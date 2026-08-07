# Braintrust eval strategy

Strumentario treats evals as product, not afterthought. Braintrust is the Phase 2 measurement layer: golden datasets, scored experiments, and public write-ups that answer whether a tool or scaffold change actually improved quality.

This document is the high-level strategy. Concrete suite layout, run commands, and experiment summaries land with Phase 2 implementation (see [ROADMAP.md](../ROADMAP.md) Phase 2).

## Why Braintrust

Strumentario needs a loop that matches its differentiation bets:

| Need | How Braintrust fits |
|------|---------------------|
| Golden traces for content primitives | Versioned datasets + comparable experiments |
| Tool-choice and output-shape quality | Code scorers (and later LLM judges where useful) |
| Scaffold structure / compile checks | Pure code scorers over artifacts |
| “Did this change help?” | Experiment comparison and score diffs |
| Local ownership of instruments | SDK + CLI; eval cloud is optional for *running* the MCP server |
| Public credibility | Exportable experiments → checked-in summaries under `docs/` |

Peers often stop at “the server runs.” We want a reviewer to clone the repo, run an eval from docs, and see a pass/fail that would catch a real regression in tool selection or output shape—*before* polished widgets become the story.

## What we measure

Evals target the high-signal content primitives—not a large miscellaneous catalog:

- **query** — retrieve / list against the schema-backed store
- **mutate** — create / update with explicit side effects
- **validate** — check instances against the schema
- **scaffold** — produce narrow, reviewable artifacts from the schema

The same tool contracts agents call over MCP are what evals exercise. Widgets and AI SDK surfaces are views over those contracts; they are not a separate private API for scoring.

## Evaluation architecture (conceptual)

```text
golden dataset  →  task (invoke instruments)  →  scorers  →  experiment  →  docs summary
```

1. **Golden dataset** — Small, high-signal cases checked into the repo (or with a documented export path). Start focused (roughly a dozen cases covering the four primitives), including edge cases: missing args, invalid payloads, refuse / do-nothing paths.
2. **Task** — First slice: **direct tool invocation** against the same handlers the MCP server exposes (deterministic, cheap, attributable). Later: an **agent tool-selection** path that gives a model the published tool definitions and scores whether the high-signal set is discoverable and correctly chosen.
3. **Scorers** — Prefer **code scorers** for schema validity and tool-choice correctness; reserve LLM-as-judge for intent fit and final-answer quality once the baseline is stable.
4. **Experiment** — Each run is a comparable Braintrust experiment (e.g. content-primitives baselines) so prompt/tool/schema changes are measurable over time.
5. **Public summary** — A checked-in write-up under `docs/evals/` is part of the product narrative: what was scored, what passed/failed, and what a regression looks like.

## Scorer philosophy

| Scorer intent | Type | Role |
|---------------|------|------|
| Tool choice correct | Code | Expected tool name(s) / args vs golden |
| Output schema valid | Code / autoevals JSON | Return shape matches declared contracts |
| Scaffold structure / compile | Code | Files exist, structure matches, later `tsc` success |
| Trajectory / step budget | Trace-level code | Unexpected tools, failures, runaway steps (repair loops) |
| Final answer quality | LLM-as-judge | Intent fit using tool results (after the code baseline) |

Code scorers stay first-class: faster, cheaper, and stable across model changes. Autoevals building blocks are welcome where they fit; custom scorers fill gaps when they do not.

## Local-first and secrets

- Golden cases live in the repo so another engineer can review and run them.
- `BRAINTRUST_API_KEY` (and any judge model keys) stay in `.env` — never committed. See `env.example`.
- Braintrust is how we **measure** instruments. It is not required to **run** the core MCP server loop.
- CI should keep typecheck/unit tests always-on; full Braintrust runs may be gated or nightly when keys are required.

## Sequencing (aligned with the roadmap)

**Phase 2 gate:** ship a runnable eval suite and one public experiment summary *before* (or with) the first polished MCP App widget. That ordering is intentional—evals are the earliest credible differentiator.

Suggested progressive depth:

1. Direct-tool path + code scorers on query / mutate / validate / simple scaffold
2. Agent tool-selection path + richer metadata / spans for tool calls
3. Scaffold compile checks and repair-loop trajectory scorers (Phase 4)
4. Optional online scoring of production traces that call Strumentario instruments

Do not expand the golden set into a noisy catalog just to look complete. Prefer cases that protect the content-primitive contracts and catch real regressions.

## What “done” looks like for Phase 2

From [ROADMAP.md](../ROADMAP.md):

- Braintrust project wired; golden dataset in repo (or documented export path)
- Scorers for tool choice / schema validity
- `bt eval` (or equivalent) documented; one checked-in experiment summary in `docs/`
- Golden cases cover the four content primitives
- Tag `v0.2.0` — “prompt/tool changes are measurable”

**Exit criteria:** a reviewer can run the suite from docs and see a meaningful pass/fail. The public experiment summary exists before polished widgets become the whole story.

## Related

- [ROADMAP.md](../ROADMAP.md) — Phase 2 checklist and phase gates
- [AGENTS.md](../AGENTS.md) — how agents should treat evals when changing tools or scaffolds
- Braintrust: [Run evaluations](https://www.braintrust.dev/docs/evaluate/run-evaluations) · `autoevals`
