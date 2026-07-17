import type { FlowData } from '../domain/flow-data.js'
export interface Chatflow {
  id: string
  name: string
  type: string
  flowData: string | FlowData
  updatedDate?: string
  createdDate?: string
  deployed?: boolean
  isPublic?: boolean
  [key: string]: unknown
}
