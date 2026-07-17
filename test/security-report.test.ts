import { describe, expect, it, vi } from 'vitest'
import { redact, redactText } from '../src/output/secret-redactor.js'
import { emitReport, makeReport } from '../src/output/report-writer.js'
import { writeSensitiveJson } from '../src/output/artifact-writer.js'
import { mkdtemp, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

describe('security and report contracts', () => {
  it('restores owner-only permissions when overwriting an artifact', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'flowise-builder-'))
    const path = join(directory, 'artifact.json')
    try {
      await writeFile(path, '{}\n', { mode: 0o644 })
      const original = await stat(path)
      await writeSensitiveJson(path, { credential: 'id' })
      const replacement = await stat(path)
      expect(replacement.mode & 0o777).toBe(0o600)
      expect(replacement.ino).not.toBe(original.ino)
    } finally {
      await rm(directory, { recursive: true, force: true })
    }
  })
  it('deeply redacts secret-shaped fields and literal tokens', () => {
    expect(redact({ authorization: 'Bearer abc', nested: { apiKey: 'abc', safe: 'yes' } })).toEqual({ authorization: '[REDACTED]', nested: { apiKey: '[REDACTED]', safe: 'yes' } })
    expect(redactText('failure abc', ['abc'])).toBe('failure [REDACTED]')
  })
  it('emits exactly one compact JSON object to stdout', () => {
    const write = vi.spyOn(process.stdout, 'write').mockImplementation(() => true)
    emitReport(makeReport('build', { ok: true }), 'json')
    expect(write).toHaveBeenCalledTimes(1)
    expect(() => JSON.parse(String(write.mock.calls[0]?.[0]).trim())).not.toThrow()
    write.mockRestore()
  })
})
