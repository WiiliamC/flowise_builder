import { describe, expect, it, vi } from 'vitest'
import { updateAgentflow } from '../src/application/update-flow.js'
import { createAgentflow } from '../src/application/create-flow.js'
import type { Chatflow } from '../src/flowise/flowise-api-types.js'

const flow = { nodes: [], edges: [] }
const remote: Chatflow = { id: 'x', name: 'x', type: 'AGENTFLOW', flowData: JSON.stringify(flow), updatedDate: '2025-01-01' }

describe('update guards', () => {
  it('rejects non-Agentflow and skips no-op PUT', async () => {
    const client = { getChatflow: vi.fn().mockResolvedValue(remote), updateAgentflow: vi.fn() }
    await expect(updateAgentflow(client, { targetId: 'x', flowData: flow, name: 'x', apply: true })).resolves.toMatchObject({ changed: false, applied: false })
    expect(client.updateAgentflow).not.toHaveBeenCalled()
    client.getChatflow.mockResolvedValue({ ...remote, type: 'CHATFLOW' })
    await expect(updateAgentflow(client, { targetId: 'x', flowData: flow, name: 'x', apply: true })).rejects.toMatchObject({ code: 'TARGET_TYPE_INVALID' })
  })
  it('detects a change immediately before PUT', async () => {
    const changedFlow = { nodes: [{ id: 's', type: 'agentflowNode', position: { x: 0, y: 0 }, data: { id: 's', name: 'startAgentflow', label: 'Start', inputs: {} } }], edges: [] }
    const client = {
      getChatflow: vi.fn().mockResolvedValueOnce(remote).mockResolvedValueOnce({ ...remote, updatedDate: '2025-01-02' }),
      updateAgentflow: vi.fn()
    }
    await expect(updateAgentflow(client, { targetId: 'x', flowData: changedFlow, name: 'x', apply: true })).rejects.toMatchObject({ code: 'REMOTE_CHANGED' })
    expect(client.updateAgentflow).not.toHaveBeenCalled()
  })

  it('reads created and updated flows back before reporting success', async () => {
    const created = { ...remote, id: 'created' }
    const createClient = { createAgentflow: vi.fn().mockResolvedValue(created), getChatflow: vi.fn().mockResolvedValue(created) }
    await expect(createAgentflow(createClient, { name: 'x', flowData: flow, apply: true })).resolves.toMatchObject({ applied: true, remote: created })
    expect(createClient.getChatflow).toHaveBeenCalledWith('created')

    const changedFlow = { nodes: [{ id: 's', type: 'agentflowNode', position: { x: 0, y: 0 }, data: { id: 's', name: 'startAgentflow', label: 'Start', inputs: {} } }], edges: [] }
    const persisted = { ...remote, flowData: JSON.stringify(changedFlow) }
    const updateClient = {
      getChatflow: vi.fn().mockResolvedValueOnce(remote).mockResolvedValueOnce(remote).mockResolvedValueOnce(persisted),
      updateAgentflow: vi.fn().mockResolvedValue(persisted)
    }
    await expect(updateAgentflow(updateClient, { targetId: 'x', flowData: changedFlow, name: 'x', apply: true })).resolves.toMatchObject({ applied: true, remote: persisted })
    expect(updateClient.getChatflow).toHaveBeenCalledTimes(3)
  })

  it('rejects a create whose persisted FlowData differs from the validated build', async () => {
    const created = { ...remote, id: 'created' }
    const changed = { ...created, flowData: JSON.stringify({ nodes: [], edges: [{ id: 'unexpected', source: 'a', target: 'b', type: 'default' }] }) }
    const client = { createAgentflow: vi.fn().mockResolvedValue(created), getChatflow: vi.fn().mockResolvedValue(changed) }
    await expect(createAgentflow(client, { name: 'x', flowData: flow, apply: true })).rejects.toMatchObject({ code: 'REMOTE_PERSISTENCE_MISMATCH' })
  })
})
