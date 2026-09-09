import { afterEach, expect, it, vi } from 'vitest'
import { mkdtemp, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { editAgentModel, inspectAgentModel } from '../src/application/agent-model.js'
import type { NodeDataSchema } from '../src/domain/node-catalog.js'
const efforts = ['none', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max']
const schema: NodeDataSchema = { name: 'chatOpenAICustom', label: 'Custom', inputs: Object.entries({ modelName: 'string', temperature: 'number', streaming: 'boolean', reasoningEffort: 'options', maxTokens: 'number', topP: 'number', frequencyPenalty: 'number', presencePenalty: 'number', timeout: 'number', basepath: 'string', baseOptions: 'json' }).map(([name, type]) => ({ id: name, name, label: name, type, optional: name !== 'modelName', ...(name === 'reasoningEffort' ? { options: [...efforts, 'UNTRUSTED_PLACEHOLDER'] } : {}), ...(type === 'string' ? { default: 'DEFAULT_PRIVATE_PLACEHOLDER' } : {}) })) }
function client(config: Record<string, unknown> = { modelName: 'MODEL_PRIVATE_PLACEHOLDER', credential: 'YOUR_API_KEY', cache: 'cache', baseOptions: '{"old":true}' }) {
  const source = { id: 'target', type: 'AGENTFLOW', updatedDate: 'date', flowData: { nodes: [{ id: 'agent', type: 'agentflowNode', position: { x: 0, y: 0 }, data: { id: 'agent', label: 'Agent', name: 'agentAgentflow', inputs: { agentModel: 'chatOpenAICustom', agentModelConfig: config } } }], edges: [], extra: true } }
  return { source, getNode: vi.fn().mockResolvedValue(schema), getChatflow: vi.fn().mockResolvedValue(source), updateAgentflow: vi.fn().mockImplementation(async (_id, { flowData }) => { source.flowData = flowData; return source }) }
}
const args = { targetId: 'target', agentRef: 'n1', ifMatchUpdatedAt: 'date', set: [] as string[], apply: false }
afterEach(() => vi.unstubAllEnvs())
it('discovers the component-specific full form with safe metadata and redacted text defaults and stored values', async () => {
  const c = client(); const report = await inspectAgentModel(c, args)
  expect(c.getNode).toHaveBeenCalledWith('chatOpenAICustom')
  expect(report.parameters).toHaveLength(11)
  expect(report.parameters.find(p => p.alias === 'reasoning.effort')).toMatchObject({ field: 'reasoningEffort', aliases: ['reasoning.effort', 'reasoningEffort'], optional: true, enum: efforts, dependencies: {} })
  expect(report.parameters.find(p => p.alias === 'modelName')).toMatchObject({ optional: false, stored: { state: 'stored', redacted: true }, catalogDefault: { state: 'available', redacted: true } })
  expect(JSON.stringify(report)).not.toMatch(/PRIVATE_PLACEHOLDER|UNTRUSTED|YOUR_API_KEY/)
})
it.each(efforts)('sets effort %s without a reasoning toggle', async effort => {
  expect(await editAgentModel(client(), { ...args, set: [`reasoningEffort=${effort}`] })).toMatchObject({ changed: true })
})
it('applies native fields and aliases with form JSON replacement and exact deletion while preserving everything else', async () => {
  const c = client(); const expected = structuredClone(c.source.flowData)
  Object.assign(expected.nodes[0]!.data.inputs.agentModelConfig, { modelName: 'NEW_PRIVATE_PLACEHOLDER', streaming: false, temperature: 3, maxTokens: -2.5, topP: 2, frequencyPenalty: -3, presencePenalty: 4, timeout: 0.5, basepath: 'https://example.com', reasoningEffort: 'none' })
  delete expected.nodes[0]!.data.inputs.agentModelConfig.baseOptions
  const report = await editAgentModel(c, { ...args, apply: true, set: ['modelName=NEW_PRIVATE_PLACEHOLDER', 'streaming=false', 'temperature=3', 'max-output-tokens=-2.5', 'top-p=2', 'frequencyPenalty=-3', 'presencePenalty=4', 'timeout=0.5', 'basepath=https://example.com', 'reasoning.effort=none'], unset: ['baseOptions'] })
  expect(c.updateAgentflow).toHaveBeenCalledExactlyOnceWith('target', { flowData: expected })
  expect(report).toMatchObject({ applied: true })
  expect(JSON.stringify(report)).not.toMatch(/PRIVATE_PLACEHOLDER|example.com|YOUR_API_KEY/)
})
it('parses env and UTF8 file sources through the same types and replaces JSON as serialized form text', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'model-test-')); const path = join(dir, 'options.json')
  try {
    await writeFile(path, '{ "headers": {"example": "FILE_PRIVATE_PLACEHOLDER"} }')
    vi.stubEnv('MODEL_TEST_STREAMING', 'true')
    const c = client()
    const report = await editAgentModel(c, { ...args, apply: true, setEnv: ['streaming=MODEL_TEST_STREAMING'], setFile: [`baseOptions=${path}`] })
    expect(c.source.flowData.nodes[0]!.data.inputs.agentModelConfig).toMatchObject({ streaming: true, baseOptions: '{"headers":{"example":"FILE_PRIVATE_PLACEHOLDER"}}' })
    expect(JSON.stringify(report)).not.toMatch(/FILE_PRIVATE|model-test-|MODEL_TEST/)
  } finally { await rm(dir, { recursive: true, force: true }) }
})
it.each([
  { set: ['modelName= '] }, { unset: ['modelName'] }, { set: ['baseOptions=[]'] }, { set: ['baseOptions=null'] }, { set: ['baseOptions={PRIVATE_PLACEHOLDER'] },
  { set: ['streaming=1'] }, { set: ['timeout=Infinity'] }, { set: ['reasoning.enabled=true'] }, { set: ['credential=YOUR_API_KEY'] }, { set: ['cache=x'] },
  { set: ['top-p=1', 'topP=1'] }, { set: ['topP=1'], unset: ['top-p'] }, { setEnv: ['streaming=MISSING_PRIVATE_PLACEHOLDER'] }, { setFile: ['baseOptions=/nonexistent/PRIVATE_PLACEHOLDER'] },
  { set: ['temperature=1'], setEnv: ['temperature=PRIVATE_PLACEHOLDER'] }
])('rejects invalid operations safely: %j', async operations => {
  const c = client()
  const error = await editAgentModel(c, { ...args, ...operations }).catch(error => error)
  expect(error).toMatchObject({ code: 'AGENT_MODEL_PARAM_INVALID' })
  expect(error.message).not.toMatch(/PRIVATE_PLACEHOLDER|nonexistent|YOUR_API_KEY/)
  expect(c.updateAgentflow).not.toHaveBeenCalled()
})
it('honors catalog numeric bounds and visibility and no-op deletion timestamp checks', async () => {
  const c = client(); const bounded = structuredClone(schema); bounded.inputs!.find(p => p.name === 'timeout')!.max = 10; bounded.inputs!.find(p => p.name === 'temperature')!.show = { streaming: true }; c.getNode.mockResolvedValue(bounded)
  await expect(editAgentModel(c, { ...args, set: ['timeout=11'] })).rejects.toMatchObject({ code: 'AGENT_MODEL_PARAM_INVALID' })
  await expect(editAgentModel(c, { ...args, set: ['temperature=1'] })).rejects.toMatchObject({ code: 'AGENT_MODEL_DEPENDENCY_INVALID' })
  expect(await editAgentModel(c, { ...args, unset: ['timeout'], apply: true })).toMatchObject({ changed: false, applied: false })
  await expect(editAgentModel(c, { ...args, unset: ['timeout'], ifMatchUpdatedAt: 'stale' })).rejects.toMatchObject({ code: 'REMOTE_CHANGED' })
})
it('rejects full-canvas concurrency changes and deletion readback mismatches without retry', async () => {
  const c = client(); const latest = structuredClone(c.source); latest.flowData.extra = false
  c.getChatflow.mockResolvedValueOnce(structuredClone(c.source)).mockResolvedValueOnce(latest)
  await expect(editAgentModel(c, { ...args, unset: ['baseOptions'], apply: true })).rejects.toMatchObject({ code: 'REMOTE_CHANGED' })
  expect(c.updateAgentflow).not.toHaveBeenCalled()
  const ignored = client(); ignored.updateAgentflow.mockImplementation(async () => ignored.source)
  await expect(editAgentModel(ignored, { ...args, unset: ['baseOptions'], apply: true })).rejects.toMatchObject({ code: 'REMOTE_PERSISTENCE_MISMATCH' })
  expect(ignored.updateAgentflow).toHaveBeenCalledTimes(1)
})

it('rejects malformed UTF8 file contents without exposing the source or writing', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'model-utf8-test-')); const path = join(dir, 'PRIVATE_PLACEHOLDER')
  try {
    await writeFile(path, Buffer.from([0xc3, 0x28]))
    const c = client()
    const error = await editAgentModel(c, { ...args, setFile: [`modelName=${path}`], apply: true }).catch(error => error)
    expect(error).toMatchObject({ code: 'AGENT_MODEL_PARAM_INVALID' })
    expect(error.message).not.toMatch(/PRIVATE_PLACEHOLDER|model-utf8-test/)
    expect(c.updateAgentflow).not.toHaveBeenCalled()
  } finally { await rm(dir, { recursive: true, force: true }) }
})
