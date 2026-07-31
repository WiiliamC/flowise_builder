import type { FlowData } from '../domain/flow-data.js'
import type { Chatflow } from '../flowise/flowise-api-types.js'
import { FlowiseError } from '../flowise/flowise-client.js'
import { isDeepStrictEqual } from 'node:util'
import { semanticDiff } from './diff-flow.js'
import { parseFlowData } from './inspect-agentflows.js'

interface EditClient {
  getChatflow(id: string): Promise<Chatflow>
  updateAgentflow(id: string, input: { name?: string; flowData: FlowData }): Promise<Chatflow>
}

type Message = Record<string, unknown>

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function requireAgentflow(remote: Chatflow): FlowData {
  if (remote.type !== 'AGENTFLOW') throw new FlowiseError('TARGET_NOT_AGENTFLOW', 'Target is not an Agentflow')
  return parseFlowData(remote)
}

function parseMessages(value: unknown): { messages: Message[]; encoded: boolean } {
  const encoded = typeof value === 'string'
  if (value === undefined || value === null) return { messages: [], encoded: false }
  if (encoded && !value.trim()) return { messages: [], encoded: true }
  let decoded: unknown = value
  if (encoded) {
    try { decoded = JSON.parse(value) } catch { throw new FlowiseError('AGENT_MESSAGES_INVALID', 'Agent messages are malformed') }
  }
  if (!Array.isArray(decoded) || !decoded.every(isRecord)) throw new FlowiseError('AGENT_MESSAGES_INVALID', 'Agent messages are malformed')
  return { messages: decoded, encoded }
}

function editedFlow(flow: FlowData, agentRef: string, prompt: string): { flowData: FlowData; operation: 'added' | 'replaced'; changed: boolean } {
  const match = /^n([1-9]\d*)$/.exec(agentRef)
  const node = match ? flow.nodes[Number(match[1]) - 1] : undefined
  if (!node || node.data.name !== 'agentAgentflow') throw new FlowiseError('AGENT_REF_INVALID', 'Agent reference does not identify an agent node')
  const inputs = node.data.inputs
  const parsed = parseMessages(inputs.agentMessages)
  const systemIndices = parsed.messages.flatMap((message, index) => message.role === 'system' ? [index] : [])
  if (systemIndices.length > 1) throw new FlowiseError('SYSTEM_MESSAGE_AMBIGUOUS', 'Agent has multiple system messages')
  if (systemIndices.length === 1) {
    const index = systemIndices[0]!
    if (parsed.messages[index]!.content === prompt) return { flowData: flow, operation: 'replaced', changed: false }
    parsed.messages[index] = { ...parsed.messages[index], content: prompt }
    inputs.agentMessages = parsed.encoded ? JSON.stringify(parsed.messages) : parsed.messages
    return { flowData: flow, operation: 'replaced', changed: true }
  }
  parsed.messages.unshift({ role: 'system', content: prompt })
  inputs.agentMessages = parsed.encoded ? JSON.stringify(parsed.messages) : parsed.messages
  return { flowData: flow, operation: 'added', changed: true }
}

export async function editSystemPrompt(client: EditClient, input: { targetId: string; agentRef: string; ifMatchUpdatedAt: string; prompt: string; apply: boolean }) {
  if (!input.ifMatchUpdatedAt) throw new FlowiseError('UPDATED_DATE_REQUIRED', 'An updatedDate match is required')
  if (!input.prompt.trim()) throw new FlowiseError('PROMPT_INVALID', 'System prompt must not be empty')
  const remote = await client.getChatflow(input.targetId)
  const flow = requireAgentflow(remote)
  if (remote.updatedDate !== input.ifMatchUpdatedAt) throw new FlowiseError('REMOTE_CHANGED', 'Remote Agentflow changed since it was inspected')
  const result = editedFlow(structuredClone(flow), input.agentRef, input.prompt)
  const summary = { operation: result.operation, agentRef: input.agentRef, nodes: result.flowData.nodes.length, edges: result.flowData.edges.length }
  if (!result.changed) return { changed: false, applied: false, ...summary }
  if (!input.apply) return { changed: true, applied: false, ...summary }

  const latest = await client.getChatflow(input.targetId)
  const latestFlow = requireAgentflow(latest)
  if (latest.updatedDate !== remote.updatedDate || latest.updatedDate !== input.ifMatchUpdatedAt || !isDeepStrictEqual(latestFlow, flow)) throw new FlowiseError('REMOTE_CHANGED', 'Remote Agentflow changed before update')
  try {
    await client.updateAgentflow(input.targetId, { flowData: result.flowData })
  } catch (error) {
    if (error instanceof FlowiseError) throw new FlowiseError(error.code, 'Agentflow update failed', error.status, error.requestId)
    throw new FlowiseError('REMOTE_WRITE_FAILED', 'Agentflow update failed')
  }
  const persisted = await client.getChatflow(input.targetId)
  if (semanticDiff(result.flowData, requireAgentflow(persisted)).changed) throw new FlowiseError('REMOTE_PERSISTENCE_MISMATCH', 'Persisted Agentflow differs from the requested edit')
  return { changed: true, applied: true, ...summary }
}
