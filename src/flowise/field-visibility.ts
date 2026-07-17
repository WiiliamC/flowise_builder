import type { InputParam } from '../domain/node-catalog.js'

function getPath(value: Record<string, unknown>, path: string): unknown {
  return path.replace(/\[(\d+)\]/g, '.$1').split('.').filter(Boolean).reduce<unknown>((current, part) => current && typeof current === 'object' ? (current as Record<string, unknown>)[part] : undefined, value)
}
const exactMatch = (actual: unknown, expected: unknown) => JSON.stringify(actual) === JSON.stringify(expected)
const explicitRegexSyntax = /[.*+?^${}()|[\]\\]/
function matches(actual: unknown, expected: unknown): boolean {
  if (Array.isArray(expected)) {
    const actualValues = Array.isArray(actual) ? actual : [actual]
    return expected.some((item) => actualValues.some((value) => exactMatch(value, item)))
  }
  if (Array.isArray(actual)) return actual.some((item) => matches(item, expected))
  if (typeof expected === 'string') {
    if (!explicitRegexSyntax.test(expected)) return actual === expected
    try { return new RegExp(expected).test(String(actual ?? '')) } catch { return actual === expected }
  }
  return exactMatch(actual, expected)
}
export function isVisible(param: InputParam, inputs: Record<string, unknown>, index?: number): boolean {
  const resolve = (path: string) => getPath(inputs, index === undefined ? path : path.replaceAll('$index', String(index)))
  if (param.show && Object.entries(param.show).some(([path, expected]) => !matches(resolve(path), expected))) return false
  if (param.hide && Object.entries(param.hide).some(([path, expected]) => matches(resolve(path), expected))) return false
  return true
}
