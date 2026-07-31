import type { Diagnostic } from '../domain/diagnostics.js'
import type { FlowData, FlowNode } from '../domain/flow-data.js'
import type { Chatflow } from '../flowise/flowise-api-types.js'
import { FlowiseError } from '../flowise/flowise-client.js'

export interface AgentflowListItem {
  id: string
  name: string
  type: 'AGENTFLOW'
  createdDate?: string
  updatedDate?: string
  deployed?: boolean
  isPublic?: boolean
  nodes: number | null
  edges: number | null
}

export interface AgentflowCapabilitySummary {
  model?: { component?: string; credentialConfigured: boolean; customEndpointConfigured: boolean }
  messages?: { count: number; roles: string[] }
  tools?: { count: number; components: string[]; humanApprovalCount: number }
  memory?: { enabled: boolean; type?: string }
  state?: { entryCount: number; persist: boolean; updateConfigured: boolean }
}

export interface AgentflowInspection {
  agentflow: Omit<AgentflowListItem, 'nodes' | 'edges'>
  graph: {
    nodes: Array<{
      ref: string
      label: string
      component: string
      type?: string
      category?: string
      parentRef?: string
      configuredInputs: string[]
      capabilities: AgentflowCapabilitySummary
    }>
    edges: Array<{ from: string; to: string; type: string; outputIndex?: number; inputIndex?: number }>
  }
  analysis: { startRefs: string[]; branchRefs: string[]; humanApprovalRefs: string[] }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function isAnchorArray(value: unknown): boolean {
  return value === undefined || (Array.isArray(value) && value.every((anchor) => isRecord(anchor) && typeof anchor.id === 'string'))
}

function isFlowNode(value: unknown): value is FlowNode {
  if (!isRecord(value) || typeof value.id !== 'string' || typeof value.type !== 'string' || !isRecord(value.position) || !isRecord(value.data)) return false
  const data = value.data
  return typeof value.position.x === 'number'
    && typeof value.position.y === 'number'
    && typeof data.id === 'string'
    && typeof data.name === 'string'
    && typeof data.label === 'string'
    && isRecord(data.inputs)
    && isAnchorArray(data.inputAnchors)
    && isAnchorArray(data.outputAnchors)
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

function parseFlowData(remote: Chatflow): FlowData {
  try {
    const parsed: unknown = typeof remote.flowData === 'string' ? JSON.parse(remote.flowData) : remote.flowData
    if (!isRecord(parsed) || !Array.isArray(parsed.nodes) || !parsed.nodes.every(isFlowNode) || !Array.isArray(parsed.edges) || !parsed.edges.every(isFlowEdge)) throw new Error('invalid shape')
    const nodeIds = new Set<string>()
    for (const node of parsed.nodes) {
      if (nodeIds.has(node.id)) throw new Error('duplicate node id')
      nodeIds.add(node.id)
    }
    if (parsed.edges.some((edge) => !nodeIds.has(edge.source) || !nodeIds.has(edge.target))) throw new Error('dangling edge endpoint')
    return parsed as unknown as FlowData
  } catch {
    throw new FlowiseError('REMOTE_FLOW_DATA_INVALID', 'Remote flowData is malformed')
  }
}

function optionalMetadata(remote: Chatflow) {
  return {
    ...(remote.createdDate ? { createdDate: remote.createdDate } : {}),
    ...(remote.updatedDate ? { updatedDate: remote.updatedDate } : {}),
    ...(typeof remote.deployed === 'boolean' ? { deployed: remote.deployed } : {}),
    ...(typeof remote.isPublic === 'boolean' ? { isPublic: remote.isPublic } : {})
  }
}

export function listAgentflows(chatflows: Chatflow[]): {
  agentflows: AgentflowListItem[]
  diagnostics: Diagnostic[]
  nodes: number
  edges: number
} {
  const diagnostics: Diagnostic[] = []
  let nodes = 0
  let edges = 0
  const agentflows = chatflows.filter((item) => item.type === 'AGENTFLOW').map((item, index): AgentflowListItem => {
    try {
      const flow = parseFlowData(item)
      nodes += flow.nodes.length
      edges += flow.edges.length
      return { id: item.id, name: item.name, type: 'AGENTFLOW', ...optionalMetadata(item), nodes: flow.nodes.length, edges: flow.edges.length }
    } catch {
      diagnostics.push({
        code: 'REMOTE_FLOW_DATA_INVALID',
        severity: 'warning',
        message: `Agentflow #${index + 1} has malformed flowData`,
        path: `agentflows[${index}].flowData`
      })
      return { id: item.id, name: item.name, type: 'AGENTFLOW', ...optionalMetadata(item), nodes: null, edges: null }
    }
  })
  return { agentflows, diagnostics, nodes, edges }
}

function configured(value: unknown): boolean {
  if (value === undefined || value === null || value === '') return false
  if (Array.isArray(value)) return value.length > 0
  if (typeof value === 'object') return Object.keys(value).length > 0
  return true
}

function decodedArray(value: unknown): unknown[] {
  if (Array.isArray(value)) return value
  if (typeof value !== 'string' || !value.trim()) return []
  try {
    const parsed: unknown = JSON.parse(value)
    return Array.isArray(parsed) ? parsed : []
  } catch {
    return []
  }
}

function firstString(record: Record<string, unknown>, keys: string[]): string | undefined {
  for (const key of keys) if (typeof record[key] === 'string' && record[key]) return record[key]
  return undefined
}

function containsConfiguredKey(value: unknown, matcher: RegExp): boolean {
  if (!value || typeof value !== 'object') return false
  return Object.entries(value).some(([key, child]) => (matcher.test(key) && configured(child)) || containsConfiguredKey(child, matcher))
}

function capabilities(node: FlowNode): AgentflowCapabilitySummary {
  const inputs = node.data.inputs ?? {}
  const result: AgentflowCapabilitySummary = {}

  const modelEntry = Object.entries(inputs).find(([key, value]) => /Model$/.test(key) && typeof value === 'string' && value)
  if (modelEntry) {
    const configKey = `${modelEntry[0]}Config`
    const config = inputs[configKey] && typeof inputs[configKey] === 'object'
      ? inputs[configKey] as Record<string, unknown>
      : Object.values(inputs).find((value) => value && typeof value === 'object' && ('modelName' in value || 'credential' in value)) as Record<string, unknown> | undefined
    result.model = {
      component: String(modelEntry[1]),
      credentialConfigured: containsConfiguredKey(config, /credential/i),
      customEndpointConfigured: containsConfiguredKey(config, /^(base(path|url)|endpoint|host)$/i)
    }
  }

  const messageEntry = Object.entries(inputs).find(([key]) => /Messages$/.test(key))
  if (messageEntry) {
    const messages = decodedArray(messageEntry[1])
    const roles = [...new Set(messages.flatMap((message) => {
      if (!message || typeof message !== 'object') return []
      const role = firstString(message as Record<string, unknown>, ['role', 'type'])
      return role ? [role] : []
    }))]
    result.messages = { count: messages.length, roles }
  }

  const toolEntries = Object.entries(inputs).filter(([key]) => /Tools(?:BuiltIn[A-Za-z0-9]+)?$/.test(key))
  if (toolEntries.length) {
    const tools = toolEntries.flatMap(([, value]) => decodedArray(value))
    const components = [...new Set(tools.flatMap((tool) => {
      if (typeof tool === 'string' && tool) return [tool]
      if (!tool || typeof tool !== 'object') return []
      const component = firstString(tool as Record<string, unknown>, ['agentSelectedTool', 'selectedTool', 'component'])
      return component ? [component] : []
    }))]
    const humanApprovalCount = tools.filter((tool) =>
      Boolean(tool && typeof tool === 'object' && (tool as Record<string, unknown>).agentSelectedToolRequiresHumanInput)
    ).length
    result.tools = { count: tools.length, components, humanApprovalCount }
  }

  const enableMemory = Object.entries(inputs).find(([key]) => /EnableMemory$/.test(key))
  const memoryType = Object.entries(inputs).find(([key]) => /MemoryType$/.test(key))
  if (enableMemory || memoryType) {
    result.memory = {
      enabled: Boolean(enableMemory?.[1]),
      ...(typeof memoryType?.[1] === 'string' && memoryType[1] ? { type: memoryType[1] } : {})
    }
  }

  const stateEntry = Object.entries(inputs).find(([key]) => /State$/.test(key) && !/PersistState$/.test(key) && !/UpdateState$/.test(key))
  const persistState = Object.entries(inputs).find(([key]) => /PersistState$/.test(key))
  const updateState = Object.entries(inputs).find(([key]) => /UpdateState$/.test(key))
  if (stateEntry || persistState || updateState) {
    result.state = {
      entryCount: decodedArray(stateEntry?.[1]).length,
      persist: Boolean(persistState?.[1]),
      updateConfigured: configured(updateState?.[1])
    }
  }
  return result
}

function anchorIndex(node: FlowNode | undefined, handle: string | undefined, kind: 'input' | 'output'): number | undefined {
  if (!node || !handle) return undefined
  const anchors = kind === 'input' ? node.data.inputAnchors : node.data.outputAnchors
  const index = anchors?.findIndex((anchor) => anchor.id === handle)
  return index !== undefined && index >= 0 ? index : undefined
}

export function inspectAgentflow(remote: Chatflow): AgentflowInspection {
  if (remote.type !== 'AGENTFLOW') throw new FlowiseError('TARGET_NOT_AGENTFLOW', 'Target is not an Agentflow')
  const flow = parseFlowData(remote)
  const refs = new Map(flow.nodes.map((node, index) => [node.id, `n${index + 1}`]))
  const byId = new Map(flow.nodes.map((node) => [node.id, node]))
  const graphNodes = flow.nodes.map((node) => {
    const parentRef = node.parentNode ? refs.get(node.parentNode) : undefined
    return {
      ref: refs.get(node.id)!,
      label: node.data.label,
      component: node.data.name,
      ...(node.data.type ? { type: node.data.type } : {}),
      ...(node.data.category ? { category: node.data.category } : {}),
      ...(parentRef ? { parentRef } : {}),
      configuredInputs: Object.entries(node.data.inputs ?? {}).filter(([, value]) => configured(value)).map(([key]) => key).sort(),
      capabilities: capabilities(node)
    }
  })
  const graphEdges = flow.edges.map((edge) => {
    const source = byId.get(edge.source)
    const target = byId.get(edge.target)
    const outputIndex = anchorIndex(source, edge.sourceHandle, 'output')
    const inputIndex = anchorIndex(target, edge.targetHandle, 'input')
    return {
      from: refs.get(edge.source)!,
      to: refs.get(edge.target)!,
      type: edge.type,
      ...(outputIndex !== undefined ? { outputIndex } : {}),
      ...(inputIndex !== undefined ? { inputIndex } : {})
    }
  })
  const outgoing = new Map<string, number>()
  for (const edge of graphEdges) outgoing.set(edge.from, (outgoing.get(edge.from) ?? 0) + 1)
  const humanApprovalRefs = graphNodes.filter((node) =>
    node.component === 'humanInputAgentflow' || (node.capabilities.tools?.humanApprovalCount ?? 0) > 0
  ).map((node) => node.ref)
  return {
    agentflow: { id: remote.id, name: remote.name, type: 'AGENTFLOW', ...optionalMetadata(remote) },
    graph: { nodes: graphNodes, edges: graphEdges },
    analysis: {
      startRefs: graphNodes.filter((node) => node.component === 'startAgentflow').map((node) => node.ref),
      branchRefs: graphNodes.filter((node) => (outgoing.get(node.ref) ?? 0) > 1).map((node) => node.ref),
      humanApprovalRefs
    }
  }
}
