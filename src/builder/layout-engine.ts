import dagre from '@dagrejs/dagre'
import type { FlowData } from '../domain/flow-data.js'

export function layoutFlow(flow: FlowData, explicit: Set<string>, ranksep = 360, nodesep = 180, zoom?: number): void {
  const graph = new dagre.graphlib.Graph().setDefaultEdgeLabel(() => ({}))
  graph.setGraph({ rankdir: 'LR', ranksep, nodesep, marginx: 40, marginy: 40 })
  for (const node of flow.nodes) if (node.type !== 'stickyNote') graph.setNode(node.id, { width: node.width ?? 280, height: node.height ?? 100 })
  for (const edge of flow.edges) graph.setEdge(edge.source, edge.target)
  dagre.layout(graph)
  for (const node of flow.nodes) {
    if (explicit.has(node.id) || node.type === 'stickyNote') continue
    const position = graph.node(node.id) as { x: number; y: number } | undefined
    if (position) node.position = { x: Math.round(position.x - (node.width ?? 280) / 2), y: Math.round(position.y - (node.height ?? 100) / 2) }
  }
  const xs = flow.nodes.map((node) => node.position.x); const ys = flow.nodes.map((node) => node.position.y)
  const automaticZoom = Math.max(0.4, Math.min(1, 900 / Math.max(900, (Math.max(...xs) || 0) - (Math.min(...xs) || 0) + 320)))
  flow.viewport = { x: -(Math.min(...xs) || 0) + 40, y: -(Math.min(...ys) || 0) + 40, zoom: zoom ?? automaticZoom }
}
