# Precise model configuration

Use structural `inspect` to select the current `nN` agent reference. Run:

```sh
flowise-agentflow inspect-agent-model --target-id ID --agent-ref n2 --format json
flowise-agentflow edit-agent-model --target-id ID --agent-ref n2 --if-match-updated-at DATE --set reasoning.enabled=true --set reasoning.effort=high --format json
```

Replace `DATE` with the exact inspection timestamp. Review `data.changes`, then repeat with `--apply` when the user's authorization includes the mutation. No separate diff, export, or raw API call is needed. Preview and no-op also require the timestamp; no-op never writes.

V1 supports only `agentAgentflow` with an existing object model configuration and the `chatOpenAI` component. It intersects a fixed whitelist with live catalog fields, types, options, numeric bounds, and visibility:

- `reasoning.enabled`: strict `true` or `false`, stored as `reasoning`.
- `reasoning.effort`: `low`, `medium`, `high`, or `xhigh` when offered by the live schema, stored as `reasoningEffort`.
- `temperature`: finite number in `[0, 2]`.
- `max-output-tokens`: positive safe integer, stored as `maxTokens`.
- `top-p`: finite number in `[0, 1]`, stored as `topP`.

Use distinct aliases with repeatable `--set key=value`. Effort needs reasoning true in the combined candidate; explicitly set both together if necessary. Disabling reasoning retains stored effort. Existing unrelated values are preserved, including historic numeric strings. Inspection separates explicit stored values from catalog defaults and marks invalid historic values without echoing them. Defaults do not become stored values automatically.

Model/provider names, credentials, endpoints, headers, prompts, tools, and graph structure cannot be changed. Unsupported components are reported safely. There is no unset/reset, model config file, batch, force, offline catalog, or arbitrary path mode.

`MODEL_COMPATIBILITY_UNVERIFIED` means the schema cannot establish runtime model or custom endpoint support. Schema-valid changes are allowed with this warning, without probing the model or asking for extra confirmation solely for the warning. Do not invent a model capability claim.

The editor proves only requested fields changed, rereads and compares the timestamp and complete FlowData immediately before PUT, sends only `{flowData}`, and verifies complete readback equality. Readback returns the persisted timestamp. There remains a client-side race between reread and PUT because Flowise has no atomic precondition here. On `REMOTE_CHANGED`, inspect again and review a fresh preview. On uncertain writes or persistence mismatches, inspect before deciding what to do; never automatically retry or roll back.

Keep reports local: do not copy runtime metadata or configuration into repository artifacts.
