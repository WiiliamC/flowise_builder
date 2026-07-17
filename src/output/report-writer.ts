import type { Diagnostic, Report } from '../domain/diagnostics.js'
import { summarize } from '../domain/diagnostics.js'

export function makeReport(command: string, options: { ok: boolean; applied?: boolean; changed?: boolean; nodes?: number; edges?: number; diagnostics?: Diagnostic[]; target?: Report['target']; artifacts?: Report['artifacts']; data?: unknown; error?: Report['error']; meta?: Report['meta'] }): Report {
  const diagnostics = options.diagnostics ?? []
  return {
    schemaVersion: '1', ok: options.ok, command, applied: options.applied ?? false, changed: options.changed ?? false,
    ...(options.target ? { target: options.target } : {}), summary: summarize(options.nodes ?? 0, options.edges ?? 0, diagnostics), diagnostics,
    ...(options.artifacts ? { artifacts: options.artifacts } : {}), ...(options.data !== undefined ? { data: options.data } : {}), ...(options.error ? { error: options.error } : {}), ...(options.meta ? { meta: options.meta } : {})
  }
}
export function emitReport(report: Report, format: string): void {
  if (format === 'json') process.stdout.write(`${JSON.stringify(report)}\n`)
  else {
    process.stdout.write(`${report.ok ? 'OK' : 'ERROR'} ${report.command}: ${report.summary.nodes} nodes, ${report.summary.edges} edges, ${report.summary.errors} errors, ${report.summary.warnings} warnings\n`)
    for (const item of report.diagnostics) process.stdout.write(`${item.severity.toUpperCase()} ${item.code}: ${item.message}\n`)
    if (report.error) process.stdout.write(`${report.error.code}: ${report.error.message}\n`)
  }
}
