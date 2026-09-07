import type { Chatflow } from '../flowise/flowise-api-types.js'
import { FlowiseError } from '../flowise/flowise-client.js'

interface RenameClient {
  getChatflow(id: string): Promise<Chatflow>
  renameAgentflow(id: string, input: { name: string }): Promise<Chatflow>
}

export async function renameAgentflow(client: RenameClient, input: { targetId: string; name: string; ifMatchUpdatedAt?: string; apply: boolean }) {
  if (!input.targetId.trim()) throw new FlowiseError('TARGET_ID_REQUIRED', 'Rename requires a target ID')
  if (!input.name.trim()) throw new FlowiseError('NAME_INVALID', 'Agentflow name must not be empty')
  const remote = await client.getChatflow(input.targetId)
  if (remote.type !== 'AGENTFLOW') throw new FlowiseError('TARGET_NOT_AGENTFLOW', 'Target is not an Agentflow')
  if (input.ifMatchUpdatedAt !== undefined && (!input.ifMatchUpdatedAt.trim() || remote.updatedDate !== input.ifMatchUpdatedAt)) throw new FlowiseError('REMOTE_CHANGED', 'Remote Agentflow changed since it was inspected')
  const summary = { before: { name: remote.name }, after: { name: input.name } }
  if (remote.name === input.name) return { changed: false, applied: false, ...summary }
  if (!input.apply) return { changed: true, applied: false, ...summary }

  const latest = await client.getChatflow(input.targetId)
  if (latest.type !== remote.type || latest.name !== remote.name || latest.updatedDate !== remote.updatedDate) throw new FlowiseError('REMOTE_CHANGED', 'Remote Agentflow changed before rename')
  try {
    await client.renameAgentflow(input.targetId, { name: input.name })
  } catch (error) {
    if (error instanceof FlowiseError) throw new FlowiseError(error.code, 'Agentflow rename failed', error.status, error.requestId)
    throw new FlowiseError('REMOTE_WRITE_FAILED', 'Agentflow rename failed')
  }
  const persisted = await client.getChatflow(input.targetId)
  if (persisted.id !== input.targetId || persisted.type !== 'AGENTFLOW' || persisted.name !== input.name) throw new FlowiseError('REMOTE_PERSISTENCE_MISMATCH', 'Persisted Agentflow differs from the requested rename')
  return { changed: true, applied: true, ...summary }
}
