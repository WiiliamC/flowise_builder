import { z } from 'zod'

const key = z.string().regex(/^[a-z][a-z0-9_-]*$/)
const position = z.union([z.literal('auto'), z.object({ x: z.number(), y: z.number() }).strict()])
const node = z.object({
  key,
  component: z.string().min(1),
  label: z.string().min(1).optional(),
  position: position.default('auto'),
  size: z.object({ width: z.number().positive(), height: z.number().positive() }).strict().optional(),
  inputs: z.record(z.string(), z.unknown()).default({})
}).strict()
const edge = z.object({ from: key, to: key, output: z.string().optional(), input: z.string().optional() }).strict()

export const AgentflowSpecSchema = z.object({
  apiVersion: z.literal('flowise-agentflow-builder/v1alpha1'),
  kind: z.literal('Agentflow'),
  metadata: z.object({
    name: z.string().min(1),
    description: z.string().optional(),
    labels: z.record(z.string(), z.string()).optional()
  }).strict(),
  spec: z.object({
    flowise: z.object({ targetId: z.string().nullable().default(null) }).strict().optional(),
    viewport: z.object({ zoom: z.number().min(0.4).max(1) }).strict().optional(),
    nodes: z.array(node).min(1),
    edges: z.array(edge)
  }).strict()
}).strict()
export type AgentflowSpec = z.infer<typeof AgentflowSpecSchema>
