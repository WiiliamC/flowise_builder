import { describe, expect, it, vi } from 'vitest'
import { renameAgentflow } from '../src/application/rename-agentflow.js'
import { FlowiseError } from '../src/flowise/flowise-client.js'
import type { Chatflow } from '../src/flowise/flowise-api-types.js'

const source: Chatflow = { id: 'target', name: 'Before', type: 'AGENTFLOW', updatedDate: '2026-01-01', flowData: 'unparsed canvas' }
const input = { targetId: 'target', name: ' After 名称 ', apply: false }
const mockClient = () => ({ getChatflow: vi.fn().mockResolvedValue(source), renameAgentflow: vi.fn() })

describe('rename Agentflow', () => {
  it('previews exact names without reading the canvas or writing', async () => {
    const client = mockClient()
    await expect(renameAgentflow(client, input)).resolves.toEqual({ changed: true, applied: false, before: { name: 'Before' }, after: { name: input.name } })
    expect(client.getChatflow).toHaveBeenCalledExactlyOnceWith('target')
    expect(client.renameAgentflow).not.toHaveBeenCalled()
  })
  it('rereads before writing only the name and verifies persistence', async () => {
    const client = mockClient()
    client.getChatflow.mockResolvedValueOnce(source).mockResolvedValueOnce(source).mockResolvedValueOnce({ ...source, name: input.name })
    await expect(renameAgentflow(client, { ...input, apply: true })).resolves.toMatchObject({ changed: true, applied: true })
    expect(client.renameAgentflow).toHaveBeenCalledExactlyOnceWith('target', { name: input.name })
    expect(client.getChatflow).toHaveBeenCalledTimes(3)
  })
  it('rejects an empty target ID before reading', async () => {
    const client = mockClient()
    await expect(renameAgentflow(client, { ...input, targetId: ' ' })).rejects.toMatchObject({ code: 'TARGET_ID_REQUIRED' })
    expect(client.getChatflow).not.toHaveBeenCalled()
  })
  it.each([0, 1, 2])('does not retry when read %s fails', async (successfulReads) => {
    const client = mockClient()
    for (let index = 0; index < successfulReads; index++) client.getChatflow.mockResolvedValueOnce(source)
    client.getChatflow.mockRejectedValueOnce(new FlowiseError('REMOTE_NETWORK_ERROR', 'Unable to reach Flowise'))
    await expect(renameAgentflow(client, { ...input, apply: true })).rejects.toMatchObject({ code: 'REMOTE_NETWORK_ERROR' })
    expect(client.getChatflow).toHaveBeenCalledTimes(successfulReads + 1)
    expect(client.renameAgentflow).toHaveBeenCalledTimes(successfulReads === 2 ? 1 : 0)
  })
  it('can apply without a timestamp when the server omits it', async () => {
    const client = mockClient()
    const { updatedDate: _unused, ...untimed } = source
    client.getChatflow.mockResolvedValueOnce(untimed).mockResolvedValueOnce(untimed).mockResolvedValueOnce({ ...untimed, name: input.name })
    await expect(renameAgentflow(client, { ...input, apply: true })).resolves.toMatchObject({ applied: true })
  })
  it('does not write or reread a matching name', async () => {
    const client = mockClient()
    await expect(renameAgentflow(client, { ...input, name: source.name, apply: true })).resolves.toMatchObject({ changed: false, applied: false })
    expect(client.getChatflow).toHaveBeenCalledTimes(1)
    expect(client.renameAgentflow).not.toHaveBeenCalled()
  })
  it.each(['', ' \t\n '])('rejects an empty name before reading', async (name) => {
    const client = mockClient()
    await expect(renameAgentflow(client, { ...input, name })).rejects.toMatchObject({ code: 'NAME_INVALID' })
    expect(client.getChatflow).not.toHaveBeenCalled()
  })
  it('rejects a non-Agentflow even for a matching name', async () => {
    const client = mockClient(); client.getChatflow.mockResolvedValue({ ...source, type: 'CHATFLOW' })
    await expect(renameAgentflow(client, { ...input, name: source.name })).rejects.toMatchObject({ code: 'TARGET_NOT_AGENTFLOW' })
    expect(client.renameAgentflow).not.toHaveBeenCalled()
  })
  it.each([{ updatedDate: source.updatedDate, token: 'stale' }, { updatedDate: undefined, token: '2026-01-01' }, { updatedDate: undefined, token: '' }, { updatedDate: '', token: '' }, { updatedDate: ' ', token: ' ' }])('validates supplied timestamps before no-op', async ({ updatedDate, token }) => {
    const client = mockClient(); client.getChatflow.mockResolvedValue({ ...source, updatedDate })
    await expect(renameAgentflow(client, { ...input, name: source.name, ifMatchUpdatedAt: token, apply: true })).rejects.toMatchObject({ code: 'REMOTE_CHANGED' })
    expect(client.renameAgentflow).not.toHaveBeenCalled()
  })
  it.each([{ name: 'Concurrent' }, { updatedDate: '2026-01-02' }, { type: 'CHATFLOW' }])('rejects concurrent metadata changes', async (change) => {
    const client = mockClient(); client.getChatflow.mockResolvedValueOnce(source).mockResolvedValueOnce({ ...source, ...change })
    await expect(renameAgentflow(client, { ...input, apply: true })).rejects.toMatchObject({ code: 'REMOTE_CHANGED' })
    expect(client.renameAgentflow).not.toHaveBeenCalled()
  })
  it.each([{ name: 'Wrong' }, { id: 'other' }, { type: 'CHATFLOW' }])('rejects incorrect readback', async (change) => {
    const client = mockClient(); client.getChatflow.mockResolvedValueOnce(source).mockResolvedValueOnce(source).mockResolvedValueOnce({ ...source, name: input.name, ...change })
    await expect(renameAgentflow(client, { ...input, apply: true })).rejects.toMatchObject({ code: 'REMOTE_PERSISTENCE_MISMATCH' })
    expect(client.renameAgentflow).toHaveBeenCalledTimes(1)
  })
  it.each([new Error('echoed example name'), new FlowiseError('REMOTE_WRITE_UNCERTAIN', 'echoed example name')])('sanitizes write failures without retries', async (error) => {
    const client = mockClient(); client.renameAgentflow.mockRejectedValue(error)
    await expect(renameAgentflow(client, { ...input, apply: true })).rejects.toMatchObject({ code: error instanceof FlowiseError ? error.code : 'REMOTE_WRITE_FAILED', message: 'Agentflow rename failed' })
    expect(client.renameAgentflow).toHaveBeenCalledTimes(1)
    expect(client.getChatflow).toHaveBeenCalledTimes(2)
  })
})
