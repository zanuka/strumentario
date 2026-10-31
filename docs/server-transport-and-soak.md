# Server transport, configuration and soak results

## Configuration

| Variable | Default | Meaning |
| --- | --- | --- |
| `PORT` | `3001` | Listen port. `env.example`, the README and `packages/server/src/config.ts` all use this default. |
| `HOST` | `127.0.0.1` | Bind address. Loopback by default; set `0.0.0.0` only behind a network boundary you control. |
| `MCP_AUTH_TOKEN` | unset | Optional shared secret. When set, `/mcp` requires `Authorization: Bearer <token>` and answers `401` otherwise. Unset means no auth. `/healthz` is never gated. This is a single shared secret, not multi-tenant auth. |

`MCP_TRANSPORT` was removed: the server only speaks Streamable HTTP, so the variable selected nothing.

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
