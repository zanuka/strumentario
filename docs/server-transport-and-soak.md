# Server transport, configuration and soak results

## Configuration

| Variable | Default | Meaning |
| --- | --- | --- |
| `PORT` | `3001` | Listen port. `env.example`, the README and `packages/server/src/config.ts` all use this default. |
| `HOST` | `127.0.0.1` | Bind address. Loopback by default; set `0.0.0.0` only behind a network boundary you control. |
| `MCP_TRANSPORT` | `http` | `http` (Streamable HTTP, the primary path) or `stdio`. `serve --stdio` / `strumentario serve --stdio` is the same as `MCP_TRANSPORT=stdio`. Any other value is a configuration error. |
| `STRUMENTARIO_AGENT` | unset | Agent name attributed to calls in stdio mode, where there are no request headers. Ignored over HTTP, which uses `X-Strumentario-Agent`. |
| `MCP_AUTH_TOKEN` | unset | Optional shared secret. When set, `/mcp` requires `Authorization: Bearer <token>` and answers `401` otherwise. It acts as a write token (see [Token scopes](#token-scopes)), so a single configured token behaves as before. Unset (with the two below also unset) means no auth. `/healthz` is never gated. |
| `MCP_READ_TOKEN` | unset | Optional bearer secret limited to the read scope. |
| `MCP_WRITE_TOKEN` | unset | Optional bearer secret with the write scope. Equivalent to `MCP_AUTH_TOKEN`; set either or both. |

`PORT`, `HOST` and the three tokens apply to HTTP only; stdio opens no port and needs no token.

## Token scopes

Auth is on as soon as any of the three tokens is set; a request whose bearer matches none of them gets `401`. A matching token grants one of two fixed scopes. This is deliberately not multi-tenant auth: there are no per-agent or per-task tokens.

| Scope | Token | May |
| --- | --- | --- |
| `read` | `MCP_READ_TOKEN` | Call tools annotated `readOnlyHint: true` (`query`, `validate`); list and read resources (pages, the page schema, the change journal). |
| `write` | `MCP_WRITE_TOKEN`, `MCP_AUTH_TOKEN` | Everything a read token can, plus every other tool (`mutate`, `scaffold`). |

**Which tools are writes is decided by the tool's own annotations, not a hand-kept list.** A tool needs the read scope only if it declares `readOnlyHint: true`; anything else, including a tool with no hint, needs the write scope. The check wraps every tool registered on the server (`createMcpServer` in `packages/server/src/server.ts`), so a new tool with `readOnlyHint: false` is write-only automatically (`scopes.test.ts` registers one and proves it). Today that makes `mutate` and `scaffold` writes. `scaffold` is annotated `readOnlyHint: false` because it can write files, so a read token is refused on it entirely, including previews with `write: false`, not only `write: true`; this is the safe default and keeps the rule one annotation deep.

A refused call returns a tool result with `isError: true` and a message such as `Forbidden: tool "mutate" needs the write scope, but this bearer token has the read scope only. Send the server's MCP_WRITE_TOKEN (or MCP_AUTH_TOKEN) as the bearer token ...`. Nothing is written and nothing is journaled for a refused call. Token values are never logged, echoed in errors, or stored; the scope is recorded in change journal entries as `scope` (see [journal.md](journal.md)). `scaffold` host-config output still refers to the token by environment variable name (`MCP_AUTH_TOKEN`), never by value; point that variable at the read or write token the agent should use.

**stdio does not use token scopes.** The host spawns the process and owns its stdin, so there is no bearer token to check and every tool is available; tokens are ignored and journal entries from stdio record `scope: null`. To give an agent read-only access, use the HTTP transport with a read token.

## stdio transport

Terminal coding agents usually start MCP servers as child processes. `node packages/server/dist/serve.js --stdio` (after `pnpm build`) serves the same `createMcpServer()` tools and resources over stdin/stdout. It is an additional entry point, not a fork: HTTP behaviour is unchanged.

- **stdout carries only protocol messages.** The startup line, signal notices and errors go to stderr. Do not write to stdout in code that runs in this mode.
- The process serves until the host closes stdin, or it receives `SIGINT`/`SIGTERM`, then exits `0`.
- **One data directory, many processes.** Every host that spawns the server gets its own process; they share `STRUMENTARIO_DATA_DIR`. Writes to a slug are serialized across processes by a lock directory under `<data dir>/.locks/` (a holder that crashed is reclaimed after 30 s), so revision checks (`expectedRevision`) and idempotency keys (`idempotencyKey`) behave as they do with one process, and journal appends use `O_APPEND`. `stdio.test.ts` checks this with 10 processes.
- Set `STRUMENTARIO_AGENT` per host so the journal attributes changes.

This repo registers the server for three hosts at project scope, so opening it in Claude Code, Cursor or Codex lists `query`, `validate`, `mutate`, `scaffold` and `repair` with no process to start. Run `pnpm install && pnpm build` once. Every entry runs `scripts/mcp-stdio.mjs`, a small launcher that checks `packages/server/dist/serve.js` exists, exits with `Run pnpm install && pnpm build` when it does not, and otherwise starts the server with `--stdio`. Each entry sets `STRUMENTARIO_DATA_DIR` to `.strumentario/data` and a distinct `STRUMENTARIO_AGENT`, so `strumentario journal` shows which host made each change.

| Host | File | Server command | Agent | How the repo root is found |
| --- | --- | --- | --- | --- |
| Claude Code | `.mcp.json` | `node scripts/mcp-stdio.mjs` | `claude-code` | Project servers start in the project root; `${CLAUDE_PROJECT_DIR:-.}` builds the data path. |
| Cursor | `.cursor/mcp.json` | `node ${workspaceFolder}/scripts/mcp-stdio.mjs` | `cursor` | `${workspaceFolder}` is expanded in `args` and `env`. |
| Codex | `.codex/config.toml` | `sh -c 'cd "$(git rev-parse --show-toplevel)" && ... node scripts/mcp-stdio.mjs'` | `codex` | Codex starts servers in the session's working directory, resolves a relative `cwd` against it too, and interpolates nothing, so the command changes to the git root itself. |

- **Claude Code** asks you to approve a project-scoped server the first time it sees `.mcp.json`; approve `strumentario`. Until you do, `claude mcp list` shows it as pending.
- **Codex** loads `.codex/config.toml` only for trusted projects. The entry needs a POSIX shell and `git`. Without project config, register it per user: `codex mcp add strumentario --env STRUMENTARIO_AGENT=codex --env STRUMENTARIO_DATA_DIR=/abs/path/to/strumentario/.strumentario/data -- node /abs/path/to/strumentario/scripts/mcp-stdio.mjs`.
- **Cursor** shows the server beside `hindsight` in Settings → MCP.
- Outside this repo, or for another data directory, use the same launcher or `node /abs/path/to/packages/server/dist/serve.js --stdio` with absolute paths. A relative `STRUMENTARIO_DATA_DIR` resolves from the host's working directory for the child, so prefer an absolute path there. The `scaffold` tool's `host-config` target still emits the HTTP entry; a stdio variant is a follow-up.

**stdio or HTTP.** Use stdio for a host working in this repo: no port, no token, one process per host over one data directory. Use HTTP when several agents share one running server, when you want read and write [token scopes](#token-scopes), or when the agent is not on this machine's repo checkout.

## Agent identity

Callers may send `X-Strumentario-Agent: <name>`. The value is read from the request headers
inside tool handlers (`getAgentId` in `server.ts`) and reported through the `onToolCall`
observer. A missing header is allowed. The value is unauthenticated and for attribution only.

## Decision: stateless by default

Each `POST /mcp` builds a fresh `McpServer` and transport and tears both down when the response
closes. `GET` and `DELETE` on `/mcp` return `405`.

- The server is the shared tool layer for many agents (10, then tens or more). Stateless handling
  needs no session table, no sticky routing and no cleanup of abandoned sessions, and any
  instance can serve any request.
- Current tools (`validate`) are pure, so sessions add no value.
- Stateful sessions are **not** supported. If a later tool needs them (server-initiated
  notifications, resumable streams), implement the Streamable HTTP session rules in full:
  `Mcp-Session-Id` issued on initialize, `GET` for the server-to-client stream, `DELETE` to end a
  session, `404` for unknown ids. Keep stateless as the default.

## Health and shutdown

- `GET /healthz` returns `200 {"status":"ok"}`.
- `SIGINT`/`SIGTERM` stop accepting connections, close idle keep-alive connections, and let
  in-flight requests finish before exiting.

## Soak test

`packages/server/src/soak.ts` starts the server in-process on an ephemeral loopback port and runs
N concurrent SDK clients, each calling `validate` in a loop. It reports failed calls, error rate
and latency percentiles.

- CI size: 10 clients x 5 calls, in `http.test.ts` (`pnpm test`).
- Full size: `pnpm --filter @strumentario/server soak` (defaults `SOAK_CLIENTS=10,30,100`,
  `SOAK_CALLS=50`; both overridable). Exits non-zero on any failed call.

### Recorded result

Local run, 2026-10-31, Node 22, macOS, 50 calls per client:

| Clients | Calls | Failed | Error rate | p50 ms | p95 ms | p99 ms | max ms | Calls/s |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 10 | 500 | 0 | 0.00% | 8.5 | 12.6 | 16.3 | 24.2 | 911 |
| 30 | 1500 | 0 | 0.00% | 16.5 | 22.7 | 25.6 | 143.0 | 1505 |
| 100 | 5000 | 0 | 0.00% | 25.5 | 36.4 | 41.2 | 956.6 | 2235 |

Latency includes client and server sharing one process, so absolute numbers are a floor for
contention, not a deployment benchmark. The `max` outliers are connection setup bursts.
