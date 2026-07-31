import type { NodeDataSchema } from '../domain/node-catalog.js'
import { posix, win32 } from 'node:path'

const nodeFields = [
  'name', 'label', 'type', 'category', 'description', 'version', 'baseClasses',
  'outputs', 'inputs', 'inputAnchors', 'color', 'icon', 'hideInput', 'hideOutput',
  'credential'
] as const

const runtimePathKey = /^(filePath|modulePath|absolutePath|sourcePath)$/i

function isAbsoluteFilesystemPath(value: string): boolean {
  const windowsAbsolute = /^(?:[A-Za-z]:[\\/]|\\\\)/.test(value) && win32.isAbsolute(value)
  return windowsAbsolute || posix.isAbsolute(value)
}

function sanitizeValue(value: unknown): unknown {
  if (typeof value === 'string' && isAbsoluteFilesystemPath(value)) return undefined
  if (Array.isArray(value)) return value.map((item) => sanitizeValue(item)).filter((item) => item !== undefined)
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).flatMap(([childKey, child]) => {
      const sanitized = sanitizeValue(child)
      return sanitized === undefined ? [] : [[childKey, sanitized]]
    }))
  }
  return value
}

function sanitizeInput(value: unknown): unknown {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return sanitizeValue(value)
  return Object.fromEntries(Object.entries(value).flatMap(([key, child]) => {
    if (runtimePathKey.test(key)) return []
    const sanitized = key === 'array' && Array.isArray(child)
      ? child.map(sanitizeInput).filter((item) => item !== undefined)
      : sanitizeValue(child)
    return sanitized === undefined ? [] : [[key, sanitized]]
  }))
}

export function sanitizeCatalogNode(input: NodeDataSchema): NodeDataSchema {
  const output: Record<string, unknown> = {}
  for (const field of nodeFields) {
    const value = input[field]
    if (value === undefined) continue
    const safe = field === 'inputs' && Array.isArray(value)
      ? value.map(sanitizeInput).filter((item) => item !== undefined)
      : sanitizeValue(value)
    if (safe !== undefined) output[field] = safe
  }
  return output as NodeDataSchema
}

export function sanitizeCatalog(nodes: NodeDataSchema[]): NodeDataSchema[] {
  return nodes.map(sanitizeCatalogNode)
}
