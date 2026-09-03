import { createHash } from 'node:crypto'
import { isDeepStrictEqual } from 'node:util'
import type { FlowData, FlowNode } from '../domain/flow-data.js'
import type { Chatflow } from '../flowise/flowise-api-types.js'
import { FlowiseError } from '../flowise/flowise-client.js'
import { semanticDiff } from './diff-flow.js'
import { parseFlowData } from './inspect-agentflows.js'

type RecordValue = Record<string, unknown>
type McpTool = RecordValue & { agentSelectedToolConfig: RecordValue }

interface ReadClient { getChatflow(id: string): Promise<Chatflow> }
interface WriteClient extends ReadClient { updateAgentflow(id: string, input: { name?: string; flowData: FlowData }): Promise<Chatflow> }
interface DiscoveryClient extends ReadClient { loadCustomMcpActions(config: string): Promise<Array<{ name: string }>> }
interface RefreshClient extends WriteClient, DiscoveryClient {}

function isRecord(value: unknown): value is RecordValue {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function requireAgentflow(remote: Chatflow): FlowData {
  if (remote.type !== 'AGENTFLOW') throw new FlowiseError('TARGET_NOT_AGENTFLOW', 'Target is not an Agentflow')
  return parseFlowData(remote)
}

function parseArray(value: unknown, code: string, message: string): { values: unknown[]; encoded: boolean } {
  const encoded = typeof value === 'string'
  if (value === undefined || value === null || value === '') return { values: [], encoded }
  let decoded = value
  if (encoded) {
    try { decoded = JSON.parse(value) } catch { throw new FlowiseError(code, message) }
  }
  if (!Array.isArray(decoded)) throw new FlowiseError(code, message)
  return { values: decoded, encoded }
}

function agentNode(flow: FlowData, agentRef: string): FlowNode {
  const match = /^n([1-9]\d*)$/.exec(agentRef)
  const node = match ? flow.nodes[Number(match[1]) - 1] : undefined
  if (!node || node.data.name !== 'agentAgentflow') throw new FlowiseError('AGENT_REF_INVALID', 'Agent reference does not identify an agent node')
  return node
}

function customMcpTools(node: FlowNode): { tools: unknown[]; encoded: boolean; matches: Array<{ index: number; tool: McpTool }> } {
  const parsed = parseArray(node.data.inputs.agentTools, 'MCP_REF_INVALID', 'Agent tools are malformed')
  const matches = parsed.values.flatMap((value, index) => {
    if (!isRecord(value) || value.agentSelectedTool !== 'customMCP' || !isRecord(value.agentSelectedToolConfig)) return []
    return [{ index, tool: value as McpTool }]
  })
  return { tools: parsed.values, encoded: parsed.encoded, matches }
}

function mcpMatch(node: FlowNode, mcpRef: string) {
  const tools = customMcpTools(node)
  const match = /^m([1-9]\d*)$/.exec(mcpRef)
  const selected = match ? tools.matches[Number(match[1]) - 1] : undefined
  if (!selected) throw new FlowiseError('MCP_REF_INVALID', 'MCP reference does not identify an existing Custom MCP')
  return { ...tools, ...selected }
}

function configText(config: unknown): string {
  if (typeof config === 'string') return config
  if (isRecord(config)) return JSON.stringify(config)
  throw new FlowiseError('MCP_CONFIG_INVALID', 'Custom MCP configuration is invalid')
}

function inspectionConfig(config: unknown): { text: string; parsed?: RecordValue } {
  const text = typeof config === 'string' ? config : isRecord(config) ? JSON.stringify(config) : ''
  try {
    const parsed: unknown = JSON.parse(text)
    return { text, ...(isRecord(parsed) ? { parsed } : {}) }
  } catch { return { text } }
}

function parseConfig(text: string): RecordValue {
  try {
    const parsed: unknown = JSON.parse(text)
    if (!isRecord(parsed)) throw new Error('not an object')
    return parsed
  } catch {
    throw new FlowiseError('MCP_CONFIG_INVALID', 'Custom MCP configuration must be strict JSON object text')
  }
}

function actionNames(value: unknown): { names: string[]; encoded: boolean } {
  const parsed = parseArray(value, 'MCP_ACTION_SELECTION_INVALID', 'Stored MCP action selection is malformed')
  if (!parsed.values.every((item) => typeof item === 'string' && item.length > 0)) throw new FlowiseError('MCP_ACTION_SELECTION_INVALID', 'Stored MCP action selection is malformed')
  return { names: [...new Set(parsed.values as string[])], encoded: parsed.encoded }
}

function transportOf(config: RecordValue): 'stdio' | 'sse' | 'streamable-http' | 'unknown' {
  if (typeof config.command === 'string') return 'stdio'
  if (typeof config.url !== 'string') return 'unknown'
  if (config.type === 'sse') return 'sse'
  if (config.type === 'streamableHttp' || config.type === 'streamable-http') return 'streamable-http'
  return 'sse'
}

export function inspectAgentMcp(remote: Chatflow, agentRef: string) {
  const node = agentNode(requireAgentflow(remote), agentRef)
  const { matches } = customMcpTools(node)
  return {
    agentRef,
    ...(remote.updatedDate ? { updatedDate: remote.updatedDate } : {}),
    mcps: matches.map(({ tool }, index) => {
      const config = inspectionConfig(tool.agentSelectedToolConfig.mcpServerConfig)
      return {
        ref: `m${index + 1}`,
        transport: config.parsed ? transportOf(config.parsed) : 'unknown' as const,
        configHash: createHash('sha256').update(config.text).digest('hex'),
        hasFlowiseVariableRefs: /\{\{\s*\$vars\.[^}]+\}\}/.test(config.text),
        enabledActionCount: actionNames(tool.agentSelectedToolConfig.mcpActions).names.length
      }
    })
  }
}

function replaceTools(node: FlowNode, tools: unknown[], encoded: boolean) {
  node.data.inputs.agentTools = encoded ? JSON.stringify(tools) : tools
}

async function guardedWrite(client: WriteClient, input: { targetId: string; original: Chatflow; originalFlow: FlowData; editedFlow: FlowData }) {
  const latest = await client.getChatflow(input.targetId)
  const latestFlow = requireAgentflow(latest)
  if (latest.updatedDate !== input.original.updatedDate || !isDeepStrictEqual(latestFlow, input.originalFlow)) throw new FlowiseError('REMOTE_CHANGED', 'Remote Agentflow changed before update')
  try {
    await client.updateAgentflow(input.targetId, { flowData: input.editedFlow })
  } catch (error) {
    if (error instanceof FlowiseError) throw new FlowiseError(error.code, 'Agentflow update failed', error.status, error.requestId)
    throw new FlowiseError('REMOTE_WRITE_FAILED', 'Agentflow update failed')
  }
  const persisted = await client.getChatflow(input.targetId)
  if (semanticDiff(input.editedFlow, requireAgentflow(persisted)).changed) throw new FlowiseError('REMOTE_PERSISTENCE_MISMATCH', 'Persisted Agentflow differs from the requested edit')
}

export async function editAgentMcp(client: WriteClient, input: { targetId: string; agentRef: string; mcpRef: string; ifMatchUpdatedAt: string; configText: string; apply: boolean }) {
  if (!input.ifMatchUpdatedAt) throw new FlowiseError('UPDATED_DATE_REQUIRED', 'An updatedDate match is required')
  parseConfig(input.configText)
  const remote = await client.getChatflow(input.targetId)
  const flow = requireAgentflow(remote)
  if (remote.updatedDate !== input.ifMatchUpdatedAt) throw new FlowiseError('REMOTE_CHANGED', 'Remote Agentflow changed since it was inspected')
  const edited = structuredClone(flow)
  const node = agentNode(edited, input.agentRef)
  const match = mcpMatch(node, input.mcpRef)
  const previous = match.tool.agentSelectedToolConfig.mcpServerConfig
  if (previous === input.configText) return { agentRef: input.agentRef, mcpRef: input.mcpRef, changed: false, applied: false, nodes: flow.nodes.length, edges: flow.edges.length }
  match.tool.agentSelectedToolConfig.mcpServerConfig = input.configText
  replaceTools(node, match.tools, match.encoded)
  if (input.apply) await guardedWrite(client, { targetId: input.targetId, original: remote, originalFlow: flow, editedFlow: edited })
  return { agentRef: input.agentRef, mcpRef: input.mcpRef, changed: true, applied: input.apply, nodes: flow.nodes.length, edges: flow.edges.length }
}

export async function refreshAgentMcpActions(client: RefreshClient, input: { targetId: string; agentRef: string; mcpRef: string; enableActions: string[]; enableAll: boolean; ifMatchUpdatedAt?: string; showActionNames: boolean; apply: boolean }) {
  if (input.enableAll && input.enableActions.length) throw new FlowiseError('MCP_ACTION_SELECTION_INVALID', '--enable-all and --enable-action are mutually exclusive')
  const enableIntent = input.enableAll || input.enableActions.length > 0
  if (input.apply && !enableIntent) throw new FlowiseError('MCP_ACTION_SELECTION_INVALID', '--apply requires an action enablement option')
  if (enableIntent && !input.ifMatchUpdatedAt) throw new FlowiseError('UPDATED_DATE_REQUIRED', 'An updatedDate match is required for action enablement')
  const remote = await client.getChatflow(input.targetId)
  const flow = requireAgentflow(remote)
  if (input.ifMatchUpdatedAt && remote.updatedDate !== input.ifMatchUpdatedAt) throw new FlowiseError('REMOTE_CHANGED', 'Remote Agentflow changed since it was inspected')
  const sourceNode = agentNode(flow, input.agentRef)
  const sourceMatch = mcpMatch(sourceNode, input.mcpRef)
  const text = configText(sourceMatch.tool.agentSelectedToolConfig.mcpServerConfig)
  parseConfig(text)
  let discovered: Array<{ name: string }>
  try { discovered = await client.loadCustomMcpActions(text) }
  catch (error) {
    if (error instanceof FlowiseError && error.code === 'MCP_TARGET_DENIED_BY_POLICY') throw error
    throw new FlowiseError('MCP_ACTION_DISCOVERY_FAILED', 'Custom MCP action discovery failed')
  }
  const available = [...new Set(discovered.map((option) => option.name))]
  const current = actionNames(sourceMatch.tool.agentSelectedToolConfig.mcpActions)
  const unknown = input.enableActions.filter((name) => !available.includes(name))
  if (unknown.length) throw new FlowiseError('MCP_ACTION_SELECTION_INVALID', 'One or more requested MCP actions are unavailable')
  const additions = input.enableAll ? available : input.enableActions
  const enabled = [...new Set([...current.names, ...additions])]
  const newlyAvailable = available.filter((name) => !current.names.includes(name))
  const missing = current.names.filter((name) => !available.includes(name))
  const changed = enableIntent && !isDeepStrictEqual(enabled, current.names)
  const result = {
    agentRef: input.agentRef, mcpRef: input.mcpRef,
    availableCount: available.length, enabledCount: enabled.length, newCount: newlyAvailable.length, missingCount: missing.length,
    changed, applied: false,
    ...(input.showActionNames ? { availableNames: available, enabledNames: enabled, newNames: newlyAvailable, missingNames: missing } : {})
  }
  if (!changed || !input.apply) return result

  const edited = structuredClone(flow)
  const editedNode = agentNode(edited, input.agentRef)
  const editedMatch = mcpMatch(editedNode, input.mcpRef)
  editedMatch.tool.agentSelectedToolConfig.mcpActions = current.encoded ? JSON.stringify(enabled) : enabled
  replaceTools(editedNode, editedMatch.tools, editedMatch.encoded)
  await guardedWrite(client, { targetId: input.targetId, original: remote, originalFlow: flow, editedFlow: edited })
  return { ...result, applied: true }
}
