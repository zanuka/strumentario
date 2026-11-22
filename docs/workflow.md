# Workflow: the handbook you maintain

The primitives (`query`, `validate`, `mutate`) work on one domain, a page with `title`, `slug` and `body`. This page describes the store this repo actually uses: a small handbook of operating notes for the stack, kept through those same tools.

## Which directory is the store

`./.strumentario/data`, the server's default (`STRUMENTARIO_DATA_DIR`; see [CLI guide](cli-guide.md)). One JSON file per page, named for its slug, and committed. The journal beside it (`journal.jsonl`) is git-ignored; the entries that created the first pages are quoted [below](#journal-the-first-pages).

| Slug | What it holds |
| --- | --- |
| `cursor-session-start` | What a Cursor session in this repo loads today (rules, the Hindsight server), and what is pending (stdio registration, #42; the edit skill, #43). |
| `page-edit-loop` | The edit loop: `query`, `validate`, dry-run `mutate`, real `mutate`, `query`. |
| `orto-recall-and-write` | How an Orto recall and a Strumentario write fit in one turn. |

The three demo pages (`getting-started`, `content-primitives`, `local-data-store`) are not in this store. They are fixtures in `packages/server/test-fixtures/demo-pages`, used by the store test and the Inspector walkthrough.

## A page is what you would have typed in chat

When you would otherwise paste "here is how we do X, remember it" into a session, that text is a page: the `title` is what you would call it, the `slug` is its key, and the `body` is the text you would have typed. The difference is that it is stored, checked and attributed instead of retyped:

- `query` reads it back, by `slug` or by `text` search, with its `revision`.
- `validate` checks a draft before anything is stored.
- `mutate` writes it: a dry run by default, `"dryRun": false` to write, `expectedRevision` on update and delete, and an `idempotencyKey` so a retry cannot apply twice.
- Every write is recorded in the [journal](journal.md) with the agent id.

Do not edit the JSON files by hand: that skips validation, the revision check and the journal.

## The round trip

Start the server, then use the CLI as an MCP client (see the [CLI guide](cli-guide.md)):

```bash
pnpm install && pnpm build
pnpm --filter @strumentario/server serve                 # http://localhost:3001/mcp, pages in ./.strumentario/data
export STRUMENTARIO_AGENT=my-session
alias strumentario="node $PWD/packages/cli/dist/main.js"

strumentario call query --json --input '{}'                                   # list the pages
strumentario call query --json --input '{"slug":"page-edit-loop"}'            # read one, note its revision
strumentario call validate --json --input-file draft.json                      # {"instance": {...}}
strumentario call mutate --json --input-file edit.json                         # dry run: nothing written
# set "dryRun": false and an idempotencyKey in edit.json, then run it again
strumentario call query --json --input '{"slug":"page-edit-loop"}'            # confirm; the revision changed
strumentario journal --limit 5 --json                                          # the record of the write
```

`edit.json` for an update is `{"action":"update","slug":"page-edit-loop","page":{...},"expectedRevision":"<from query>","dryRun":false,"idempotencyKey":"<unique>"}`. On a `conflict`, re-read the page and re-apply your edit to it; do not retry with the stale revision.

Commit the changed `.strumentario/data/<slug>.json` with the work that prompted the edit.

## What is not wired yet

Registering Strumentario as a stdio server for the editor (#42) and a skill that limits a session to `query`, `validate` and dry-run `mutate` (#43) have not landed, so a Cursor session reaches the pages through the CLI above, not as native tools. The pages say so; update them when that changes.

## Journal: the first pages

The three pages were created with `mutate` (`"dryRun": false`, agent `fm-issue-44`) after a dry run of each. The journal is git-ignored, so these are its `applied` lines as written. Bodies are not recorded; `payload.hash` is the hash of what was submitted.

```json
{"v":1,"ts":"2026-11-21T20:53:34.657Z","tool":"mutate","action":"create","slug":"cursor-session-start","status":"applied","dryRun":false,"agent":"fm-issue-44","scope":null,"idempotencyKey":"handbook-seed-cursor-session-start","expectedRevision":null,"revisionBefore":null,"revisionAfter":"bbdfe573526e51e9","proposedRevision":null,"errorCode":null,"payload":{"bytes":1277,"hash":"ed754d22478f6999"}}
{"v":1,"ts":"2026-11-21T20:53:35.218Z","tool":"mutate","action":"create","slug":"page-edit-loop","status":"applied","dryRun":false,"agent":"fm-issue-44","scope":null,"idempotencyKey":"handbook-seed-page-edit-loop","expectedRevision":null,"revisionBefore":null,"revisionAfter":"406f336080a290fb","proposedRevision":null,"errorCode":null,"payload":{"bytes":1365,"hash":"9bfd1cbdba84f465"}}
{"v":1,"ts":"2026-11-21T20:53:35.745Z","tool":"mutate","action":"create","slug":"orto-recall-and-write","status":"applied","dryRun":false,"agent":"fm-issue-44","scope":null,"idempotencyKey":"handbook-seed-orto-recall-and-write","expectedRevision":null,"revisionBefore":null,"revisionAfter":"21497c31f745f265","proposedRevision":null,"errorCode":null,"payload":{"bytes":1342,"hash":"081f3db75741211e"}}
```
