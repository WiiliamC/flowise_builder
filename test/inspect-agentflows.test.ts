import { describe, expect, it } from 'vitest'
import { inspectAgentflow, listAgentflows } from '../src/application/inspect-agentflows.js'
import type { FlowData, FlowNode } from '../src/domain/flow-data.js'
import type { Chatflow } from '../src/flowise/flowise-api-types.js'

function node(id: string, name: string, label = name, inputs: Record<string, unknown> = {}): FlowNode {
  return {
    id,
    type: 'agentflowNode',
    position: { x: 0, y: 0 },
    data: { id, name, label, type: name === 'startAgentflow' ? 'Start' : 'Agent', category: 'Agent Flows', inputs, inputAnchors: [], outputAnchors: [{ id: `${id}-out-0`, name: '0', label: '0' }] }
  }
}

function remote(id: string, type: string, flow: FlowData | string): Chatflow {
  return { id, name: `flow-${id}`, type, flowData: typeof flow === 'string' ? flow : JSON.stringify(flow), updatedDate: '2026-01-01' }
}

describe('Agentflow read models', () => {
  it('lists only Agentflows and degrades malformed flowData to a warning', () => {
    const valid: FlowData = { nodes: [node('secret-node-id', 'startAgentflow')], edges: [] }
    const result = listAgentflows([
      remote('agent-1', 'AGENTFLOW', valid),
      remote('chat-1', 'CHATFLOW', valid),
      remote('agent-2', 'AGENTFLOW', '{bad')
    ])

    expect(result.agentflows).toEqual([
      expect.objectContaining({ id: 'agent-1', nodes: 1, edges: 0 }),
      expect.objectContaining({ id: 'agent-2', nodes: null, edges: null })
    ])
    expect(result.diagnostics).toContainEqual(expect.objectContaining({ code: 'REMOTE_FLOW_DATA_INVALID', severity: 'warning' }))
    expect(result.nodes).toBe(1)
  })

  it('projects topology and capabilities without exposing configured values or raw node IDs', () => {
    const start = node('raw-start-id', 'startAgentflow', 'Start', {
      startInputType: 'chatInput',
      startState: [{ key: 'private-state-name', value: 'private-state-value' }],
      startPersistState: true
    })
    start.data.outputAnchors = [{ id: 'raw-start-id-output', name: 'out', label: 'Out' }]
    const agent = node('raw-agent-id', 'agentAgentflow', 'Assistant', {
      agentModel: 'chatOpenAICustom',
      agentModelConfig: { modelName: 'example-model', credential: 'credential-id', basepath: 'https://private.example.test' },
      agentMessages: [{ role: 'system', content: 'private system prompt' }],
      agentTools: [{ agentSelectedTool: 'exampleTool', agentSelectedToolRequiresHumanInput: true, agentSelectedToolConfig: { token: 'private-token' } }],
      agentEnableMemory: true,
      agentMemoryType: 'allMessages',
      agentUpdateState: [{ key: 'private-update', value: 'private-value' }]
    })
    const human = node('raw-human-id', 'humanInputAgentflow', 'Approval')
    const flow: FlowData = {
      nodes: [start, agent, human],
      edges: [
        { id: 'raw-edge-1', source: start.id, target: agent.id, sourceHandle: 'raw-start-id-output', type: 'agentFlow' },
        { id: 'raw-edge-2', source: agent.id, target: human.id, type: 'agentFlow' }
      ]
    }

    const result = inspectAgentflow(remote('agentflow-id', 'AGENTFLOW', flow))
    expect(result.graph.nodes[0]).toMatchObject({ ref: 'n1', component: 'startAgentflow', capabilities: { state: { entryCount: 1, persist: true } } })
    expect(result.graph.nodes[1]).toMatchObject({
      ref: 'n2',
      capabilities: {
        model: { component: 'chatOpenAICustom', credentialConfigured: true, customEndpointConfigured: true },
        messages: { count: 1, roles: ['system'] },
        tools: { count: 1, components: ['exampleTool'], humanApprovalCount: 1 },
        memory: { enabled: true, type: 'allMessages' }
      }
    })
    expect(result.graph.edges[0]).toEqual({ from: 'n1', to: 'n2', type: 'agentFlow', outputIndex: 0 })
    expect(result.analysis.humanApprovalRefs).toEqual(['n2', 'n3'])
    const serialized = JSON.stringify(result)
    for (const secret of ['example-model', 'private system prompt', 'credential-id', 'private-token', 'private.example.test', 'private-state-name', 'private-state-value', 'raw-start-id', 'raw-agent-id', 'raw-edge']) {
      expect(serialized).not.toContain(secret)
    }
  })

  it('includes configured built-in tools in the capability summary', () => {
    const agent = node('agent', 'agentAgentflow', 'Assistant', {
      agentToolsBuiltInOpenAI: ['web_search_preview'],
      agentToolsBuiltInGemini: JSON.stringify(['urlContext', 'googleSearch']),
      agentToolsBuiltInAnthropic: ['web_fetch_20250910'],
      agentTools: []
    })

    expect(inspectAgentflow(remote('agentflow-id', 'AGENTFLOW', { nodes: [agent], edges: [] })).graph.nodes[0]?.capabilities.tools).toEqual({
      count: 4,
      components: ['web_search_preview', 'urlContext', 'googleSearch', 'web_fetch_20250910'],
      humanApprovalCount: 0
    })
  })

  it('finds branch nodes and rejects non-Agentflow targets', () => {
    const start = node('s', 'startAgentflow')
    const condition = node('c', 'conditionAgentflow')
    const left = node('l', 'directReplyAgentflow')
    const right = node('r', 'directReplyAgentflow')
    const flow: FlowData = { nodes: [start, condition, left, right], edges: [
      { id: '1', source: 's', target: 'c', type: 'agentFlow' },
      { id: '2', source: 'c', target: 'l', type: 'agentFlow' },
      { id: '3', source: 'c', target: 'r', type: 'agentFlow' }
    ] }
    expect(inspectAgentflow(remote('a', 'AGENTFLOW', flow)).analysis.branchRefs).toEqual(['n2'])
    expect(() => inspectAgentflow(remote('c', 'CHATFLOW', flow))).toThrowError(expect.objectContaining({ code: 'TARGET_NOT_AGENTFLOW' }))
  })

  it.each([
    { nodes: [null], edges: [] },
    { nodes: [{ id: 'broken' }], edges: [] },
    { nodes: [], edges: [null] },
    { nodes: [], edges: [{ id: 'broken' }] },
    { nodes: [node('duplicate', 'startAgentflow'), node('duplicate', 'agentAgentflow')], edges: [] },
    { nodes: [node('source', 'startAgentflow')], edges: [{ id: 'dangling-target', source: 'source', target: 'missing', type: 'agentFlow' }] },
    { nodes: [node('target', 'agentAgentflow')], edges: [{ id: 'dangling-source', source: 'missing', target: 'target', type: 'agentFlow' }] }
  ])('rejects malformed node and edge entries as remote flow data errors', (flow) => {
    const malformed = remote('a', 'AGENTFLOW', JSON.stringify(flow))
    expect(() => inspectAgentflow(malformed)).toThrowError(expect.objectContaining({ code: 'REMOTE_FLOW_DATA_INVALID' }))
    expect(listAgentflows([malformed])).toMatchObject({
      agentflows: [{ nodes: null, edges: null }],
      diagnostics: [expect.objectContaining({ code: 'REMOTE_FLOW_DATA_INVALID' })]
    })
  })
})
