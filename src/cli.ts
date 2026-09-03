#!/usr/bin/env node
import { Command, CommanderError } from 'commander'
import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { parseSpecFile } from './builder/spec-parser.js'
import { buildFlow } from './application/build-flow.js'
import { validateFlow } from './application/validate-flow.js'
import { semanticDiff } from './application/diff-flow.js'
import { createAgentflow } from './application/create-flow.js'
import { copyAgentflow } from './application/copy-flow.js'
import { updateAgentflow } from './application/update-flow.js'
import { editSystemPrompt } from './application/edit-system-prompt.js'
import { editAgentMcp, inspectAgentMcp, refreshAgentMcpActions } from './application/agent-mcp.js'
import { loadCatalog, snapshotCatalog, catalogHash } from './flowise/node-catalog-loader.js'
import { FlowiseClient, FlowiseError } from './flowise/flowise-client.js'
import type { FlowData } from './domain/flow-data.js'
import type { NodeDataSchema } from './domain/node-catalog.js'
import { loadConfig, loadCredentialAliases } from './config.js'
import { emitReport, escapeTerminalText, makeReport } from './output/report-writer.js'
import type { Diagnostic } from './domain/diagnostics.js'
import { SpecError } from './builder/spec-parser.js'
import { redact } from './output/secret-redactor.js'
import { writeSensitiveJson } from './output/artifact-writer.js'
import { inspectAgentflow, listAgentflows } from './application/inspect-agentflows.js'
import { VERSION } from './version.js'

type Opts = Record<string, unknown>
const program = new Command().name('flowise-agentflow').version(VERSION).showHelpAfterError()
program.exitOverride()
const collect = (value: string, previous: string[]) => [...previous, value]
program.option('--config <path>').option('--credentials <path>', 'private credential alias mapping').option('--base-url <url>').option('--token-env <name>', 'token environment variable', 'FLOWISE_API_TOKEN').option('--format <format>', 'human|json', 'human').option('--timeout <ms>').option('--header <header>', 'custom Name: value header', collect, []).option('--verbose').option('--allow-insecure-http')

const globalOpts = (command: Command): Opts => ({ ...command.optsWithGlobals() })
const terminalText = (value: unknown) => escapeTerminalText(String(value))
async function clientFor(opts: Opts) { return new FlowiseClient(await loadConfig(opts)) }
async function catalogFor(opts: Opts): Promise<{ nodes: NodeDataSchema[]; hash: string; client?: FlowiseClient }> {
  if (typeof opts.catalog === 'string') return loadCatalog(opts.catalog)
  if (opts.offline) throw new FlowiseError('CATALOG_REQUIRED', '--offline requires --catalog')
  const client = await clientFor(opts); const nodes = await client.listNodes(); return { nodes, hash: catalogHash(nodes), client }
}
const writeJson = writeSensitiveJson
async function credentialsFor(opts: Opts) { return loadCredentialAliases(typeof opts.credentials === 'string' ? opts.credentials : undefined) }
function parseFlowData(remote: { flowData: string | FlowData }): FlowData { try { return typeof remote.flowData === 'string' ? JSON.parse(remote.flowData) as FlowData : remote.flowData } catch { throw new FlowiseError('REMOTE_FLOW_DATA_INVALID', 'Remote flowData is malformed') } }
async function promptFromFile(path: string): Promise<string> {
  try { return new TextDecoder('utf-8', { fatal: true }).decode(await readFile(path)) }
  catch { throw new FlowiseError('PROMPT_FILE_INVALID', 'Prompt file must be readable UTF-8 text') }
}
async function mcpConfigFromFile(path: string): Promise<string> {
  try { return new TextDecoder('utf-8', { fatal: true }).decode(await readFile(path)) }
  catch { throw new FlowiseError('MCP_CONFIG_INVALID', 'MCP config file must be readable UTF-8 text') }
}

program.command('doctor').description('Check connectivity, authentication, and read capabilities').action(async (_opts, command) => {
  const opts = globalOpts(command); const client = await clientFor(opts); const nodes = await client.listNodes(); const chatflows = await client.listChatflows()
  emitReport(makeReport('doctor', { ok: true, data: { reachable: true, nodeCount: nodes.length, chatflowRead: Array.isArray(chatflows) }, target: { baseUrl: client.baseUrl }, diagnostics: [{ code: 'FLOWISE_VERSION_UNKNOWN', severity: 'info', message: 'Flowise version was not exposed by the API' }] }), String(opts.format))
})

program.command('list').description('List Agentflow V2 workflows').action(async (_opts, command) => {
  const opts = globalOpts(command); const client = await clientFor(opts); const result = listAgentflows(await client.listChatflows())
  const report = makeReport('list', { ok: true, nodes: result.nodes, edges: result.edges, diagnostics: result.diagnostics, data: { count: result.agentflows.length, agentflows: result.agentflows }, target: { baseUrl: client.baseUrl } })
  const details = [`Agentflows: ${result.agentflows.length}`, ...result.agentflows.map((item) => `${terminalText(item.id)}\t${terminalText(item.name)}\t${item.nodes ?? '?'} nodes\t${item.edges ?? '?'} edges`)]
  emitReport(report, String(opts.format), details)
})

program.command('inspect').description('Inspect a sanitized Agentflow V2 graph').requiredOption('--target-id <id>').action(async (local, command) => {
  const opts = { ...globalOpts(command), ...local }; const client = await clientFor(opts); const inspection = inspectAgentflow(await client.getChatflow(String(opts.targetId)))
  const report = makeReport('inspect', { ok: true, nodes: inspection.graph.nodes.length, edges: inspection.graph.edges.length, data: inspection, target: { baseUrl: client.baseUrl, chatflowId: inspection.agentflow.id, type: inspection.agentflow.type } })
  const details = [
    `Agentflow: ${terminalText(inspection.agentflow.id)}\t${terminalText(inspection.agentflow.name)}`,
    ...inspection.graph.nodes.map((node) => `${terminalText(node.ref)}\t${terminalText(node.label)}\t${terminalText(node.component)}`),
    ...inspection.graph.edges.map((edge) => `${terminalText(edge.from)} -> ${terminalText(edge.to)}${edge.outputIndex !== undefined ? ` [output ${edge.outputIndex}]` : ''}`)
  ]
  emitReport(report, String(opts.format), details)
})

program.command('edit-system-prompt').description('Edit one agent system message without exposing its content').requiredOption('--target-id <id>').requiredOption('--agent-ref <ref>').requiredOption('--if-match-updated-at <date>').option('--prompt <text>').option('--prompt-file <path>').option('--apply').action(async (local, command) => {
  const opts = { ...globalOpts(command), ...local }
  const hasPrompt = typeof opts.prompt === 'string'; const hasPromptFile = typeof opts.promptFile === 'string'
  if (hasPrompt === hasPromptFile) throw new FlowiseError('PROMPT_SOURCE_INVALID', 'Provide exactly one of --prompt or --prompt-file')
  const prompt = hasPrompt ? String(opts.prompt) : await promptFromFile(String(opts.promptFile))
  const client = await clientFor(opts)
  const result = await editSystemPrompt(client, { targetId: String(opts.targetId), agentRef: String(opts.agentRef), ifMatchUpdatedAt: String(opts.ifMatchUpdatedAt), prompt, apply: Boolean(opts.apply) })
  emitReport(makeReport('edit-system-prompt', {
    ok: true, changed: result.changed, applied: result.applied, nodes: result.nodes, edges: result.edges,
    target: { baseUrl: client.baseUrl, chatflowId: String(opts.targetId), type: 'AGENTFLOW' },
    data: { agentRef: result.agentRef, operation: result.operation }
  }), String(opts.format))
})

program.command('inspect-agent-mcp').description('Inspect sanitized Custom MCP metadata for one agent').requiredOption('--target-id <id>').requiredOption('--agent-ref <ref>').action(async (local, command) => {
  const opts = { ...globalOpts(command), ...local }; const client = await clientFor(opts)
  const remote = await client.getChatflow(String(opts.targetId))
  const result = inspectAgentMcp(remote, String(opts.agentRef))
  emitReport(makeReport('inspect-agent-mcp', {
    ok: true, data: result, target: { baseUrl: client.baseUrl, chatflowId: remote.id, type: remote.type }
  }), String(opts.format), result.mcps.map((mcp) => `${terminalText(mcp.ref)}\t${terminalText(mcp.transport)}\t${mcp.configHash}\tvariable refs: ${mcp.hasFlowiseVariableRefs}\t${mcp.enabledActionCount} enabled actions`))
})

program.command('edit-agent-mcp').description('Edit one existing Custom MCP configuration without discovering actions').requiredOption('--target-id <id>').requiredOption('--agent-ref <ref>').requiredOption('--mcp-ref <ref>').requiredOption('--config-file <path>').requiredOption('--if-match-updated-at <date>').option('--apply').action(async (local, command) => {
  const opts = { ...globalOpts(command), ...local }; const client = await clientFor(opts)
  const result = await editAgentMcp(client, {
    targetId: String(opts.targetId), agentRef: String(opts.agentRef), mcpRef: String(opts.mcpRef),
    ifMatchUpdatedAt: String(opts.ifMatchUpdatedAt), configText: await mcpConfigFromFile(String(opts.configFile)), apply: Boolean(opts.apply)
  })
  emitReport(makeReport('edit-agent-mcp', {
    ok: true, changed: result.changed, applied: result.applied, nodes: result.nodes, edges: result.edges,
    target: { baseUrl: client.baseUrl, chatflowId: String(opts.targetId), type: 'AGENTFLOW' },
    data: { agentRef: result.agentRef, mcpRef: result.mcpRef }
  }), String(opts.format))
})

program.command('refresh-agent-mcp-actions').description('Discover current Custom MCP actions and optionally enable them').requiredOption('--target-id <id>').requiredOption('--agent-ref <ref>').requiredOption('--mcp-ref <ref>').option('--enable-all').option('--enable-action <name>', 'action name to enable (repeatable)', collect, []).option('--if-match-updated-at <date>').option('--show-action-names').option('--apply').action(async (local, command) => {
  const opts = { ...globalOpts(command), ...local }; const client = await clientFor(opts)
  const result = await refreshAgentMcpActions(client, {
    targetId: String(opts.targetId), agentRef: String(opts.agentRef), mcpRef: String(opts.mcpRef),
    enableAll: Boolean(opts.enableAll), enableActions: opts.enableAction as string[],
    ...(opts.ifMatchUpdatedAt ? { ifMatchUpdatedAt: String(opts.ifMatchUpdatedAt) } : {}),
    showActionNames: Boolean(opts.showActionNames), apply: Boolean(opts.apply)
  })
  const names = result.availableNames ? { availableNames: result.availableNames, enabledNames: result.enabledNames, newNames: result.newNames, missingNames: result.missingNames } : {}
  emitReport(makeReport('refresh-agent-mcp-actions', {
    ok: true, changed: result.changed, applied: result.applied,
    target: { baseUrl: client.baseUrl, chatflowId: String(opts.targetId), type: 'AGENTFLOW' },
    data: { agentRef: result.agentRef, mcpRef: result.mcpRef, availableCount: result.availableCount, enabledCount: result.enabledCount, newCount: result.newCount, missingCount: result.missingCount, ...names }
  }), String(opts.format), [
    `Available: ${result.availableCount}\tEnabled: ${result.enabledCount}\tNew: ${result.newCount}\tMissing: ${result.missingCount}`,
    ...(result.availableNames ? [
      `Available names: ${result.availableNames.map(terminalText).join(', ')}`,
      `Enabled names: ${(result.enabledNames ?? []).map(terminalText).join(', ')}`,
      `New names: ${(result.newNames ?? []).map(terminalText).join(', ')}`,
      `Missing names: ${(result.missingNames ?? []).map(terminalText).join(', ')}`
    ] : [])
  ])
})

program.command('inspect-nodes').option('--component <name>').option('--category <name>').option('--snapshot <path>').action(async (local, command) => {
  const opts = { ...globalOpts(command), ...local }; const client = await clientFor(opts); let nodes = await client.listNodes()
  if (opts.component) nodes = nodes.filter((node) => node.name === opts.component)
  if (opts.category) nodes = nodes.filter((node) => node.category?.toLowerCase().includes(String(opts.category).toLowerCase()))
  let snapshot: string | undefined
  if (typeof opts.snapshot === 'string') { await snapshotCatalog(client, opts.snapshot, nodes); snapshot = resolve(opts.snapshot) }
  emitReport(makeReport('inspect-nodes', { ok: true, data: { nodes }, artifacts: snapshot ? { catalog: snapshot } : undefined }), String(opts.format))
})

program.command('build').argument('<spec>').option('--catalog <path>').option('--offline').option('--output <path>').option('--report <path>').action(async (path, local, command) => {
  const opts = { ...globalOpts(command), ...local }; const spec = await parseSpecFile(path); const catalog = await catalogFor(opts); const result = buildFlow(spec, catalog.nodes, await credentialsFor(opts))
  const artifacts: { flowData?: string; report?: string } = {}
  if (typeof opts.output === 'string' && result.valid) { await writeJson(opts.output, result.flowData); artifacts.flowData = resolve(opts.output) }
  const report = makeReport('build', { ok: result.valid, nodes: result.flowData.nodes.length, edges: result.flowData.edges.length, diagnostics: result.diagnostics, artifacts, data: opts.output ? undefined : redact({ flowData: result.flowData }), meta: { builderVersion: VERSION, specApiVersion: spec.apiVersion, catalogHash: catalog.hash } })
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

program.command('copy').description('Copy an existing Agentflow V2 canvas within this Flowise instance').requiredOption('--source-id <id>').requiredOption('--name <name>').option('--allow-warnings').option('--apply').action(async (local, command) => {
  const opts = { ...globalOpts(command), ...local }; const catalog = await catalogFor(opts); const client = catalog.client ?? await clientFor(opts)
  const result = await copyAgentflow(client, catalog.nodes, { sourceId: String(opts.sourceId), name: String(opts.name), allowWarnings: Boolean(opts.allowWarnings), apply: Boolean(opts.apply) })
  const data = { source: result.source, destination: result.destination ?? { name: String(opts.name), type: 'AGENTFLOW' } }
  emitReport(makeReport('copy', { ok: !result.blocked, applied: result.applied, changed: true, nodes: result.nodes, edges: result.edges, diagnostics: result.diagnostics, data }), String(opts.format), [
    `Source: ${terminalText(result.source.id)}\t${terminalText(result.source.name)}`,
    `Destination: ${result.destination ? `${terminalText(result.destination.id)}\t${terminalText(result.destination.name)}` : terminalText(String(opts.name))}`
  ])
  if (result.blocked) process.exitCode = 2
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
  if (error instanceof CommanderError && (error.code === 'commander.helpDisplayed' || error.code === 'commander.version')) process.exitCode = 0
  else {
    const opts = program.opts() as Opts; const code = error instanceof FlowiseError ? error.code : error instanceof SpecError ? error.code : error && typeof error === 'object' && 'code' in error ? String(error.code) : 'INTERNAL_ERROR'; const message = error instanceof Error ? error.message : String(error)
    if (opts.verbose && error instanceof Error && error.stack) process.stderr.write(`${error.stack}\n`)
    emitReport(makeReport(program.args[0] ?? 'unknown', { ok: false, error: { code, message }, diagnostics: error instanceof SpecError ? error.diagnostics : [] }), String(opts.format ?? 'human'))
    process.exitCode = error instanceof FlowiseError ? 3 : error instanceof SpecError ? 2 : 1
  }
}
