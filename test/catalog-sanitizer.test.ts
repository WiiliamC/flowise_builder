import { mkdtemp, readFile, rm, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { sanitizeCatalogNode } from '../src/flowise/catalog-sanitizer.js'
import { snapshotCatalog } from '../src/flowise/node-catalog-loader.js'
import type { FlowiseClient } from '../src/flowise/flowise-client.js'

describe('catalog sanitization', () => {
  it('keeps authoritative schema values while dropping known runtime metadata', () => {
    const sanitized = sanitizeCatalogNode({
      name: 'agentAgentflow',
      label: 'Agent',
      icon: '/private/install/agent.svg',
      filePath: '/private/install/Agent.js',
      loadMethods: { secret: true },
      inputs: [{
        id: '',
        name: 'model',
        label: 'Model',
        type: 'string',
        modulePath: '/private/module.js',
        default: 'safe-default',
        options: ['safe-option', '/home/example/private-model.bin', {
          name: 'local',
          label: 'Local',
          show: {
            filePath: 'selected-file',
            modulePath: true,
            absolutePath: 'relative/path',
            sourcePath: 'selected-source',
            path: 'C:\\private\\option.txt'
          }
        }],
        placeholder: '/tmp/private-placeholder',
        description: '/Users/example/private-description'
      }, {
        id: '',
        name: 'file',
        label: 'File',
        type: 'string',
        default: '/opt/private/default.txt'
      }]
    })
    expect(sanitized).toMatchObject({
      name: 'agentAgentflow',
      label: 'Agent',
      inputs: [
        {
          name: 'model',
          default: 'safe-default',
          options: ['safe-option', {
            name: 'local',
            label: 'Local',
            show: {
              filePath: 'selected-file',
              modulePath: true,
              absolutePath: 'relative/path',
              sourcePath: 'selected-source'
            }
          }]
        },
        { name: 'file', label: 'File' }
      ]
    })
    expect(sanitized).not.toHaveProperty('filePath')
    expect(sanitized).not.toHaveProperty('loadMethods')
    expect(sanitized).not.toHaveProperty('icon')
    expect(sanitized.inputs?.[0]).not.toHaveProperty('modulePath')
    expect(JSON.stringify(sanitized)).not.toMatch(/(?:\/(?:home|opt|private|tmp|Users)\/|C:\\\\private\\\\)/)
  })

  it('preserves safe relative icon paths', () => {
    expect(sanitizeCatalogNode({
      name: 'agentAgentflow',
      label: 'Agent',
      icon: 'icons/agent.svg'
    })).toMatchObject({ icon: 'icons/agent.svg' })
  })

  it('snapshots only the caller-selected catalog with owner-only permissions', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'flowise-catalog-'))
    const path = join(directory, 'catalog.json')
    const client = { baseUrl: 'https://flowise.test/api/v1', listNodes: vi.fn() } as unknown as FlowiseClient
    try {
      await snapshotCatalog(client, path, [{ name: 'startAgentflow', label: 'Start' }])
      const snapshot = JSON.parse(await readFile(path, 'utf8')) as { nodes: unknown[] }
      expect(snapshot.nodes).toHaveLength(1)
      expect(client.listNodes).not.toHaveBeenCalled()
      expect((await stat(path)).mode & 0o777).toBe(0o600)
    } finally {
      await rm(directory, { recursive: true, force: true })
    }
  })
})
