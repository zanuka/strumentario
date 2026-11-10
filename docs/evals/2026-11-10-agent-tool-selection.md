# Agent tool-selection eval — live run pending

**No live model run has happened yet.** This was built without an `ANTHROPIC_API_KEY` or `OPENAI_API_KEY`, so there are no accuracy numbers, no experiment URL and no per-tool results here. The path is implemented and unit tested with the model mocked; those tests prove the wiring, not how well any model chooses.

When a key is available, run it and replace this file with the real results:

```bash
ANTHROPIC_API_KEY=... pnpm eval:agent --summary docs/evals/<date>-agent-tool-selection.md
```

Add `BRAINTRUST_API_KEY` to record the run as an experiment; the summary then links it.

## What it measures

A model is given the tool definitions from a live MCP `tools/list` (never copied by hand) and one prompt at a time (17 prompts in `packages/evals/src/agent-cases.ts`). The report gives tool-choice accuracy per tool (`query`, `validate`, `mutate`, `scaffold`) and the mean of each scorer: `tool_selected`, `tool_choice`, `argument_shape`, `argument_schema_valid`, `output_schema_valid`. The prompts include the near misses that tool descriptions must disambiguate:

- `query` versus `validate`: a stored page versus a draft you supply
- `mutate` dry run versus write: `dryRun: true` versus an explicit save with `dryRun: false`
- `mutate` versus `scaffold`: a page about the client versus generating the client

## Keeping it honest

Changing a tool description, input schema or tool name requires re-running this suite, because `pnpm eval:local` calls tools directly and cannot see whether an agent can still choose them. Record the new run here when the numbers move.
