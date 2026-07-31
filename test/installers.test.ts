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
  cpSync(join(root, 'scripts', 'uninstall-cli.sh'), join(dir, 'scripts', 'uninstall-cli.sh'))
  cpSync(join(root, 'scripts', 'uninstall-skill.sh'), join(dir, 'scripts', 'uninstall-skill.sh'))
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
    const helpOutput = join(dir, 'help-stdout'); const helpErrors = join(dir, 'help-stderr')
    const help = spawnSync('bash', ['-c', 'node dist/cli.js --help > "$1" 2> "$2"', 'bash', helpOutput, helpErrors], { cwd: root, encoding: 'utf8' })
    expect(help.status).toBe(0)
    expect(readFileSync(helpOutput, 'utf8')).toContain('list')
    expect(readFileSync(helpOutput, 'utf8')).toContain('inspect')
    expect(readFileSync(helpErrors, 'utf8')).toBe('')
    const inspectHelpOutput = join(dir, 'inspect-help-stdout'); const inspectHelpErrors = join(dir, 'inspect-help-stderr')
    const inspectHelp = spawnSync('bash', ['-c', 'node dist/cli.js inspect --help > "$1" 2> "$2"', 'bash', inspectHelpOutput, inspectHelpErrors], { cwd: root, encoding: 'utf8' })
    expect(inspectHelp.status).toBe(0)
    expect(readFileSync(inspectHelpOutput, 'utf8')).toContain('--target-id <id>')
    expect(readFileSync(inspectHelpErrors, 'utf8')).toBe('')
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

  it('prints CLI installer help without checking dependencies and rejects unknown options', () => {
    const dir = fixture(); const script = join(dir, 'scripts', 'install-cli.sh')
    const mockBin = join(dir, 'mock-bin'); mkdirSync(mockBin)
    for (const command of ['node', 'pnpm']) {
      writeFileSync(join(mockBin, command), '#!/usr/bin/env bash\nexit 99\n')
      chmodSync(join(mockBin, command), 0o755)
    }
    for (const args of [['-h'], ['--help']]) {
      const result = run(script, dir, args, { PATH: `${mockBin}:/usr/bin:/bin` })
      expect(result.status).toBe(0)
      expect(result.stdout).toContain('Usage:')
      expect(result.stderr).toBe('')
    }
    const invalid = run(script, dir, ['--unexpected'])
    expect(invalid.status).toBe(2)
    expect(invalid.stderr).toContain('Unknown option')
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

  it('uninstalls only the CLI globally linked from this checkout and is idempotent', () => {
    const dir = fixture(); const script = join(dir, 'scripts', 'uninstall-cli.sh')
    const mockBin = join(dir, 'mock-bin'); const globalRoot = join(dir, 'global-root'); const log = join(dir, 'commands.log')
    const packageTarget = join(globalRoot, 'flowise-agentflow-builder')
    mkdirSync(mockBin); mkdirSync(globalRoot); symlinkSync(dir, packageTarget)
    writeFileSync(join(mockBin, 'pnpm'), '#!/usr/bin/env bash\nprintf "%s\\n" "$*" >> "$UNINSTALL_LOG"\nif [ "$*" = "root --global" ]; then printf "%s\\n" "$PNPM_GLOBAL_ROOT"; exit 0; fi\nif [ "$*" = "uninstall --global flowise-agentflow-builder" ]; then rm -f -- "$PNPM_PACKAGE_TARGET"; fi\n')
    chmodSync(join(mockBin, 'pnpm'), 0o755)
    const env = {
      PATH: `${mockBin}:${process.env.PATH}`, PNPM_GLOBAL_ROOT: globalRoot, PNPM_PACKAGE_TARGET: packageTarget, UNINSTALL_LOG: log,
    }
    expect(run(script, dir, [], env).status).toBe(0)
    expect(existsSync(packageTarget)).toBe(false)
    expect(run(script, dir, [], env).status).toBe(0)
    expect(readFileSync(log, 'utf8')).toBe('root --global\nuninstall --global flowise-agentflow-builder\nroot --global\n')
  })

  it('protects a conflicting global CLI package unless force is explicit', () => {
    const dir = fixture(); const script = join(dir, 'scripts', 'uninstall-cli.sh')
    const mockBin = join(dir, 'mock-bin'); const globalRoot = join(dir, 'global-root'); const log = join(dir, 'commands.log')
    const packageTarget = join(globalRoot, 'flowise-agentflow-builder')
    mkdirSync(mockBin); mkdirSync(packageTarget, { recursive: true }); writeFileSync(join(packageTarget, 'sentinel'), 'keep')
    writeFileSync(join(mockBin, 'pnpm'), '#!/usr/bin/env bash\nprintf "%s\\n" "$*" >> "$UNINSTALL_LOG"\nif [ "$*" = "root --global" ]; then printf "%s\\n" "$PNPM_GLOBAL_ROOT"; exit 0; fi\nif [ "$*" = "uninstall --global flowise-agentflow-builder" ]; then rm -rf -- "$PNPM_PACKAGE_TARGET"; fi\n')
    chmodSync(join(mockBin, 'pnpm'), 0o755)
    const env = {
      PATH: `${mockBin}:${process.env.PATH}`, PNPM_GLOBAL_ROOT: globalRoot, PNPM_PACKAGE_TARGET: packageTarget, UNINSTALL_LOG: log,
    }
    expect(run(script, dir, [], env).status).not.toBe(0)
    expect(readFileSync(join(packageTarget, 'sentinel'), 'utf8')).toBe('keep')
    expect(run(script, dir, ['--force'], env).status).toBe(0)
    expect(existsSync(packageTarget)).toBe(false)
  })

  it('reports a failed pnpm CLI uninstall without removing the existing link', () => {
    const dir = fixture(); const script = join(dir, 'scripts', 'uninstall-cli.sh')
    const mockBin = join(dir, 'mock-bin'); const globalRoot = join(dir, 'global-root')
    const packageTarget = join(globalRoot, 'flowise-agentflow-builder')
    mkdirSync(mockBin); mkdirSync(globalRoot); symlinkSync(dir, packageTarget)
    writeFileSync(join(mockBin, 'pnpm'), '#!/usr/bin/env bash\nif [ "$*" = "root --global" ]; then printf "%s\\n" "$PNPM_GLOBAL_ROOT"; exit 0; fi\nexit 17\n')
    chmodSync(join(mockBin, 'pnpm'), 0o755)
    const result = run(script, dir, [], { PATH: `${mockBin}:${process.env.PATH}`, PNPM_GLOBAL_ROOT: globalRoot })
    expect(result.status).toBe(17)
    expect(existsSync(packageTarget)).toBe(true)
  })

  it('prints CLI uninstaller help and rejects unknown options without invoking pnpm', () => {
    const dir = fixture(); const script = join(dir, 'scripts', 'uninstall-cli.sh')
    const mockBin = join(dir, 'mock-bin'); mkdirSync(mockBin)
    writeFileSync(join(mockBin, 'pnpm'), '#!/usr/bin/env bash\nexit 99\n')
    chmodSync(join(mockBin, 'pnpm'), 0o755)
    for (const args of [['-h'], ['--help']]) {
      const result = run(script, dir, args, { PATH: `${mockBin}:/usr/bin:/bin` })
      expect(result.status).toBe(0)
      expect(result.stdout).toContain('Usage:')
      expect(result.stderr).toBe('')
    }
    expect(run(script, dir, ['--unexpected']).status).toBe(2)
  })

  it('prints help without arguments or with either help option and does not install', () => {
    const dir = fixture(); const script = join(dir, 'scripts', 'install-skill.sh')
    for (const args of [[], ['-h'], ['--help']]) {
      const result = run(script, dir, args)
      expect(result.status).toBe(0)
      expect(result.stdout).toContain('Usage:')
      expect(result.stderr).toBe('')
    }
    expect(existsSync(join(dir, '.agents'))).toBe(false)
  })

  it('creates an idempotent project skill symlink and protects conflicts', () => {
    const dir = fixture(); const script = join(dir, 'scripts', 'install-skill.sh')
    expect(run(script, dir, ['--project', '.']).status).toBe(0)
    expect(readFileSync(join(dir, '.agents', 'skills', 'build-flowise-agentflow', 'SKILL.md'), 'utf8')).toContain('Flowise')
    expect(run(script, dir, ['--project', dir]).status).toBe(0)
    rmSync(join(dir, '.agents', 'skills', 'build-flowise-agentflow'))
    mkdirSync(join(dir, '.agents', 'skills', 'build-flowise-agentflow'))
    expect(run(script, dir, ['--project', dir]).status).not.toBe(0)
    expect(run(script, dir, ['--project', dir, '--force']).status).toBe(0)
  })

  it('uninstalls a project skill link idempotently and preserves parent directories', () => {
    const dir = fixture(); const install = join(dir, 'scripts', 'install-skill.sh'); const uninstall = join(dir, 'scripts', 'uninstall-skill.sh')
    const target = join(dir, '.agents', 'skills', 'build-flowise-agentflow')
    expect(run(install, dir, ['--project', '.']).status).toBe(0)
    expect(run(uninstall, dir, ['--project', '.']).status).toBe(0)
    expect(existsSync(target)).toBe(false)
    expect(existsSync(join(dir, '.agents', 'skills'))).toBe(true)
    expect(run(uninstall, dir, ['--project', '.']).status).toBe(0)
  })

  it('protects a conflicting project skill target unless force is explicit', () => {
    const dir = fixture(); const script = join(dir, 'scripts', 'uninstall-skill.sh')
    const target = join(dir, '.agents', 'skills', 'build-flowise-agentflow')
    mkdirSync(target, { recursive: true }); writeFileSync(join(target, 'sentinel'), 'keep')
    expect(run(script, dir, ['--project', '.']).status).not.toBe(0)
    expect(readFileSync(join(target, 'sentinel'), 'utf8')).toBe('keep')
    expect(run(script, dir, ['--project', '.', '--force']).status).toBe(0)
    expect(existsSync(target)).toBe(false)
    expect(existsSync(join(dir, '.agents', 'skills'))).toBe(true)
  })

  it('installs into an external project using a relative path with spaces', () => {
    const dir = fixture(); const script = join(dir, 'scripts', 'install-skill.sh')
    const project = join(dir, 'projects', 'example project')
    mkdirSync(project, { recursive: true })
    const result = run(script, dir, ['--project', join('projects', 'example project')])
    expect(result.status).toBe(0)
    expect(readFileSync(join(project, '.agents', 'skills', 'build-flowise-agentflow', 'SKILL.md'), 'utf8')).toContain('Flowise')
  })

  it('rejects a symlinked repo-local skill parent without changing its target', () => {
    const dir = fixture(); const script = join(dir, 'scripts', 'install-skill.sh'); const external = join(dir, 'external')
    mkdirSync(join(external, 'skills', 'build-flowise-agentflow'), { recursive: true })
    writeFileSync(join(external, 'skills', 'build-flowise-agentflow', 'sentinel'), 'keep')
    symlinkSync(external, join(dir, '.agents'))
    const result = run(script, dir, ['--project', dir, '--force'])
    expect(result.status).not.toBe(0)
    expect(result.stderr).toContain('symlinked repository skill path')
    expect(readFileSync(join(external, 'skills', 'build-flowise-agentflow', 'sentinel'), 'utf8')).toBe('keep')
  })

  it('rejects invalid project and option combinations without installing', () => {
    const dir = fixture(); const script = join(dir, 'scripts', 'install-skill.sh')
    for (const args of [
      ['--project'],
      ['--project', '--global'],
      ['--project', dir, '--global'],
      ['--force'],
      ['--unexpected'],
    ]) {
      expect(run(script, dir, args).status).toBe(2)
    }
    expect(run(script, dir, ['--project', join(dir, 'missing')]).status).not.toBe(0)
    expect(existsSync(join(dir, '.agents'))).toBe(false)
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

  it('uninstalls a matching global skill copy and protects modified copies', () => {
    const dir = fixture(); const install = join(dir, 'scripts', 'install-skill.sh'); const uninstall = join(dir, 'scripts', 'uninstall-skill.sh')
    const home = join(dir, 'home'); const target = join(home, '.codex', 'skills', 'build-flowise-agentflow')
    mkdirSync(home)
    const env = { HOME: home, CODEX_HOME: '' }
    expect(run(install, dir, ['--global'], env).status).toBe(0)
    expect(run(uninstall, dir, ['--global'], env).status).toBe(0)
    expect(existsSync(target)).toBe(false)
    expect(existsSync(join(home, '.codex', 'skills'))).toBe(true)
    expect(run(uninstall, dir, ['--global'], env).status).toBe(0)

    expect(run(install, dir, ['--global'], env).status).toBe(0)
    writeFileSync(join(target, 'stale'), 'keep')
    expect(run(uninstall, dir, ['--global'], env).status).not.toBe(0)
    expect(existsSync(join(target, 'stale'))).toBe(true)
    expect(run(uninstall, dir, ['--global', '--force'], env).status).toBe(0)
    expect(existsSync(target)).toBe(false)
  })

  it('prints skill uninstaller help and rejects invalid target options', () => {
    const dir = fixture(); const script = join(dir, 'scripts', 'uninstall-skill.sh')
    const mockBin = join(dir, 'mock-bin'); mkdirSync(mockBin)
    writeFileSync(join(mockBin, 'node'), '#!/usr/bin/env bash\nexit 99\n')
    chmodSync(join(mockBin, 'node'), 0o755)
    for (const args of [[], ['-h'], ['--help']]) {
      const result = run(script, dir, args, { PATH: `${mockBin}:/usr/bin:/bin` })
      expect(result.status).toBe(0)
      expect(result.stdout).toContain('Usage:')
      expect(result.stderr).toBe('')
    }
    for (const args of [
      ['--project'],
      ['--project', '--global'],
      ['--project', dir, '--global'],
      ['--force'],
      ['--unexpected'],
    ]) {
      expect(run(script, dir, args).status).toBe(2)
    }
  })

  it('rejects symlinked skill parents without changing their targets', () => {
    const dir = fixture(); const script = join(dir, 'scripts', 'uninstall-skill.sh'); const external = join(dir, 'external')
    mkdirSync(join(external, 'skills', 'build-flowise-agentflow'), { recursive: true })
    writeFileSync(join(external, 'skills', 'build-flowise-agentflow', 'sentinel'), 'keep')
    symlinkSync(external, join(dir, '.agents'))
    expect(run(script, dir, ['--project', dir, '--force']).status).not.toBe(0)
    expect(readFileSync(join(external, 'skills', 'build-flowise-agentflow', 'sentinel'), 'utf8')).toBe('keep')

    const codexHome = join(dir, 'codex-home'); const globalSkills = join(dir, 'global-skills')
    mkdirSync(codexHome); mkdirSync(join(globalSkills, 'build-flowise-agentflow'), { recursive: true })
    writeFileSync(join(globalSkills, 'build-flowise-agentflow', 'sentinel'), 'keep')
    symlinkSync(globalSkills, join(codexHome, 'skills'))
    expect(run(script, dir, ['--global', '--force'], { CODEX_HOME: codexHome }).status).not.toBe(0)
    expect(readFileSync(join(globalSkills, 'build-flowise-agentflow', 'sentinel'), 'utf8')).toBe('keep')
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
    const dir = fixture(); const install = join(dir, 'scripts', 'install-skill.sh'); const uninstall = join(dir, 'scripts', 'uninstall-skill.sh')
    const rootAlias = join(dir, 'root-alias')
    symlinkSync('/', rootAlias)
    for (const codexHome of ['/tmp/..', '//', rootAlias]) {
      for (const script of [install, uninstall]) {
        const result = run(script, dir, ['--global', '--force'], { CODEX_HOME: codexHome })
        expect(result.status).not.toBe(0)
        expect(result.stderr).toContain('CODEX_HOME must resolve to an absolute directory other than /.')
      }
    }
  })
})
