import { describe, expect, it, vi } from 'vitest'
import { editAgentMcp, inspectAgentMcp, refreshAgentMcpActions } from '../src/application/agent-mcp.js'
import type { Chatflow } from '../src/flowise/flowise-api-types.js'

const tool = (config: string, actions: unknown = '["kept"]') => ({
  agentSelectedTool: 'customMCP',
  agentSelectedToolRequiresHumanInput: false,
  agentSelectedToolConfig: { mcpServerConfig: config, mcpActions: actions, untouched: true }
})
const remote = (agentTools: unknown, updatedDate = '2026-01-01'): Chatflow => ({
  id: 'target', name: 'target', type: 'AGENTFLOW', updatedDate,
  flowData: JSON.stringify({
    nodes: [
      { id: 'private-start', type: 'agentflowNode', position: { x: 0, y: 0 }, data: { id: 'private-start', name: 'startAgentflow', label: 'Start', inputs: {} } },
      { id: 'private-agent', type: 'agentflowNode', position: { x: 0, y: 0 }, data: { id: 'private-agent', name: 'agentAgentflow', label: 'Agent', inputs: { agentTools, unrelated: 'keep' } } }
    ], edges: []
  })
})

describe('agent Custom MCP operations', () => {
  it('inspects only Custom MCP entries through sanitized stable refs', () => {
    const config = '{"url":"https://example.com/mcp","headers":{"Authorization":"Bearer {{$vars.MCP_TOKEN}}"}}'
    const result = inspectAgentMcp(remote([
      { agentSelectedTool: 'other', agentSelectedToolConfig: { secret: 'do-not-report' } },
      tool(config, ['one', 'two']),
      tool('{"command":"private-command","args":["secret"]}', '["three"]')
    ]), 'n2')
    expect(result).toEqual({
      agentRef: 'n2',
      updatedDate: '2026-01-01',
      mcps: [
        { ref: 'm1', transport: 'sse', configHash: expect.stringMatching(/^[a-f0-9]{64}$/), hasFlowiseVariableRefs: true, enabledActionCount: 2 },
        { ref: 'm2', transport: 'stdio', configHash: expect.stringMatching(/^[a-f0-9]{64}$/), hasFlowiseVariableRefs: false, enabledActionCount: 1 }
      ]
    })
    expect(JSON.stringify(result)).not.toMatch(/private|Authorization|MCP_TOKEN|command|three/)
  })

  it('edits only exact MCP config text, preserves representations, and uses full concurrency checks', async () => {
    const source = remote(JSON.stringify([tool('{"url":"https://old.example.com"}')]))
    const exact = '{\n  "url": "https://new.example.com",\n  "headers": {"X-Key":"{{$vars.KEY}}"}\n}\n'
    const persistedFlow = JSON.parse(String(source.flowData))
    persistedFlow.nodes[1].data.inputs.agentTools = JSON.stringify([tool(exact)])
    const persisted = { ...source, flowData: JSON.stringify(persistedFlow) }
    const client = { getChatflow: vi.fn().mockResolvedValueOnce(source).mockResolvedValueOnce(source).mockResolvedValueOnce(persisted), updateAgentflow: vi.fn() }

    await expect(editAgentMcp(client, { targetId: 'target', agentRef: 'n2', mcpRef: 'm1', ifMatchUpdatedAt: '2026-01-01', configText: exact, apply: true })).resolves.toMatchObject({ changed: true, applied: true })
    const inputs = client.updateAgentflow.mock.calls[0]![1].flowData.nodes[1].data.inputs
    expect(typeof inputs.agentTools).toBe('string')
    const changedTool = JSON.parse(inputs.agentTools)[0]
    expect(changedTool.agentSelectedToolConfig).toEqual({ mcpServerConfig: exact, mcpActions: '["kept"]', untouched: true })
  })

  it('refreshes without writing and additively enables validated discovered actions', async () => {
    const source = remote([tool('{"type":"sse","url":"https://example.com/mcp"}', ['kept', 'stale', 'kept'])])
    const options = [{ name: 'kept', label: 'Kept', description: 'private detail' }, { name: 'new', label: 'New' }]
    const refreshClient = { getChatflow: vi.fn().mockResolvedValue(source), loadCustomMcpActions: vi.fn().mockResolvedValue(options), updateAgentflow: vi.fn() }
    await expect(refreshAgentMcpActions(refreshClient, { targetId: 'target', agentRef: 'n2', mcpRef: 'm1', enableActions: [], enableAll: false, showActionNames: false, apply: false })).resolves.toMatchObject({ availableCount: 2, enabledCount: 2, newCount: 1, missingCount: 1, changed: false, applied: false })
    expect(refreshClient.updateAgentflow).not.toHaveBeenCalled()

    const persisted = remote([tool('{"type":"sse","url":"https://example.com/mcp"}', ['kept', 'stale', 'new'])])
    const enableClient = { getChatflow: vi.fn().mockResolvedValueOnce(source).mockResolvedValueOnce(source).mockResolvedValueOnce(persisted), loadCustomMcpActions: vi.fn().mockResolvedValue(options), updateAgentflow: vi.fn() }
    await expect(refreshAgentMcpActions(enableClient, { targetId: 'target', agentRef: 'n2', mcpRef: 'm1', enableActions: ['new'], enableAll: false, ifMatchUpdatedAt: '2026-01-01', showActionNames: true, apply: true })).resolves.toMatchObject({ changed: true, applied: true, availableNames: ['kept', 'new'], enabledNames: ['kept', 'stale', 'new'] })
    expect(enableClient.updateAgentflow.mock.calls[0]![1].flowData.nodes[1].data.inputs.agentTools[0].agentSelectedToolConfig.mcpActions).toEqual(['kept', 'stale', 'new'])
  })

  it('rejects invalid refs, configs, selections, and stale same-timestamp flow data', async () => {
    expect(() => inspectAgentMcp(remote([]), 'n1')).toThrowError(expect.objectContaining({ code: 'AGENT_REF_INVALID' }))
    expect(inspectAgentMcp(remote([]), 'n2')).toEqual({ agentRef: 'n2', updatedDate: '2026-01-01', mcps: [] })
    const unconfigured = tool(''); delete (unconfigured.agentSelectedToolConfig as Record<string, unknown>).mcpServerConfig
    expect(inspectAgentMcp(remote([unconfigured]), 'n2').mcps[0]).toMatchObject({ ref: 'm1', transport: 'unknown', enabledActionCount: 1 })
    const source = remote([tool('{"url":"https://example.com/mcp"}')])
    const basic = { getChatflow: vi.fn().mockResolvedValue(source), updateAgentflow: vi.fn() }
    await expect(editAgentMcp(basic, { targetId: 'target', agentRef: 'n2', mcpRef: 'm1', ifMatchUpdatedAt: '2026-01-01', configText: '{url:"not strict"}', apply: false })).rejects.toMatchObject({ code: 'MCP_CONFIG_INVALID' })

    const discovery = { ...basic, loadCustomMcpActions: vi.fn().mockResolvedValue([{ name: 'known', label: 'Known' }]) }
    await expect(refreshAgentMcpActions(discovery, { targetId: 'target', agentRef: 'n2', mcpRef: 'm1', enableActions: ['unknown'], enableAll: false, ifMatchUpdatedAt: '2026-01-01', showActionNames: false, apply: false })).rejects.toMatchObject({ code: 'MCP_ACTION_SELECTION_INVALID' })
    await expect(refreshAgentMcpActions(discovery, { targetId: 'target', agentRef: 'n2', mcpRef: 'm1', enableActions: [], enableAll: false, showActionNames: false, apply: true })).rejects.toMatchObject({ code: 'MCP_ACTION_SELECTION_INVALID' })

    const noop = { getChatflow: vi.fn().mockResolvedValue(source), loadCustomMcpActions: vi.fn().mockResolvedValue([{ name: 'kept' }]), updateAgentflow: vi.fn() }
    await expect(refreshAgentMcpActions(noop, { targetId: 'target', agentRef: 'n2', mcpRef: 'm1', enableActions: ['kept'], enableAll: false, ifMatchUpdatedAt: '2026-01-01', showActionNames: false, apply: true })).resolves.toMatchObject({ changed: false, applied: false })
    expect(noop.updateAgentflow).not.toHaveBeenCalled()

    const changed = remote([tool('{"url":"https://example.com/mcp"}')])
    const changedFlow = JSON.parse(String(changed.flowData)); changedFlow.nodes[0].data.inputs.concurrent = true; changed.flowData = JSON.stringify(changedFlow)
    const concurrent = { getChatflow: vi.fn().mockResolvedValueOnce(source).mockResolvedValueOnce(changed), loadCustomMcpActions: vi.fn().mockResolvedValue([{ name: 'known', label: 'Known' }]), updateAgentflow: vi.fn() }
    await expect(refreshAgentMcpActions(concurrent, { targetId: 'target', agentRef: 'n2', mcpRef: 'm1', enableActions: ['known'], enableAll: false, ifMatchUpdatedAt: '2026-01-01', showActionNames: false, apply: true })).rejects.toMatchObject({ code: 'REMOTE_CHANGED' })
    expect(concurrent.updateAgentflow).not.toHaveBeenCalled()
  })
})
