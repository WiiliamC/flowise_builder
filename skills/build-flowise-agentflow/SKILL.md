---
name: build-flowise-agentflow
description: Build, validate, diff, copy, create, update, and inspect Flowise Agentflow V2 canvases through the flowise-agentflow CLI. Use when Codex needs to turn a workflow requirement into a Flowise Agentflow, copy or modify an existing Agentflow, diagnose an Agentflow spec or canvas validation failure, or inspect Flowise Agentflow node capabilities.
---

# Build Flowise Agentflow

Check `flowise-agentflow --version`, then run `doctor --format json`. For an existing workflow, run `list --format json`, select its returned ID, and run `inspect --target-id ID --format json`. Use that structural report to identify responsibilities, order, branches, state, tools, models, and human approval points. Then inspect only the involved components with `inspect-nodes`; the target catalog is authoritative.

Use only the CLI for Flowise discovery and inspection. Do not call the Flowise API directly, write an ad hoc FlowData parser, guess an ID, or expose raw FlowData merely to summarize a workflow. To duplicate an existing canvas in the same instance, use `copy --source-id ID --name NAME`; it validates the live canvas and does not require YAML or export artifacts. Treat runtime flow IDs and names as local operational data and never put captured output in repository artifacts. Use `export` only when a protected raw artifact is explicitly needed.

Translate the request into node responsibilities, order, branches, state, tools, models, credential aliases, and human approval points. Use YAML AgentflowSpec, never hand-written FlowData. Reuse patterns in `references/workflow-patterns.md`.

Do not guess credentials, target models, business URLs, or component fields. Leave a clear TODO and do not apply while one remains. Build and run strict validation in JSON mode. Correct diagnostics by stable `code`; if a code repeats twice, inspect its node schema again, and stop after three unresolved attempts.

## Command modification scope

All commands may emit terminal reports. Never place captured reports, runtime IDs or names, FlowData, prompts, credentials, endpoints, or protected artifacts in repository files.

| Command | Local writes | Remote writes |
| --- | --- | --- |
| `doctor` | None | None; reads node and chatflow APIs. |
| `list` | None | None; reads chatflows. |
| `inspect` | None | None; reads one chatflow and returns a sanitized projection. |
| `inspect-nodes` | Optional protected catalog snapshot with `--snapshot` | None; otherwise reads node catalog. |
| `build` | Optional protected FlowData (`--output`) and report (`--report`) artifacts | None; may read node catalog unless offline catalog is supplied. |
| `validate` | None | None; may read node catalog unless offline catalog is supplied. |
| `diff` | None | None; reads the target chatflow and node catalog unless offline catalog is supplied. |
| `create` | None | Only with explicit authorization and `--apply`: creates exactly one new `AGENTFLOW`. |
| `copy` | None | Only with explicit authorization and `--apply`: creates exactly one new `AGENTFLOW` from the validated source; never modifies the source. |
| `update` | None | Only with explicit authorization and `--apply`: PUTs the specified target `AGENTFLOW` after its concurrency check. |
| `export` | One protected raw FlowData artifact at required `--output` | None; reads one chatflow. |
| `edit-system-prompt` | None, except it reads a caller-provided UTF-8 prompt file when `--prompt-file` is used | Default/dry run: none, reads only the specified target. With explicit authorization and `--apply`: PUTs only that target `AGENTFLOW`'s full FlowData after an exact `updatedDate` match and immediate reread; it replaces the selected `agentAgentflow` system-message content, or prepends one when absent. |

Before update, always diff. Do not use `--force` without explicit authorization. Create, copy, update, and edit-system-prompt require explicit user authorization plus `--apply --format json`. Copy warnings require explicit `--allow-warnings`; errors always block. After create or update, inspect the remote flow. Copy and edit-system-prompt perform their own remote readback and semantic persistence check, so do not add a separate inspect unless the user asks for structural details. Export and validate only when a protected raw verification artifact is required. Report the chatflow ID, semantic changes, warnings, and manual checks without secrets.

See `references/spec-reference.md` for the contract and `references/troubleshooting.md` for error handling.
