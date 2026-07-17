import { describe, expect, it } from 'vitest'
import { buildFlow, stableNodeId } from '../src/application/build-flow.js'
import { parseSpecText } from '../src/builder/spec-parser.js'
import { fixtureCatalog } from './fixtures/catalog.js'
import { resolveVariables } from '../src/builder/variable-resolver.js'
import { initializeNode } from '../src/flowise/node-initializer.js'

const spec = parseSpecText(`apiVersion: flowise-agentflow-builder/v1alpha1
kind: Agentflow
metadata: { name: simple }
spec:
  nodes:
    - { key: start, component: startAgentflow }
    - key: reply
      component: directReplyAgentflow
      inputs: { message: hello }
  edges: [{ from: start, to: reply }]`)

describe('buildFlow', () => {
  it('is deterministic and initializes Flowise-compatible nodes and handles', () => {
    const one = buildFlow(spec, fixtureCatalog)
    const two = buildFlow(spec, fixtureCatalog)
    expect(JSON.stringify(one.flowData)).toBe(JSON.stringify(two.flowData))
    expect(one.flowData.nodes[0]?.id).toBe('startAgentflow_start')
    expect(one.flowData.nodes[1]?.data.inputParams?.[0]?.id).toContain('-input-message-string')
    expect(one.flowData.edges[0]?.sourceHandle).toBe(one.flowData.nodes[0]?.data.outputAnchors?.[0]?.id)
    expect(one.flowData.edges[0]?.targetHandle).toBe(one.flowData.nodes[1]?.id)
    expect(one.flowData.edges[0]?.type).toBe('agentflowEdge')
    expect(one.flowData.nodes[0]?.position.x).toBeLessThan(one.flowData.nodes[1]?.position.x ?? 0)
  })

  it('rebuilds condition anchors from provided conditions', () => {
    const conditional = parseSpecText(`apiVersion: flowise-agentflow-builder/v1alpha1
kind: Agentflow
metadata: { name: conditional }
spec:
  nodes:
    - { key: start, component: startAgentflow }
    - key: condition
      component: conditionAgentflow
      inputs: { conditions: [{ value: yes }] }
  edges: [{ from: start, to: condition }]`)
    const node = buildFlow(conditional, fixtureCatalog).flowData.nodes[1]
    expect(node?.data.outputAnchors?.map((a) => a.description)).toEqual(['Condition 0', 'Else'])
    expect(node?.data.outputs).toEqual({ conditionAgentflow: '' })
  })

  it('compiles supported variables and resolves credentials from a separate mapping', () => {
    const variables = parseSpecText(`apiVersion: flowise-agentflow-builder/v1alpha1
kind: Agentflow
metadata: { name: variables }
spec:
  nodes:
    - { key: start, component: startAgentflow }
    - key: reply
      component: directReplyAgentflow
      inputs: { message: "\${flow.input.question}" }
  edges: [{ from: start, to: reply }]`)
    const built = buildFlow(variables, fixtureCatalog, { openai: 'credential-id' })
    expect(built.flowData.nodes[1]?.data.inputs.message).toBe('{{ question }}')
    const diagnostics: Parameters<typeof resolveVariables>[3] = []
    expect(resolveVariables('${credential.openai}', new Map(), { openai: 'credential-id' }, diagnostics)).toBe('credential-id')
    expect(diagnostics).toEqual([])
  })

  it('reports input values with incompatible catalog types', () => {
    const invalid = parseSpecText(`apiVersion: flowise-agentflow-builder/v1alpha1
kind: Agentflow
metadata: { name: invalid }
spec:
  nodes:
    - { key: start, component: startAgentflow }
    - { key: reply, component: directReplyAgentflow, inputs: { message: 42 } }
  edges: [{ from: start, to: reply }]`)
    expect(buildFlow(invalid, fixtureCatalog).diagnostics).toContainEqual(expect.objectContaining({ code: 'INPUT_TYPE_INVALID' }))
  })

  it('stores a resolved catalog credential in the top-level Flowise field', () => {
    const credentialCatalog = [...fixtureCatalog, {
      name: 'httpAgentflow', label: 'HTTP', type: 'HTTP', category: 'Agent Flows',
      credential: { name: 'credential', label: 'HTTP Credential', type: 'credential', credentialNames: ['httpBasicAuth'] },
      inputs: []
    }]
    const credentialSpec = parseSpecText(`apiVersion: flowise-agentflow-builder/v1alpha1
kind: Agentflow
metadata: { name: credential }
spec:
  nodes:
    - { key: start, component: startAgentflow }
    - { key: request, component: httpAgentflow, inputs: { credential: "\${credential.http}" } }
  edges: [{ from: start, to: request }]`)
    const built = buildFlow(credentialSpec, credentialCatalog, { http: 'credential-id' })
    const request = built.flowData.nodes[1]
    expect(built.valid).toBe(true)
    expect(request?.data.inputParams?.[0]).toMatchObject({ name: 'credential', id: 'httpAgentflow_request-input-credential-credential' })
    expect(request?.data.credential).toBe('credential-id')
    expect(request?.data.inputs).not.toHaveProperty('credential')
    expect(request?.data.inputs).not.toHaveProperty('FLOWISE_CREDENTIAL_ID')

    const missingCredential = parseSpecText(`apiVersion: flowise-agentflow-builder/v1alpha1
kind: Agentflow
metadata: { name: missing-credential }
spec:
  nodes:
    - { key: start, component: startAgentflow }
    - { key: request, component: httpAgentflow }
  edges: [{ from: start, to: request }]`)
    expect(buildFlow(missingCredential, credentialCatalog)).toMatchObject({ valid: false, diagnostics: expect.arrayContaining([expect.objectContaining({ code: 'CREDENTIAL_REQUIRED', severity: 'error' })]) })
  })

  it('treats visible required, nested required, and array child fields as build errors', () => {
    const visibleTool = {
      name: 'visibleToolAgentflow', label: 'Visible Tool', type: 'Tool', category: 'Agent Flows', inputs: [
        { id: '', name: 'selectedTool', label: 'Tool', type: 'string' },
        { id: '', name: 'toolInputArgs', label: 'Arguments', type: 'array', show: { selectedTool: '.+' }, array: [{ id: '', name: 'value', label: 'Value', type: 'string' }] }
      ]
    }
    const nestedSelector = {
      name: 'nestedSelectorAgentflow', label: 'Nested Selector', type: 'Tool', category: 'Agent Flows', inputs: [
        { id: '', name: 'selected', label: 'Selected', type: 'string', loadConfig: true }
      ]
    }
    const nested = { name: 'nestedComponent', label: 'Nested', type: 'Tool', category: 'Tools', inputs: [{ id: '', name: 'token', label: 'Token', type: 'string' }] }
    const catalog = [...fixtureCatalog, visibleTool, nestedSelector, nested]
    const visibleMissing = parseSpecText(`apiVersion: flowise-agentflow-builder/v1alpha1
kind: Agentflow
metadata: { name: visible }
spec:
  nodes:
    - { key: start, component: startAgentflow }
    - { key: tool, component: visibleToolAgentflow, inputs: { selectedTool: chosen } }
  edges: [{ from: start, to: tool }]`)
    const arrayChildMissing = parseSpecText(`apiVersion: flowise-agentflow-builder/v1alpha1
kind: Agentflow
metadata: { name: child }
spec:
  nodes:
    - { key: start, component: startAgentflow }
    - { key: tool, component: visibleToolAgentflow, inputs: { selectedTool: chosen, toolInputArgs: [{}] } }
  edges: [{ from: start, to: tool }]`)
    const nestedMissing = parseSpecText(`apiVersion: flowise-agentflow-builder/v1alpha1
kind: Agentflow
metadata: { name: nested }
spec:
  nodes:
    - { key: start, component: startAgentflow }
    - { key: tool, component: nestedSelectorAgentflow, inputs: { selected: nestedComponent } }
  edges: [{ from: start, to: tool }]`)
    expect(buildFlow(visibleMissing, catalog)).toMatchObject({ valid: false, diagnostics: expect.arrayContaining([expect.objectContaining({ code: 'INPUT_REQUIRED_MISSING', severity: 'error' })]) })
    expect(buildFlow(arrayChildMissing, catalog)).toMatchObject({ valid: false, diagnostics: expect.arrayContaining([expect.objectContaining({ code: 'INPUT_REQUIRED_MISSING', severity: 'error' })]) })
    expect(buildFlow(nestedMissing, catalog)).toMatchObject({ valid: false, diagnostics: expect.arrayContaining([expect.objectContaining({ code: 'NESTED_CONFIG_INVALID', severity: 'error' })]) })
  })

  it('preserves explicit viewport zoom and hashes only truncated stable IDs', () => {
    const zoomed = parseSpecText(`apiVersion: flowise-agentflow-builder/v1alpha1
kind: Agentflow
metadata: { name: zoomed }
spec:
  viewport: { zoom: 0.55 }
  nodes:
    - { key: start, component: startAgentflow }
    - { key: reply, component: directReplyAgentflow, inputs: { message: hello } }
  edges: [{ from: start, to: reply }]`)
    expect(buildFlow(zoomed, fixtureCatalog).flowData.viewport?.zoom).toBe(0.55)
    expect(stableNodeId('startAgentflow', 'start')).toBe('startAgentflow_start')
    const prefix = `node${'a'.repeat(110)}`
    const first = stableNodeId('agentAgentflow', `${prefix}x`)
    const second = stableNodeId('agentAgentflow', `${prefix}y`)
    expect(first).not.toBe(second)
    expect(first).toHaveLength(100)
    expect(second).toHaveLength(100)
  })

  it('initializes declared and hidden outputs in the persisted Flowise shape', () => {
    const human = fixtureCatalog.find((item) => item.name === 'humanInputAgentflow')!
    expect(initializeNode(human, 'human_1').data.outputs).toEqual({ humanInputAgentflow: '' })
    expect(initializeNode({ ...human, hideOutput: true }, 'human_2').data).toMatchObject({ outputs: {}, outputAnchors: [] })
  })

  it.each(['timePicker', 'weekDaysPicker', 'monthDaysPicker', 'datePicker'])('initializes %s fields as parameters', (type) => {
    const scheduled = initializeNode({ name: 'scheduledStart', label: 'Scheduled Start', inputs: [{ id: '', name: 'schedule', label: 'Schedule', type }] }, `scheduled_${type}`)
    expect(scheduled.data.inputParams).toContainEqual(expect.objectContaining({ name: 'schedule', type }))
    expect(scheduled.data.inputs).toHaveProperty('schedule', '')
    expect(scheduled.data.inputAnchors).toEqual([])
  })
})
