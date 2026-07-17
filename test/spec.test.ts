import { describe, expect, it } from 'vitest'
import { parseSpecText, SpecError } from '../src/builder/spec-parser.js'

const minimal = `apiVersion: flowise-agentflow-builder/v1alpha1
kind: Agentflow
metadata: { name: demo }
spec:
  nodes: [{ key: start, component: startAgentflow }]
  edges: []`

describe('AgentflowSpec', () => {
  it('parses YAML and rejects unknown fields with a stable diagnostic', () => {
    expect(parseSpecText(minimal).metadata.name).toBe('demo')
    expect(() => parseSpecText(`${minimal}\n  typo: true`)).toThrowError(SpecError)
    try { parseSpecText(`${minimal}\n  typo: true`) } catch (error) {
      expect((error as SpecError).diagnostics[0]?.code).toBe('SPEC_UNKNOWN_FIELD')
    }
  })

  it('rejects duplicate keys and invalid edge references', () => {
    expect(() => parseSpecText(minimal.replace('nodes: [{ key: start, component: startAgentflow }]', 'nodes: [{ key: start, component: startAgentflow }, { key: start, component: startAgentflow }]'))).toThrowError(/duplicate/i)
    expect(() => parseSpecText(minimal.replace('edges: []', 'edges: [{ from: start, to: missing }]'))).toThrowError(/missing/i)
  })

  it('keeps credential IDs out of the workflow spec', () => {
    expect(() => parseSpecText(minimal.replace('spec:', 'credentials: { openai: secret-id }\nspec:'))).toThrowError(SpecError)
  })
})
