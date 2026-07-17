const sensitiveKey = /(authorization|cookie|token|secret|password|credential|api[-_]?key)/i
export function redact(value: unknown, key = ''): unknown {
  if (sensitiveKey.test(key)) return '[REDACTED]'
  if (Array.isArray(value)) return value.map((item) => redact(item))
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([childKey, item]) => [childKey, redact(item, childKey)]))
  return value
}
export function redactText(value: string, secrets: string[] = []): string {
  let output = value.replace(/(Bearer\s+|token["'=:\s]+|password["'=:\s]+)[^\s,"']+/gi, '$1[REDACTED]')
  for (const secret of secrets.filter(Boolean)) output = output.split(secret).join('[REDACTED]')
  return output
}
