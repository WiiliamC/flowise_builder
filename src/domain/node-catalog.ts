export interface InputParam {
  id: string
  name: string
  label: string
  type: string
  default?: unknown
  optional?: boolean
  options?: Array<string | { name: string; label: string; show?: Record<string, unknown>; hide?: Record<string, unknown> }>
  show?: Record<string, unknown>
  hide?: Record<string, unknown>
  array?: InputParam[]
  loadConfig?: boolean
  credentialNames?: string[]
  [key: string]: unknown
}
export interface InputAnchor { id: string; name: string; label: string; type: string; optional?: boolean; description?: string }
export interface OutputAnchor { id: string; name: string; label: string; type?: string; description?: string }
export interface NodeOutput { name: string; label: string; type: string }
export interface NodeDataSchema {
  name: string
  label: string
  type?: string
  category?: string
  description?: string
  version?: number
  baseClasses?: string[]
  outputs?: NodeOutput[]
  inputs?: InputParam[]
  inputAnchors?: InputAnchor[]
  color?: string
  icon?: string
  hideInput?: boolean
  hideOutput?: boolean
  credential?: string | { name: string; credentialNames?: string[]; label?: string; type?: string; optional?: boolean }
  [key: string]: unknown
}
export interface CatalogSnapshot { schemaVersion: '1'; fetchedAt: string; source?: string; flowiseVersion?: string; schemaHash: string; nodes: NodeDataSchema[] }
