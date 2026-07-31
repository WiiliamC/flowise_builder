import { describe, expect, it, vi } from 'vitest'
import { copyAgentflow } from '../src/application/copy-flow.js'
import type { Chatflow } from '../src/flowise/flowise-api-types.js'
import type { NodeDataSchema } from '../src/domain/node-catalog.js'

const flow = {
  nodes: [{ id: 'start', type: 'agentflowNode', position: { x: 0, y: 0 }, data: { id: 'start', name: 'startAgentflow', label: 'Start', inputs: {} } }],
  edges: []
}
const source: Chatflow = { id: 'source', name: 'original', type: 'AGENTFLOW', flowData: JSON.stringify(flow), updatedDate: '2026-01-01' }
const catalog: NodeDataSchema[] = [{ name: 'startAgentflow', label: 'Start' }]

describe('copyAgentflow', () => {
  it('is a dry run by default and exposes only safe copy facts', async () => {
    const client = { getChatflow: vi.fn().mockResolvedValue(source), createAgentflow: vi.fn() }
    const result = await copyAgentflow(client, catalog, { sourceId: 'source', name: 'copy', apply: false })
    expect(result).toMatchObject({ applied: false, source: { id: 'source', name: 'original', type: 'AGENTFLOW' }, nodes: 1, edges: 0 })
    expect(result).not.toHaveProperty('flowData')
    expect(client.createAgentflow).not.toHaveBeenCalled()
  })

  it('rejects a source that is not an Agentflow', async () => {
    const client = { getChatflow: vi.fn().mockResolvedValue({ ...source, type: 'CHATFLOW' }), createAgentflow: vi.fn() }
    await expect(copyAgentflow(client, catalog, { sourceId: 'source', name: 'copy', apply: false })).rejects.toMatchObject({ code: 'SOURCE_TYPE_INVALID' })
    expect(client.createAgentflow).not.toHaveBeenCalled()
  })

  it('blocks warnings unless explicitly allowed, then creates only name and FlowData', async () => {
    const created = { ...source, id: 'created', name: 'copy' }
    const blockedClient = { getChatflow: vi.fn().mockResolvedValue(source), createAgentflow: vi.fn() }
    const blocked = await copyAgentflow(blockedClient, catalog, { sourceId: 'source', name: 'copy', apply: true })
    expect(blocked.blocked).toBe('warnings')
    expect(blockedClient.createAgentflow).not.toHaveBeenCalled()

    const client = { getChatflow: vi.fn().mockResolvedValueOnce(source).mockResolvedValueOnce(source).mockResolvedValueOnce(created), createAgentflow: vi.fn().mockResolvedValue(created) }
    const applied = await copyAgentflow(client, catalog, { sourceId: 'source', name: 'copy', allowWarnings: true, apply: true })
    expect(applied).toMatchObject({ applied: true, destination: { id: 'created', name: 'copy', type: 'AGENTFLOW' } })
    expect(client.createAgentflow).toHaveBeenCalledWith({ name: 'copy', flowData: flow })
  })

  it('does not write when the source changes before create', async () => {
    const changed = { ...source, updatedDate: '2026-01-02' }
    const client = { getChatflow: vi.fn().mockResolvedValueOnce(source).mockResolvedValueOnce(changed), createAgentflow: vi.fn() }
    await expect(copyAgentflow(client, catalog, { sourceId: 'source', name: 'copy', allowWarnings: true, apply: true })).rejects.toMatchObject({ code: 'REMOTE_CHANGED' })
    expect(client.createAgentflow).not.toHaveBeenCalled()
  })

  it('rejects invalid source data and a semantically changed persisted copy', async () => {
    const invalid = { ...source, flowData: JSON.stringify({ nodes: [], edges: [] }) }
    const invalidClient = { getChatflow: vi.fn().mockResolvedValue(invalid), createAgentflow: vi.fn() }
    const invalidResult = await copyAgentflow(invalidClient, catalog, { sourceId: 'source', name: 'copy', apply: true })
    expect(invalidResult.blocked).toBe('errors')
    expect(invalidClient.createAgentflow).not.toHaveBeenCalled()

    const created = { ...source, id: 'created' }
    const mismatch = { ...created, flowData: JSON.stringify({ ...flow, edges: [{ id: 'bad', source: 'start', target: 'missing', type: 'default' }] }) }
    const mismatchClient = { getChatflow: vi.fn().mockResolvedValueOnce(source).mockResolvedValueOnce(source).mockResolvedValueOnce(mismatch), createAgentflow: vi.fn().mockResolvedValue(created) }
    await expect(copyAgentflow(mismatchClient, catalog, { sourceId: 'source', name: 'copy', allowWarnings: true, apply: true })).rejects.toMatchObject({ code: 'REMOTE_PERSISTENCE_MISMATCH' })
  })

  it('reports a stable error for parseable but malformed remote FlowData', async () => {
    const malformedClient = { getChatflow: vi.fn().mockResolvedValue({ ...source, flowData: JSON.stringify({ nodes: null, edges: [] }) }), createAgentflow: vi.fn() }
    await expect(copyAgentflow(malformedClient, catalog, { sourceId: 'source', name: 'copy', apply: false })).rejects.toMatchObject({ code: 'REMOTE_FLOW_DATA_INVALID' })
    expect(malformedClient.createAgentflow).not.toHaveBeenCalled()
  })

  it('rejects malformed node and edge entries with a stable remote-data error', async () => {
    for (const flowData of [{ nodes: [{}], edges: [] }, { nodes: flow.nodes, edges: [{}] }]) {
      const client = { getChatflow: vi.fn().mockResolvedValue({ ...source, flowData: JSON.stringify(flowData) }), createAgentflow: vi.fn() }
      await expect(copyAgentflow(client, catalog, { sourceId: 'source', name: 'copy', apply: false })).rejects.toMatchObject({ code: 'REMOTE_FLOW_DATA_INVALID' })
      expect(client.createAgentflow).not.toHaveBeenCalled()
    }
  })

  it('blocks components that are absent from the live catalog', async () => {
    const client = { getChatflow: vi.fn().mockResolvedValue(source), createAgentflow: vi.fn() }
    const result = await copyAgentflow(client, [], { sourceId: 'source', name: 'copy', allowWarnings: true, apply: true })
    expect(result).toMatchObject({
      applied: false,
      blocked: 'errors',
      diagnostics: expect.arrayContaining([expect.objectContaining({ code: 'COMPONENT_NOT_FOUND', severity: 'error', nodeId: 'start' })])
    })
    expect(client.createAgentflow).not.toHaveBeenCalled()
  })
})
