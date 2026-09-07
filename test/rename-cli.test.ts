import { afterEach, describe, expect, it, vi } from 'vitest'

vi.mock('../src/config.js', () => ({ loadConfig: vi.fn(async () => ({ baseUrl: 'https://example.com' })), loadCredentialAliases: vi.fn() }))
const originalArgv = process.argv
const originalExitCode = process.exitCode
const source = { id: 'target', name: 'Before\nname', type: 'AGENTFLOW', flowData: 'canvas must not be reported', updatedDate: '2026-01-01' }

afterEach(() => {
  process.argv = originalArgv
  process.exitCode = originalExitCode
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

async function run(args: string[], responses = [source]) {
  vi.resetModules()
  const fetch = vi.fn()
  for (const response of responses) fetch.mockResolvedValueOnce(new Response(JSON.stringify(response)))
  vi.stubGlobal('fetch', fetch)
  const stdout = vi.spyOn(process.stdout, 'write').mockImplementation(() => true)
  vi.spyOn(process.stderr, 'write').mockImplementation(() => true)
  process.argv = ['node', 'flowise-agentflow', ...args]
  await import('../src/cli.js')
  return { fetch, output: stdout.mock.calls.map(([value]) => String(value)).join('') }
}

describe('rename CLI', () => {
  it('parses required options and defaults to dry run with one JSON report', async () => {
    const { fetch, output } = await run(['rename', '--target-id', 'target', '--name', ' New 名称 ', '--format', 'json'])
    expect(output.trim().split('\n')).toHaveLength(1)
    expect(JSON.parse(output)).toMatchObject({ command: 'rename', ok: true, changed: true, applied: false, target: { chatflowId: 'target', type: 'AGENTFLOW' }, data: { before: { name: source.name }, after: { name: ' New 名称 ' } } })
    expect(output).not.toContain(source.flowData)
    expect(fetch).toHaveBeenCalledTimes(1)
  })
  it('parses apply and exact timestamp with global JSON format', async () => {
    const { fetch, output } = await run(['--format', 'json', 'rename', '--target-id', 'target', '--name', 'New', '--if-match-updated-at', source.updatedDate, '--apply'], [source, source, source, { ...source, name: 'New' }])
    expect(JSON.parse(output)).toMatchObject({ ok: true, changed: true, applied: true })
    expect(fetch.mock.calls.map(([, options]) => options.method)).toEqual(['GET', 'GET', 'PUT', 'GET'])
  })
  it.each([['--target-id', 'target'], ['--name', 'New']])('requires both ID and name', async (options) => {
    const { fetch, output } = await run(['--format', 'json', 'rename', ...options])
    expect(JSON.parse(output)).toMatchObject({ ok: false, error: { code: 'commander.missingMandatoryOptionValue' } })
    expect(fetch).not.toHaveBeenCalled()
  })
  it('does not omit an explicitly empty timestamp', async () => {
    const { fetch, output } = await run(['rename', '--target-id', 'target', '--name', 'New', '--if-match-updated-at', '', '--apply', '--format', 'json'])
    expect(JSON.parse(output)).toMatchObject({ ok: false, error: { code: 'REMOTE_CHANGED' } })
    expect(fetch).toHaveBeenCalledTimes(1)
  })
  it('escapes control characters in human old and new names', async () => {
    const { output } = await run(['rename', '--target-id', 'target', '--name', 'New\u001b[31m', '--format', 'human'])
    expect(output).toContain('Before: Before\\nname\n')
    expect(output).toContain('After: New\\u001b[31m\n')
    expect(output).not.toContain('\u001b')
  })
})
