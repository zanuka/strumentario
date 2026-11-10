# CLI-first usage

Coding agents in a terminal (Claude Code, Codex, Cursor's CLI agent and similar) usually have a bash tool and no MCP configuration. The `strumentario` CLI gives them the same tools over the same server: it is a thin MCP client, so there is no CLI-only API and nothing it can do that `tools/call` cannot. Every command below was run against a locally started server.

## 1. Start the server

```bash
pnpm install && pnpm build
pnpm --filter @strumentario/server serve        # http://localhost:3001/mcp, data in ./.strumentario/data
curl -s http://localhost:3001/healthz            # {"status":"ok"}
```

Use `STRUMENTARIO_DATA_DIR=/some/dir` to keep the pages and the [journal](journal.md) elsewhere, and `PORT` / `HOST` to move or expose it (see [transport and config](server-transport-and-soak.md)).

Put the CLI on your path once:

```bash
alias strumentario="node $PWD/packages/cli/dist/main.js"
```

## 2. Set an agent id

The id is sent as `X-Strumentario-Agent` and recorded on every journal entry, so you can tell agents apart afterwards. It is for attribution, not authentication.

```bash
export STRUMENTARIO_AGENT=agent-a      # or pass --agent agent-a per command
```

Point at another server or token with `STRUMENTARIO_URL` and `STRUMENTARIO_TOKEN` (or `--url`, `--token`). When the server has bearer tokens, a read token is enough for `query`, `validate` and reading resources.

## 3. Call tools with `--json`

Always pass `--json` from an agent's bash tool: only the result goes to stdout (one JSON document), diagnostics go to stderr, and the exit code tells you what happened.

```bash
strumentario tools --json                          # tool names, descriptions and schemas
strumentario call mutate --help                    # one tool's schema

strumentario call validate --json --input '{"instance":{"title":"Getting started","slug":"getting-started","body":"Draft content."}}'
# {"valid":true,"errors":[]}                                                   exit 0

strumentario call mutate --json --input '{"action":"create","slug":"getting-started","page":{"title":"Getting started","slug":"getting-started","body":"Draft content."}}'
# {"ok":true,"action":"create","slug":"getting-started","dryRun":true,"page":{...,"revision":"67223029c6d97f0c"}}   dry run, nothing written

strumentario call mutate --json --input '{"action":"create","slug":"getting-started","page":{"title":"Getting started","slug":"getting-started","body":"Draft content."},"dryRun":false,"idempotencyKey":"create-gs-1"}'
# {"ok":true,...,"dryRun":false,...}                                           written

strumentario call query --json --input '{"slug":"getting-started"}'
# {"ok":true,"page":{...,"revision":"67223029c6d97f0c"}}
```

`mutate` is a dry run unless the input says `"dryRun": false`; `--dry-run` forces a dry run even when it does. For larger inputs use `--input-file page.json`, which avoids shell quoting.

The standard loop for an agent: `validate` the draft, `mutate` as a dry run, `mutate` with `"dryRun": false`, then `query` to confirm. Updates and deletes need the `expectedRevision` from the last `query` (see the [multi-agent guide](multi-agent.md)).

## 4. Resources and the journal

```bash
strumentario resource strumentario://schemas/handbook-page
strumentario resource strumentario://pages/getting-started
strumentario journal --limit 20 --json            # who changed what; pass the printed cursor as --since to tail
```

A missing page is exit `1` with the available slugs in the message.

## 5. Exit codes

| Code | Meaning | What an agent should do |
| --- | --- | --- |
| `0` | Success | Read stdout. |
| `1` | Tool or validation error: `validate` returned `valid: false`, `mutate` returned `ok: false` (for example `conflict`), unknown tool, missing resource | The result is still printed on stdout with the fix (`errors`, `currentPage`, `currentRevision`); fix the input or re-read and retry. |
| `2` | Usage error: unknown command or option, malformed `--input` | Fix the command line; nothing was sent. |
| `3` | Connection or auth error | Start the server (`strumentario serve`) or fix `--url` / `--token`. |

## 6. Many calls at once

`strumentario batch` runs JSON-lines calls over one connection and returns one result line per call, in input order. See [batch](batch.md). Use it for orchestrators; keep dependent calls (create, then update) in a `--concurrency 1` batch.

## 7. No CLI at all

If the host can speak MCP, skip the CLI and use the [host config](../README.md#connect-an-agent-host) instead. The tools are identical.
