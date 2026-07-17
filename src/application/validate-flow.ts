import type { Diagnostic } from '../domain/diagnostics.js'
import type { FlowData } from '../domain/flow-data.js'
import type { NodeDataSchema } from '../domain/node-catalog.js'
import { isVisible } from '../flowise/field-visibility.js'

const empty = (value: unknown) => value == null || value === '' || value === '<p></p>' || (Array.isArray(value) && value.length === 0)
function matchesInputType(type: string, value: unknown): boolean {
  if (empty(value)) return true
  if (type === 'number') return typeof value === 'number' && Number.isFinite(value)
  if (type === 'boolean') return typeof value === 'boolean'
  if (['array', 'datagrid', 'multiOptions', 'asyncMultiOptions'].includes(type)) return Array.isArray(value)
  if (type === 'json') {
    if (typeof value === 'object') return value !== null
    if (typeof value !== 'string') return false
    try { JSON.parse(value); return true } catch { return false }
  }
  if (['string', 'password', 'code', 'date', 'file', 'folder', 'options', 'asyncOptions', 'conditionFunction', 'credential'].includes(type)) return typeof value === 'string'
  return true
}
export function validateFlow(flow: FlowData, catalog: NodeDataSchema[] = [], strict = false) {
  const diagnostics: Diagnostic[] = []
  if (!flow.nodes.length) diagnostics.push({ code: 'FLOW_EMPTY', severity: 'error', message: 'Flow is empty' })
  const starts = flow.nodes.filter((node) => node.data.name === 'startAgentflow')
  if (starts.length === 0) diagnostics.push({ code: 'START_MISSING', severity: 'error', message: 'Flow must have one Start node' })
  if (starts.length > 1) diagnostics.push({ code: 'START_DUPLICATE', severity: 'error', message: 'Flow can only have one Start node' })
  const ids = new Set(flow.nodes.map((node) => node.id))
  const connected = new Set<string>()
  const adjacency = new Map(flow.nodes.map((node) => [node.id, [] as string[]]))
  const edgeKeys = new Set<string>()
  for (const [index, edge] of flow.edges.entries()) {
    if (!ids.has(edge.source) || !ids.has(edge.target)) diagnostics.push({ code: 'EDGE_HANGING', severity: 'error', message: 'Edge references a missing node', edgeIndex: index })
    connected.add(edge.source); connected.add(edge.target); adjacency.get(edge.source)?.push(edge.target)
    const key = `${edge.source}|${edge.sourceHandle ?? ''}|${edge.target}|${edge.targetHandle ?? ''}`
    if (edgeKeys.has(key)) diagnostics.push({ code: 'EDGE_DUPLICATE', severity: strict ? 'error' : 'warning', message: 'Duplicate edge', edgeIndex: index }); edgeKeys.add(key)
    const source = flow.nodes.find((node) => node.id === edge.source); const target = flow.nodes.find((node) => node.id === edge.target)
    if (edge.sourceHandle && !source?.data.outputAnchors?.some((anchor) => anchor.id === edge.sourceHandle)) diagnostics.push({ code: 'EDGE_HANDLE_HANGING', severity: 'error', message: 'Source handle does not exist', edgeIndex: index })
    if (edge.targetHandle && edge.targetHandle !== target?.id && !target?.data.inputAnchors?.some((anchor) => anchor.id === edge.targetHandle)) diagnostics.push({ code: 'EDGE_HANDLE_HANGING', severity: 'error', message: 'Target handle does not exist', edgeIndex: index })
  }
  const colors = new Map<string, number>(); let cycle = false
  const visit = (id: string) => { colors.set(id, 1); for (const next of adjacency.get(id) ?? []) { if (colors.get(next) === 1) cycle = true; else if (!colors.get(next)) visit(next) }; colors.set(id, 2) }
  for (const id of ids) if (!colors.get(id)) visit(id)
  if (cycle) diagnostics.push({ code: 'FLOW_CYCLE', severity: 'error', message: 'Flow contains a cycle' })
  for (const node of flow.nodes.filter((item) => item.data.name !== 'stickyNoteAgentflow')) {
    if (!connected.has(node.id)) diagnostics.push({ code: 'NODE_ISOLATED', severity: strict ? 'error' : 'warning', message: 'Node is not connected', nodeId: node.id })
    const schema = catalog.find((item) => item.name === node.data.name)
    for (const param of schema?.inputs ?? node.data.inputParams ?? []) {
      if (!isVisible(param, node.data.inputs)) continue
      const value = node.data.inputs[param.name] ?? param.default
      if (!param.optional && empty(value)) diagnostics.push({ code: 'INPUT_REQUIRED_MISSING', severity: 'error', message: `${param.label} is required`, nodeId: node.id, path: `nodes.${node.id}.inputs.${param.name}` })
      if (!matchesInputType(param.type, value)) diagnostics.push({ code: 'INPUT_TYPE_INVALID', severity: 'error', message: `${param.label} has an invalid type`, nodeId: node.id, path: `nodes.${node.id}.inputs.${param.name}` })
      if (param.options && !empty(value)) {
        const names = param.options.map((option) => typeof option === 'string' ? option : option.name)
        if (typeof value === 'string' && !names.includes(value)) diagnostics.push({ code: 'INPUT_OPTION_INVALID', severity: 'error', message: `${param.label} has an invalid option`, nodeId: node.id })
      }
      if (param.type === 'array' && Array.isArray(value) && param.array) {
        for (const [itemIndex, item] of value.entries()) {
          if (!item || typeof item !== 'object' || Array.isArray(item)) { diagnostics.push({ code: 'INPUT_TYPE_INVALID', severity: 'error', message: `${param.label} item #${itemIndex + 1} must be an object`, nodeId: node.id }); continue }
          for (const child of param.array) {
            if (!isVisible(child, node.data.inputs, itemIndex)) continue
            const childValue = (item as Record<string, unknown>)[child.name] ?? child.default
            if (!child.optional && empty(childValue)) diagnostics.push({ code: 'INPUT_REQUIRED_MISSING', severity: 'error', message: `${param.label} item #${itemIndex + 1}: ${child.label} is required`, nodeId: node.id })
            if (!matchesInputType(child.type, childValue)) diagnostics.push({ code: 'INPUT_TYPE_INVALID', severity: 'error', message: `${param.label} item #${itemIndex + 1}: ${child.label} has an invalid type`, nodeId: node.id })
          }
        }
      }
      const config = node.data.inputs[`${param.name}Config`]
      if (param.loadConfig && typeof value === 'string') {
        const nested = catalog.find((item) => item.name === value)
        const nestedConfig = config && typeof config === 'object' && !Array.isArray(config) ? config as Record<string, unknown> : {}
        const effectiveNestedConfig = { ...nestedConfig }
        for (const nestedParam of nested?.inputs ?? []) if (effectiveNestedConfig[nestedParam.name] === undefined && nestedParam.default !== undefined) effectiveNestedConfig[nestedParam.name] = nestedParam.default
        for (const nestedParam of nested?.inputs ?? []) if (!nestedParam.optional && isVisible(nestedParam, effectiveNestedConfig) && empty(effectiveNestedConfig[nestedParam.name])) diagnostics.push({ code: 'NESTED_CONFIG_INVALID', severity: 'error', message: `${param.label} configuration: ${nestedParam.label} is required`, nodeId: node.id })
      }
    }
    for (const credential of (node.data.inputParams ?? []).filter((param) => param.type === 'credential' && !param.optional)) if (empty(node.data.credential)) diagnostics.push({ code: 'CREDENTIAL_REQUIRED', severity: 'error', message: `${credential.label} is required`, nodeId: node.id, path: `nodes.${node.id}.credential` })
  }
  if (starts[0]) {
    const reached = new Set<string>(); const walk = (id: string) => { if (reached.has(id)) return; reached.add(id); for (const next of adjacency.get(id) ?? []) walk(next) }; walk(starts[0].id)
    for (const node of flow.nodes) if (!reached.has(node.id) && connected.has(node.id) && node.type !== 'stickyNote') diagnostics.push({ code: 'NODE_UNREACHABLE', severity: strict ? 'error' : 'warning', message: 'Node is unreachable from Start', nodeId: node.id })
  }
  return { valid: !diagnostics.some((item) => item.severity === 'error'), diagnostics }
}
