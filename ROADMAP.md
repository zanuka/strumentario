# Strumentario Roadmap

Phased plan for the public open-source demo. Treat the repo as a product with milestones, not a private study scratchpad.

Primary goal for v1.0: developers and contributors can clone or connect the repo in under 15 minutes and see (1) remote MCP tools working in an agent host, (2) an eval suite that fails/passes meaningfully, and (3) either an MCP app widget or a streamed AI SDK path documented with a short architecture note.

---

## Phase 0 — Repo foundation

- [ ] Create public repo with clear problem statement and audience
- [ ] TypeScript monorepo or simple packages: `server`, `evals`, optional `app` / `widget` / `cli`
- [ ] License (MIT), CONTRIBUTING stub, `.env.example` (no secrets)
- [ ] AGENTS.md / Cursor rules / Claude skills that mirror how agents should work on this codebase
- [ ] CI: typecheck + unit tests on PR; evals gated or nightly if keys required
- [ ] README problem → vision → quick-start skeleton

**Exit criteria:** cold clone + `npm i` + typecheck succeeds; no secrets in tree.

---

## Phase 1 — MCP server (minimum ship)

- [ ] Streamable HTTP MCP server with 3–5 real tools + ≥1 resource + ≥1 prompt
- [ ] Domain can start Sanity-like or a simple custom schema store (query / mutate / validate + scaffold endpoints)
- [ ] Cursor / Claude Code / other host config snippets in README
- [ ] MCP Inspector walkthrough (screenshot or short clip)
- [ ] Tag `v0.1.0` — “agents can call my tools”

**Exit criteria:** an external agent host can list tools, call at least one tool, and read one resource without forking the server process into the host.

---

## Phase 2 — Evals (credibility)

- [ ] Braintrust project wired; golden dataset checked into repo (or documented export path)
- [ ] Scorers for tool choice / schema validity (custom where autoevals are insufficient)
- [ ] `bt eval` (or equivalent CI job) documented; one checked-in experiment summary in `docs/`
- [ ] Tag `v0.2.0` — “prompt/tool changes are measurable”

**Exit criteria:** a reviewer can run the eval suite from docs and see a pass/fail that would catch a real regression in tool selection or output shape.

---

## Phase 3 — Surface for humans (MCP app and/or AI SDK)

Pick A, B, or both (both is ideal):

- [ ] **A:** MCP app widget (ChatGPT Apps / MCP Apps bridge) on the same tools — React first, with room for other web frameworks
- [ ] **B:** Small web UI using Vercel AI SDK or Anthropic/OpenAI that calls the same backend capabilities
- [ ] Demo GIF or short Loom in README; tools still work headless without the UI
- [ ] Tag `v0.3.0` — “protocol + product UI”

**Exit criteria:** a human can browse/edit via the widget or AI SDK path, and the identical tools remain callable from Cursor/Claude Code.

---

## Phase 4 — Agentic scaffolding

- [ ] Narrow scaffolder (schema → typed client / page / studio stub) exposed as MCP tools + skill/slash commands
- [ ] One repair loop (compile or test feedback → patch)
- [ ] Evals cover “output compiles / matches golden structure”
- [ ] Tag `v0.4.0` — “agents that build, not only query”

**Exit criteria:** an agent (or the CLI) can produce a compilable stub from a schema and recover from at least one class of failure via the repair loop.

---

## Phase 5 — Polish for applications

- [ ] Architecture doc: tools vs resources vs prompts; auth model; eval strategy
- [ ] 2–3 failure postmortems (`docs/postmortems/`) that show prompt/tool intuition
- [ ] Landscape note optional; keep opinions tied to this project’s experiments
- [ ] Tag `v1.0.0` — project-ready demo

**Exit criteria:** a hiring screen or open-source contributor can follow README-only, run the server + one eval + one surface, and have concrete talking points from the architecture + postmortems.

---

## Working cadence

| Cadence     | Action |
|-------------|--------|
| Weekly      | One vertical slice that ends in a commit + README/demo update |
| Per phase   | Release tag + short changelog (what a reviewer should try) |
| Ongoing     | Log agent failures → postmortem or new eval case |
| Before applying / public push | Cold-path test: new machine, follow README only |

---

## Definition of done (v1.0)

- Public repo with reproducible setup
- Remote MCP usable from at least one mainstream agent host (Cursor, Claude Code, or equivalent)
- Braintrust (or equivalent) evals another engineer can run from docs
- At least one of: MCP app UI, AI SDK product path, scaffolder with repair loop
- Written artifacts that double as project talking points (architecture + postmortems)

---

## Explicit non-goals for v1

Do **not** block the first public tags on:

- Multi-tenant auth perfection
- Full Sanity feature parity
- Polished marketing site
- Large plugin marketplace
- Event-driven multi-repo orchestration (that belongs later or in Maglio)

Depth on MCP + evals + one agentic surface beats breadth.

---

## Suggested 6–8 week sequence (compressed)

| Week  | Focus                                      | Output                              |
|-------|--------------------------------------------|-------------------------------------|
| 1–2   | Remote MCP server + Inspector + editor wiring | Public repo, tools documented     |
| 3     | Braintrust on that server’s tool path      | First experiment + golden set       |
| 4     | ChatGPT MCP app UI on same server          | Demo GIF / short write-up           |
| 5     | Vercel AI SDK (or Anthropic) product path + tests | Resume bullet                  |
| 6     | Scaffolder + repair loop + evals           | Capstone MVP                        |
| 7–8   | Architecture + postmortems + polish        | v1.0 readiness                      |

Minimum credible triad for most applications: **MCP server → Braintrust → MCP app (or AI SDK path)**.

---

## Demo goals (what a reviewer should be able to say)

- “Built and deployed a remote MCP server (Streamable HTTP) with real tools; used from Cursor / Claude Code.”
- “MCP App for ChatGPT via Apps SDK / MCP Apps bridge (React and other web frameworks).”
- “Braintrust evals for tool selection / scaffold quality; caught a real regression.”
- “Shipped a feature with Vercel AI SDK / Anthropic in a public demo that shares the same tools.”

---

## Resources (start here)

- MCP TypeScript SDK: [modelcontextprotocol/typescript-sdk](https://github.com/modelcontextprotocol/typescript-sdk) · first-server guide
- Braintrust: [Run evaluations](https://www.braintrust.dev/docs/evaluate/run-evaluations) · `autoevals`
- ChatGPT Apps / MCP Apps: [Apps SDK quickstart](https://developers.openai.com/apps-sdk/quickstart) · build MCP server for Apps
- Vercel AI SDK (streamText, tools; React and other web frameworks)
- Sanity official MCP server + Agent Toolkit posts (reference architecture only)

---

## Out of scope for primary effort

Do not spend primary study time on: basic web framework/TypeScript fluency, general Cursor/Claude Code proficiency, writing AGENTS.md/rules/skills in the abstract, configuring third-party MCP servers, or explaining why hooks/quality gates matter. Deepen those only when a gap in the phases above requires it (e.g. skills as the interface to *this* scaffolder).
