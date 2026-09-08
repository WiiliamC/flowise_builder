import { afterEach, expect, it, vi } from 'vitest'
vi.mock('../src/config.js', () => ({ loadConfig: vi.fn(async () => ({ baseUrl: 'https://example.com' })), loadCredentialAliases: vi.fn() }))
const originalArgv = process.argv
const originalExitCode = process.exitCode
const source = { id: 'target', name: 'Example', type: 'AGENTFLOW', updatedDate: '2026-01-01', flowData: { nodes: [{ id: 'agent', type: 'agentflowNode', position: { x: 0, y: 0 }, data: { id: 'agent', name: 'agentAgentflow', label: 'Agent', inputs: { agentModel: 'chatOpenAI', agentModelConfig: { temperature: 0.5, modelName: 'CUSTOM_MODEL_PLACEHOLDER', basepath: 'https://example.com/private', apiKey: 'YOUR_API_KEY' } } } }], edges: [], metadata: { keep: true } } }
const catalog = { name: 'chatOpenAI', inputs: [{ name: 'temperature', type: 'number' }, { name: 'topP', type: 'number' }] }
afterEach(() => { process.argv = originalArgv; process.exitCode = originalExitCode; vi.restoreAllMocks(); vi.unstubAllGlobals() })
async function run(args: string[], responses: unknown[] = [source, catalog]) {
  vi.resetModules()
  const fetch = vi.fn()
  for (const response of responses) fetch.mockResolvedValueOnce(new Response(JSON.stringify(response)))
  vi.stubGlobal('fetch', fetch)
  const stdout = vi.spyOn(process.stdout, 'write').mockImplementation(() => true)
  const stderr = vi.spyOn(process.stderr, 'write').mockImplementation(() => true)
  process.argv = ['node', 'flowise-agentflow', '--format', 'json', ...args]
  await import('../src/cli.js')
  return { fetch, output: stdout.mock.calls.map(([s]) => String(s)).join(''), errors: stderr.mock.calls.map(([s]) => String(s)).join('') }
}
const common = ['--target-id', 'target', '--agent-ref', 'n1']
const edit = ['edit-agent-model', ...common, '--if-match-updated-at', source.updatedDate]
it('inspects one JSON report with safe values and no connection or config contents', async () => {
  const result = await run(['inspect-agent-model', ...common])
  expect(result.output.trim().split('\n')).toHaveLength(1)
  expect(JSON.parse(result.output)).toMatchObject({ ok: true, command: 'inspect-agent-model', data: { component: 'chatOpenAI', updatedDate: source.updatedDate } })
  expect(result.fetch.mock.calls.map(([, options]) => options.method)).toEqual(['GET', 'GET'])
  expect(result.output + result.errors).not.toMatch(/example.com|YOUR_API_KEY|CUSTOM_MODEL|basepath|apiKey/)
})
it('collects repeated assignments and defaults to preview', async () => {
  const result = await run([...edit, '--set', 'temperature=1', '--set', 'top-p=0.9'])
  expect(JSON.parse(result.output)).toMatchObject({ ok: true, applied: false, changed: true, data: { changes: [{ alias: 'temperature' }, { alias: 'top-p' }] } })
  expect(result.fetch).toHaveBeenCalledTimes(2)
})
it('sends only full flowData and verifies persisted timestamp on apply', async () => {
  const persisted = structuredClone(source); persisted.flowData.nodes[0]!.data.inputs.agentModelConfig.temperature = 1; persisted.updatedDate = '2026-01-02'
  const result = await run([...edit, '--set', 'temperature=1', '--apply'], [source, catalog, source, persisted, persisted])
  expect(JSON.parse(result.output)).toMatchObject({ ok: true, applied: true, data: { updatedDate: '2026-01-02' } })
  expect(result.fetch.mock.calls.map(([, o]) => o.method)).toEqual(['GET', 'GET', 'GET', 'PUT', 'GET'])
  expect(JSON.parse(result.fetch.mock.calls[3]![1].body)).toEqual({ flowData: JSON.stringify(persisted.flowData) })
})
it.each([
  ['edit-agent-model', ...common, '--set', 'temperature=1'],
  edit,
  [...edit, '--set', 'temperature=1', '--force'],
  [...edit, '--set', 'temperature=1', '--unknown=INPUT_SECRET_PLACEHOLDER']
])('rejects missing and unknown options without parser echoes', async (...args) => {
  const result = await run(args)
  expect(JSON.parse(result.output)).toMatchObject({ ok: false })
  expect(result.fetch).not.toHaveBeenCalled()
  expect(result.output + result.errors).not.toContain('INPUT_SECRET_PLACEHOLDER')
  expect(result.errors).toBe('')
})
it('never prints invalid assignment contents, including verbose mode', async () => {
  const result = await run([...edit, '--set', 'temperature=INPUT_SECRET_PLACEHOLDER', '--verbose'])
  expect(JSON.parse(result.output)).toMatchObject({ ok: false, error: { code: 'AGENT_MODEL_PARAM_INVALID' } })
  expect(result.output + result.errors).not.toMatch(/INPUT_SECRET|example.com|CUSTOM_MODEL|YOUR_API_KEY/)
  expect(result.errors).toBe('')
})
it('does not enable model privacy mode when an existing command uses its name as a value', async () => {
  const result = await run(['rename', '--name', 'edit-agent-model'])
  expect(result.errors).toContain("required option '--target-id <id>' not specified")
  expect(JSON.parse(result.output).error.message).toContain('--target-id')
})
