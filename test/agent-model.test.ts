import { describe, expect, it, vi } from 'vitest'
import { editAgentModel, inspectAgentModel } from '../src/application/agent-model.js'
import type { Chatflow } from '../src/flowise/flowise-api-types.js'
import type { NodeDataSchema } from '../src/domain/node-catalog.js'

const catalog: NodeDataSchema = { name: 'chatOpenAI', label: 'ChatOpenAI', inputs: [
  { id: 'r', name: 'reasoning', label: 'Reasoning', type: 'boolean', default: false },
  { id: 'e', name: 'reasoningEffort', label: 'Effort', type: 'options', options: ['low', 'medium', 'high', 'xhigh'], show: { reasoning: true } },
  { id: 't', name: 'temperature', label: 'Temperature', type: 'number', default: 0.9 },
  { id: 'm', name: 'maxTokens', label: 'Tokens', type: 'number' },
  { id: 'p', name: 'topP', label: 'Top P', type: 'number' }
] }
const remote = (config: unknown = { modelName: 'CUSTOM_MODEL_PLACEHOLDER', basepath: 'https://example.com/private', temperature: '0.5' }): Chatflow => ({
  id: 'target', name: 'Example', type: 'AGENTFLOW', updatedDate: '2026-01-01', flowData: JSON.stringify({ extra: { preserved: true }, nodes: [
    { id: 'start', type: 'agentflowNode', position: { x: 0, y: 0 }, data: { id: 'start', label: 'Start', name: 'startAgentflow', inputs: {} } },
    { id: 'agent', type: 'agentflowNode', position: { x: 0, y: 0 }, data: { id: 'agent', label: 'Agent', name: 'agentAgentflow', inputs: { agentModel: 'chatOpenAI', agentModelConfig: config, agentMessages: 'PROMPT_PLACEHOLDER' } } }
  ], edges: [] })
})
const client = (source = remote(), schema = catalog) => ({ getChatflow: vi.fn().mockResolvedValue(source), getNode: vi.fn().mockResolvedValue(schema), updateAgentflow: vi.fn() })
const args = { targetId: 'target', agentRef: 'n2', ifMatchUpdatedAt: '2026-01-01', set: ['reasoning.enabled=true', 'reasoning.effort=high'], apply: false }

describe('agent model', () => {
  it('previews only requested model fields while preserving the source and hiding private metadata', async () => {
    const c = client()
    const result = await editAgentModel(c, args)
    expect(result).toMatchObject({ changed: true, applied: false, updatedDate: '2026-01-01', warnings: [{ code: 'MODEL_COMPATIBILITY_UNVERIFIED' }] })
    expect(result.changes).toHaveLength(2)
    expect(c.updateAgentflow).not.toHaveBeenCalled()
    expect(JSON.stringify(result)).not.toMatch(/CUSTOM_MODEL|example.com|PROMPT_PLACEHOLDER/)
  })
})

it('inspects stored, absent, invalid and default states without exposing historical strings', async () => {
  const result = await inspectAgentModel(client(), args)
  expect(result.parameters.find((p) => p.alias === 'temperature')).toMatchObject({ stored: { state: 'invalid' }, catalogDefault: { state: 'available', value: 0.9 } })
  expect(result.parameters.find((p) => p.alias === 'reasoning.enabled')).toMatchObject({ stored: { state: 'absent' }, catalogDefault: { state: 'available', value: false } })
  expect(JSON.stringify(result)).not.toMatch(/CUSTOM_MODEL|example.com|PROMPT_PLACEHOLDER|0.5/)
})
it('applies all five mappings in one exact isolated delta and returns readback timestamp', async () => {
  const source = remote()
  const c = client(source)
  const expected = JSON.parse(String(source.flowData))
  Object.assign(expected.nodes[1].data.inputs.agentModelConfig, { reasoning: true, reasoningEffort: 'xhigh', temperature: 0, maxTokens: 100, topP: 1 })
  c.getChatflow.mockResolvedValueOnce(source).mockResolvedValueOnce(source).mockResolvedValueOnce({ ...source, flowData: expected, updatedDate: '2026-01-02' })
  const result = await editAgentModel(c, { ...args, apply: true, set: [...args.set.slice(0, 1), 'reasoning.effort=xhigh', 'temperature=0', 'max-output-tokens=100', 'top-p=1'] })
  expect(result).toMatchObject({ changed: true, applied: true, updatedDate: '2026-01-02' })
  expect(c.updateAgentflow.mock.calls).toEqual([['target', { flowData: expected }]])
  expect(JSON.parse(String(source.flowData)).nodes[1].data.inputs.agentModelConfig.temperature).toBe('0.5')
})
it('preserves unrelated numeric strings and stored effort when disabling reasoning', async () => {
  const source = remote({ temperature: '0.5', reasoning: true, reasoningEffort: 'high' })
  const c = client(source)
  const expected = JSON.parse(String(source.flowData)); expected.nodes[1].data.inputs.agentModelConfig.reasoning = false
  c.getChatflow.mockResolvedValueOnce(source).mockResolvedValueOnce(source).mockResolvedValueOnce({ ...source, flowData: expected })
  await editAgentModel(c, { ...args, set: ['reasoning.enabled=false'], apply: true })
  expect(c.updateAgentflow.mock.calls[0]![1]).toEqual({ flowData: expected })
})
it('no-op checks timestamp and never writes', async () => {
  const c = client(remote({ reasoning: true }))
  expect(await editAgentModel(c, { ...args, set: ['reasoning.enabled=true'], apply: true })).toMatchObject({ changed: false, applied: false })
  await expect(editAgentModel(c, { ...args, set: ['reasoning.enabled=true'], ifMatchUpdatedAt: 'stale' })).rejects.toMatchObject({ code: 'REMOTE_CHANGED' })
  expect(c.updateAgentflow).not.toHaveBeenCalled()
})
it.each(['temperature=NaN', 'temperature=Infinity', 'temperature=2.1', 'temperature=-1', 'temperature= 1', 'temperature=0x1', 'temperature=[]', 'temperature={}', 'temperature={{value}}', 'reasoning.enabled=1', 'reasoning.enabled=True', 'reasoning.effort=auto', 'max-output-tokens=1.5', 'max-output-tokens=0', 'max-output-tokens=9007199254740992', 'top-p=1.1', 'top-p=-0.1', 'modelName=other', 'agentModelConfig.reasoning=true', '__proto__=true', 'temperature'])('rejects unsafe assignment %s', async (assignment) => {
  const c = client()
  await expect(editAgentModel(c, { ...args, set: [assignment] })).rejects.toMatchObject({ code: 'AGENT_MODEL_PARAM_INVALID' })
  expect(c.updateAgentflow).not.toHaveBeenCalled()
})
it.each([{ set: [] }, { set: ['temperature=1', 'temperature=0'] }])('rejects empty or duplicate assignments', async ({ set }) => {
  await expect(editAgentModel(client(), { ...args, set })).rejects.toMatchObject({ code: 'AGENT_MODEL_PARAM_INVALID' })
})
it.each(['n1', 'n02', 'n0', 'agent', 'n999999999999999999999'])('rejects invalid agent ref %s', async (agentRef) => {
  await expect(inspectAgentModel(client(), { ...args, agentRef })).rejects.toMatchObject({ code: 'AGENT_REF_INVALID' })
})
it.each([null, 'encoded config', [], 1])('rejects malformed config', async (config) => {
  await expect(inspectAgentModel(client(remote(config)), args)).rejects.toMatchObject({ code: 'AGENT_MODEL_CONFIG_INVALID' })
})
it('reports unsupported components safely and rejects editing', async () => {
  const source = remote(); const flow = JSON.parse(String(source.flowData)); flow.nodes[1].data.inputs.agentModel = 'CUSTOM_COMPONENT_PLACEHOLDER'; source.flowData = flow
  const c = client(source)
  expect(await inspectAgentModel(c, args)).toMatchObject({ component: 'unsupported', supported: false, parameters: [] })
  await expect(editAgentModel(c, args)).rejects.toMatchObject({ code: 'AGENT_MODEL_UNSUPPORTED' })
  expect(c.getNode).not.toHaveBeenCalled()
})
it('rejects non-agentflow and missing timestamp', async () => {
  await expect(inspectAgentModel(client({ ...remote(), type: 'CHATFLOW' }), args)).rejects.toMatchObject({ code: 'TARGET_NOT_AGENTFLOW' })
  await expect(editAgentModel(client(), { ...args, ifMatchUpdatedAt: '' })).rejects.toMatchObject({ code: 'UPDATED_DATE_REQUIRED' })
})
it('requires explicit reasoning and validates combined live dependencies', async () => {
  await expect(editAgentModel(client(), { ...args, set: ['reasoning.effort=low'] })).rejects.toMatchObject({ code: 'AGENT_MODEL_DEPENDENCY_INVALID' })
  const schema = structuredClone(catalog); schema.inputs![2]!.hide = { reasoning: true }
  await expect(editAgentModel(client(remote(), schema), { ...args, set: ['reasoning.enabled=true', 'temperature=1'] })).rejects.toMatchObject({ code: 'AGENT_MODEL_DEPENDENCY_INVALID' })
})
it.each(['missing', 'type', 'enum', 'bounds', 'duplicate'])('intersects live schema %s', async (kind) => {
  const schema = structuredClone(catalog)
  if (kind === 'missing') schema.inputs = schema.inputs!.filter((p) => p.name !== 'temperature')
  if (kind === 'type') schema.inputs![2]!.type = 'string'
  if (kind === 'enum') schema.inputs![1]!.options = ['low', 'UNTRUSTED_ENUM_PLACEHOLDER']
  if (kind === 'bounds') schema.inputs![2]!.max = 0.5
  if (kind === 'duplicate') schema.inputs!.push(schema.inputs![2]!)
  const c = client(remote(), schema)
  await expect(editAgentModel(c, { ...args, set: kind === 'enum' ? args.set : ['temperature=1'] })).rejects.toMatchObject({ code: 'AGENT_MODEL_PARAM_INVALID' })
  expect(JSON.stringify(await inspectAgentModel(c, args))).not.toContain('UNTRUSTED_ENUM')
})
it.each(['timestamp', 'order', 'metadata'])('rejects concurrent %s change before PUT', async (kind) => {
  const source = remote(); const latest = structuredClone(source); const flow = JSON.parse(String(source.flowData))
  if (kind === 'timestamp') latest.updatedDate = '2026-01-02'
  if (kind === 'order') flow.nodes.reverse()
  if (kind === 'metadata') flow.extra.preserved = false
  latest.flowData = flow
  const c = client(source); c.getChatflow.mockResolvedValueOnce(source).mockResolvedValueOnce(latest)
  await expect(editAgentModel(c, { ...args, apply: true })).rejects.toMatchObject({ code: 'REMOTE_CHANGED' })
  expect(c.updateAgentflow).not.toHaveBeenCalled()
})
it('rejects complete readback mismatch without rollback or retries', async () => {
  const source = remote(); const c = client(source)
  const persisted = JSON.parse(String(source.flowData)); Object.assign(persisted.nodes[1].data.inputs.agentModelConfig, { reasoning: true, reasoningEffort: 'high' }); delete persisted.extra
  c.getChatflow.mockResolvedValueOnce(source).mockResolvedValueOnce(source).mockResolvedValueOnce({ ...source, flowData: persisted })
  await expect(editAgentModel(c, { ...args, apply: true })).rejects.toMatchObject({ code: 'REMOTE_PERSISTENCE_MISMATCH' })
  expect(c.updateAgentflow).toHaveBeenCalledTimes(1)
})
it('sanitizes uncertain writes and reads without retries', async () => {
  const c = client(); c.updateAgentflow.mockRejectedValue(new Error('SERVER_SECRET_PLACEHOLDER'))
  await expect(editAgentModel(c, { ...args, apply: true })).rejects.toMatchObject({ code: 'REMOTE_WRITE_FAILED', message: 'Agentflow update failed' })
  expect(c.updateAgentflow).toHaveBeenCalledTimes(1)
  expect(c.getChatflow).toHaveBeenCalledTimes(2)
  c.getChatflow.mockRejectedValue(new Error('SERVER_SECRET_PLACEHOLDER'))
  await expect(inspectAgentModel(c, args)).rejects.toMatchObject({ code: 'REMOTE_READ_FAILED', message: 'Agentflow read failed' })
})
it('rejects catalog retrieval failure safely', async () => {
  const c = client(); c.getNode.mockRejectedValue(new Error('CATALOG_SECRET_PLACEHOLDER'))
  await expect(inspectAgentModel(c, args)).rejects.toMatchObject({ code: 'AGENT_MODEL_CATALOG_INVALID', message: 'Model catalog could not be read' })
})
it('treats malformed catalog visibility as a safe catalog error', async () => {
  const schema = structuredClone(catalog); schema.inputs![2]!.show = 'INVALID_CATALOG_PLACEHOLDER' as unknown as Record<string, unknown>
  await expect(inspectAgentModel(client(remote(), schema), args)).rejects.toMatchObject({ code: 'AGENT_MODEL_CATALOG_INVALID' })
})
