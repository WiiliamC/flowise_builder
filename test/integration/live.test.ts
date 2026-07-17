import { describe, expect, it } from 'vitest'
import { FlowiseClient } from '../../src/flowise/flowise-client.js'

const enabled = process.env.FLOWISE_INTEGRATION === '1'
describe.skipIf(!enabled)('live Flowise read-only integration', () => {
  it('checks management authentication and the Agentflow catalog', async () => {
    const baseUrl = process.env.FLOWISE_BASE_URL
    if (!baseUrl) throw new Error('FLOWISE_BASE_URL is required')
    const host = new URL(baseUrl).hostname
    const local = ['localhost', '127.0.0.1', '::1'].includes(host)
    if (!local && process.env.FLOWISE_INTEGRATION_ALLOW_REMOTE !== '1') throw new Error('Remote integration requires FLOWISE_INTEGRATION_ALLOW_REMOTE=1')
    const client = new FlowiseClient({ baseUrl, ...(process.env.FLOWISE_API_TOKEN ? { token: process.env.FLOWISE_API_TOKEN } : {}), allowInsecureHttp: local })
    const [nodes, chatflows] = await Promise.all([client.listNodes(), client.listChatflows()])
    expect(Array.isArray(nodes)).toBe(true)
    expect(nodes.some((node) => node.name === 'startAgentflow')).toBe(true)
    expect(Array.isArray(chatflows)).toBe(true)
  })
})
