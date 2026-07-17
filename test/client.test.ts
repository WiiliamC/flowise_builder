import { afterEach, describe, expect, it } from 'vitest'
import { MockAgent, setGlobalDispatcher } from 'undici'
import { FlowiseClient, FlowiseError, normalizeBaseUrl } from '../src/flowise/flowise-client.js'

const agents: MockAgent[] = []
afterEach(async () => { await Promise.all(agents.map((a) => a.close())); agents.length = 0 })

function mock(status: number, body: object) {
  const agent = new MockAgent(); agents.push(agent); agent.disableNetConnect(); setGlobalDispatcher(agent)
  const pool = agent.get('https://flowise.test')
  pool.intercept({ path: '/api/v1/nodes?client=agentflowsdk', method: 'GET' }).reply(status, body)
  return new FlowiseClient({ baseUrl: 'https://flowise.test', token: 'top-secret' })
}

describe('FlowiseClient', () => {
  it('normalizes API URLs and rejects insecure remote authentication', () => {
    expect(normalizeBaseUrl('https://x.test/api/v1/')).toBe('https://x.test/api/v1')
    expect(() => new FlowiseClient({ baseUrl: 'http://example.com', token: 'x' })).toThrow(/insecure/i)
  })
  it.each(['Authorization', 'Cookie', 'X-API-Key'])('rejects insecure remote authentication in a %s header', (name) => {
    expect(() => new FlowiseClient({ baseUrl: 'http://example.com', headers: { [name]: 'secret' } })).toThrowError(expect.objectContaining({ code: 'INSECURE_HTTP' }))
  })
  it('allows safe transports, explicit overrides, and ordinary custom headers', () => {
    expect(() => new FlowiseClient({ baseUrl: 'https://example.com', headers: { Authorization: 'secret' } })).not.toThrow()
    expect(() => new FlowiseClient({ baseUrl: 'http://localhost:3000', headers: { Cookie: 'secret' } })).not.toThrow()
    expect(() => new FlowiseClient({ baseUrl: 'http://example.com', headers: { 'X-API-Key': 'secret' }, allowInsecureHttp: true })).not.toThrow()
    expect(() => new FlowiseClient({ baseUrl: 'http://example.com', headers: { 'User-Agent': 'flowise-builder' } })).not.toThrow()
  })
  it.each([401, 403])('maps HTTP %s without leaking credentials', async (status) => {
    const client = mock(status, { message: 'bad top-secret' })
    await expect(client.listNodes()).rejects.toMatchObject({ code: status === 401 ? 'REMOTE_UNAUTHENTICATED' : 'REMOTE_FORBIDDEN' })
    try { await client.listNodes() } catch (error) { expect(JSON.stringify(error)).not.toContain('top-secret'); expect(error).toBeInstanceOf(FlowiseError) }
  })
})
