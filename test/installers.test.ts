import { spawnSync } from 'node:child_process'
import { chmodSync, cpSync, existsSync, mkdtempSync, mkdirSync, readFileSync, readdirSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'

const root = process.cwd()
const packageVersion = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')).version
const tempDirs: string[] = []

function fixture() {
  const dir = mkdtempSync(join(tmpdir(), 'flowise-agentflow-install-'))
  tempDirs.push(dir)
  mkdirSync(join(dir, 'scripts'), { recursive: true })
  cpSync(join(root, 'scripts', 'install-cli.sh'), join(dir, 'scripts', 'install-cli.sh'))
  cpSync(join(root, 'scripts', 'install-skill.sh'), join(dir, 'scripts', 'install-skill.sh'))
  cpSync(join(root, 'skills', 'build-flowise-agentflow'), join(dir, 'skills', 'build-flowise-agentflow'), { recursive: true })
  return dir
}

function run(script: string, cwd: string, args: string[] = [], env: Record<string, string> = {}) {
  return spawnSync('bash', [script, ...args], { cwd, env: { ...process.env, ...env }, encoding: 'utf8' })
}

afterEach(() => { for (const dir of tempDirs.splice(0)) rmSync(dir, { recursive: true, force: true }) })

describe('CLI and installers', () => {
  it('prints only its package version and exits successfully', () => {
    expect(spawnSync('bash', ['-c', 'node node_modules/typescript/bin/tsc -p tsconfig.build.json'], { cwd: root }).status).toBe(0)
    const dir = mkdtempSync(join(tmpdir(), 'flowise-agentflow-version-')); tempDirs.push(dir)
    const output = join(dir, 'stdout'); const errors = join(dir, 'stderr')
    const result = spawnSync('bash', ['-c', 'node dist/cli.js --version > "$1" 2> "$2"', 'bash', output, errors], { cwd: root, encoding: 'utf8' })
    expect(result.status).toBe(0)
    expect(readFileSync(output, 'utf8')).toBe(`${packageVersion}\n`)
    expect(readFileSync(errors, 'utf8')).toBe('')
  })

  it('runs the lockfile-pinned CLI install sequence and verifies the linked version', () => {
    const dir = fixture(); const mockBin = join(dir, 'mock-bin'); const globalBin = join(dir, 'global-bin')
    const log = join(dir, 'commands.log'); const verificationLog = join(dir, 'verification.log')
    mkdirSync(mockBin); mkdirSync(globalBin); writeFileSync(join(dir, 'package.json'), '{"version":"0.1.0"}\n')
    writeFileSync(join(mockBin, 'node'), '#!/usr/bin/env bash\ncase "$2" in *process.versions.node*) echo 20 ;; *) echo 0.1.0 ;; esac\n')
    writeFileSync(join(mockBin, 'pnpm'), '#!/usr/bin/env bash\nprintf "%s\\n" "$*" >> "$INSTALL_LOG"\n[ "$*" != "bin --global" ] || printf "%s\\n" "$PNPM_GLOBAL_BIN"\n')
    writeFileSync(join(mockBin, 'flowise-agentflow'), '#!/usr/bin/env bash\n[ "$1" = "--version" ] && echo 0.1.0\n')
    writeFileSync(join(globalBin, 'flowise-agentflow'), '#!/usr/bin/env bash\nprintf "linked\\n" >> "$VERIFICATION_LOG"\n[ "$1" = "--version" ] && echo 0.1.0\n')
    for (const command of ['node', 'pnpm', 'flowise-agentflow']) chmodSync(join(mockBin, command), 0o755)
    chmodSync(join(globalBin, 'flowise-agentflow'), 0o755)
    const result = run(join(dir, 'scripts', 'install-cli.sh'), dir, [], {
      PATH: `${mockBin}:${process.env.PATH}`, INSTALL_LOG: log, PNPM_GLOBAL_BIN: globalBin, VERIFICATION_LOG: verificationLog,
    })
    expect(result.status).toBe(0)
    expect(readFileSync(log, 'utf8')).toBe('bin --global\ninstall --frozen-lockfile\nbuild\nlink --global\n')
    expect(readFileSync(verificationLog, 'utf8')).toBe('linked\n')
  })

  it('rejects an unconfigured pnpm global bin before installing dependencies', () => {
    const dir = fixture(); const mockBin = join(dir, 'mock-bin'); const log = join(dir, 'commands.log')
    mkdirSync(mockBin); writeFileSync(join(dir, 'package.json'), '{"version":"0.1.0"}\n')
    writeFileSync(join(mockBin, 'node'), '#!/usr/bin/env bash\ncase "$2" in *process.versions.node*) echo 20 ;; *) echo 0.1.0 ;; esac\n')
    writeFileSync(join(mockBin, 'pnpm'), '#!/usr/bin/env bash\nprintf "%s\\n" "$*" >> "$INSTALL_LOG"\nexit 1\n')
    for (const command of ['node', 'pnpm']) chmodSync(join(mockBin, command), 0o755)
    const result = run(join(dir, 'scripts', 'install-cli.sh'), dir, [], { PATH: `${mockBin}:${process.env.PATH}`, INSTALL_LOG: log })
    expect(result.status).not.toBe(0)
    expect(result.stderr).toContain('pnpm setup')
    expect(readFileSync(log, 'utf8')).toBe('bin --global\n')
  })

  it('stops the CLI install sequence after a failed build', () => {
    const dir = fixture(); const mockBin = join(dir, 'mock-bin'); const globalBin = join(dir, 'global-bin'); const log = join(dir, 'commands.log')
    mkdirSync(mockBin); mkdirSync(globalBin); writeFileSync(join(dir, 'package.json'), '{"version":"0.1.0"}\n')
    writeFileSync(join(mockBin, 'node'), '#!/usr/bin/env bash\ncase "$2" in *process.versions.node*) echo 20 ;; *) echo 0.1.0 ;; esac\n')
    writeFileSync(join(mockBin, 'pnpm'), '#!/usr/bin/env bash\nprintf "%s\\n" "$*" >> "$INSTALL_LOG"\n[ "$*" != "bin --global" ] || printf "%s\\n" "$PNPM_GLOBAL_BIN"\n[ "$1" != build ]\n')
    writeFileSync(join(mockBin, 'flowise-agentflow'), '#!/usr/bin/env bash\necho should-not-run\n')
    for (const command of ['node', 'pnpm', 'flowise-agentflow']) chmodSync(join(mockBin, command), 0o755)
    const result = run(join(dir, 'scripts', 'install-cli.sh'), dir, [], {
      PATH: `${mockBin}:${process.env.PATH}`, INSTALL_LOG: log, PNPM_GLOBAL_BIN: globalBin,
    })
    expect(result.status).not.toBe(0)
    expect(readFileSync(log, 'utf8')).toBe('bin --global\ninstall --frozen-lockfile\nbuild\n')
  })

  it('creates an idempotent repo-local skill symlink and protects conflicts', () => {
    const dir = fixture(); const script = join(dir, 'scripts', 'install-skill.sh')
    expect(run(script, dir).status).toBe(0)
    expect(readFileSync(join(dir, '.agents', 'skills', 'build-flowise-agentflow', 'SKILL.md'), 'utf8')).toContain('Flowise')
    expect(run(script, dir).status).toBe(0)
    rmSync(join(dir, '.agents', 'skills', 'build-flowise-agentflow'))
    mkdirSync(join(dir, '.agents', 'skills', 'build-flowise-agentflow'))
    expect(run(script, dir).status).not.toBe(0)
    expect(run(script, dir, ['--force']).status).toBe(0)
  })

  it('rejects a symlinked repo-local skill parent without changing its target', () => {
    const dir = fixture(); const script = join(dir, 'scripts', 'install-skill.sh'); const external = join(dir, 'external')
    mkdirSync(join(external, 'skills', 'build-flowise-agentflow'), { recursive: true })
    writeFileSync(join(external, 'skills', 'build-flowise-agentflow', 'sentinel'), 'keep')
    symlinkSync(external, join(dir, '.agents'))
    const result = run(script, dir, ['--force'])
    expect(result.status).not.toBe(0)
    expect(result.stderr).toContain('symlinked repository skill path')
    expect(readFileSync(join(external, 'skills', 'build-flowise-agentflow', 'sentinel'), 'utf8')).toBe('keep')
  })

  it('copies globally under the default Codex home and replaces an existing copy only with --force', () => {
    const dir = fixture(); const script = join(dir, 'scripts', 'install-skill.sh'); const home = join(dir, 'home')
    mkdirSync(home)
    const target = join(home, '.codex', 'skills', 'build-flowise-agentflow')
    const first = run(script, dir, ['--global'], { HOME: home, CODEX_HOME: '' })
    expect(first.status).toBe(0)
    expect(first.stdout).not.toContain(home)
    expect(readFileSync(join(target, 'SKILL.md'), 'utf8')).toContain('Flowise')
    writeFileSync(join(target, 'stale'), 'old')
    expect(run(script, dir, ['--global'], { HOME: home, CODEX_HOME: '' }).status).not.toBe(0)
    expect(existsSync(join(target, 'stale'))).toBe(true)
    expect(run(script, dir, ['--global', '--force'], { HOME: home, CODEX_HOME: '' }).status).toBe(0)
    expect(existsSync(join(target, 'stale'))).toBe(false)
    expect(readdirSync(join(home, '.codex', 'skills')).filter((name) => name.includes('.tmp.') || name.includes('.backup.'))).toEqual([])
    expect(run(script, dir, ['--unexpected'], { HOME: home, CODEX_HOME: '' }).status).not.toBe(0)
  })

  it('honors CODEX_HOME for a global skill installation', () => {
    const dir = fixture(); const script = join(dir, 'scripts', 'install-skill.sh')
    const home = join(dir, 'home'); const codexHome = join(dir, 'nested', '..', 'custom-codex-home')
    mkdirSync(home)
    expect(run(script, dir, ['--global'], { HOME: home, CODEX_HOME: codexHome }).status).toBe(0)
    expect(readFileSync(join(dir, 'custom-codex-home', 'skills', 'build-flowise-agentflow', 'SKILL.md'), 'utf8')).toContain('Flowise')
    expect(existsSync(join(home, '.codex', 'skills', 'build-flowise-agentflow'))).toBe(false)
  })

  it('installs globally when realpath does not support GNU options', () => {
    const dir = fixture(); const script = join(dir, 'scripts', 'install-skill.sh')
    const mockBin = join(dir, 'mock-bin'); const codexHome = join(dir, 'nested', '..', 'custom-codex-home')
    mkdirSync(mockBin)
    writeFileSync(join(mockBin, 'realpath'), '#!/usr/bin/env bash\nexit 64\n')
    chmodSync(join(mockBin, 'realpath'), 0o755)
    const result = run(script, dir, ['--global'], { CODEX_HOME: codexHome, PATH: `${mockBin}:${process.env.PATH}` })
    expect(result.status).toBe(0)
    expect(readFileSync(join(dir, 'custom-codex-home', 'skills', 'build-flowise-agentflow', 'SKILL.md'), 'utf8')).toContain('Flowise')
  })

  it('rejects CODEX_HOME spellings that resolve to the filesystem root', () => {
    const dir = fixture(); const script = join(dir, 'scripts', 'install-skill.sh')
    const rootAlias = join(dir, 'root-alias')
    symlinkSync('/', rootAlias)
    for (const codexHome of ['/tmp/..', '//', rootAlias]) {
      const result = run(script, dir, ['--global', '--force'], { CODEX_HOME: codexHome })
      expect(result.status).not.toBe(0)
      expect(result.stderr).toContain('CODEX_HOME must resolve to an absolute directory other than /.')
    }
  })
})
