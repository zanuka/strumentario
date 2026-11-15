# Stack seams: Nocciolo, Strumentario, Maglio

Strumentario sits in the middle of a three-layer stack. Each layer is a separate project that works alone; the seams below are the only places they touch.

```text
Nocciolo (knowledge)  ──recall──▶  agent  ──tools/call──▶  Strumentario (instruments)  ◀──tools/call, headless──  Maglio (factory)
 durable project context            reads context, decides   query · validate · mutate · scaffold + journal         overnight / assembly-line jobs
```

| Layer | Owns | Does not own |
| --- | --- | --- |
| **Nocciolo** | Durable project knowledge and recall (the memory bank, for example Hindsight). | Content mutation, validation, factories. |
| **Strumentario** | The instruments: typed `query` / `validate` / `mutate` / `scaffold`, the page store, the change journal, evals of those tools. | Memory, orchestration, scheduling, agent runtime. |
| **Maglio** | Factory runs: which stage runs when, retries, overnight assembly. | The content primitives themselves. |

## Nocciolo ↔ Strumentario: recall, then instrument

Nocciolo supplies *what is true and why* (standards, decisions, domain invariants). Strumentario supplies *what you can do about content*. The seam is the agent: it recalls from Nocciolo through that project's own MCP tools, then calls Strumentario's tools with the result. There is no code dependency in either direction. Strumentario never reads Nocciolo's store and Nocciolo never calls Strumentario. Putting both servers in one host config is the integration; the `review-draft` prompt and `validate` are where recalled standards get checked against the schema. Setup of the memory bank: [nocciolo-brain-details](../nocciolo-brain-details.md).

## Strumentario ↔ Maglio: the headless contract

A factory stage can rely on the following. It needs no UI, no session and no LLM in the loop.

**Transport and identity**

- Streamable HTTP at `http://<host>:<port>/mcp` (default `http://127.0.0.1:3001/mcp`), stateless, liveness at `GET /healthz`. Or `serve --stdio` for a stage that spawns the server.
- `X-Strumentario-Agent: <stage-id>` (`--agent`, `STRUMENTARIO_AGENT` over stdio) for attribution. Use `MCP_READ_TOKEN` / `MCP_WRITE_TOKEN` to give read-only stages read-only access.

**Tools** (exact names; shapes from `tools/list`, stable enough for the golden evals)

| Tool | Stage use | Side effect |
| --- | --- | --- |
| `query` | Read a page by `slug` or list pages; take `revision` from it. | none |
| `validate` | Gate a draft before writing. Result `{valid, errors[]}`. | none |
| `mutate` | `create` / `update` / `delete`. **Dry run by default**; send `"dryRun": false` to write. Send `expectedRevision` on update/delete and an `idempotencyKey` on every write so a retried stage cannot double-apply. | writes the store, appends the journal |
| `scaffold` | Typed client or host config from the schema. Returns files in memory; writes only with `write: true` and `outDir`. | files under `STRUMENTARIO_SCAFFOLD_ROOT` when asked |
| `repair` | Fix scaffold files that fail `tsc` or schema checks, within `maxRounds` (default 3) and stopping early when errors stop shrinking. Returns the corrected files and the rounds report. | none |

**Resources**: `strumentario://journal` (append-only record of every `mutate`; `?since=<cursor>&limit=<n>`, tail by passing the last `cursor`), `strumentario://pages/{slug}`, `strumentario://schemas/handbook-page`. The journal format is the contract: [journal](../journal.md).

**Results a stage branches on.** `mutate` returns `{ok: false, error: {code}}` with `code` one of `invalid`, `not_found`, `already_exists`, `revision_required`, `conflict`, `idempotency_mismatch`, `store_error`. `conflict` and `already_exists` carry `currentPage` / `currentRevision` to retry from. A replayed idempotency key returns the first result with `"replayed": true`.

**Exit codes of the CLI** (`strumentario call|batch|resource|journal`; same codes in [CLI guide](../cli-guide.md)): `0` success, `1` tool or validation error (result still on stdout), `2` usage error, `3` connection or auth error. A stage should treat `3` as retryable and `1` as a decision for the stage, not a transport failure.

**Many calls per stage**: `strumentario batch` (JSON lines in, `{id, ok, result|error}` lines out, input order) over one connection. See [batch](../batch.md).

What Maglio should not expect: Strumentario will not schedule, queue, retry or order work across stages. Coordination is revision checks and idempotency keys; ordering is the factory's job. See [multi-agent](../multi-agent.md).

## Other CLIs: Riparo

Other command-line tools in this ecosystem, such as Riparo, follow the same habit: a dry-run first, then a verify step before anything is trusted. That is a shared convention, not a shared dependency. They are separate tools with their own repos and contracts; Strumentario does not call them, wrap them or ship them, and nothing here depends on them.
