# Spec reference

Required top-level fields are `apiVersion: flowise-agentflow-builder/v1alpha1`, `kind: Agentflow`, `metadata.name`, `spec.nodes`, and `spec.edges`. Unknown fields are errors.

Each node has a unique lowercase `key`, exact catalog `component`, optional `label`, `position` (`auto` or `{x,y}`), and actual `inputs`. Edges reference node keys with `from` and `to`; specify `output` or `input` when a handle is ambiguous. `${node.key.output}`, `${node.key.output.field}`, `${flow.input.question}`, and `${flow.state.key}` are compiled. Put `${credential.alias}` under the credential input name exposed by the catalog (normally `credential`); the alias requires `.flowise-agentflow.credentials.yaml` or `--credentials <path>`. Credential mappings are forbidden in the workflow spec. Environment expressions are disabled.

Use `flowise-agentflow inspect-nodes --component NAME --format json` before choosing fields. FlowData artifacts can contain credential IDs and prompts; store them as sensitive files.
