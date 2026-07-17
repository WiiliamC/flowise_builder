import type { FlowData } from '../domain/flow-data.js'
import type { FlowNode } from '../domain/flow-data.js'
import { redact } from '../output/secret-redactor.js'

function normalize(flow: FlowData): unknown {
  return {
    nodes: [...flow.nodes].sort((a, b) => a.id.localeCompare(b.id)).map(({ selected: _selected, dragging: _dragging, ...node }) => node),
    edges: [...flow.edges].sort((a, b) => a.id.localeCompare(b.id)).map(({ selected: _selected, ...edge }) => edge)
  }
}
function redactNode(node: FlowNode | undefined): unknown {
  if (!node) return node
  return redact({
    ...node,
    data: {
      ...node.data,
      inputs: Object.fromEntries(Object.keys(node.data.inputs).map((key) => [key, '[REDACTED]']))
    }
  })
}
export function semanticDiff(before: FlowData, after: FlowData) {
  const left = normalize(before); const right = normalize(after); const changed = JSON.stringify(left) !== JSON.stringify(right)
  if (!changed) return { changed: false, changes: [] as Array<{ path: string; before: unknown; after: unknown }> }
  const changes: Array<{ path: string; before: unknown; after: unknown }> = []
  const beforeNodes = new Map(before.nodes.map((node) => [node.id, node])); const afterNodes = new Map(after.nodes.map((node) => [node.id, node]))
  for (const id of new Set([...beforeNodes.keys(), ...afterNodes.keys()])) {
    const a = beforeNodes.get(id); const b = afterNodes.get(id)
    if (!a || !b) changes.push({ path: `nodes.${id}`, before: redactNode(a), after: redactNode(b) })
    else {
      if (JSON.stringify(a.position) !== JSON.stringify(b.position)) changes.push({ path: `nodes.${id}.position`, before: a.position, after: b.position })
      if (a.data.credential !== b.data.credential) changes.push({ path: `nodes.${id}.credential`, before: '[REDACTED]', after: '[REDACTED]' })
      for (const key of new Set([...Object.keys(a.data.inputs), ...Object.keys(b.data.inputs)])) if (JSON.stringify(a.data.inputs[key]) !== JSON.stringify(b.data.inputs[key])) changes.push({ path: `nodes.${id}.inputs.${key}`, before: '[REDACTED]', after: '[REDACTED]' })
    }
  }
  if (JSON.stringify(before.edges) !== JSON.stringify(after.edges)) changes.push({ path: 'edges', before: before.edges.map((e) => e.id), after: after.edges.map((e) => e.id) })
  return { changed, changes }
}
