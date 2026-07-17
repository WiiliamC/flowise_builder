import { describe, expect, it } from 'vitest'
import { validateFlow } from '../src/application/validate-flow.js'
import { semanticDiff } from '../src/application/diff-flow.js'
import type { FlowData } from '../src/domain/flow-data.js'
import { isVisible } from '../src/flowise/field-visibility.js'

const node = (id: string, name: string) => ({ id, type: 'agentflowNode', position: { x: 0, y: 0 }, data: { id, name, label: name, inputs: {}, inputParams: [], inputAnchors: [], outputAnchors: [] } })

describe('validation and diff', () => {
  it('diagnoses cycles and strict isolated nodes', () => {
    const flow: FlowData = { nodes: [node('s', 'startAgentflow'), node('a', 'agentAgentflow')], edges: [
      { id: '1', source: 's', target: 'a', type: 'default' }, { id: '2', source: 'a', target: 's', type: 'default' }
    ] }
    expect(validateFlow(flow).diagnostics.some((d) => d.code === 'FLOW_CYCLE')).toBe(true)
  })

  it('keeps topology quality warnings non-strict while required inputs are errors', () => {
    const flow: FlowData = { nodes: [node('s', 'startAgentflow'), node('r', 'directReplyAgentflow')], edges: [] }
    const catalog = [{ name: 'directReplyAgentflow', label: 'Reply', inputs: [{ id: '', name: 'message', label: 'Message', type: 'string' }] }]
    const result = validateFlow(flow, catalog)
    expect(result.diagnostics).toContainEqual(expect.objectContaining({ code: 'NODE_ISOLATED', severity: 'warning' }))
    expect(result.diagnostics).toContainEqual(expect.objectContaining({ code: 'INPUT_REQUIRED_MISSING', severity: 'error' }))
    expect(result.valid).toBe(false)
  })

  it('ignores transient UI state while reporting semantic input changes', () => {
    const before = { nodes: [{ ...node('s', 'startAgentflow'), selected: true }], edges: [] }
    const after = structuredClone(before)
    after.nodes[0]!.selected = false
    expect(semanticDiff(before, after).changed).toBe(false)
    ;(after.nodes[0]!.data.inputs as Record<string, unknown>).prompt = 'secret-value'
    const diff = semanticDiff(before, after)
    expect(diff.changed).toBe(true)
    expect(JSON.stringify(diff)).not.toContain('secret-value')
  })

  it('reports credential-only changes without exposing credential IDs', () => {
    const before: FlowData = { nodes: [node('s', 'startAgentflow')], edges: [] }
    const after = structuredClone(before)
    before.nodes[0]!.data.credential = 'old-credential-id'
    after.nodes[0]!.data.credential = 'new-credential-id'

    const diff = semanticDiff(before, after)
    expect(diff).toEqual({ changed: true, changes: [{ path: 'nodes.s.credential', before: '[REDACTED]', after: '[REDACTED]' }] })
    expect(JSON.stringify(diff)).not.toContain('old-credential-id')
    expect(JSON.stringify(diff)).not.toContain('new-credential-id')
  })

  it.each(['added', 'removed'])('redacts every input value for an %s node', (direction) => {
    const secretNode = node('reply', 'directReplyAgentflow')
    secretNode.data.inputs = { message: 'private-message', settings: { prompt: 'nested-prompt' } }
    const empty: FlowData = { nodes: [], edges: [] }
    const populated: FlowData = { nodes: [secretNode], edges: [] }

    const diff = direction === 'added' ? semanticDiff(empty, populated) : semanticDiff(populated, empty)
    expect(JSON.stringify(diff)).not.toContain('private-message')
    expect(JSON.stringify(diff)).not.toContain('nested-prompt')
    expect(diff.changes[0]).toMatchObject({ path: 'nodes.reply' })
    expect(diff.changes[0]?.[direction === 'added' ? 'after' : 'before']).toMatchObject({ data: { inputs: { message: '[REDACTED]', settings: '[REDACTED]' } } })
  })

  it('treats array visibility conditions as exact alternatives', () => {
    const show = { id: '', name: 'token', label: 'Token', type: 'string', show: { mode: ['foo'] } }
    const hide = { id: '', name: 'token', label: 'Token', type: 'string', hide: { mode: ['foo'] } }

    expect(isVisible(show, { mode: 'foo' })).toBe(true)
    expect(isVisible(show, { mode: 'foobar' })).toBe(false)
    expect(isVisible(show, { mode: ['bar', 'foo'] })).toBe(true)
    expect(isVisible(hide, { mode: 'foo' })).toBe(false)
    expect(isVisible(hide, { mode: 'foobar' })).toBe(true)
    expect(isVisible({ ...show, show: { mode: '.+' } }, { mode: 'foobar' })).toBe(true)
  })

  it('matches ordinary scalar visibility strings exactly and explicit patterns as regex', () => {
    const param = { id: '', name: 'token', label: 'Token', type: 'string' }
    expect(isVisible({ ...param, show: { mode: 'foo' } }, { mode: 'foo' })).toBe(true)
    expect(isVisible({ ...param, show: { mode: 'foo' } }, { mode: 'foobar' })).toBe(false)
    expect(isVisible({ ...param, show: { mode: '^foo.+' } }, { mode: 'foobar' })).toBe(true)
    expect(isVisible({ ...param, show: { mode: '[' } }, { mode: '[' })).toBe(true)
  })

  it('evaluates indexed array child visibility against the complete node inputs', () => {
    const condition = node('condition', 'conditionAgentflow')
    condition.data.inputs = { conditions: [{ type: 'string', value1: 'present' }, { type: 'string' }] }
    const flow: FlowData = { nodes: [node('s', 'startAgentflow'), condition], edges: [{ id: 'e', source: 's', target: 'condition', type: 'default' }] }
    const catalog = [{ name: 'conditionAgentflow', label: 'Condition', inputs: [{
      id: '', name: 'conditions', label: 'Conditions', type: 'array', array: [
        { id: '', name: 'value1', label: 'Value 1', type: 'string', show: { 'conditions[$index].type': 'string' } },
        { id: '', name: 'operation', label: 'Operation', type: 'string', show: { 'conditions[$index].type': 'number' } }
      ]
    }] }]

    const diagnostics = validateFlow(flow, catalog).diagnostics
    expect(diagnostics).toContainEqual(expect.objectContaining({ code: 'INPUT_REQUIRED_MISSING', message: expect.stringContaining('item #2: Value 1') }))
    expect(diagnostics).not.toContainEqual(expect.objectContaining({ message: expect.stringContaining('Operation') }))
  })

  it('uses nested schema defaults when evaluating required field visibility', () => {
    const selector = node('selector', 'nestedSelectorAgentflow')
    selector.data.inputs = { selected: 'nestedComponent', selectedConfig: {} }
    const flow: FlowData = { nodes: [node('s', 'startAgentflow'), selector], edges: [{ id: 'e', source: 's', target: 'selector', type: 'default' }] }
    const catalog = [
      { name: 'nestedSelectorAgentflow', label: 'Selector', inputs: [{ id: '', name: 'selected', label: 'Selected', type: 'string', loadConfig: true }] },
      { name: 'nestedComponent', label: 'Nested', inputs: [
        { id: '', name: 'mode', label: 'Mode', type: 'string', default: 'basic' },
        { id: '', name: 'token', label: 'Token', type: 'string', show: { mode: ['basic'] } }
      ] }
    ]

    expect(validateFlow(flow, catalog).diagnostics).toContainEqual(expect.objectContaining({ code: 'NESTED_CONFIG_INVALID', nodeId: 'selector' }))
    ;(selector.data.inputs as Record<string, unknown>).selectedConfig = { mode: 'advanced' }
    expect(validateFlow(flow, catalog).diagnostics).not.toContainEqual(expect.objectContaining({ code: 'NESTED_CONFIG_INVALID', nodeId: 'selector' }))
  })
})
