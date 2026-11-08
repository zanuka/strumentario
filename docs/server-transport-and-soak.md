# Server transport, configuration and soak results

## Configuration

| Variable | Default | Meaning |
| --- | --- | --- |
| `PORT` | `3001` | Listen port. `env.example`, the README and `packages/server/src/config.ts` all use this default. |
| `HOST` | `127.0.0.1` | Bind address. Loopback by default; set `0.0.0.0` only behind a network boundary you control. |
| `MCP_TRANSPORT` | `http` | `http` (Streamable HTTP, the primary path) or `stdio`. `serve --stdio` / `strumentario serve --stdio` is the same as `MCP_TRANSPORT=stdio`. Any other value is a configuration error. |
| `STRUMENTARIO_AGENT` | unset | Agent name attributed to calls in stdio mode, where there are no request headers. Ignored over HTTP, which uses `X-Strumentario-Agent`. |
| `MCP_AUTH_TOKEN` | unset | Optional shared secret. When set, `/mcp` requires `Authorization: Bearer <token>` and answers `401` otherwise. Unset means no auth. `/healthz` is never gated. This is a single shared secret, not multi-tenant auth. |

`PORT`, `HOST` and `MCP_AUTH_TOKEN` apply to HTTP only; stdio opens no port and needs no token.

## stdio transport

Terminal coding agents usually start MCP servers as child processes. `node packages/server/dist/serve.js --stdio` (after `pnpm build`) serves the same `createMcpServer()` tools and resources over stdin/stdout. It is an additional entry point, not a fork: HTTP behaviour is unchanged.

- **stdout carries only protocol messages.** The startup line, signal notices and errors go to stderr. Do not write to stdout in code that runs in this mode.
- The process serves until the host closes stdin, or it receives `SIGINT`/`SIGTERM`, then exits `0`.
- **One data directory, many processes.** Every host that spawns the server gets its own process; they share `STRUMENTARIO_DATA_DIR`. Writes to a slug are serialized across processes by a lock directory under `<data dir>/.locks/` (a holder that crashed is reclaimed after 30 s), so revision checks (`expectedRevision`) and idempotency keys (`idempotencyKey`) behave as they do with one process, and journal appends use `O_APPEND`. `stdio.test.ts` checks this with 10 processes.
- Set `STRUMENTARIO_AGENT` per host so the journal attributes changes.

Host entry (Cursor `.cursor/mcp.json`, Claude Code `.mcp.json`, and similar), with absolute paths:

```json
{
  "mcpServers": {
    "strumentario": {
      "command": "node",
      "args": ["/abs/path/to/strumentario/packages/server/dist/serve.js", "--stdio"],
      "env": {
        "STRUMENTARIO_DATA_DIR": "/abs/path/to/strumentario/.strumentario/data",
        "STRUMENTARIO_AGENT": "cursor"
      }
    }
  }
}
```

Relative `STRUMENTARIO_DATA_DIR` resolves from the host's working directory for the child, so prefer an absolute path. The `scaffold` tool's `host-config` target still emits the HTTP entry; a stdio variant is a follow-up.

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
