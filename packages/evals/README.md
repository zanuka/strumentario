# @strumentario/evals

Golden dataset and offline harness for the Strumentario content primitives. The first slice of the eval strategy in [`docs/braintrust-eval-details.md`](../../docs/braintrust-eval-details.md): deterministic, cheap, attributable. The code scorers and the Braintrust experiment path build on it (issue #9).

## Run it

```bash
pnpm eval:local      # builds, then runs every golden case; no API key, no network
pnpm test            # includes harness tests that prove a broken case fails the run
```

Output is one `PASS`/`FAIL` line per case plus the failed checks. The process exits `1` if any case fails, so it is safe in CI.

`pnpm eval:local` also scores every tool case (see Scorers) and exits `1` on any case or scorer below 1.00.

`pnpm eval` is the Braintrust path: with `BRAINTRUST_API_KEY` set (and optionally `BRAINTRUST_PROJECT`, default `strumentario`) it runs the golden cases as a Braintrust experiment and exits non-zero on any regression. Without a key it prints how to set one and exits `1`; the offline harness is unaffected.

`pnpm eval:regression` breaks the writer lock on purpose and runs the suite red, then restored and green, to show the scorers catch a real regression.

## Scorers

Code scorers in `src/scorers.ts` read the trace the harness records (every call made, its outcome, and store snapshots around each step). Each returns 0..1, or `null` when it does not apply.

| Scorer | Checks |
|--------|--------|
| `tool_choice` | the expected tool and arguments in the golden spec versus the calls actually sent; the tool must be a published contract. In the direct-invocation task this guards the tool/argument contract; whether a model picks the right tool is the agent path below |
| `output_schema_valid` | every structured result validates against the tool's published `outputSchema` |
| `no_unexpected_side_effect` | query, validate and dry-run mutate steps leave the store byte-identical and report `dryRun: true` |
| `repair_converged` | every `repair` call honoured its stop condition (rounds within `maxRounds`, a kept round always shrank the errors, a non-converged result names why and returns the remaining errors) and, when a case sets `convergeWithin: N`, converged within N rounds |
| `concurrency_safety` | parallel calls: no lost update (two writers never both win from one revision; the final revision was produced by an accepted call) and no double apply (one idempotency key applies once) |

Braintrust also gets `expectations_met`, the harness verdict on the `expect`/`after` checks in each case. A regression is any case with `expectations_met` or an applicable scorer below 1. Scorers are unit tested with failing examples in `src/scorers.test.ts`. The first results are in [`docs/evals/`](../../docs/evals/2026-11-08-baseline.md).

## Agent tool-selection eval

`pnpm eval:agent` gives a model the **published tool definitions** and one prompt at a time, then scores the call it makes. It is the evidence that tool descriptions work for agents (issue #16).

```bash
ANTHROPIC_API_KEY=... pnpm eval:agent                      # or OPENAI_API_KEY; prints per-tool accuracy
pnpm eval:agent --summary docs/evals/<date>-agent-tool-selection.md   # also writes the checked-in summary from this run
```

- Tool definitions come from a live MCP `tools/list` against `createMcpServer()` (`listPublishedTools` in `src/agent.ts`); nothing is copied by hand. A test proves the list request is made and handed to the model unchanged.
- 19 prompts in `src/agent-cases.ts` with the expected tool and an argument *shape* (subset match: listed keys must match). Near misses: `query` vs `validate`, `mutate` dry run vs write, `mutate` vs `scaffold`, and `repair` (fix a failing generated file) vs `scaffold` (generate one).
- Scorers: `tool_selected` (right tool; accuracy per tool is computed from it), `tool_choice` and `output_schema_valid` (the scorers above, run on the call executed through the golden harness), `argument_shape` and `argument_schema_valid` (arguments validate against the published `inputSchema`).
- No `ANTHROPIC_API_KEY`/`OPENAI_API_KEY`: prints how to set one and exits `0`; `pnpm test` covers the whole path with the model mocked. The Anthropic model defaults to `claude-sonnet-5-5` (`EVAL_ANTHROPIC_MODEL` overrides; `EVAL_OPENAI_MODEL` for OpenAI).
- With `BRAINTRUST_API_KEY` set the same run is recorded as a Braintrust experiment, with the same project setting as `pnpm eval`.
- A model miss is a reported weak spot, not a failed build: the run exits `0`. Read the misses; do not change tool descriptions only to raise a score without reviewing why.

**Changing a tool description, an input schema or a tool name requires re-running this suite** (and updating `docs/evals/` if the numbers move). Descriptions are the only thing an agent has to choose with; `pnpm eval:local` cannot see a description regression.

## How it works

- `src/golden.ts` is the dataset: plain, serializable data, one entry per behaviour with an `intent` sentence saying what it protects.
- `src/harness.ts` runs each case against a fresh temporary store directory (deleted afterwards):
  - **tool cases** connect an in-process MCP client to `createMcpServer()`, so they go through the same handlers and schemas the HTTP server exposes;
  - **CLI cases** start the Streamable HTTP server on a free port and run the real `strumentario` CLI (`runCli`) against it, checking exit code, `--json` stdout and stderr.
- Tool names are checked against the exported `toolContracts` from `@strumentario/server`; a misspelled tool fails the case.

Categories: `query`, `validate`, `mutate`, `concurrency` (parallel calls, races, idempotent retries) `scaffold` (files returned in memory, nothing written without `write: true`, no effect on pages), `repair` (a broken scaffold converges within the round limit; a file the template path cannot fix stops early with its errors; passing files use no rounds; unsafe paths are refused) and `cli`.

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
