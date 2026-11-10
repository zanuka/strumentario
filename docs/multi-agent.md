# Several agents, one store

People run more than one coding agent at once: two terminals, a Cursor window and a Claude Code session, or a factory stage next to a human. Strumentario is a shared tool layer for them. It is not an orchestrator. Every command below was run against a local server.

## What you get

| Need | Mechanism |
| --- | --- |
| Many agents call the server at once | Stateless Streamable HTTP: each `POST /mcp` is independent, any instance can serve any request, nothing to clean up. See the [decision](server-transport-and-soak.md#decision-stateless-by-default). |
| One agent must not overwrite another's edit | `expectedRevision` on `mutate` update and delete. |
| A retry must not double-apply | `idempotencyKey` on `mutate`. |
| Know who changed what | `X-Strumentario-Agent` (`--agent`) plus the [change journal](journal.md). |
| Agents with different trust | Read and write [token scopes](server-transport-and-soak.md#token-scopes) (HTTP). |
| Hosts that spawn their own server process | stdio: many processes can share one data directory; writes to a slug are serialized across them. |

## Revision checks (`expectedRevision`)

Every page carries a `revision`, a content hash. `query` returns it; an update or delete must send it back. If the page changed in between, nothing is written and the call returns `conflict` with the current page to retry from.

```bash
# both agents read revision 482f3e0b028e7559
strumentario --agent agent-a call mutate --json --input '{"action":"update","slug":"second","page":{"title":"Second","slug":"second","body":"A."},"expectedRevision":"482f3e0b028e7559","dryRun":false}'
# {"ok":true,...,"page":{...,"revision":"977dcc8c6a257088"},"previous":{...}}                 exit 0

strumentario --agent agent-b call mutate --json --input '{"action":"update","slug":"second","page":{"title":"Second","slug":"second","body":"B."},"expectedRevision":"482f3e0b028e7559","dryRun":false}'
# {"ok":false,...,"error":{"code":"conflict","currentRevision":"977dcc8c6a257088","currentPage":{...}}}   exit 1
```

On `conflict` the agent re-reads `currentPage`, merges its change, and retries with `currentRevision`. Updates and deletes without `expectedRevision` are refused (`revision_required`) unless `overwrite: true`, which is the explicit last-writer-wins escape hatch.

## Retries (`idempotencyKey`)

Pick a key per logical change. Replaying the same key with the same input returns the original result with `"replayed": true` and writes nothing; the same key with different input is `idempotency_mismatch`.

```bash
strumentario call mutate --json --input '{"action":"create","slug":"getting-started","page":{...},"dryRun":false,"idempotencyKey":"create-gs-1"}'   # applied
strumentario call mutate --json --input '<same input>'                                                                                             # {"...","replayed":true}
```

## Reading the journal

```bash
strumentario journal --limit 20 --json
strumentario journal --since 1075 --json          # only entries after a previous cursor
```

Entries carry `agent`, `action`, `slug`, `status` (`applied`, `dry_run`, `replayed`, `conflict`, `rejected`), `revisionBefore` / `revisionAfter` and the `idempotencyKey`, never page bodies. The losing `agent-b` call above is an entry with `status: "conflict"`. Over MCP it is the resource `strumentario://journal`. Field reference: [journal](journal.md).

## Soak and concurrency evidence

- Server soak (`packages/server/src/soak.ts`, recorded 2026-10-31): 10, 30 and 100 concurrent clients with 50 calls each, 0 failed calls, p95 12.6 / 22.7 / 36.4 ms. Table in [server transport and soak](server-transport-and-soak.md#soak-test).
- Concurrent writers: `stdio.test.ts` runs 10 server processes on one data directory and checks revision and idempotency behaviour; the golden eval cases cover the concurrency scorer (`pnpm eval:local`).

## What this repo does not do

- **No orchestration or scheduling.** Strumentario does not assign work, queue tasks, retry on your behalf or decide which agent runs. That belongs to your orchestrator, or to Maglio factories.
- **No locks held across calls.** A writer lock lives only for the duration of one `mutate`. Coordination across calls is optimistic: revisions.
- **No per-agent authentication.** The agent id is attribution only; scopes are two fixed levels, not multi-tenant auth.
- **No sessions.** Do not rely on server-side state between calls.
