/** Compatibility implementation aligned with Flowise commit 83f2947 (nodeFactory.ts). */
import type { FlowNode, NodeData } from '../domain/flow-data.js'
import type { InputParam, NodeDataSchema, OutputAnchor } from '../domain/node-catalog.js'

const parameterTypes = new Set(['asyncOptions', 'asyncMultiOptions', 'options', 'multiOptions', 'array', 'datagrid', 'string', 'number', 'boolean', 'password', 'json', 'code', 'date', 'datePicker', 'timePicker', 'weekDaysPicker', 'monthDaysPicker', 'file', 'folder', 'tabs', 'conditionFunction'])

function defaultValue(param: InputParam): unknown {
  if (param.default !== undefined) return structuredClone(param.default)
  if (param.type === 'boolean') return false
  if (param.type === 'json') return '{}'
  if (param.type === 'array') return []
  return ''
}

export function dynamicOutputAnchors(id: string, count: number, prefix: string, includeElse: boolean): OutputAnchor[] {
  const anchors = Array.from({ length: count }, (_, index) => ({ id: `${id}-output-${index}`, name: String(index), label: String(index), type: prefix, description: `${prefix} ${index}` }))
  if (includeElse) anchors.push({ id: `${id}-output-${count}`, name: String(count), label: String(count), type: prefix, description: 'Else' })
  return anchors
}

export function initializeNode(schema: NodeDataSchema, id: string, label?: string): FlowNode {
  const params: InputParam[] = []
  const anchors = []
  for (const input of schema.inputs ?? schema.inputAnchors ?? []) {
    const initialized = { ...input, id: `${id}-input-${input.name}-${input.type}` }
    if (parameterTypes.has(input.type)) params.push(initialized)
    else anchors.push(initialized)
  }
  const inputs: Record<string, unknown> = {}
  for (const param of params) if (!(param.name in inputs)) inputs[param.name] = defaultValue(param)
  const credential = typeof schema.credential === 'object' ? schema.credential : undefined
  if (credential?.name) params.unshift({ ...credential, id: `${id}-input-${credential.name}-${credential.type ?? 'credential'}`, label: credential.label ?? 'Credential', type: credential.type ?? 'credential' })
  let outputs: OutputAnchor[]
  if (schema.name === 'conditionAgentflow') outputs = dynamicOutputAnchors(id, Array.isArray(inputs.conditions) ? inputs.conditions.length : 0, 'Condition', true)
  else if (schema.name === 'conditionAgentAgentflow') outputs = dynamicOutputAnchors(id, Array.isArray(inputs.conditionAgentScenarios) ? inputs.conditionAgentScenarios.length : 0, 'Scenario', false)
  else if (schema.hideOutput) outputs = []
  else if (schema.outputs?.length) outputs = schema.outputs.map((_, index) => ({ id: `${id}-output-${index}`, label: schema.label, name: schema.name }))
  else outputs = [{ id: `${id}-output-${schema.name}`, label: schema.label, name: schema.name }]
  const data: NodeData = {
    id, name: schema.name, label: label ?? schema.label, inputs, inputParams: params,
    inputAnchors: anchors, outputAnchors: outputs,
    outputs: !schema.hideOutput && schema.outputs?.length ? { [schema.name]: '' } : {},
    ...(credential?.name ? { credential: '' } : {})
  }
  for (const field of ['type', 'category', 'description', 'version', 'baseClasses', 'color', 'icon', 'hideInput'] as const) {
    if (schema[field] !== undefined) Object.assign(data, { [field]: schema[field] })
  }
  return { id, type: schema.type === 'Iteration' ? 'iteration' : schema.type === 'StickyNote' ? 'stickyNote' : 'agentflowNode', position: { x: 0, y: 0 }, data }
}

export function rebuildDynamicOutputs(node: FlowNode): void {
  if (node.data.name === 'conditionAgentflow') node.data.outputAnchors = dynamicOutputAnchors(node.id, Array.isArray(node.data.inputs.conditions) ? node.data.inputs.conditions.length : 0, 'Condition', true)
  if (node.data.name === 'conditionAgentAgentflow') node.data.outputAnchors = dynamicOutputAnchors(node.id, Array.isArray(node.data.inputs.conditionAgentScenarios) ? node.data.inputs.conditionAgentScenarios.length : 0, 'Scenario', false)
}
