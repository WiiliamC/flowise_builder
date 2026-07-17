import type { InputParam, InputAnchor, OutputAnchor } from './node-catalog.js'

export interface NodeData {
  id: string
  name: string
  label: string
  type?: string
  category?: string
  description?: string
  version?: number
  baseClasses?: string[]
  color?: string
  icon?: string
  hideInput?: boolean
  credential?: string
  inputParams?: InputParam[]
  inputs: Record<string, unknown>
  inputAnchors?: InputAnchor[]
  outputAnchors?: OutputAnchor[]
  outputs?: Record<string, unknown>
}
export interface FlowNode {
  id: string
  type: string
  position: { x: number; y: number }
  data: NodeData
  parentNode?: string
  extent?: 'parent'
  selected?: boolean
  dragging?: boolean
  width?: number
  height?: number
}
export interface FlowEdge {
  id: string
  source: string
  target: string
  sourceHandle?: string
  targetHandle?: string
  type: string
  data?: Record<string, unknown>
  selected?: boolean
  animated?: boolean
}
export interface FlowData { nodes: FlowNode[]; edges: FlowEdge[]; viewport?: { x: number; y: number; zoom: number } }
