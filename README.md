# Flowise Agentflow Builder

A standalone TypeScript CLI that deterministically compiles strict YAML/JSON intent specs into Flowise Agentflow V2 (`AGENTFLOW`) canvas data. It validates before any remote write and includes a Codex Skill for safe agent-driven use.

## Install and configure

Requires Node.js 20+ and pnpm.

Install the CLI from a checkout with:

```bash
./scripts/install-cli.sh
```

The script requires pnpm's global bin directory to be configured (`pnpm setup`), installs lockfile-pinned dependencies, builds the CLI, links it globally with pnpm, and verifies `flowise-agentflow --version`. It does not install system dependencies or configure a Flowise instance.

Run `./scripts/install-cli.sh -h` to display the installer's help without checking dependencies or installing. To remove the CLI link created from this checkout, run:

```bash
./scripts/uninstall-cli.sh
```

The uninstaller leaves a same-named global package from another source untouched unless `--force` is explicit.

To make the bundled Codex Skill available to a project, pass its project root:

```bash
./scripts/install-skill.sh --project .
```

This creates `.agents/skills/build-flowise-agentflow` under the selected project as a symlink to the Skill in this checkout. The project directory must already exist. To copy the skill to your user-level Codex skills directory instead, run `./scripts/install-skill.sh --global`. Existing targets require `--force` to replace them. Running the script without arguments, or with `-h` or `--help`, displays usage without installing.

Use the matching target option to uninstall the Skill:

```bash
./scripts/uninstall-skill.sh --project .
./scripts/uninstall-skill.sh --global
```

Skill uninstall is idempotent and preserves parent directories. A target that does not match this checkout's link or copy is rejected unless `--force` is explicit.

Manual CLI installation remains:

```bash
pnpm install
pnpm build
pnpm link --global
export FLOWISE_BASE_URL=http://localhost:3000
export FLOWISE_API_TOKEN='management-token'
```

The token must authorize management APIs; a Prediction API key is not sufficient. Configuration priority is CLI, environment, then `.flowise-agentflow.yaml`. The default auth header is `Authorization: Bearer …`; change it with `FLOWISE_AUTH_HEADER` and `FLOWISE_AUTH_SCHEME`. Authenticated plain HTTP is allowed only for localhost unless `--allow-insecure-http` is explicit.

## Safe workflow

```bash
flowise-agentflow doctor --format json
flowise-agentflow list --format json
flowise-agentflow inspect --target-id ID --format json
flowise-agentflow edit-system-prompt --target-id ID --agent-ref n2 --if-match-updated-at DATE --prompt-file prompt.txt --apply --format json
flowise-agentflow inspect-nodes --component startAgentflow --format json
flowise-agentflow inspect-nodes --component agentAgentflow --format json
flowise-agentflow build examples/simple-agent.yaml --output build/simple.flow.json --format json
flowise-agentflow validate examples/simple-agent.yaml --strict --format json
flowise-agentflow diff examples/simple-agent.yaml --target-id ID --format json
flowise-agentflow copy --source-id ID --name "Copy of workflow" --apply --format json
flowise-agentflow update examples/simple-agent.yaml --target-id ID --apply --format json
```

`create`, `copy`, `update`, and `edit-system-prompt` are dry runs unless `--apply` is present. Copy reads an existing `AGENTFLOW`, validates its canvas against the live node catalog, and creates a new workflow with only the requested name and original FlowData; it never copies deployment, public, API-key, chatbot, analytics, or voice metadata. Validation errors always block a copy; warnings require `--allow-warnings`. Before creating, it reads and checks the source again, then reads the destination back and requires semantic equality. Copy has no automatic retry for uncertain writes. Every JSON-mode invocation writes exactly one report object to stdout; verbose details go to stderr. Update rejects non-Agentflow targets, checks `updatedDate` again immediately before PUT, and performs no PUT when semantic data is unchanged.

`edit-system-prompt` precisely changes the sole system message for one inspected agent. It requires `--target-id`, the sanitized inspection reference `--agent-ref nN`, and the exact `--if-match-updated-at` value returned by `inspect`; use exactly one of `--prompt TEXT` or UTF-8 `--prompt-file PATH`. It rejects empty prompts, stale targets, non-agent nodes, and agents with multiple system messages. With `--apply`, it reads again immediately before the PUT and reads back afterward to verify persistence; an unchanged prompt does not issue a PUT. Prefer `--prompt-file`: inline prompt text can be retained in shell history and exposed in process arguments. Treat prompt files as sensitive, keep them outside the repository or ignored, and never commit them.

`list` returns only Agentflow V2 workflows. `inspect` returns a structural projection with local node references and configuration metadata; it omits prompts, input values, credentials, endpoints, and raw canvas IDs. The prompt editor never reports prompt text or raw node IDs. Copy reports only safe source/destination identifiers, names, types, node/edge counts, and diagnostics—it never prints raw FlowData, prompts, credentials, or endpoints. `build`, `validate`, `diff`, `doctor`, `list`, `inspect`, `inspect-nodes`, and dry-run `edit-system-prompt` never mutate Flowise. `export` writes a local artifact only. Exit codes are 0 success/no diff, 1 local/internal failure, 2 validation failure, 3 remote/configuration failure, and 4 diff found.

## Spec and credentials

See [schemas/agentflow-spec.schema.json](schemas/agentflow-spec.schema.json) and the four files under `examples/`. Components and inputs must exactly match the live or explicitly supplied catalog. Put credential references under the credential field name exposed by that catalog (normally `credential`), for example `inputs: { credential: "${credential.openai_default}" }`. IDs are supplied outside the workflow spec in `.flowise-agentflow.credentials.yaml`, or in a file selected with `--credentials`:

```yaml
credentials:
  openai_default: existing-flowise-credential-id
```

The CLI never creates credentials. The default mapping filename is gitignored; do not commit an alternate mapping either.

Build and export artifacts can contain credential IDs, prompts, and external endpoints. The CLI creates explicit artifact files with owner-only permissions, but callers must also protect backups and CI artifacts. Reports redact common secret fields and semantic diff values. Runtime `list` output contains Flowise resource IDs and user-supplied names; use it locally and never commit captured output. Node catalog reports and snapshots discard Flowise runtime fields and absolute filesystem paths.

## Compatibility and limits

The compatibility layer is aligned to Flowise commit `83f2947df934d3fa1032def302f0c8c706db8fe3` and dynamically checks the target node catalog rather than assuming a version. It supports standard nodes and dynamic Condition/Condition Agent handles. Complex Iteration parent/container layout remains experimental: node rendering is supported, but nested container construction is not synthesized. Raw `{{ … }}` Flowise expressions are preserved with a warning because they cannot be fully verified. Environment-variable expressions and arbitrary file reads are disabled.

No browser automation, MCP server, AI generator, credential creation, flow execution, or deployment-state changes are performed.

## Development

```bash
pnpm lint
pnpm typecheck
pnpm test
pnpm build
pnpm pack
```

Live read-only integration is opt-in (`FLOWISE_INTEGRATION=1`) and accepts remote hosts only with `FLOWISE_INTEGRATION_ALLOW_REMOTE=1`. No integration test or remote write runs by default. The Codex Skill is in `skills/build-flowise-agentflow`.
