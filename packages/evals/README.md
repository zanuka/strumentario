# @strumentario/evals

Golden dataset and offline harness for the Strumentario content primitives. The first slice of the eval strategy in [`docs/braintrust-eval-details.md`](../../docs/braintrust-eval-details.md): deterministic, cheap, attributable. Braintrust upload and scorers are tracked separately (issue #9).

## Run it

```bash
pnpm eval:local      # builds, then runs every golden case; no API key, no network
pnpm test            # includes harness tests that prove a broken case fails the run
```

Output is one `PASS`/`FAIL` line per case plus the failed checks. The process exits `1` if any case fails, so it is safe in CI.

`pnpm eval` is the separate Braintrust path and still needs `BRAINTRUST_API_KEY`.

## How it works

- `src/golden.ts` is the dataset: plain, serializable data, one entry per behaviour with an `intent` sentence saying what it protects.
- `src/harness.ts` runs each case against a fresh temporary store directory (deleted afterwards):
  - **tool cases** connect an in-process MCP client to `createMcpServer()`, so they go through the same handlers and schemas the HTTP server exposes;
  - **CLI cases** start the Streamable HTTP server on a free port and run the real `strumentario` CLI (`runCli`) against it, checking exit code, `--json` stdout and stderr.
- Tool names are checked against the exported `toolContracts` from `@strumentario/server`; a misspelled tool fails the case.

Categories: `query`, `validate`, `mutate`, `concurrency` (parallel calls, races, idempotent retries) and `cli`. Scaffold cases arrive with the scaffold tool (issue #11).

## Add a case

Append an object to `goldenCases` in `src/golden.ts`.

```ts
{
  id: "mutate-delete-needs-revision",          // unique, kebab-case
  kind: "tool",                                // "tool" or "cli"
  category: "mutate",
  intent: "Deleting without expectedRevision is refused, so agents cannot delete blind.",
  seed: [{ title: "Intro", slug: "intro", body: "Welcome." }],   // pages written before the case runs
  steps: [
    {
      call: { tool: "mutate", input: { action: "delete", slug: "intro", dryRun: false } },
      expect: { isError: true, match: { ok: false, error: { code: "revision_required" } } },
    },
  ],
  after: [{ slug: "intro", exists: true }],    // optional store post-conditions
}
```

- `expect.isError` is the MCP result's `isError`. Input the schema rejects (missing or out-of-range arguments) also counts as an error; use `errorIncludes` to check its text.
- `expect.match` is **subset-matched** against the structured output: listed keys must match, extra keys are ignored, arrays must match exactly. Markers: `{ $contains: "text" }`, `{ $present: true }`, `{ $absent: true }`.
- `"$revision:<slug>"` anywhere in a tool input is replaced with that page's current revision when the step runs.
- **Concurrency:** use `parallel: [call, call]` with `expect: { ok, errorCodes?, replayed? }`. The calls start together and order is not asserted, only the counts (for example `{ ok: 1, errorCodes: ["conflict"] }`).
- **CLI cases** take `args` (the harness appends `--url`) and `expect: { exitCode, stdoutJson?, stderrIncludes? }`.
- Prove the case can fail: temporarily change one expectation and confirm `pnpm eval:local` exits non-zero, then restore it.

When a tool's behaviour or shape changes, update or add the matching cases in the same PR.
