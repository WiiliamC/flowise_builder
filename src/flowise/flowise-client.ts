import type { NodeDataSchema } from '../domain/node-catalog.js'
import type { FlowData } from '../domain/flow-data.js'
import type { Chatflow } from './flowise-api-types.js'
import { redactText } from '../output/secret-redactor.js'

export interface ClientOptions { baseUrl: string; token?: string; authHeader?: string; authScheme?: string; headers?: Record<string, string>; timeoutMs?: number; allowInsecureHttp?: boolean; maxResponseBytes?: number; fetch?: typeof fetch }
export function normalizeBaseUrl(input: string): string {
  const url = new URL(input); url.pathname = url.pathname.replace(/\/+$/, '').replace(/\/api\/v1$/, '') + '/api/v1'; url.search = ''; url.hash = ''; return url.toString().replace(/\/$/, '')
}
export class FlowiseError extends Error {
  constructor(readonly code: string, message: string, readonly status?: number, readonly requestId?: string) { super(message); this.name = 'FlowiseError' }
  toJSON() { return { name: this.name, code: this.code, message: this.message, status: this.status, requestId: this.requestId } }
}

const statusCode = (status: number) => status === 401 ? 'REMOTE_UNAUTHENTICATED' : status === 403 ? 'REMOTE_FORBIDDEN' : status === 404 ? 'REMOTE_NOT_FOUND' : status === 409 ? 'REMOTE_CONFLICT' : status === 422 ? 'REMOTE_INVALID' : 'REMOTE_HTTP_ERROR'
const credentialHeader = /(authorization|cookie|api[-_]?key|token|secret|password|credential|(^|[-_])auth(entication)?($|[-_]))/i
export class FlowiseClient {
  readonly baseUrl: string
  private readonly headers: Record<string, string>; private readonly timeout: number; private readonly maxBytes: number; private readonly fetchImpl: typeof fetch; private readonly secrets: string[]
  constructor(options: ClientOptions) {
    this.baseUrl = normalizeBaseUrl(options.baseUrl)
    const url = new URL(this.baseUrl); const local = ['localhost', '127.0.0.1', '::1'].includes(url.hostname)
    const hasAuthentication = Boolean(options.token) || Object.entries(options.headers ?? {}).some(([name, value]) => value !== '' && credentialHeader.test(name))
    if (url.protocol === 'http:' && hasAuthentication && !local && !options.allowInsecureHttp) throw new FlowiseError('INSECURE_HTTP', 'Refusing authentication over insecure remote HTTP')
    this.headers = { Accept: 'application/json', 'Content-Type': 'application/json', ...options.headers }
    if (options.token) this.headers[options.authHeader ?? 'Authorization'] = `${options.authScheme ?? 'Bearer'} ${options.token}`
    this.timeout = options.timeoutMs ?? 30_000; this.maxBytes = options.maxResponseBytes ?? 10 * 1024 * 1024; this.fetchImpl = options.fetch ?? globalThis.fetch; this.secrets = [options.token ?? '', ...Object.values(options.headers ?? {})]
  }
  private async request<T>(method: string, path: string, body?: unknown): Promise<T> {
    const controller = new AbortController(); const timeout = setTimeout(() => controller.abort(), this.timeout)
    let response: Response
    try { response = await this.fetchImpl(`${this.baseUrl}${path}`, { method, headers: this.headers, signal: controller.signal, ...(body === undefined ? {} : { body: JSON.stringify(body) }) }) }
    catch (error) {
      const uncertain = method === 'POST' || method === 'PUT'
      throw new FlowiseError(uncertain ? 'REMOTE_WRITE_UNCERTAIN' : error instanceof Error && error.name === 'AbortError' ? 'REMOTE_TIMEOUT' : 'REMOTE_NETWORK_ERROR', uncertain ? 'Remote write result is uncertain; inspect the target before retrying' : 'Unable to reach Flowise')
    } finally { clearTimeout(timeout) }
    const length = Number(response.headers.get('content-length') ?? 0)
    if (length > this.maxBytes) throw new FlowiseError('REMOTE_RESPONSE_TOO_LARGE', 'Flowise response exceeded the configured limit', response.status)
    const text = await response.text()
    if (Buffer.byteLength(text) > this.maxBytes) throw new FlowiseError('REMOTE_RESPONSE_TOO_LARGE', 'Flowise response exceeded the configured limit', response.status)
    let data: unknown
    try { data = text ? JSON.parse(text) : null } catch { data = undefined }
    if (!response.ok) {
      const unsafe = data && typeof data === 'object' && 'message' in data ? String((data as { message: unknown }).message) : `HTTP ${response.status}`
      throw new FlowiseError(statusCode(response.status), redactText(unsafe, this.secrets).slice(0, 500), response.status, response.headers.get('x-request-id') ?? undefined)
    }
    if (data === undefined) throw new FlowiseError('REMOTE_MALFORMED_RESPONSE', 'Flowise returned a non-JSON response', response.status)
    return data as T
  }
  listNodes() { return this.request<NodeDataSchema[]>('GET', '/nodes?client=agentflowsdk') }
  getNode(name: string) { return this.request<NodeDataSchema>('GET', `/nodes/${encodeURIComponent(name)}?client=agentflowsdk`) }
  listChatflows() { return this.request<Chatflow[]>('GET', '/chatflows') }
  getChatflow(id: string) { return this.request<Chatflow>('GET', `/chatflows/${encodeURIComponent(id)}`) }
  createAgentflow(input: { name: string; flowData: FlowData }) { return this.request<Chatflow>('POST', '/chatflows', { name: input.name, flowData: JSON.stringify(input.flowData), type: 'AGENTFLOW' }) }
  updateAgentflow(id: string, input: { name?: string; flowData: FlowData }) { return this.request<Chatflow>('PUT', `/chatflows/${encodeURIComponent(id)}`, { ...input, flowData: JSON.stringify(input.flowData) }) }
}
