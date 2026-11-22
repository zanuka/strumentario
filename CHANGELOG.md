# Changelog

## Unreleased

- The default store (`./.strumentario/data`) now holds a handbook of operating notes created through `mutate`: `cursor-session-start`, `page-edit-loop`, `orto-recall-and-write`. The three demo pages moved to `packages/server/test-fixtures/demo-pages`, which the store test and the Inspector walkthrough use. New guide: [the handbook you maintain](docs/workflow.md), with the journal entries of the first writes.
- Host registration over stdio: opening this repo in Claude Code (`.mcp.json`), Cursor (`.cursor/mcp.json`, beside `hindsight`) or Codex (`.codex/config.toml`) registers a `strumentario` stdio server with no process to start. Each entry runs the new `scripts/mcp-stdio.mjs` launcher (which tells you to run `pnpm install && pnpm build` on an unbuilt checkout), sets `STRUMENTARIO_DATA_DIR` and a distinct `STRUMENTARIO_AGENT` (`claude-code`, `cursor`, `codex`) so the journal shows the host. README and the stdio section of the transport doc cover the three hosts and when to use stdio or HTTP; the HTTP examples now register under `strumentario-http` so they do not collide with the checked-in entry. Not verified: Cursor in a cold window, Claude Code's first-run approval prompt.
- `@strumentario/widget`: the one `<strumentario-page-widget>` is now exercised from Vue 3 and Svelte 5. The widget behavior test is a shared suite (`src/widget-behavior.ts`) that runs unchanged against the element mounted plain, from a Vue fixture and from a Svelte fixture (test fixtures under `packages/widget/fixtures`, not published). Added types-only entries `@strumentario/widget/vue` and `@strumentario/widget/svelte`, built from the generated `ToolCaller`, and `pnpm typecheck` now type-checks both fixtures. The element adopts a `caller` set before it was registered, which happens when the module is imported client-side after the framework has rendered the tag. New guide: [Use the widget from a framework](docs/widget/frameworks.md) (Vue, Svelte, React 19, plain HTML, and the steps for checking another framework). Not verified: Nuxt, SvelteKit, React fixtures, real browsers for the Vue and Svelte fixtures, an MCP Apps host.
- Renamed the Nocciolo project reference to Orto (https://github.com/zanuka/orto): `.nocciolo/` is now `.orto/`, `docs/nocciolo-brain-details.md` is now `docs/orto-brain-details.md`, the CLI is `orto` and the API key variable is `ORTO_HINDSIGHT_API_KEY`. Docs and config only.

- `repair` tool (Phase 4): feeds `tsc` and schema-validation errors from scaffold output back into a bounded repair loop (default 3 rounds, early stop when the error count does not shrink) and returns the corrected files, rounds used, error counts per round and any remaining errors. Read-only annotations, so a read token may call it. The default path is deterministic; an optional model fixer sits behind `STRUMENTARIO_REPAIR_MODEL`.
- Evals: six `repair` golden cases, the `repair_converged` scorer, and two agent tool-selection prompts for `repair`. Because `repair` is a new tool, the generated client and host config now include it.
- `@strumentario/ai-sdk`: Vercel AI SDK product path. Connects to the server as an MCP client, exposes the tools it publishes to `streamText`, and ships a runnable query, validate, mutate (dry run by default) example. Optional provider keys; the server and CLI do not depend on it.
- `@strumentario/widget`: MCP App widget as a vanilla web component (`<strumentario-page-widget>`, no framework dependency) over `query`, `validate` and `mutate` (list, edit with live validation, dry-run preview, save). Prop types and the editable field list are generated from the server's tool contracts with a drift test; the controller is framework-neutral and the element is a thin renderer over it. Exercised in a local harness (`pnpm --filter @strumentario/widget harness`), not yet in an MCP Apps host. See [docs/widget](docs/widget/README.md).

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
