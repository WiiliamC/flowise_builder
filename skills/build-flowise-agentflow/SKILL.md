---
name: build-flowise-agentflow
description: Build, validate, diff, create, update, and inspect Flowise Agentflow V2 canvases through the flowise-agentflow CLI. Use when Codex needs to turn a workflow requirement into a Flowise Agentflow, modify an existing Agentflow, diagnose an Agentflow spec or canvas validation failure, or inspect Flowise Agentflow node capabilities.
---

# Build Flowise Agentflow

Check `flowise-agentflow --version`, then run `doctor --format json`. For an existing workflow, run `list --format json`, select its returned ID, and run `inspect --target-id ID --format json`. Use that structural report to identify responsibilities, order, branches, state, tools, models, and human approval points. Then inspect only the involved components with `inspect-nodes`; the target catalog is authoritative.

Use only the CLI for Flowise discovery and inspection. Do not call the Flowise API directly, write an ad hoc FlowData parser, guess an ID, or expose raw FlowData merely to summarize a workflow. Treat runtime flow IDs and names as local operational data and never put captured output in repository artifacts. Use `export` only when a protected raw artifact is explicitly needed.

Translate the request into node responsibilities, order, branches, state, tools, models, credential aliases, and human approval points. Use YAML AgentflowSpec, never hand-written FlowData. Reuse patterns in `references/workflow-patterns.md`.

Do not guess credentials, target models, business URLs, or component fields. Leave a clear TODO and do not apply while one remains. Build and run strict validation in JSON mode. Correct diagnostics by stable `code`; if a code repeats twice, inspect its node schema again, and stop after three unresolved attempts.

Before update, always diff. Do not use `--force` without explicit authorization. Create and update require explicit user authorization plus `--apply --format json`. After apply, inspect the remote flow; export and validate it only when a protected raw verification artifact is required. Report the chatflow ID, semantic changes, warnings, and manual checks without secrets.

See `references/spec-reference.md` for the contract and `references/troubleshooting.md` for error handling.
