# Workflow patterns

- Simple agent: Start → Agent → Direct Reply.
- Tool workflow: Start → Tool/Agent configured with catalog-supported tools → Direct Reply.
- Conditional: Start → Condition, then name every dynamic output and connect each branch.
- Human approval: place Human Input before the consequential continuation or final reply.
- RAG: use only retriever/model components present in the target catalog; credentials remain aliases.

Start from the matching file in `examples/`, then replace placeholders using inspected schemas.


## Rename an existing workflow

Use the target ID returned by `list`; `inspect` supplies an optional exact `updatedDate` match. No spec or catalog is required.

```sh
flowise-agentflow rename --target-id ID --name "Renamed workflow" --format json
flowise-agentflow rename --target-id ID --name "Renamed workflow" --if-match-updated-at DATE --apply --format json
```

The first command previews the old/new names. Run the second only within the user's authorized scope; omit the timestamp option if no inspected timestamp is available. Supplied timestamps must match even when the name is unchanged. Apply rereads metadata, sends only the name, and verifies persistence. The client-side reread cannot prevent a concurrent change between GET and PUT. Inspect after an uncertain write before deciding whether another attempt is needed. Keep runtime reports outside repository artifacts.
