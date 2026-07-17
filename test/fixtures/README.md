# Contract fixture provenance

The minimized node catalog in `catalog.ts` / `catalog.json` is derived from Flowise commit `83f2947df934d3fa1032def302f0c8c706db8fe3`:

- `packages/agentflow/src/core/utils/nodeFactory.ts`
- `packages/agentflow/src/core/utils/dynamicOutputAnchors.ts`
- `packages/agentflow/src/core/validation/flowValidation.ts`
- `packages/server/marketplaces/agentflowsv2/Workplace Chat.json`
- `packages/server/marketplaces/agentflowsv2/Human In The Loop.json`

Only fields needed to lock initialization, dynamic anchors, validation, and edge compatibility are retained. Credentials, model selections, URLs, prompts, icons, authors, and server file paths are omitted. Update fixtures deliberately when the catalog contract changes; never regenerate them silently.
