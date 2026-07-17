import { readFile } from 'node:fs/promises'
import YAML from 'yaml'
import type { ClientOptions } from './flowise/flowise-client.js'

export interface CliConfig extends ClientOptions { format: 'human' | 'json' }
export async function loadCredentialAliases(explicitPath?: string): Promise<Record<string, string>> {
  const path = explicitPath ?? '.flowise-agentflow.credentials.yaml'
  let parsed: unknown
  try { parsed = YAML.parse(await readFile(path, 'utf8')) }
  catch (error) {
    if (!explicitPath && error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT') return {}
    throw error
  }
  const raw = parsed && typeof parsed === 'object' && 'credentials' in parsed ? (parsed as { credentials: unknown }).credentials : parsed
  if (!raw || typeof raw !== 'object' || Array.isArray(raw) || Object.values(raw).some((value) => typeof value !== 'string')) throw new Error('Credential mapping must contain string alias-to-ID entries')
  return raw as Record<string, string>
}
export async function loadConfig(cli: Record<string, unknown>): Promise<CliConfig> {
  let file: Record<string, unknown> = {}
  const path = typeof cli.config === 'string' ? cli.config : '.flowise-agentflow.yaml'
  try { file = YAML.parse(await readFile(path, 'utf8')) as Record<string, unknown> ?? {} } catch (error) { if (typeof cli.config === 'string') throw error }
  const tokenEnv = String(cli.tokenEnv ?? 'FLOWISE_API_TOKEN')
  const baseUrl = String(cli.baseUrl ?? process.env.FLOWISE_BASE_URL ?? file.baseUrl ?? '')
  if (!baseUrl) throw new Error('FLOWISE_BASE_URL is required for online commands')
  const timeoutMs = Number(cli.timeout ?? process.env.FLOWISE_REQUEST_TIMEOUT_MS ?? file.timeoutMs ?? 30_000)
  const token = process.env[tokenEnv]
  const headers: Record<string, string> = {}
  for (const raw of Array.isArray(cli.header) ? cli.header : []) {
    const value = String(raw); const separator = value.indexOf(':')
    if (separator < 1) throw new Error('--header must use Name: value syntax')
    headers[value.slice(0, separator).trim()] = value.slice(separator + 1).trim()
  }
  return {
    baseUrl, ...(token ? { token } : {}), timeoutMs,
    authHeader: String(process.env.FLOWISE_AUTH_HEADER ?? file.authHeader ?? 'Authorization'),
    authScheme: String(process.env.FLOWISE_AUTH_SCHEME ?? file.authScheme ?? 'Bearer'),
    allowInsecureHttp: Boolean(cli.allowInsecureHttp ?? file.allowInsecureHttp ?? false),
    ...(Object.keys(headers).length ? { headers } : {}),
    format: cli.format === 'json' ? 'json' : 'human'
  }
}
