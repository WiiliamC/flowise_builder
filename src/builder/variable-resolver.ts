import type { Diagnostic } from '../domain/diagnostics.js'

const expression = /\$\{(node|flow|credential|env)\.([^}]+)\}/g
export function resolveVariables(value: unknown, ids: Map<string, string>, credentials: Record<string, string>, diagnostics: Diagnostic[]): unknown {
  if (Array.isArray(value)) return value.map((item) => resolveVariables(item, ids, credentials, diagnostics))
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, resolveVariables(item, ids, credentials, diagnostics)]))
  if (typeof value !== 'string') return value
  if (/\$\{env\./.test(value)) {
    diagnostics.push({ code: 'VARIABLE_REFERENCE_INVALID', severity: 'error', message: 'Environment variable references are disabled' }); return value
  }
  if (/\{\{.*\}\}/.test(value)) diagnostics.push({ code: 'VARIABLE_UNVERIFIED', severity: 'warning', message: 'Raw Flowise expression was preserved and could not be verified' })
  return value.replace(expression, (whole, namespace: string, path: string) => {
    const [head, ...tail] = path.split('.')
    if (namespace === 'node') {
      const id = head ? ids.get(head) : undefined
      if (!id) { diagnostics.push({ code: 'VARIABLE_REFERENCE_INVALID', severity: 'error', message: `Unknown node reference: ${head ?? ''}` }); return whole }
      if (tail[0] !== 'output') { diagnostics.push({ code: 'VARIABLE_REFERENCE_INVALID', severity: 'error', message: `Unsupported node reference: ${path}` }); return whole }
      return tail.length === 1 ? `{{ ${id} }}` : `{{ ${id}.output.${tail.slice(1).join('.')} }}`
    }
    if (namespace === 'flow') {
      if (path === 'input.question') return '{{ question }}'
      if (path.startsWith('state.') && path.length > 'state.'.length) return `{{ $flow.${path} }}`
      diagnostics.push({ code: 'VARIABLE_REFERENCE_INVALID', severity: 'error', message: `Unsupported flow reference: ${path}` }); return whole
    }
    if (namespace === 'credential') {
      const id = head ? credentials[head] : undefined
      if (!id) { diagnostics.push({ code: 'CREDENTIAL_ALIAS_UNRESOLVED', severity: 'error', message: `Credential alias is not mapped: ${head ?? ''}` }); return whole }
      return id
    }
    return whole
  })
}
