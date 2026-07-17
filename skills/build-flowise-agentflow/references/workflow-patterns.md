# Workflow patterns

- Simple agent: Start → Agent → Direct Reply.
- Tool workflow: Start → Tool/Agent configured with catalog-supported tools → Direct Reply.
- Conditional: Start → Condition, then name every dynamic output and connect each branch.
- Human approval: place Human Input before the consequential continuation or final reply.
- RAG: use only retriever/model components present in the target catalog; credentials remain aliases.

Start from the matching file in `examples/`, then replace placeholders using inspected schemas.
