# Precise model configuration

Use structural `inspect` to select the current `nN` agent reference. Run:

```sh
flowise-agentflow inspect-agent-model --target-id ID --agent-ref n2 --format json
flowise-agentflow edit-agent-model --target-id ID --agent-ref n2 --if-match-updated-at DATE --set reasoning.enabled=true --set reasoning.effort=high --format json
```

Replace `DATE` with the exact inspection timestamp. Review `data.changes`, then repeat with `--apply` when the user's authorization includes the mutation. No separate diff, export, or raw API call is needed. Preview and no-op also require the timestamp; no-op never writes.

Supported components are `chatOpenAI` and `chatOpenAICustom` on `agentAgentflow` with an existing object model configuration. For ordinary `chatOpenAI`, the editor intersects a fixed whitelist with live catalog fields, types, options, numeric bounds, and visibility:

- `reasoning.enabled`: strict `true` or `false`, stored as `reasoning`.
- `reasoning.effort`: `low`, `medium`, `high`, or `xhigh` when offered by the live schema, stored as `reasoningEffort`.
- `temperature`: finite number in `[0, 2]`.
- `max-output-tokens`: positive safe integer, stored as `maxTokens`.
- `top-p`: finite number in `[0, 1]`, stored as `topP`.

For `chatOpenAICustom`, required `modelName` is a nonblank string. Optional form fields are `temperature`, `streaming`, `reasoningEffort`, `maxTokens`, `topP`, `frequencyPenalty`, `presencePenalty`, `timeout`, `basepath`, and `baseOptions`, intersected with the live catalog. Custom numeric fields accept finite numbers within catalog bounds without ordinary OpenAI range or integer restrictions. Custom effort accepts `none`, `minimal`, `low`, `medium`, `high`, `xhigh`, or `max` when offered by the catalog, with no reasoning enable dependency. Custom has no `reasoning.enabled`. The `cache` connection anchor and credentials are excluded.

Use native names or the aliases above. Provide at least one repeatable operation: `--set key=value`, `--set-env key=ENV_NAME`, `--set-file key=PATH` (UTF8 contents), or `--unset key`. All input sources use the same typed parsing. Duplicate canonical fields across aliases or operations fail. Unset removes optional fields, never writes defaults, and cannot remove required `modelName`. `baseOptions` requires a JSON object, replaces the entire object, and is stored as serialized JSON form text. Use environment or protected files for sensitive values; errors never echo values, source names, paths, or file contents. There is no whole config-file mode or arbitrary configuration path support.

Ordinary OpenAI effort needs reasoning true in the combined candidate; set both together if necessary. Disabling reasoning retains stored effort. Existing unrelated values are preserved, including historic numeric strings. Inspection provides native field names, accepted aliases, optional status, stored states and catalog defaults. All free text and JSON stored/default/change values are redacted, and invalid historic values are marked without echoing them. Defaults do not become stored values automatically.

For Custom, model names, endpoints and request options/headers can be edited through their allowed fields. Credentials, prompts, tools and graph structure cannot be changed. Unsupported components are reported safely. There is no batch, force, offline catalog, or arbitrary path mode.

`MODEL_COMPATIBILITY_UNVERIFIED` means the schema cannot establish runtime model or custom endpoint support. Schema-valid changes are allowed with this warning, without probing the model or asking for extra confirmation solely for the warning. Do not invent a model capability claim.

The editor proves only requested fields changed, rereads and compares the timestamp and complete FlowData immediately before PUT, sends only `{flowData}`, and verifies complete readback equality. Readback returns the persisted timestamp. There remains a client-side race between reread and PUT because Flowise has no atomic precondition here. On `REMOTE_CHANGED`, inspect again and review a fresh preview. On uncertain writes or persistence mismatches, inspect before deciding what to do; never automatically retry or roll back.

Keep reports local: do not copy runtime metadata or configuration into repository artifacts.
