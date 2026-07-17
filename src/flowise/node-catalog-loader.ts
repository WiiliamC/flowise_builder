import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import type { CatalogSnapshot, NodeDataSchema } from '../domain/node-catalog.js'
import type { FlowiseClient } from './flowise-client.js'
import { writeSensitiveJson } from '../output/artifact-writer.js'

export function catalogHash(nodes: NodeDataSchema[]): string {
  return createHash('sha256').update(JSON.stringify([...nodes].sort((a, b) => a.name.localeCompare(b.name)))).digest('hex')
}
export async function loadCatalog(path: string): Promise<{ nodes: NodeDataSchema[]; hash: string }> {
  const parsed = JSON.parse(await readFile(path, 'utf8')) as NodeDataSchema[] | CatalogSnapshot
  const nodes = Array.isArray(parsed) ? parsed : parsed.nodes
  return { nodes, hash: Array.isArray(parsed) ? catalogHash(nodes) : parsed.schemaHash }
}
export async function snapshotCatalog(client: FlowiseClient, path: string) {
  const nodes = await client.listNodes(); const source = createHash('sha256').update(client.baseUrl).digest('hex').slice(0, 12); const snapshot: CatalogSnapshot = { schemaVersion: '1', fetchedAt: new Date().toISOString(), source: `instance:${source}`, schemaHash: catalogHash(nodes), nodes }
  await writeSensitiveJson(path, snapshot); return snapshot
}
