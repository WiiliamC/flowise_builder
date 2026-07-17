import type { FlowData } from '../domain/flow-data.js'
import type { Chatflow } from '../flowise/flowise-api-types.js'
import { FlowiseError } from '../flowise/flowise-client.js'
import { semanticDiff } from './diff-flow.js'

interface UpdateClient { getChatflow(id: string): Promise<Chatflow>; updateAgentflow(id: string, input: { name?: string; flowData: FlowData }): Promise<Chatflow> }
function parseRemote(remote: Chatflow): FlowData { try { return typeof remote.flowData === 'string' ? JSON.parse(remote.flowData) as FlowData : remote.flowData } catch { throw new FlowiseError('REMOTE_FLOW_DATA_INVALID', 'Remote flowData is malformed') } }
export async function updateAgentflow(client: UpdateClient, input: { targetId: string; flowData: FlowData; name?: string; apply: boolean; ifMatchUpdatedAt?: string; force?: boolean }) {
  const remote = await client.getChatflow(input.targetId)
  if (remote.type !== 'AGENTFLOW') throw new FlowiseError('TARGET_TYPE_INVALID', `Target type ${remote.type} is not AGENTFLOW`)
  if (!input.force && input.ifMatchUpdatedAt && remote.updatedDate !== input.ifMatchUpdatedAt) throw new FlowiseError('REMOTE_CHANGED', 'Remote Agentflow changed since it was inspected')
  const diff = semanticDiff(parseRemote(remote), input.flowData)
  const nameChanged = input.name !== undefined && input.name !== remote.name
  if (nameChanged) { diff.changed = true; diff.changes.unshift({ path: 'name', before: remote.name, after: input.name }) }
  if (!diff.changed && !nameChanged) return { changed: false, applied: false, remote, diff }
  if (!input.apply) return { changed: true, applied: false, remote, diff }
  if (!input.force) {
    const latest = await client.getChatflow(input.targetId)
    if (latest.updatedDate !== remote.updatedDate) throw new FlowiseError('REMOTE_CHANGED', 'Remote Agentflow changed before update')
  }
  await client.updateAgentflow(input.targetId, { ...(input.name ? { name: input.name } : {}), flowData: input.flowData })
  const persisted = await client.getChatflow(input.targetId)
  if (semanticDiff(input.flowData, parseRemote(persisted)).changed || (input.name !== undefined && persisted.name !== input.name)) throw new FlowiseError('REMOTE_PERSISTENCE_MISMATCH', 'Persisted Agentflow differs from the validated update')
  return { changed: true, applied: true, remote: persisted, diff: { ...diff, changed: true } }
}
