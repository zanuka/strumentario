# Change journal

The journal answers "who changed what, and when" for a Strumentario store. Every `mutate` call appends one JSON line describing its outcome. It is a record for an external reader (an orchestrator, a factory such as Maglio, or the cantiere dashboard); Strumentario does not orchestrate, it supplies the evidence.

- **Append-only.** There is no tool to edit or delete entries, and the journal is a resource, not a tool.
- **No bodies, no secrets.** Entries carry hashes and sizes of what was submitted, never page titles or bodies.
- **Local.** One file, `journal.jsonl`, in the data directory (`STRUMENTARIO_DATA_DIR`, default `./.strumentario/data`), next to the pages. The default data directory's journal is git-ignored.

## File format

JSON Lines: one object per line, UTF-8, each line ending in `\n`. Lines are written with a single append, queued per file within a process and appended with `O_APPEND`, so concurrent writers do not interleave or truncate lines. Entry lines are well under 4 KB: `slug`, `agent` and `idempotencyKey` are truncated at 200 characters.

```json
{"v":1,"ts":"2026-11-08T11:02:51.123Z","tool":"mutate","action":"update","slug":"getting-started","status":"applied","dryRun":false,"agent":"agent-a","idempotencyKey":"k-1","expectedRevision":"3f2a9c1d5e7b8a40","revisionBefore":"3f2a9c1d5e7b8a40","revisionAfter":"9b1e0c44d2a7f653","proposedRevision":null,"errorCode":null,"payload":{"bytes":212,"hash":"c04be9a1d77e3f08"}}
```

| Field | Type | Meaning |
| --- | --- | --- |
| `v` | `1` | Format version. A reader should skip lines with a version it does not know. |
| `ts` | string | ISO 8601 UTC time the outcome was recorded. |
| `tool` | `"mutate"` | The tool called. Only `mutate` is journaled; reads are not. |
| `action` | `create` \| `update` \| `delete` | The requested action. |
| `slug` | string | The page the call targeted (the domain's key field). |
| `status` | see below | The outcome. |
| `dryRun` | boolean | True when nothing was written because the call was a dry run (the default). |
| `agent` | string \| null | Value of the `X-Strumentario-Agent` header (`strumentario --agent <id>`); `null` when the caller sent none. |
| `idempotencyKey` | string \| null | The key the caller passed, if any. |
| `expectedRevision` | string \| null | The `expectedRevision` the caller passed, if any. |
| `revisionBefore` | string \| null | Revision of the page before the call. `null` when the page did not exist, and for a `replayed` entry (a replay does not read the store). |
| `revisionAfter` | string \| null | Revision after the call. Equal to `revisionBefore` unless the call applied a change; `null` after a delete and for a replay. |
| `proposedRevision` | string \| null | Dry runs only: the revision the page would have had, which a real write of the same input produces. |
| `errorCode` | string \| null | The `mutate` error code for `conflict` and `rejected`: `invalid`, `not_found`, `already_exists`, `revision_required`, `conflict`, `idempotency_mismatch`, `store_error`. |
| `payload` | `{bytes, hash}` \| null | Size in bytes and content hash (first 16 hex characters of SHA-256, like revisions) of the submitted page as JSON. `null` for delete or when no page was sent. |

### Status

| `status` | Meaning |
| --- | --- |
| `applied` | A real write succeeded (`dryRun: false`). |
| `dry_run` | The call was valid and would have succeeded; nothing was written. |
| `replayed` | An `idempotencyKey` replay returned the earlier result; nothing was written again. |
| `conflict` | `expectedRevision` was stale (`errorCode: "conflict"`). `revisionBefore` is the current revision. |
| `rejected` | Any other refusal: see `errorCode`. |

Ordering: a real write is journaled while the page's writer lock is held, so entries for one slug appear in the order the changes were applied, and each `applied` entry's `revisionBefore` equals the previous `applied` entry's `revisionAfter`. Entries for different slugs have no defined relative order beyond append order.

The JSON Schema of an entry is generated from the domain definition (`journalContract.entrySchema` in `@strumentario/server`, see [schema generation](architecture/schema-generation.md)), so it cannot drift from the code.

## Reading the journal

Resource `strumentario://journal`, over MCP `resources/read`, JSON result:

```json
{ "entries": [ /* oldest first */ ], "cursor": "1834", "skipped": 0 }
```

| Parameter | Meaning |
| --- | --- |
| `limit` | Maximum entries to return, 1 to 1000 (default 100). |
| `since` | The `cursor` from the previous read. Omit to start from the beginning. |

Query parameters are `?since=<cursor>&limit=<n>`, or either one alone, or `?limit=<n>&since=<cursor>`; any other order or extra parameter is not served.

A cursor is the byte offset just after the last line returned, so reading from a cursor is a seek, not a scan. Treat it as opaque. To tail the journal, call with `since` set to the last `cursor`; when `entries` comes back empty you are caught up and `cursor` is unchanged. Only complete lines are returned, so a line still being written shows up on the next read.

- `skipped` counts corrupt lines passed over (for example one torn by a crash). They are never returned as entries.
- A cursor that is not a line boundary, or lies past the end of the file (the journal was truncated or replaced), is an `InvalidParams` error with the fix in the message; read again without `since`.
- Reading before any `mutate` call returns `{ "entries": [], "cursor": "0", "skipped": 0 }`.
- A server whose store has no data directory (a custom store in embedding code) reports that it keeps no journal.

From the CLI:

```bash
strumentario journal --limit 20
strumentario journal --since 1834 --json
```

Reading `journal.jsonl` directly also works for a process on the same machine; the line format above is the contract.

## Failure behaviour

The journal is written after the outcome is decided. If the append fails (disk full, permissions), the `mutate` result is unchanged, because the page change cannot be rolled back, and the server logs an actionable message to stderr (`Strumentario could not write the change journal: ...`). Embedders can intercept this through `onJournalError` in `mutatePage` options.

## Scope

Not in the journal: reads (`query`, `validate`), page content, request headers other than the agent identity, and any rotation or retention policy. A consumer that wants retention can copy and truncate on its own schedule; a truncation is detected by the past-the-end cursor error.
