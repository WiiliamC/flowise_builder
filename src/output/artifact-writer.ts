import { open, mkdir, rename, rm } from 'node:fs/promises'
import { randomUUID } from 'node:crypto'
import { basename, dirname, join, resolve } from 'node:path'

export async function writeSensitiveJson(path: string, value: unknown): Promise<void> {
  const target = resolve(path)
  const directory = dirname(target)
  const temporary = join(directory, `.${basename(target)}.${randomUUID()}.tmp`)

  await mkdir(directory, { recursive: true })

  let file
  try {
    file = await open(temporary, 'wx', 0o600)
    await file.writeFile(`${JSON.stringify(value, null, 2)}\n`, 'utf8')
    await file.close()
    file = undefined
    await rename(temporary, target)
  } catch (error) {
    await file?.close().catch(() => undefined)
    await rm(temporary, { force: true }).catch(() => undefined)
    throw error
  }
}
