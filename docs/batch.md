# Batch calls

`strumentario batch` runs many tool calls over **one** MCP connection and reports one result line per call. It is for orchestrators and factory stages (the Maglio seam in [use-cases](use-cases.md)) that would otherwise start a CLI process per call. It is a thin client: the same connection setup, auth, `--agent` header and exit codes as `strumentario call`.

```sh
strumentario batch --input-file calls.jsonl --concurrency 8 --agent maglio-stage-3 > results.jsonl
cat calls.jsonl | strumentario batch --dry-run
```

Input comes from `--input-file <path>` or, when that is absent, stdin.

| Option | Effect |
| --- | --- |
| `--input-file <path>` | Read the JSON lines from a file instead of stdin. |
| `--agent <id>` | Agent identity for every call, as for `call` (`X-Strumentario-Agent`; recorded in the [journal](journal.md)). |
| `--dry-run` | Force dry-run on every tool that supports it (see below). |
| `--stop-on-error` | After the first failed line or call, start no new calls; every call not yet started is reported as `skipped`. |
| `--concurrency <n>` | Calls in flight at once (default `1`). Must be a positive integer. |

## Contract

This format is stable for external consumers. Fields may be added to the objects below; existing fields will not change meaning or type, and new `error.code` values will not reuse an existing name.

### Input: one call per line

JSON Lines, UTF-8. Blank lines are ignored.

```json
{"id":"c1","tool":"validate","input":{"instance":{"title":"Getting started","slug":"getting-started","body":"Draft content."}}}
{"id":"c2","tool":"mutate","input":{"action":"create","slug":"getting-started","page":{"title":"Getting started","slug":"getting-started","body":"Draft content."},"dryRun":false}}
```

| Field | Type | Meaning |
| --- | --- | --- |
| `id` | string or number, required | Caller's correlation key, echoed unchanged. Not required to be unique, but results can only be matched by `id` if it is. |
| `tool` | string, required | Tool name, as listed by `strumentario tools`. |
| `input` | object, optional (default `{}`) | The tool's input, exactly as for `strumentario call --input`. |

### Output: one result per input line

One JSON object per non-blank input line, on one line each, **in input order** regardless of `--concurrency` (a record is written as soon as it and every earlier record are complete). Nothing else is written to stdout; diagnostics go to stderr.

```json
{"id":"c1","ok":true,"result":{"valid":true,"errors":[]}}
{"id":"c2","ok":false,"error":{"code":"tool_error","message":"Tool \"mutate\" reported an error. …","details":{"ok":false,"error":{"code":"already_exists"}}}}
{"id":null,"ok":false,"error":{"code":"invalid_line","message":"Line 3: not valid JSON (…)."}}
```

| Field | Present | Meaning |
| --- | --- | --- |
| `id` | always | The input `id`, or `null` when the line had no usable `id`. |
| `ok` | always | `true` when the call ran and the tool reported success. |
| `result` | `ok: true` | The tool's structured result, as `strumentario call` prints it. |
| `error.code` | `ok: false` | One of the codes below. |
| `error.message` | `ok: false` | Human-readable explanation with a next step. |
| `error.details` | optional | The tool's own result, when it returned one alongside the failure (for example mutate's `error.code: "conflict"` or validate's `errors`). |

| `error.code` | Meaning |
| --- | --- |
| `invalid_line` | The line is not valid JSON, not an object, or lacks a usable `id` or `tool`, or `input` is not an object. The batch continues. |
| `tool_error` | The tool reported an error, or reported its input invalid (`valid: false`). |
| `rejected` | The server refused the request, for example an unknown tool or input that fails the tool's schema. |
| `connection` | The connection broke during this call. |
| `skipped` | Not run because of `--stop-on-error`. |

A tool call refused for the token's scope (a read-only token calling `mutate`) is reported as `tool_error` or `rejected` for that call only.

### Exit code

`0` only if every record is `ok: true` (an empty input is a success). Otherwise the codes of `strumentario call` apply, see the [README](../README.md#cli-quick-start): `1` when any call failed, including invalid lines and skipped calls; `2` for a usage error before anything runs (bad `--concurrency`, unreadable `--input-file`, no input source); `3` when the server is unreachable or rejects the token at connect time, or the connection dies mid-batch. A connect failure happens before any call runs, so no records are written.

## Dry-run

`--dry-run` is enforced by the CLI from each tool's published input schema, overriding what the line says:

| Tool | Effect of `--dry-run` |
| --- | --- |
| `mutate` | `dryRun: true` is forced, even when the line says `dryRun: false`. Nothing is written to the store; the journal records the dry run. |
| `scaffold` | `write: false` is forced. Files are returned in memory and none are written. |
| `query`, `validate` | They never write, so the input is passed through unchanged. |
| Any other tool | If it declares neither `dryRun` nor `write`, the input is passed through unchanged. Do not rely on `--dry-run` for a tool whose schema lacks those fields. |

## Ordering and concurrency

With `--concurrency 1` calls run strictly one after another. With more, up to `n` calls are in flight over the same connection and may complete in any order; the output order is still the input order, and each record carries its `id`. Calls that touch the same slug are serialized by the store's writer lock, but their relative order is **not** guaranteed above concurrency 1: keep dependent calls (create, then update) in a `--concurrency 1` batch.
