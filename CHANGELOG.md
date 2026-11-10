# Changelog

## Unreleased

- `repair` tool (Phase 4): feeds `tsc` and schema-validation errors from scaffold output back into a bounded repair loop (default 3 rounds, early stop when the error count does not shrink) and returns the corrected files, rounds used, error counts per round and any remaining errors. Read-only annotations, so a read token may call it. The default path is deterministic; an optional model fixer sits behind `STRUMENTARIO_REPAIR_MODEL`.
- Evals: six `repair` golden cases, the `repair_converged` scorer, and two agent tool-selection prompts for `repair`. Because `repair` is a new tool, the generated client and host config now include it.

## v0.1.0 (upcoming; the maintainer tags after merge)

"Agents can call my content instruments." Phase 1 and the Phase 2 local eval harness.

### Server and tools

- Streamable HTTP MCP server (stateless, `GET /healthz`) with `query`, `validate`, `mutate` and `scaffold`, all generated from one domain schema.
- `mutate` is dry-run by default, guarded by `expectedRevision` and made retry-safe by `idempotencyKey`.
- Resources: `strumentario://schemas/handbook-page`, `strumentario://pages/{slug}`, and the append-only change journal `strumentario://journal`. Prompt: `review-draft`.
- stdio transport (`serve --stdio`) with a shared data directory across processes.
- Separate read and write bearer tokens (`MCP_READ_TOKEN`, `MCP_WRITE_TOKEN`; `MCP_AUTH_TOKEN` still works as a write token).

### CLI

- `strumentario` thin MCP client: `serve`, `tools`, `call`, `resource`, `journal`, `batch`; `--json`, `--agent`, `--dry-run`; exit codes `0`/`1`/`2`/`3`.

### Evals

- Golden dataset, code scorers and an offline harness (`pnpm eval:local`); Braintrust experiment path behind `BRAINTRUST_API_KEY`; CI workflow. See [docs/evals](docs/evals/2026-11-08-baseline.md).
- Agent tool-selection eval (`pnpm eval:agent`): 17 prompts, tool definitions read from a live `tools/list`, scored per tool; skips without a model key. See [docs/evals](docs/evals/2026-11-10-agent-tool-selection.md).

### Docs

- Host config for Claude Code, Cursor and generic hosts; Inspector walkthrough with screenshot; [CLI guide](docs/cli-guide.md); [multi-agent guide](docs/multi-agent.md); [stack seams](docs/architecture/stack-seams.md).

### Host verification (2026-11-10)

Run against a local server with project-scoped or temporary config only.

| Host | Result |
| --- | --- |
| Claude Code 2.1.322, HTTP (`claude mcp add --transport http`, project scope) | Listed 4 tools, called `query`, read `strumentario://schemas/handbook-page`. |
| Claude Code, stdio entry | Called `query`, read `strumentario://journal`; the call was attributed to `STRUMENTARIO_AGENT`. |
| Cursor CLI agent 2026.08.11 (`.cursor/mcp.json`) | Server approved and `list-tools` showed the 4 tools. Calling a tool and reading a resource could not be verified: the agent requires a Cursor login that was not available. |
| MCP Inspector 2.13.0 | Connected over Streamable HTTP, listed tools, ran `validate`. |

### Known issues

- Inspector 2.13 reports "Schema portability: 1 warning" on `validate` (`inputSchema.properties.instance`) and `mutate`: the `instance` / `page` input is declared without a type, so the schema accepts any value. Calls work, and the server validates the content itself; declaring it as an object schema is a follow-up (a tool-contract change that needs eval updates).
- Claude Code: `claude mcp add` takes `--header` as a multi-value flag, so put the name and URL before it.
- Cursor: a project `.cursor/mcp.json` server must be approved once (`cursor-agent mcp enable strumentario`, or in the app) before it loads.
- The `scaffold` `host-config` target emits HTTP entries only; a stdio entry is documented in [server transport](docs/server-transport-and-soak.md#stdio-transport).
