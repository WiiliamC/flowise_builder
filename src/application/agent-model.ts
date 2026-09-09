import { readFile } from 'node:fs/promises'
import { isDeepStrictEqual } from 'node:util'
import type { FlowData } from '../domain/flow-data.js'
import type { InputParam, NodeDataSchema } from '../domain/node-catalog.js'
import type { Chatflow } from '../flowise/flowise-api-types.js'
import { FlowiseError } from '../flowise/flowise-client.js'
import { isVisible } from '../flowise/field-visibility.js'
import { parseFlowData } from './inspect-agentflows.js'

interface Client {
  getChatflow(id: string): Promise<Chatflow>
  getNode(name: string): Promise<NodeDataSchema>
  updateAgentflow(id: string, input: { flowData: FlowData }): Promise<Chatflow>
}
interface Rule { alias: string; field: string; type: 'boolean' | 'number' | 'options' | 'string' | 'json'; required?: boolean; min?: number; max?: number; integer?: boolean; values?: string[] }
const adapters: ReadonlyMap<string, readonly Rule[]> = new Map([['chatOpenAI', [
  { alias: 'reasoning.enabled', field: 'reasoning', type: 'boolean' },
  { alias: 'reasoning.effort', field: 'reasoningEffort', type: 'options', values: ['low', 'medium', 'high', 'xhigh'] },
  { alias: 'temperature', field: 'temperature', type: 'number', min: 0, max: 2 },
  { alias: 'max-output-tokens', field: 'maxTokens', type: 'number', min: 1, max: Number.MAX_SAFE_INTEGER, integer: true },
  { alias: 'top-p', field: 'topP', type: 'number', min: 0, max: 1 }
]], ['chatOpenAICustom', [
  { alias: 'modelName', field: 'modelName', type: 'string', required: true },
  { alias: 'temperature', field: 'temperature', type: 'number' },
  { alias: 'streaming', field: 'streaming', type: 'boolean' },
  { alias: 'reasoning.effort', field: 'reasoningEffort', type: 'options', values: ['none', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max'] },
  { alias: 'max-output-tokens', field: 'maxTokens', type: 'number' },
  { alias: 'top-p', field: 'topP', type: 'number' },
  { alias: 'frequencyPenalty', field: 'frequencyPenalty', type: 'number' },
  { alias: 'presencePenalty', field: 'presencePenalty', type: 'number' },
  { alias: 'timeout', field: 'timeout', type: 'number' },
  { alias: 'basepath', field: 'basepath', type: 'string' },
  { alias: 'baseOptions', field: 'baseOptions', type: 'json' }
]]])
const warning = { code: 'MODEL_COMPATIBILITY_UNVERIFIED', severity: 'warning' as const, message: 'Live schema validation cannot establish runtime model or custom endpoint compatibility.' }
const record = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === 'object' && !Array.isArray(value)
function fail(code: string, message: string): never { throw new FlowiseError(code, message) }
async function read(client: Client, id: string) {
  try { return await client.getChatflow(id) } catch (error) { return fail(error instanceof FlowiseError ? error.code : 'REMOTE_READ_FAILED', 'Agentflow read failed') }
}
function flowOf(remote: Chatflow) {
  if (remote.type !== 'AGENTFLOW') fail('TARGET_NOT_AGENTFLOW', 'Target is not an Agentflow')
  return parseFlowData(remote)
}
function selected(flow: FlowData, ref: string) {
  const match = /^n([1-9]\d*)$/.exec(ref)
  const node = match ? flow.nodes[Number(match[1]) - 1] : undefined
  if (!node || node.data.name !== 'agentAgentflow') fail('AGENT_REF_INVALID', 'Agent reference does not identify an agent node')
  const config = node.data.inputs.agentModelConfig
  if (!record(config)) fail('AGENT_MODEL_CONFIG_INVALID', 'Agent model configuration must be an object')
  return { config, component: node.data.inputs.agentModel }
}
interface Allowed { rule: Rule; param: InputParam; values?: string[]; min?: number; max?: number }
function intersect(rules: readonly Rule[], schema: NodeDataSchema): Allowed[] {
  if (!Array.isArray(schema.inputs)) fail('AGENT_MODEL_CATALOG_INVALID', 'Model catalog inputs are unavailable')
  return rules.flatMap<Allowed>((rule) => {
    const fields = schema.inputs!.filter((p) => record(p) && p.name === rule.field)
    const param = fields[0]
    if (fields.length !== 1 || !param || param.type !== rule.type) return []
    if ([param.show, param.hide].some((v) => v !== undefined && !record(v))) fail('AGENT_MODEL_CATALOG_INVALID', 'Model catalog visibility is malformed')
    if (rule.type === 'options') {
      if (!Array.isArray(param.options)) return []
      const names = param.options.map((o) => typeof o === 'string' ? o : record(o) ? o.name : undefined)
      const values = rule.values!.filter((v) => names.includes(v))
      return values.length ? [{ rule, param, values }] : []
    }
    const bounds: { min?: number; max?: number } = { ...(rule.min !== undefined ? { min: rule.min } : {}), ...(rule.max !== undefined ? { max: rule.max } : {}) }
    for (const [key, target] of [['min', 'min'], ['minimum', 'min'], ['max', 'max'], ['maximum', 'max']] as const) {
      if (param[key] === undefined) continue
      if (typeof param[key] !== 'number' || !Number.isFinite(param[key])) return []
      bounds[target] = target === 'min' ? Math.max(bounds.min ?? -Infinity, param[key]) : Math.min(bounds.max ?? Infinity, param[key])
    }
    if ((bounds.min ?? -Infinity) > (bounds.max ?? Infinity)) return []
    return [{ rule, param, ...bounds }]
  })
}
const aliases = (a: Allowed) => [...new Set([a.rule.alias, a.rule.field])]
const optional = (a: Allowed) => !a.rule.required && a.param.optional === true
const displayed = (value: unknown, a: Allowed) => a.rule.type === 'string' || a.rule.type === 'json' ? { redacted: true } : { value }
function valid(value: unknown, a: Allowed): boolean {
  if (a.rule.type === 'string') return typeof value === 'string' && (optional(a) || value.trim().length > 0)
  if (a.rule.type === 'json') {
    if (typeof value !== 'string') return false
    try { return record(JSON.parse(value)) } catch { return false }
  }
  if (a.rule.type === 'boolean') return typeof value === 'boolean'
  if (a.rule.type === 'options') return typeof value === 'string' && Boolean(a.values?.includes(value))
  return typeof value === 'number' && Number.isFinite(value) && (!a.rule.integer || Number.isSafeInteger(value)) && value >= (a.min ?? -Infinity) && value <= (a.max ?? Infinity)
}
function state(config: Record<string, unknown>, a: Allowed) {
  if (!Object.hasOwn(config, a.rule.field)) return { state: 'absent' as const }
  const value = config[a.rule.field]
  return valid(value, a) ? { state: 'stored' as const, ...displayed(value, a) } : { state: 'invalid' as const }
}
async function context(client: Client, targetId: string, agentRef: string) {
  const remote = await read(client, targetId)
  const flow = flowOf(remote)
  const { config, component } = selected(flow, agentRef)
  const rules = typeof component === 'string' ? adapters.get(component) : undefined
  if (!rules) return { remote, flow, config, component: 'unsupported', allowed: [], supported: false }
  let schema: NodeDataSchema
  try { schema = await client.getNode(component as string) } catch { return fail('AGENT_MODEL_CATALOG_INVALID', 'Model catalog could not be read') }
  if (!schema || schema.name !== component) fail('AGENT_MODEL_CATALOG_INVALID', 'Model catalog does not match the component')
  return { remote, flow, config, component: component as string, allowed: intersect(rules, schema), supported: true }
}
export async function inspectAgentModel(client: Client, input: { targetId: string; agentRef: string }) {
  const c = await context(client, input.targetId, input.agentRef)
  return { agentRef: input.agentRef, updatedDate: c.remote.updatedDate, component: c.component, supported: c.supported, warnings: [warning], parameters: c.allowed.map((a) => ({
    alias: a.rule.alias, field: a.rule.field, aliases: aliases(a), optional: optional(a), type: a.rule.type, ...(a.values ? { enum: a.values } : {}), ...(a.min !== undefined ? { min: a.min } : {}), ...(a.max !== undefined ? { max: a.max } : {}),
    dependencies: c.component === 'chatOpenAI' && a.rule.field === 'reasoningEffort' ? { 'reasoning.enabled': true } : {},
    catalogVisibilityConditional: Boolean(a.param.show || a.param.hide), stored: state(c.config, a),
    catalogDefault: a.param.default === undefined ? { state: 'absent' } : valid(a.param.default, a) ? { state: 'available', ...displayed(a.param.default, a) } : { state: 'invalid' }
  })) }
}
export async function editAgentModel(client: Client, input: { targetId: string; agentRef: string; ifMatchUpdatedAt: string; set?: string[]; setEnv?: string[]; setFile?: string[]; unset?: string[]; apply: boolean }) {
  if (!input.ifMatchUpdatedAt) fail('UPDATED_DATE_REQUIRED', 'An updatedDate match is required')
  if (![input.set, input.setEnv, input.setFile, input.unset].some((items) => items?.length)) fail('AGENT_MODEL_PARAM_INVALID', 'At least one parameter operation is required')
  const c = await context(client, input.targetId, input.agentRef)
  if (c.remote.updatedDate !== input.ifMatchUpdatedAt) fail('REMOTE_CHANGED', 'Remote Agentflow changed since it was inspected')
  if (!c.supported) fail('AGENT_MODEL_UNSUPPORTED', 'Editing this model component is unsupported')
  const assignments = new Map<Allowed, unknown>()
  // Resolve all canonical keys before reading any external source.
  const operations: { a: Allowed; source: string; raw: string }[] = []
  const seen = new Set<Allowed>()
  for (const [source, entries] of [['set', input.set], ['env', input.setEnv], ['file', input.setFile], ['unset', input.unset]] as const) {
    for (const entry of entries ?? []) {
      const index = source === 'unset' ? entry.length : entry.indexOf('=')
      const key = entry.slice(0, index)
      const a = c.allowed.find((item) => aliases(item).includes(key))
      if (index < 1 || !a || seen.has(a)) fail('AGENT_MODEL_PARAM_INVALID', 'Parameter is unknown, unavailable, or duplicated')
      if (source === 'unset' && !optional(a)) fail('AGENT_MODEL_PARAM_INVALID', 'Required parameters cannot be removed')
      seen.add(a)
      operations.push({ a, source, raw: entry.slice(index + 1) })
    }
  }
  for (const operation of operations) {
    const { a, source } = operation
    if (source === 'unset') { assignments.set(a, undefined); continue }
    let raw = operation.raw
    if (source === 'env') {
      if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(raw) || process.env[raw] === undefined) fail('AGENT_MODEL_PARAM_INVALID', 'Parameter environment source is unavailable')
      raw = process.env[raw]!
    }
    if (source === 'file') {
      try { raw = new TextDecoder('utf-8', { fatal: true }).decode(await readFile(raw)) } catch { fail('AGENT_MODEL_PARAM_INVALID', 'Parameter file source could not be read') }
    }
    let value: unknown = raw
    if (a.rule.type === 'boolean') value = raw === 'true' ? true : raw === 'false' ? false : undefined
    if (a.rule.type === 'number') value = /^-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?$/.test(raw) ? Number(raw) : undefined
    if (!valid(value, a)) fail('AGENT_MODEL_PARAM_INVALID', 'Parameter value does not satisfy the allowed type or range')
    if (a.rule.type === 'json') value = JSON.stringify(JSON.parse(raw))
    assignments.set(a, value)
  }
  const candidate = structuredClone(c.flow)
  const config = selected(candidate, input.agentRef).config
  for (const [a, value] of assignments) {
    if (value === undefined) delete config[a.rule.field]
    else config[a.rule.field] = value
  }
  for (const [a] of assignments) {
    if (assignments.get(a) === undefined) continue
    if (c.component === 'chatOpenAI' && a.rule.field === 'reasoningEffort' && config.reasoning !== true) fail('AGENT_MODEL_DEPENDENCY_INVALID', 'Reasoning effort requires reasoning to be explicitly enabled')
    if (!isVisible(a.param, config)) fail('AGENT_MODEL_DEPENDENCY_INVALID', 'A requested parameter is hidden by catalog dependencies')
    const option = (Array.isArray(a.param.options) ? a.param.options : [])?.find((o) => record(o) && o.name === config[a.rule.field])
    if (record(option) && !isVisible({ ...a.param, show: option.show, hide: option.hide } as InputParam, config)) fail('AGENT_MODEL_DEPENDENCY_INVALID', 'A requested option is hidden by catalog dependencies')
  }
  // Restore requested keys on a second copy to prove the entire remaining canvas is unchanged.
  const restored = structuredClone(candidate)
  const restoredConfig = selected(restored, input.agentRef).config
  for (const [a] of assignments) {
    if (Object.hasOwn(c.config, a.rule.field)) restoredConfig[a.rule.field] = c.config[a.rule.field]
    else delete restoredConfig[a.rule.field]
  }
  if (!isDeepStrictEqual(restored, c.flow)) fail('AGENT_MODEL_DELTA_INVALID', 'Edit changed fields outside the requested parameters')
  const changes = [...assignments].filter(([a, value]) => value === undefined ? Object.hasOwn(c.config, a.rule.field) : !Object.hasOwn(c.config, a.rule.field) || !isDeepStrictEqual(c.config[a.rule.field], value)).map(([a]) => ({ alias: a.rule.alias, before: state(c.config, a), after: state(config, a) }))
  const result = { agentRef: input.agentRef, component: c.component, changed: changes.length > 0, applied: false, changes, warnings: [warning], updatedDate: c.remote.updatedDate }
  if (!result.changed || !input.apply) return result
  const latest = await read(client, input.targetId)
  if (latest.updatedDate !== input.ifMatchUpdatedAt || !isDeepStrictEqual(flowOf(latest), c.flow)) fail('REMOTE_CHANGED', 'Remote Agentflow changed before update')
  try { await client.updateAgentflow(input.targetId, { flowData: candidate }) }
  catch (error) { throw new FlowiseError(error instanceof FlowiseError ? error.code : 'REMOTE_WRITE_FAILED', 'Agentflow update failed') }
  const persisted = await read(client, input.targetId)
  if (!isDeepStrictEqual(flowOf(persisted), candidate)) fail('REMOTE_PERSISTENCE_MISMATCH', 'Persisted Agentflow differs from the requested edit')
  return { ...result, applied: true, updatedDate: persisted.updatedDate }
}
