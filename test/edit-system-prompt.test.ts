import { describe, expect, it, vi } from 'vitest'
import { editSystemPrompt } from '../src/application/edit-system-prompt.js'
import type { Chatflow } from '../src/flowise/flowise-api-types.js'

const node = (name: string, messages: unknown) => ({
  id: `${name}-private-id`, type: 'agentflowNode', position: { x: 0, y: 0 },
  data: { id: `${name}-private-id`, name, label: name, inputs: { agentMessages: messages } }
})
const remote = (messages: unknown, updatedDate = '2026-01-01'): Chatflow => ({
  id: 'target', name: 'target', type: 'AGENTFLOW', updatedDate,
  flowData: JSON.stringify({ nodes: [node('startAgentflow', []), node('agentAgentflow', messages)], edges: [] })
})

describe('edit system prompt', () => {
  it('adds the first system message when agentMessages is absent', async () => {
    const source = remote([])
    const sourceFlow = JSON.parse(String(source.flowData))
    delete sourceFlow.nodes[1].data.inputs.agentMessages
    source.flowData = JSON.stringify(sourceFlow)
    const persisted = remote([{ role: 'system', content: 'first prompt' }])
    const client = { getChatflow: vi.fn().mockResolvedValueOnce(source).mockResolvedValueOnce(source).mockResolvedValueOnce(persisted), updateAgentflow: vi.fn() }

    await expect(editSystemPrompt(client, { targetId: 'target', agentRef: 'n2', ifMatchUpdatedAt: '2026-01-01', prompt: 'first prompt', apply: true })).resolves.toMatchObject({ changed: true, applied: true, operation: 'added' })
    expect(client.updateAgentflow.mock.calls[0]![1].flowData.nodes[1]!.data.inputs.agentMessages).toEqual([{ role: 'system', content: 'first prompt' }])
  })

  it('uses inspection-order agent refs and preserves JSON-string message representation', async () => {
    const source = remote(JSON.stringify([{ role: 'user', content: 'keep', metadata: { x: true } }]))
    const persisted = remote(JSON.stringify([{ role: 'system', content: 'new prompt' }, { role: 'user', content: 'keep', metadata: { x: true } }]))
    const client = { getChatflow: vi.fn().mockResolvedValueOnce(source).mockResolvedValueOnce(source).mockResolvedValueOnce(persisted), updateAgentflow: vi.fn().mockResolvedValue(persisted) }

    await expect(editSystemPrompt(client, { targetId: 'target', agentRef: 'n2', ifMatchUpdatedAt: '2026-01-01', prompt: 'new prompt', apply: true })).resolves.toMatchObject({ changed: true, applied: true, operation: 'added', agentRef: 'n2' })
    const updated = client.updateAgentflow.mock.calls[0]![1].flowData.nodes[1]!.data.inputs.agentMessages
    expect(typeof updated).toBe('string')
    expect(JSON.parse(updated)).toEqual([{ role: 'system', content: 'new prompt' }, { role: 'user', content: 'keep', metadata: { x: true } }])
  })

  it('replaces only system content and avoids PUT for no-op', async () => {
    const source = remote([{ role: 'system', content: 'same', pinned: true }, { role: 'user', content: 'keep' }])
    const changing = { getChatflow: vi.fn().mockResolvedValueOnce(source).mockResolvedValueOnce(source).mockResolvedValueOnce(remote([{ role: 'system', content: 'changed', pinned: true }, { role: 'user', content: 'keep' }])), updateAgentflow: vi.fn() }
    await expect(editSystemPrompt(changing, { targetId: 'target', agentRef: 'n2', ifMatchUpdatedAt: '2026-01-01', prompt: 'changed', apply: true })).resolves.toMatchObject({ operation: 'replaced', applied: true })
    expect(changing.updateAgentflow.mock.calls[0]![1].flowData.nodes[1]!.data.inputs.agentMessages).toEqual([{ role: 'system', content: 'changed', pinned: true }, { role: 'user', content: 'keep' }])

    const noop = { getChatflow: vi.fn().mockResolvedValue(source), updateAgentflow: vi.fn() }
    await expect(editSystemPrompt(noop, { targetId: 'target', agentRef: 'n2', ifMatchUpdatedAt: '2026-01-01', prompt: 'same', apply: true })).resolves.toMatchObject({ changed: false, applied: false })
    expect(noop.updateAgentflow).not.toHaveBeenCalled()
  })

  it('rejects unsafe targets, conflicting messages, stale versions, and concurrent writes without leaking content', async () => {
    const client = { getChatflow: vi.fn().mockResolvedValue(remote([{ role: 'system', content: 'secret' }, { role: 'system', content: 'another secret' }])), updateAgentflow: vi.fn() }
    await expect(editSystemPrompt(client, { targetId: 'target', agentRef: 'n2', ifMatchUpdatedAt: '2026-01-01', prompt: 'private replacement', apply: false })).rejects.toMatchObject({ code: 'SYSTEM_MESSAGE_AMBIGUOUS' })
    await expect(editSystemPrompt(client, { targetId: 'target', agentRef: 'n1', ifMatchUpdatedAt: '2026-01-01', prompt: 'private replacement', apply: false })).rejects.toMatchObject({ code: 'AGENT_REF_INVALID' })
    await expect(editSystemPrompt(client, { targetId: 'target', agentRef: 'n2', ifMatchUpdatedAt: 'wrong', prompt: 'private replacement', apply: false })).rejects.toMatchObject({ code: 'REMOTE_CHANGED' })
    client.getChatflow.mockResolvedValueOnce({ ...remote([], 'wrong'), type: 'CHATFLOW' })
    await expect(editSystemPrompt(client, { targetId: 'target', agentRef: 'n2', ifMatchUpdatedAt: '2026-01-01', prompt: 'private replacement', apply: false })).rejects.toMatchObject({ code: 'TARGET_NOT_AGENTFLOW' })

    const source = remote([])
    const concurrent = { getChatflow: vi.fn().mockResolvedValueOnce(source).mockResolvedValueOnce(remote([], '2026-01-02')), updateAgentflow: vi.fn() }
    await expect(editSystemPrompt(concurrent, { targetId: 'target', agentRef: 'n2', ifMatchUpdatedAt: '2026-01-01', prompt: 'private replacement', apply: true })).rejects.toMatchObject({ code: 'REMOTE_CHANGED' })
    expect(concurrent.updateAgentflow).not.toHaveBeenCalled()
  })

  it('rejects same-timestamp FlowData changes before PUT', async () => {
    const source = remote([])
    const changed = remote([])
    const changedFlow = JSON.parse(String(changed.flowData))
    changedFlow.nodes[0].data.inputs.unrelated = 'concurrent edit'
    changed.flowData = JSON.stringify(changedFlow)
    const client = { getChatflow: vi.fn().mockResolvedValueOnce(source).mockResolvedValueOnce(changed), updateAgentflow: vi.fn() }

    await expect(editSystemPrompt(client, { targetId: 'target', agentRef: 'n2', ifMatchUpdatedAt: '2026-01-01', prompt: 'private replacement', apply: true })).rejects.toMatchObject({ code: 'REMOTE_CHANGED' })
    expect(client.updateAgentflow).not.toHaveBeenCalled()
  })

  it('does not propagate prompt content echoed by a failed update', async () => {
    const source = remote([])
    const client = {
      getChatflow: vi.fn().mockResolvedValue(source),
      updateAgentflow: vi.fn().mockRejectedValue(new Error('request contained private replacement'))
    }

    try {
      await editSystemPrompt(client, { targetId: 'target', agentRef: 'n2', ifMatchUpdatedAt: '2026-01-01', prompt: 'private replacement', apply: true })
      expect.fail('expected update to fail')
    } catch (error) {
      expect(error).toMatchObject({ code: 'REMOTE_WRITE_FAILED', message: 'Agentflow update failed' })
      expect(JSON.stringify(error)).not.toContain('private replacement')
    }
  })

  it.each([
    { nodes: [null], edges: [] },
    { nodes: [{ id: 'broken' }], edges: [] }
  ])('rejects malformed remote nodes as remote flow data errors', async (flowData) => {
    const malformed = { ...remote([]), flowData: JSON.stringify(flowData) }
    const client = { getChatflow: vi.fn().mockResolvedValue(malformed), updateAgentflow: vi.fn() }

    await expect(editSystemPrompt(client, { targetId: 'target', agentRef: 'n1', ifMatchUpdatedAt: '2026-01-01', prompt: 'replacement', apply: false })).rejects.toMatchObject({ code: 'REMOTE_FLOW_DATA_INVALID' })
    expect(client.updateAgentflow).not.toHaveBeenCalled()
  })
})
