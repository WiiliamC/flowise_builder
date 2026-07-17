export type Severity = 'error' | 'warning' | 'info'
export interface Diagnostic {
  code: string
  severity: Severity
  message: string
  path?: string
  nodeKey?: string
  nodeId?: string
  edgeIndex?: number
  hint?: string
}

export interface Report {
  schemaVersion: '1'
  ok: boolean
  command: string
  applied: boolean
  changed: boolean
  target?: { baseUrl?: string; chatflowId?: string; type?: string; canvasUrl?: string }
  summary: { nodes: number; edges: number; errors: number; warnings: number }
  diagnostics: Diagnostic[]
  artifacts?: { flowData?: string; report?: string; catalog?: string }
  meta?: { builderVersion: string; specApiVersion?: string; catalogHash?: string; flowiseVersion?: string }
  error?: { code: string; message: string }
  data?: unknown
}

export function summarize(nodes: number, edges: number, diagnostics: Diagnostic[]) {
  return {
    nodes,
    edges,
    errors: diagnostics.filter((item) => item.severity === 'error').length,
    warnings: diagnostics.filter((item) => item.severity === 'warning').length
  }
}
