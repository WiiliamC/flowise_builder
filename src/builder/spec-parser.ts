import { readFile } from 'node:fs/promises'
import { extname } from 'node:path'
import YAML from 'yaml'
import { AgentflowSpecSchema, type AgentflowSpec } from '../domain/spec.js'
import type { Diagnostic } from '../domain/diagnostics.js'

export class SpecError extends Error {
  readonly code = 'SPEC_SCHEMA_INVALID'
  constructor(message: string, readonly diagnostics: Diagnostic[]) { super(message); this.name = 'SpecError' }
}

export function parseSpecText(text: string, format?: 'yaml' | 'json'): AgentflowSpec {
  let raw: unknown
  try { raw = format === 'json' ? JSON.parse(text) : YAML.parse(text) }
  catch (error) { throw new SpecError('Unable to parse spec', [{ code: 'SPEC_SCHEMA_INVALID', severity: 'error', message: String(error) }]) }
  const result = AgentflowSpecSchema.safeParse(raw)
  if (!result.success) {
    const diagnostics: Diagnostic[] = result.error.issues.map((issue) => ({
      code: issue.code === 'unrecognized_keys' ? 'SPEC_UNKNOWN_FIELD' : 'SPEC_SCHEMA_INVALID',
      severity: 'error', message: issue.message, path: issue.path.join('.')
    }))
    throw new SpecError(diagnostics[0]?.message ?? 'Invalid spec', diagnostics)
  }
  const keys = new Set<string>()
  for (const item of result.data.spec.nodes) {
    if (keys.has(item.key)) throw new SpecError(`Duplicate node key: ${item.key}`, [{ code: 'NODE_KEY_DUPLICATE', severity: 'error', message: `Duplicate node key: ${item.key}`, nodeKey: item.key }])
    keys.add(item.key)
  }
  for (const [index, item] of result.data.spec.edges.entries()) {
    for (const ref of [item.from, item.to]) if (!keys.has(ref)) throw new SpecError(`Edge references missing node: ${ref}`, [{ code: 'EDGE_NODE_NOT_FOUND', severity: 'error', message: `Edge references missing node: ${ref}`, edgeIndex: index }])
  }
  return result.data
}

export async function parseSpecFile(path: string) {
  return parseSpecText(await readFile(path, 'utf8'), extname(path).toLowerCase() === '.json' ? 'json' : 'yaml')
}
