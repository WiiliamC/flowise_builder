# Flowise Agentflow Builder

A standalone TypeScript CLI that deterministically compiles strict YAML/JSON intent specs into Flowise Agentflow V2 (`AGENTFLOW`) canvas data. It validates before any remote write and includes a Codex Skill for safe agent-driven use.

## Install and configure

Requires Node.js 20+ and pnpm.

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
flowise-agentflow inspect-nodes --component agentAgentflow --snapshot catalog.json
flowise-agentflow build examples/simple-agent.yaml --catalog catalog.json --offline --output build/simple.flow.json --format json
flowise-agentflow validate examples/simple-agent.yaml --catalog catalog.json --offline --strict --format json
flowise-agentflow diff examples/simple-agent.yaml --target-id ID --catalog catalog.json --format json
flowise-agentflow update examples/simple-agent.yaml --target-id ID --catalog catalog.json --apply --format json
```

`create` and `update` are dry runs unless `--apply` is present. Every JSON-mode invocation writes exactly one report object to stdout; verbose details go to stderr. Update rejects non-Agentflow targets, checks `updatedDate` again immediately before PUT, and performs no PUT when semantic data is unchanged.

`build`, `validate`, `diff`, `doctor`, and `inspect-nodes` never mutate Flowise. `export` writes a local artifact only. Exit codes are 0 success/no diff, 1 local/internal failure, 2 validation failure, 3 remote/configuration failure, and 4 diff found.

## Spec and credentials

See [schemas/agentflow-spec.schema.json](schemas/agentflow-spec.schema.json) and the four files under `examples/`. Components and inputs must exactly match the live or explicitly supplied catalog. Put credential references under the credential field name exposed by that catalog (normally `credential`), for example `inputs: { credential: "${credential.openai_default}" }`. IDs are supplied outside the workflow spec in `.flowise-agentflow.credentials.yaml`, or in a file selected with `--credentials`:

```yaml
credentials:
  openai_default: existing-flowise-credential-id
```

The CLI never creates credentials. The default mapping filename is gitignored; do not commit an alternate mapping either.

Build and export artifacts can contain credential IDs, prompts, and external endpoints. The CLI creates explicit artifact files with owner-only permissions, but callers must also protect backups and CI artifacts. Reports redact common secret fields and semantic diff values.

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
