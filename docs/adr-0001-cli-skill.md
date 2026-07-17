# ADR 0001: standalone CLI and Codex Skill

Status: accepted. Baseline: Flowise `83f2947df934d3fa1032def302f0c8c706db8fe3`.

The executable is the sole deterministic execution layer. It compiles a strict, versioned YAML/JSON intent spec against a live or frozen node catalog, validates the resulting ReactFlow graph, and owns all API calls. The Skill only guides requirement extraction and safe CLI use. No browser automation, MCP server, AI generator dependency, or private Flowise imports are used.

The compatibility layer mirrors the minimum observable behavior of `nodeFactory.ts`, `dynamicOutputAnchors.ts`, `fieldVisibility.ts`, and `flowValidation.ts`. Contract fixtures and the catalog hash expose upstream drift.
