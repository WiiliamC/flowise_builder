import type { Diagnostic } from '../domain/diagnostics.js'
import type { FlowData } from '../domain/flow-data.js'
import type { NodeDataSchema } from '../domain/node-catalog.js'
import type { Chatflow } from '../flowise/flowise-api-types.js'
import { FlowiseError } from '../flowise/flowise-client.js'
import { semanticDiff } from './diff-flow.js'
import { validateFlow } from './validate-flow.js'

interface CopyClient {
  getChatflow(id: string): Promise<Chatflow>
  createAgentflow(input: { name: string; flowData: FlowData }): Promise<Chatflow>
}
interface SafeChatflow { id: string; name: string; type: string }
interface CopyResult {
  source: SafeChatflow
  destination?: SafeChatflow
  nodes: number
  edges: number
  diagnostics: Diagnostic[]
  blocked?: 'errors' | 'warnings'
  applied: boolean
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}
function isAnchorArray(value: unknown): boolean {
  return value === undefined || (Array.isArray(value) && value.every((anchor) => isRecord(anchor) && typeof anchor.id === 'string'))
}
function isInputParamArray(value: unknown): boolean {
  return value === undefined || (Array.isArray(value) && value.every((param) =>
    isRecord(param)
    && typeof param.name === 'string'
    && typeof param.label === 'string'
    && typeof param.type === 'string'
    && (param.show === undefined || isRecord(param.show))
    && (param.hide === undefined || isRecord(param.hide))
    && (param.options === undefined || (Array.isArray(param.options) && param.options.every((option) => typeof option === 'string' || (isRecord(option) && typeof option.name === 'string'))))
    && isInputParamArray(param.array)))
}
function isFlowNode(value: unknown): boolean {
  if (!isRecord(value) || typeof value.id !== 'string' || typeof value.type !== 'string' || !isRecord(value.position) || !isRecord(value.data)) return false
  return typeof value.position.x === 'number'
    && typeof value.position.y === 'number'
    && typeof value.data.id === 'string'
    && typeof value.data.name === 'string'
    && typeof value.data.label === 'string'
    && isRecord(value.data.inputs)
    && isAnchorArray(value.data.inputAnchors)
    && isAnchorArray(value.data.outputAnchors)
    && isInputParamArray(value.data.inputParams)
}
function isFlowEdge(value: unknown): boolean {
  return isRecord(value)
    && typeof value.id === 'string'
    && typeof value.source === 'string'
    && typeof value.target === 'string'
    && typeof value.type === 'string'
    && (value.sourceHandle === undefined || typeof value.sourceHandle === 'string')
    && (value.targetHandle === undefined || typeof value.targetHandle === 'string')
}
function parseRemote(remote: Chatflow): FlowData {
  try {
    const flowData: unknown = typeof remote.flowData === 'string' ? JSON.parse(remote.flowData) : remote.flowData
    if (!isRecord(flowData) || !Array.isArray(flowData.nodes) || !flowData.nodes.every(isFlowNode) || !Array.isArray(flowData.edges) || !flowData.edges.every(isFlowEdge)) throw new Error('invalid shape')
    return flowData as unknown as FlowData
  }
  catch { throw new FlowiseError('REMOTE_FLOW_DATA_INVALID', 'Remote flowData is malformed') }
}
function safeChatflow(remote: Chatflow): SafeChatflow { return { id: remote.id, name: remote.name, type: remote.type } }
function assertAgentflow(remote: Chatflow): void {
  if (remote.type !== 'AGENTFLOW') throw new FlowiseError('SOURCE_TYPE_INVALID', `Source type ${remote.type} is not AGENTFLOW`)
}
function blocked(diagnostics: Diagnostic[], allowWarnings: boolean): CopyResult['blocked'] | undefined {
  if (diagnostics.some((item) => item.severity === 'error')) return 'errors'
  if (!allowWarnings && diagnostics.some((item) => item.severity === 'warning')) return 'warnings'
  return undefined
}
function copyDiagnostics(flowData: FlowData, catalog: NodeDataSchema[]): Diagnostic[] {
  const diagnostics = validateFlow(flowData, catalog).diagnostics
  const componentNames = new Set(catalog.map((item) => item.name))
  for (const node of flowData.nodes) if (!componentNames.has(node.data.name)) diagnostics.push({
    code: 'COMPONENT_NOT_FOUND',
    severity: 'error',
    message: `Component not found: ${node.data.name}`,
    nodeId: node.id,
    path: `nodes.${node.id}.data.name`
  })
  return diagnostics
}

export async function copyAgentflow(client: CopyClient, catalog: NodeDataSchema[], input: { sourceId: string; name: string; allowWarnings?: boolean; apply: boolean }): Promise<CopyResult> {
  const source = await client.getChatflow(input.sourceId)
  assertAgentflow(source)
  const flowData = parseRemote(source)
  const diagnostics = copyDiagnostics(flowData, catalog)
  const reason = blocked(diagnostics, Boolean(input.allowWarnings))
  const result = { source: safeChatflow(source), nodes: flowData.nodes.length, edges: flowData.edges.length, diagnostics, ...(reason ? { blocked: reason } : {}), applied: false } satisfies CopyResult
  if (reason || !input.apply) return result

  const latest = await client.getChatflow(input.sourceId)
  assertAgentflow(latest)
  const latestFlowData = parseRemote(latest)
  if (latest.updatedDate !== source.updatedDate || semanticDiff(flowData, latestFlowData).changed) throw new FlowiseError('REMOTE_CHANGED', 'Source Agentflow changed before copy')
  const latestDiagnostics = copyDiagnostics(latestFlowData, catalog)
  const latestBlocked = blocked(latestDiagnostics, Boolean(input.allowWarnings))
  if (latestBlocked) return { source: safeChatflow(latest), nodes: latestFlowData.nodes.length, edges: latestFlowData.edges.length, diagnostics: latestDiagnostics, blocked: latestBlocked, applied: false }

  const created = await client.createAgentflow({ name: input.name, flowData: latestFlowData })
  const persisted = await client.getChatflow(created.id)
  if (persisted.type !== 'AGENTFLOW' || persisted.name !== input.name || semanticDiff(latestFlowData, parseRemote(persisted)).changed) throw new FlowiseError('REMOTE_PERSISTENCE_MISMATCH', 'Persisted Agentflow differs from the copied source')
  return { source: safeChatflow(latest), destination: safeChatflow(persisted), nodes: latestFlowData.nodes.length, edges: latestFlowData.edges.length, diagnostics: latestDiagnostics, applied: true }
}
