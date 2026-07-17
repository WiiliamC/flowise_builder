import { createHash } from 'node:crypto'
import type { AgentflowSpec } from '../domain/spec.js'
import type { NodeDataSchema } from '../domain/node-catalog.js'
import type { Diagnostic } from '../domain/diagnostics.js'
import type { FlowData, FlowEdge } from '../domain/flow-data.js'
import { initializeNode, rebuildDynamicOutputs } from '../flowise/node-initializer.js'
import { resolveVariables } from '../builder/variable-resolver.js'
import { layoutFlow } from '../builder/layout-engine.js'
import { validateFlow } from './validate-flow.js'

const normalizeIdPart = (value: string) => value.replace(/[^a-zA-Z0-9_-]/g, '_')
const safe = (value: string) => normalizeIdPart(value).slice(0, 64)
const shortHash = (value: string) => createHash('sha256').update(value).digest('hex').slice(0, 10)
export const stableNodeId = (component: string, key: string) => {
  const full = `${normalizeIdPart(component)}_${normalizeIdPart(key)}`
  return full.length <= 100 ? full : `${full.slice(0, 89)}_${shortHash(`${component}\0${key}`)}`
}

function selectAnchor(anchors: Array<{ id: string; name: string; label: string; description?: string }> | undefined, requested: string | undefined, kind: string, diagnostics: Diagnostic[], edgeIndex: number): string | undefined {
  const values = anchors ?? []
  if (requested && requested !== 'default') {
    const found = values.find((anchor) => [anchor.name, anchor.label, anchor.description].includes(requested))
    if (!found) diagnostics.push({ code: 'EDGE_HANDLE_NOT_FOUND', severity: 'error', message: `No ${kind} anchor named ${requested}`, edgeIndex, hint: values.map((a) => a.name).join(', ') })
    return found?.id
  }
  if (values.length === 1) return values[0]?.id
  if (values.length > 1) diagnostics.push({ code: 'EDGE_HANDLE_AMBIGUOUS', severity: 'error', message: `${kind} anchor is ambiguous`, edgeIndex, hint: values.map((a) => a.name).join(', ') })
  if (values.length === 0 && kind === 'output') diagnostics.push({ code: 'NODE_HAS_NO_OUTPUT', severity: 'error', message: 'Source node has no output', edgeIndex })
  return undefined
}

export function buildFlow(spec: AgentflowSpec, catalog: NodeDataSchema[], credentials: Record<string, string> = {}) {
  const diagnostics: Diagnostic[] = []
  const schemas = new Map(catalog.map((item) => [item.name, item]))
  const ids = new Map(spec.spec.nodes.map((node) => [node.key, stableNodeId(node.component, node.key)]))
  const explicit = new Set<string>()
  const nodes = spec.spec.nodes.flatMap((decl, index) => {
    const schema = schemas.get(decl.component)
    if (!schema) { diagnostics.push({ code: 'COMPONENT_NOT_FOUND', severity: 'error', message: `Component not found: ${decl.component}`, nodeKey: decl.key, path: `spec.nodes.${index}.component` }); return [] }
    if (!schema.name.endsWith('Agentflow') && !/agent\s*flows?/i.test(schema.category ?? '')) { diagnostics.push({ code: 'COMPONENT_NOT_AGENTFLOW', severity: 'error', message: `Component is not an Agentflow V2 canvas node: ${decl.component}`, nodeKey: decl.key }); return [] }
    const id = ids.get(decl.key)!
    const node = initializeNode(schema, id, decl.label)
    const known = new Set([...(node.data.inputParams ?? []), ...(node.data.inputAnchors ?? [])].map((item) => item.name))
    const credentialName = typeof schema.credential === 'object' ? schema.credential.name : undefined
    for (const [name, value] of Object.entries(decl.inputs)) {
      const configBase = name.endsWith('Config') ? name.slice(0, -6) : undefined
      if (!known.has(name) && (!configBase || !known.has(configBase))) diagnostics.push({ code: 'INPUT_UNKNOWN', severity: 'error', message: `Unknown input: ${name}`, nodeKey: decl.key, path: `spec.nodes.${index}.inputs.${name}` })
      const resolved = resolveVariables(value, ids, credentials, diagnostics)
      if (name === credentialName) {
        if (typeof resolved !== 'string') diagnostics.push({ code: 'INPUT_TYPE_INVALID', severity: 'error', message: `${name} has an invalid type`, nodeKey: decl.key, path: `spec.nodes.${index}.inputs.${name}` })
        node.data.credential = typeof resolved === 'string' ? resolved : ''
      }
      else node.data.inputs[name] = resolved
    }
    rebuildDynamicOutputs(node)
    if (decl.position !== 'auto') { node.position = decl.position; explicit.add(id) }
    if (decl.size) { node.width = decl.size.width; node.height = decl.size.height }
    return [node]
  })
  const byKey = new Map(spec.spec.nodes.map((decl) => [decl.key, nodes.find((node) => node.id === ids.get(decl.key))]))
  const edges: FlowEdge[] = spec.spec.edges.map((decl, index) => {
    const source = byKey.get(decl.from); const target = byKey.get(decl.to)
    const sourceId = ids.get(decl.from) ?? ''; const targetId = ids.get(decl.to) ?? ''
    const sourceHandle = source ? selectAnchor(source.data.outputAnchors, decl.output, 'output', diagnostics, index) : undefined
    const targetHandle = target ? decl.input && decl.input !== 'default' ? selectAnchor(target.data.inputAnchors, decl.input, 'input', diagnostics, index) : target.id : undefined
    const id = `edge_${safe(sourceId)}_${shortHash(sourceHandle ?? 'default')}_${safe(targetId)}_${shortHash(targetHandle ?? 'default')}`
    return { id, source: sourceId, target: targetId, ...(sourceHandle ? { sourceHandle } : {}), ...(targetHandle ? { targetHandle } : {}), type: 'agentflowEdge', data: { sourceColor: source?.data.color, targetColor: target?.data.color, isHumanInput: source?.data.name === 'humanInputAgentflow' } }
  })
  const flowData: FlowData = { nodes, edges }
  layoutFlow(flowData, explicit, 360, 180, spec.spec.viewport?.zoom)
  diagnostics.push(...validateFlow(flowData, catalog).diagnostics)
  return { flowData, diagnostics, valid: !diagnostics.some((item) => item.severity === 'error') }
}
