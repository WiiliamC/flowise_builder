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
flowise-agentflow rename --target-id ID --name "Renamed workflow" --format json
flowise-agentflow rename --target-id ID --name "Renamed workflow" --if-match-updated-at DATE --apply --format json
flowise-agentflow edit-system-prompt --target-id ID --agent-ref n2 --if-match-updated-at DATE --prompt-file prompt.txt --apply --format json
flowise-agentflow inspect-agent-mcp --target-id ID --agent-ref n2 --format json
flowise-agentflow edit-agent-mcp --target-id ID --agent-ref n2 --mcp-ref m1 --config-file mcp-config.json --if-match-updated-at DATE --format json
flowise-agentflow refresh-agent-mcp-actions --target-id ID --agent-ref n2 --mcp-ref m1 --format json
flowise-agentflow refresh-agent-mcp-actions --target-id ID --agent-ref n2 --mcp-ref m1 --enable-action ACTION --if-match-updated-at DATE --apply --format json
flowise-agentflow inspect-nodes --component startAgentflow --format json
flowise-agentflow inspect-nodes --component agentAgentflow --format json
flowise-agentflow build examples/simple-agent.yaml --output build/simple.flow.json --format json
flowise-agentflow validate examples/simple-agent.yaml --strict --format json
flowise-agentflow diff examples/simple-agent.yaml --target-id ID --format json
flowise-agentflow copy --source-id ID --name "Copy of workflow" --apply --format json
flowise-agentflow update examples/simple-agent.yaml --target-id ID --apply --format json
```

`create`, `copy`, `rename`, `update`, `edit-system-prompt`, and `edit-agent-mcp` are dry runs unless `--apply` is present. Copy reads an existing `AGENTFLOW`, validates its canvas against the live node catalog, and creates a new workflow with only the requested name and original FlowData; it never copies deployment, public, API-key, chatbot, analytics, or voice metadata. Validation errors always block a copy; warnings require `--allow-warnings`. Before creating, it reads and checks the source again, then reads the destination back and requires semantic equality. Copy has no automatic retry for uncertain writes. Every JSON-mode invocation writes exactly one report object to stdout; verbose details go to stderr. Update rejects non-Agentflow targets, checks `updatedDate` again immediately before PUT, and performs no PUT when semantic data is unchanged.

`rename` requires `--target-id` and `--name`, rejects whitespace-only names, and preserves all other name text exactly. It sends only `{ "name": NAME }` to the target update endpoint, without parsing or resending FlowData or other metadata. An optional `--if-match-updated-at DATE` must exactly match the remote timestamp, including for an unchanged name; a missing remote timestamp fails a supplied match. A matching name reports `changed: false, applied: false` without PUT. Dry run reports the before/after names. With `--apply`, it rereads type, name, and timestamp immediately before PUT and verifies the persisted ID, type, and name afterward. These checks are client-side, not an atomic server precondition: a concurrent write between reread and PUT can still race. Uncertain writes are never automatically retried; inspect the target before deciding to retry. Reports contain target metadata and before/after names, never the raw remote object.

`edit-system-prompt` precisely changes the sole system message for one inspected agent. It requires `--target-id`, the sanitized inspection reference `--agent-ref nN`, and the exact `--if-match-updated-at` value returned by `inspect`; use exactly one of `--prompt TEXT` or UTF-8 `--prompt-file PATH`. It rejects empty prompts, stale targets, non-agent nodes, and agents with multiple system messages. With `--apply`, it reads again immediately before the PUT and reads back afterward to verify persistence; an unchanged prompt does not issue a PUT. Prefer `--prompt-file`: inline prompt text can be retained in shell history and exposed in process arguments. Treat prompt files as sensitive, keep them outside the repository or ignored, and never commit them.

Custom MCP maintenance is deliberately split into three steps. First, `inspect-agent-mcp` reports the sanitized target metadata and `updatedDate` concurrency token, then assigns local `mN` references to existing Custom MCP tools and reports only transport, a configuration hash, Flowise-variable-reference presence, and enabled-action count for each. Next, `edit-agent-mcp` accepts readable fatal UTF-8 strict JSON from `--config-file`, stores its text exactly, and changes only `mcpServerConfig`; it never discovers actions or changes `mcpActions`. Finally, `refresh-agent-mcp-actions` discovers the current options from Flowise. Refresh-only mode reports counts and never writes. Use either `--enable-all` or repeatable `--enable-action NAME` to add actions without disabling existing selections; all enablement attempts require the exact inspected `updatedDate` as `--if-match-updated-at`, and only enablement combined with `--apply` can PUT. Add `--show-action-names` when names are needed; descriptions are never reported. Keep MCP config files outside the repository or ignored because they may contain endpoints, commands, headers, and credentials. V1 cannot add, delete, or reorder Custom MCP tools and cannot disable actions; it does not bypass Flowise authentication or network/security policy.

`list` returns only Agentflow V2 workflows. `inspect` returns a structural projection with local node references and configuration metadata; it omits prompts, input values, credentials, endpoints, and raw canvas IDs. The prompt and MCP editors never report protected content or raw node IDs. Copy reports only safe source/destination identifiers, names, types, node/edge counts, and diagnostics—it never prints raw FlowData, prompts, credentials, or endpoints. `build`, `validate`, `diff`, `doctor`, `list`, `inspect`, `inspect-agent-mcp`, `inspect-nodes`, refresh-only MCP discovery, and dry-run editors never mutate Flowise. `export` writes a local artifact only. Exit codes are 0 success/no diff, 1 local/internal failure, 2 validation failure, 3 remote/configuration failure, and 4 diff found.

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

### Precise agent model parameters

Use `inspect` to find the current `nN` agent reference, then inspect its model parameters and exact timestamp:

```sh
flowise-agentflow inspect-agent-model --target-id ID --agent-ref n2 --format json
flowise-agentflow edit-agent-model --target-id ID --agent-ref n2 --if-match-updated-at DATE --set reasoning.enabled=true --set reasoning.effort=high --format json
```

Review the preview, then repeat with `--apply` when authorized. Both preview and apply require an exact `--if-match-updated-at` match, including no-ops. No-ops never PUT. These commands read the live target and model catalog; they do not support offline catalogs, whole model config files, arbitrary configuration paths, batches, or force.

These commands support an existing `agentAgentflow` with an object `agentModelConfig` and either `chatOpenAI` or `chatOpenAICustom`. For `chatOpenAI`, the fixed aliases below are further restricted by live catalog field types, options, bounds, and visibility. Missing or incompatible catalog fields cannot be edited.

| Alias | Stored field | Accepted value |
| --- | --- | --- |
| `reasoning.enabled` | `reasoning` | Exact `true` or `false` |
| `reasoning.effort` | `reasoningEffort` | `low`, `medium`, `high`, `xhigh`, intersected with live options |
| `temperature` | `temperature` | Finite number from 0 through 2 |
| `max-output-tokens` | `maxTokens` | Positive safe integer |
| `top-p` | `topP` | Finite number from 0 through 1 |

For `chatOpenAICustom`, all non-credential form fields are supported: required nonblank `modelName`; optional `temperature`, `streaming`, `reasoningEffort`, `maxTokens`, `topP`, `frequencyPenalty`, `presencePenalty`, `timeout`, `basepath`, and `baseOptions`. Numbers must be finite and satisfy live catalog bounds; ordinary OpenAI ranges and integer restrictions do not apply. Custom effort accepts `none`, `minimal`, `low`, `medium`, `high`, `xhigh`, and `max`, intersected with live options, without a reasoning toggle. `reasoning.enabled` is unavailable for Custom. The `cache` connection anchor and credentials are excluded.

Use native field names or the aliases above. Supply at least one repeatable operation: `--set key=value`, `--set-env key=ENV_NAME`, `--set-file key=PATH`, or `--unset key`. Environment and UTF8 file contents use the same strict parsing as literal values; source names, paths, and contents are never echoed in errors. A field can appear only once across all operations, including aliases. Unset removes an optional stored field; it never stores a default, and required `modelName` cannot be removed. `baseOptions` accepts a JSON object only and replaces the whole object, stored as serialized JSON text as in the Flowise form.

```sh
flowise-agentflow edit-agent-model --target-id ID --agent-ref n2 --if-match-updated-at DATE --set-env modelName=MODEL_NAME --set-file baseOptions=/path/to/private-options.json --unset timeout --format json
```

For ordinary `chatOpenAI`, setting effort requires reasoning explicitly true in the combined configuration; disabling reasoning retains stored effort. Unrelated historical values, including numeric strings, are preserved. Inspection includes each field, accepted aliases, optional status, stored state, and catalog defaults; defaults are never silently materialized. All free text and JSON values are redacted in inspection and change reports, including defaults. Invalid values are marked without echoing their contents. Credentials, prompts, tools, and graph details cannot be edited through these commands.

Schema-valid edits carry `MODEL_COMPATIBILITY_UNVERIFIED`, including for custom endpoints. The CLI makes no model calls and does not establish whether the runtime model supports the requested values. This warning does not block applying an otherwise valid edit or require an additional confirmation.

Apply checks that the full delta contains only requested allowed fields, rereads and compares the exact timestamp and complete FlowData, sends only `{flowData}`, and verifies full semantic equality on readback, including metadata. The result includes the persisted timestamp. This is a client-side concurrency check: a race remains between the last read and PUT because there is no atomic server precondition. Uncertain writes and readback failures are never retried or rolled back; inspect the target before deciding the next action.
