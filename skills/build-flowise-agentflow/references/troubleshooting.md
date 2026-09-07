# Troubleshooting

- `SPEC_*`, `INPUT_UNKNOWN`: fix the YAML path; do not loosen strict parsing.
- `COMPONENT_NOT_FOUND`: inspect the target catalog and select an available Agentflow component.
- `EDGE_HANDLE_AMBIGUOUS`: set the edge's logical `output` or `input` from the listed choices.
- `INPUT_REQUIRED_MISSING`, `NESTED_CONFIG_INVALID`: inspect the selected component and fill visible required fields.
- `CREDENTIAL_ALIAS_UNRESOLVED`: ask for an existing alias mapping; never request the secret itself.
- `REMOTE_UNAUTHENTICATED` / `REMOTE_FORBIDDEN`: distinguish missing login from missing management permission.
- `REMOTE_FLOW_DATA_INVALID`: list may warn for one malformed Agentflow; inspect cannot continue until that target is repaired.
- `TARGET_NOT_AGENTFLOW`: select an ID returned by `flowise-agentflow list`, not a Chatflow ID.
- `MCP_REF_INVALID`: rerun `inspect-agent-mcp` and select one of its current `mN` references; V1 cannot add a missing Custom MCP.
- `MCP_CONFIG_INVALID`: provide readable UTF-8 strict JSON object text; keep endpoints, commands, headers, and credentials out of reports.
- `MCP_ACTION_DISCOVERY_FAILED`: verify the stored configuration and Flowise-side MCP availability without exposing configuration or action descriptions.
- `MCP_ACTION_SELECTION_INVALID`: select only names returned by the same discovery and do not combine `--enable-all` with `--enable-action`.
- `MCP_TARGET_DENIED_BY_POLICY`: do not attempt to bypass Flowise target or network policy; ask the Flowise administrator to review the target through an approved process.
- `NAME_INVALID`: provide a name containing at least one non-whitespace character; rename preserves the name exactly.
- `REMOTE_CHANGED`: re-fetch and review the intended change. Rename checks any supplied timestamp exactly (a missing remote timestamp fails) and checks type/name/timestamp again before PUT; it has no `--force` option. For full update, diff again and use `--force` only after explicit authorization.
- `REMOTE_PERSISTENCE_MISMATCH`: readback did not match the requested change. For rename, inspect the target ID, type, and name before deciding how to proceed; never automatically repeat the write.
- `REMOTE_WRITE_UNCERTAIN`: inspect by name/time before retrying; never automatically repeat the write.
