import type { FlowData } from '../domain/flow-data.js'
import type { Chatflow } from '../flowise/flowise-api-types.js'
import { FlowiseError } from '../flowise/flowise-client.js'
import { semanticDiff } from './diff-flow.js'
interface CreateClient { createAgentflow(input: { name: string; flowData: FlowData }): Promise<Chatflow>; getChatflow(id: string): Promise<Chatflow> }
function parseRemote(remote: Chatflow): FlowData { try { return typeof remote.flowData === 'string' ? JSON.parse(remote.flowData) as FlowData : remote.flowData } catch { throw new FlowiseError('REMOTE_FLOW_DATA_INVALID', 'Remote flowData is malformed') } }
export async function createAgentflow(client: CreateClient, input: { name: string; flowData: FlowData; apply: boolean }) {
  if (!input.apply) return { changed: true, applied: false }
  const created = await client.createAgentflow({ name: input.name, flowData: input.flowData })
  const persisted = await client.getChatflow(created.id)
  if (semanticDiff(input.flowData, parseRemote(persisted)).changed) throw new FlowiseError('REMOTE_PERSISTENCE_MISMATCH', 'Persisted Agentflow differs from the validated build')
  return { changed: true, applied: true, remote: persisted }
}
