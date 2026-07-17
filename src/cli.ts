#!/usr/bin/env node
import { Command, CommanderError } from 'commander'
import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { parseSpecFile } from './builder/spec-parser.js'
import { buildFlow } from './application/build-flow.js'
import { validateFlow } from './application/validate-flow.js'
import { semanticDiff } from './application/diff-flow.js'
import { createAgentflow } from './application/create-flow.js'
import { updateAgentflow } from './application/update-flow.js'
import { loadCatalog, snapshotCatalog, catalogHash } from './flowise/node-catalog-loader.js'
import { FlowiseClient, FlowiseError } from './flowise/flowise-client.js'
import type { FlowData } from './domain/flow-data.js'
import type { NodeDataSchema } from './domain/node-catalog.js'
import { loadConfig, loadCredentialAliases } from './config.js'
import { emitReport, makeReport } from './output/report-writer.js'
import type { Diagnostic } from './domain/diagnostics.js'
import { SpecError } from './builder/spec-parser.js'
import { redact } from './output/secret-redactor.js'
import { writeSensitiveJson } from './output/artifact-writer.js'

type Opts = Record<string, unknown>
const program = new Command().name('flowise-agentflow').version('0.1.0').showHelpAfterError()
program.exitOverride()
const collect = (value: string, previous: string[]) => [...previous, value]
program.option('--config <path>').option('--credentials <path>', 'private credential alias mapping').option('--base-url <url>').option('--token-env <name>', 'token environment variable', 'FLOWISE_API_TOKEN').option('--format <format>', 'human|json', 'human').option('--timeout <ms>').option('--header <header>', 'custom Name: value header', collect, []).option('--verbose').option('--allow-insecure-http')

const globalOpts = (command: Command): Opts => ({ ...command.optsWithGlobals() })
async function clientFor(opts: Opts) { return new FlowiseClient(await loadConfig(opts)) }
async function catalogFor(opts: Opts): Promise<{ nodes: NodeDataSchema[]; hash: string; client?: FlowiseClient }> {
  if (typeof opts.catalog === 'string') return loadCatalog(opts.catalog)
  if (opts.offline) throw new FlowiseError('CATALOG_REQUIRED', '--offline requires --catalog')
  const client = await clientFor(opts); const nodes = await client.listNodes(); return { nodes, hash: catalogHash(nodes), client }
}
const writeJson = writeSensitiveJson
async function credentialsFor(opts: Opts) { return loadCredentialAliases(typeof opts.credentials === 'string' ? opts.credentials : undefined) }
function parseFlowData(remote: { flowData: string | FlowData }): FlowData { try { return typeof remote.flowData === 'string' ? JSON.parse(remote.flowData) as FlowData : remote.flowData } catch { throw new FlowiseError('REMOTE_FLOW_DATA_INVALID', 'Remote flowData is malformed') } }

program.command('doctor').description('Check connectivity, authentication, and read capabilities').action(async (_opts, command) => {
  const opts = globalOpts(command); const client = await clientFor(opts); const nodes = await client.listNodes(); const chatflows = await client.listChatflows()
  emitReport(makeReport('doctor', { ok: true, data: { reachable: true, nodeCount: nodes.length, chatflowRead: Array.isArray(chatflows) }, target: { baseUrl: client.baseUrl }, diagnostics: [{ code: 'FLOWISE_VERSION_UNKNOWN', severity: 'info', message: 'Flowise version was not exposed by the API' }] }), String(opts.format))
})

program.command('inspect-nodes').option('--component <name>').option('--category <name>').option('--snapshot <path>').action(async (local, command) => {
  const opts = { ...globalOpts(command), ...local }; const client = await clientFor(opts); let nodes = await client.listNodes()
  if (opts.component) nodes = nodes.filter((node) => node.name === opts.component)
  if (opts.category) nodes = nodes.filter((node) => node.category?.toLowerCase().includes(String(opts.category).toLowerCase()))
  let snapshot: string | undefined
  if (typeof opts.snapshot === 'string') { await snapshotCatalog(client, opts.snapshot); snapshot = resolve(opts.snapshot) }
  emitReport(makeReport('inspect-nodes', { ok: true, data: { nodes }, artifacts: snapshot ? { catalog: snapshot } : undefined }), String(opts.format))
})

program.command('build').argument('<spec>').option('--catalog <path>').option('--offline').option('--output <path>').option('--report <path>').action(async (path, local, command) => {
  const opts = { ...globalOpts(command), ...local }; const spec = await parseSpecFile(path); const catalog = await catalogFor(opts); const result = buildFlow(spec, catalog.nodes, await credentialsFor(opts))
  const artifacts: { flowData?: string; report?: string } = {}
  if (typeof opts.output === 'string' && result.valid) { await writeJson(opts.output, result.flowData); artifacts.flowData = resolve(opts.output) }
  const report = makeReport('build', { ok: result.valid, nodes: result.flowData.nodes.length, edges: result.flowData.edges.length, diagnostics: result.diagnostics, artifacts, data: opts.output ? undefined : redact({ flowData: result.flowData }), meta: { builderVersion: '0.1.0', specApiVersion: spec.apiVersion, catalogHash: catalog.hash } })
  if (typeof opts.report === 'string') { artifacts.report = resolve(opts.report); await writeJson(opts.report, report) }
  emitReport(report, String(opts.format)); if (!result.valid) process.exitCode = 2
})

program.command('validate').argument('[spec]').option('--flow-data <path>').option('--catalog <path>').option('--offline').option('--strict').action(async (path, local, command) => {
  const opts = { ...globalOpts(command), ...local }; const catalog = await catalogFor(opts); let flow: FlowData; let buildDiagnostics: Diagnostic[] = []
  if (typeof opts.flowData === 'string') flow = JSON.parse(await readFile(opts.flowData, 'utf8')) as FlowData
  else { if (!path) throw new Error('Provide a spec path or --flow-data'); const built = buildFlow(await parseSpecFile(path), catalog.nodes, await credentialsFor(opts)); flow = built.flowData; buildDiagnostics = built.diagnostics }
  const result = validateFlow(flow, catalog.nodes, Boolean(opts.strict)); const diagnostics = [...buildDiagnostics, ...result.diagnostics].filter((item, index, all) => all.findIndex((other) => JSON.stringify(other) === JSON.stringify(item)) === index)
  const ok = !diagnostics.some((item) => item.severity === 'error'); emitReport(makeReport('validate', { ok, nodes: flow.nodes.length, edges: flow.edges.length, diagnostics }), String(opts.format)); if (!ok) process.exitCode = 2
})

program.command('diff').argument('<spec>').requiredOption('--target-id <id>').option('--catalog <path>').option('--offline').action(async (path, local, command) => {
  const opts = { ...globalOpts(command), ...local }; const client = await clientFor(opts); const catalog = await catalogFor(opts); const built = buildFlow(await parseSpecFile(path), catalog.nodes, await credentialsFor(opts))
  if (!built.valid) { emitReport(makeReport('diff', { ok: false, diagnostics: built.diagnostics }), String(opts.format)); process.exitCode = 2; return }
  const remote = await client.getChatflow(String(opts.targetId)); const diff = semanticDiff(parseFlowData(remote), built.flowData)
  emitReport(makeReport('diff', { ok: true, changed: diff.changed, nodes: built.flowData.nodes.length, edges: built.flowData.edges.length, diagnostics: built.diagnostics, data: diff, target: { baseUrl: client.baseUrl, chatflowId: remote.id, type: remote.type } }), String(opts.format)); if (diff.changed) process.exitCode = 4
})

program.command('create').argument('<spec>').option('--name <name>').option('--catalog <path>').option('--offline').option('--apply').action(async (path, local, command) => {
  const opts = { ...globalOpts(command), ...local }; const spec = await parseSpecFile(path); if (spec.spec.flowise?.targetId) throw new FlowiseError('CREATE_TARGET_ID_FORBIDDEN', 'Create spec must not contain spec.flowise.targetId')
  const catalog = await catalogFor(opts); const built = buildFlow(spec, catalog.nodes, await credentialsFor(opts))
  if (!built.valid) { emitReport(makeReport('create', { ok: false, diagnostics: built.diagnostics }), String(opts.format)); process.exitCode = 2; return }
  if (!opts.apply) { emitReport(makeReport('create', { ok: true, applied: false, changed: true, nodes: built.flowData.nodes.length, edges: built.flowData.edges.length, diagnostics: built.diagnostics }), String(opts.format)); return }
  const client = catalog.client ?? await clientFor(opts); const result = await createAgentflow(client, { name: String(opts.name ?? spec.metadata.name), flowData: built.flowData, apply: true })
  const remote = 'remote' in result ? result.remote : undefined
  emitReport(makeReport('create', { ok: true, applied: result.applied, changed: true, nodes: built.flowData.nodes.length, edges: built.flowData.edges.length, diagnostics: built.diagnostics, target: { baseUrl: client.baseUrl, ...(remote ? { chatflowId: remote.id, type: remote.type } : {}) } }), String(opts.format))
})

program.command('update').argument('<spec>').option('--target-id <id>').option('--if-match-updated-at <date>').option('--force').option('--catalog <path>').option('--offline').option('--apply').action(async (path, local, command) => {
  const opts = { ...globalOpts(command), ...local }; const spec = await parseSpecFile(path); const targetId = String(opts.targetId ?? spec.spec.flowise?.targetId ?? '')
  if (!targetId) throw new FlowiseError('TARGET_ID_REQUIRED', 'Update requires --target-id or spec.flowise.targetId')
  const catalog = await catalogFor(opts); const built = buildFlow(spec, catalog.nodes, await credentialsFor(opts))
  if (!built.valid) { emitReport(makeReport('update', { ok: false, diagnostics: built.diagnostics }), String(opts.format)); process.exitCode = 2; return }
  const client = catalog.client ?? await clientFor(opts); const result = await updateAgentflow(client, { targetId, flowData: built.flowData, name: spec.metadata.name, apply: Boolean(opts.apply), ...(opts.ifMatchUpdatedAt ? { ifMatchUpdatedAt: String(opts.ifMatchUpdatedAt) } : {}), force: Boolean(opts.force) })
  emitReport(makeReport('update', { ok: true, applied: result.applied, changed: result.changed, nodes: built.flowData.nodes.length, edges: built.flowData.edges.length, diagnostics: built.diagnostics, data: result.diff, target: { baseUrl: client.baseUrl, chatflowId: targetId, type: 'AGENTFLOW' } }), String(opts.format))
})

program.command('export').requiredOption('--target-id <id>').requiredOption('--output <path>').action(async (local, command) => {
  const opts = { ...globalOpts(command), ...local }; const client = await clientFor(opts); const remote = await client.getChatflow(String(opts.targetId)); const flow = parseFlowData(remote)
  await writeJson(String(opts.output), { schemaVersion: '1', chatflow: { id: remote.id, name: remote.name, type: remote.type, updatedDate: remote.updatedDate }, flowData: flow })
  emitReport(makeReport('export', { ok: true, nodes: flow.nodes.length, edges: flow.edges.length, artifacts: { flowData: resolve(String(opts.output)) }, target: { baseUrl: client.baseUrl, chatflowId: remote.id, type: remote.type } }), String(opts.format))
})

try { await program.parseAsync(process.argv) } catch (error) {
  if (error instanceof CommanderError && error.code === 'commander.helpDisplayed') process.exit(0)
  const opts = program.opts() as Opts; const code = error instanceof FlowiseError ? error.code : error instanceof SpecError ? error.code : error && typeof error === 'object' && 'code' in error ? String(error.code) : 'INTERNAL_ERROR'; const message = error instanceof Error ? error.message : String(error)
  if (opts.verbose && error instanceof Error && error.stack) process.stderr.write(`${error.stack}\n`)
  emitReport(makeReport(program.args[0] ?? 'unknown', { ok: false, error: { code, message }, diagnostics: error instanceof SpecError ? error.diagnostics : [] }), String(opts.format ?? 'human'))
  process.exitCode = error instanceof FlowiseError ? 3 : error instanceof SpecError ? 2 : 1
}
