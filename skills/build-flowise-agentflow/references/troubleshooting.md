# Troubleshooting

- `SPEC_*`, `INPUT_UNKNOWN`: fix the YAML path; do not loosen strict parsing.
- `COMPONENT_NOT_FOUND`: inspect the target catalog and select an available Agentflow component.
- `EDGE_HANDLE_AMBIGUOUS`: set the edge's logical `output` or `input` from the listed choices.
- `INPUT_REQUIRED_MISSING`, `NESTED_CONFIG_INVALID`: inspect the selected component and fill visible required fields.
- `CREDENTIAL_ALIAS_UNRESOLVED`: ask for an existing alias mapping; never request the secret itself.
- `REMOTE_UNAUTHENTICATED` / `REMOTE_FORBIDDEN`: distinguish missing login from missing management permission.
- `REMOTE_CHANGED`: re-fetch and diff; use `--force` only after explicit authorization.
- `REMOTE_WRITE_UNCERTAIN`: inspect by name/time before retrying; never automatically repeat the write.
