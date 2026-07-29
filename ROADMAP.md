# Strumentario Roadmap

Phased plan for the public open-source demo. Treat the repo as a product with milestones, not a private study scratchpad.

Primary goal for v1.0: developers and contributors can clone or connect the repo in under 15 minutes and see (1) remote MCP tools working in an agent host, (2) an eval suite that fails/passes meaningfully, and (3) both an MCP app widget *and* a streamed AI SDK path documented with a short architecture note — or, at minimum, one surface shipped with the other clearly stubbed as a first-class equal.

**Positioning:** Strumentario is the local-first MCP content toolkit. One schema produces a remote Streamable HTTP server, MCP App widgets across major web frameworks, AI SDK product paths, and agentic scaffolds — all measurable with Braintrust and designed to sit between durable project knowledge (Nocciolo) and production factories (Maglio). Protocol first, product second, evals non-negotiable.

Without deliberate sharpening, external readers will fill the gap themselves and read this as “mcp-use but smaller / later” or “yet another TypeScript server scaffolder.” The phases below exist to make the eval-first, content-primitive, multi-surface-from-schema, and knowledge↔instruments↔factory story *obvious*.

---

## Differentiation bets (working constraints)

These are not optional polish. They gate how we implement each phase.

1. **Measurable by design** — Phase 2 before Phase 3. A public experiment summary in `docs/` after the first Braintrust run beats another hello-world widget demo.
2. **Schema as single source of truth** — Schema generates typed tool handlers, resource definitions, widget prop schemas, AI SDK tool definitions, and scaffold templates. Document the generation story early; do not hand-fork three divergent surfaces.
3. **Own the content-domain language** — query / mutate / validate / scaffold are the product. Resist a large catalog of miscellaneous Phase 1 demos.
4. **AI SDK path is equal, not secondary** — Prefer shipping both MCP App widgets (major web frameworks) and AI SDK product path; if sequencing forces a choice, keep the other as an explicit first-class stub with the same tool contracts.
5. **Landscape honesty** — Acknowledge mcp-use, MCP Framework / mcpkit-style, FastMCP, and official MCP Apps kits early so readers do not invent our positioning for us. Opinions stay tied to experiments.
6. **Nocciolo / Maglio seams stay explicit** — Document handoffs even before deep integration: Nocciolo seeds durable context instruments recall against; Maglio factories call Strumentario tools overnight.
7. **Postmortems and architecture notes are product** — Hiring and contributor gold; not leftover docs.

### Overlap map (honest)

| Capability | mcp-use | MCP Framework / mcpkit-style | FastMCP | Official MCP Apps kits | **Strumentario** |
|------------|---------|------------------------------|---------|------------------------|------------------|
| Remote multi-client (Streamable HTTP) | Strong | Strong | Strong | Secondary | **Primary (Phase 1)** |
| MCP App widgets (major web frameworks) | **Excellent** (React auto-register) | Weak / none | None | **Core focus** (React) | Phase 3A (React first, then peers) |
| Zero-boilerplate tool definition | Strong | Strong | Strong | N/A | Moderate (schema-driven) |
| CLI scaffolder | Strong | Strong | Moderate | Moderate | Phase 4 |
| AI SDK / product web path | Secondary | Weak | Weak | Weak | **Equal citizen (Phase 3B)** |
| Evals as product (Braintrust, golden traces, tool-choice scorers) | Afterthought | Rare | Rare | Rare | **Phase 2, non-negotiable** |
| Scaffold + repair loop with compile/structure checks | Limited | Limited | Limited | Limited | **Phase 4** |
| Local-first (no cloud required for core loop) | Soft (has Manufact path) | Yes | Yes | Yes | **Hard principle** |
| Content-domain primitives (query/mutate/validate/scaffold) | Generic tools | Generic tools | Generic | N/A | **Explicit high-signal set** |
| Knowledge ↔ instruments ↔ factory story | Standalone | Standalone | Standalone | Standalone | **Nocciolo + Maglio alignment** |
| Architecture notes + failure postmortems as artifacts | Rare | Rare | Rare | Rare | **Phase 5, hiring/demo** |

### What not to chase for differentiation

- Pure boilerplate reduction or decorator elegance → mcpkit / MCP Framework / FastMCP
- Richest React widget runtime or auto-discovery magic → mcp-use and official Apps kits
- Multi-tenant auth perfection, plugin marketplaces, full CMS parity → already non-goals
- Becoming “the” agent runtime or memory system → Nocciolo / Maglio territory

---

## Phase 0 — Repo foundation

- [x] Create public repo with clear problem statement, audience, and differentiation thesis (README “How Strumentario differs”)
- [x] License (MIT), CONTRIBUTING stub, `.env.example` (no secrets)
- [x] AGENTS.md / Cursor rules / Claude skills that mirror how agents should work on this codebase
- [ ] TypeScript monorepo or simple packages: `server`, `evals`, optional `app` / `widget` / `cli`
- [ ] CI: typecheck + unit tests on PR; evals gated or nightly if keys required
- [ ] Short landscape paragraph in README (expand to `docs/landscape.md` when experiments exist)

**Exit criteria:** cold clone + `npm i` + typecheck succeeds; no secrets in tree; a cold reader can tell why this is not “another MCP framework.”

---

## Phase 1 — MCP server (minimum ship)

- [ ] Streamable HTTP MCP server with the **high-signal set**: query, mutate, validate, plus at least one scaffold-oriented tool; ≥1 resource + ≥1 prompt
- [ ] Domain can start Sanity-like or a simple custom schema store — schema-driven handlers, not a grab-bag of unrelated demos
- [ ] Document (even briefly) that the schema is intended to generate surfaces later; keep tool contracts stable for evals
- [ ] Cursor / Claude Code / other host config snippets in README
- [ ] MCP Inspector walkthrough (screenshot or short clip)
- [ ] Tag `v0.1.0` — “agents can call my content instruments”

**Exit criteria:** an external agent host can list tools, call at least one tool, and read one resource without forking the server process into the host. Tool surface reads as content primitives, not a miscellaneous catalog.

**Protect:** do not expand into a large tool catalog to look “complete.” High-signal set > noisy surface.

---

## Phase 2 — Evals (credibility)

**Do not skip or defer past Phase 3.** This is the earliest credible differentiator.

- [ ] Braintrust project wired; golden dataset checked into repo (or documented export path)
- [ ] Scorers for tool choice / schema validity (custom where autoevals are insufficient)
- [ ] `bt eval` (or equivalent CI job) documented; one checked-in experiment summary in `docs/`
- [ ] Golden cases cover the content primitives (query / mutate / validate / scaffold-oriented paths)
- [ ] Tag `v0.2.0` — “prompt/tool changes are measurable”

**Exit criteria:** a reviewer can run the eval suite from docs and see a pass/fail that would catch a real regression in tool selection or output shape. Public experiment summary exists before (or with) the first polished widget demo.

---

## Phase 3 — Surfaces for humans (MCP app + AI SDK)

Prefer **both**. A and B are equal citizens over the same schema-generated tool contracts — not “widget first, AI SDK if time.”

- [ ] **A:** MCP app widgets (ChatGPT Apps / MCP Apps bridge) on the same tools — major web frameworks (React first, then Vue, Svelte, and peers)
- [ ] **B:** Small web UI using Vercel AI SDK or Anthropic/OpenAI that calls the same backend capabilities
- [ ] Schema → widget prop schemas and AI SDK tool definitions stay in sync with server tools (document the generation path)
- [ ] Demo GIF or short Loom in README; tools still work headless without the UI
- [ ] Tag `v0.3.0` — “protocol + product UI + product code path”

**Exit criteria:** a human can browse/edit via the widget *and* (ideally) the AI SDK path; identical tools remain callable from Cursor/Claude Code. If only one surface ships in the tag, the other is stubbed with shared contracts and a documented follow-up — not treated as optional forever.

**Protect:** shipping a generic widget without the eval and content-primitive story already visible is the highest overlap risk with mcp-use. Phase 2 evidence must already be public. Framework coverage is a bet; React-only forever is not.

---

## Phase 4 — Agentic scaffolding

- [ ] Narrow scaffolder (schema → typed client / page / studio stub) exposed as MCP tools + skill/slash commands
- [ ] One repair loop (compile or test feedback → patch) with a clear stop condition
- [ ] Evals cover “output compiles / matches golden structure”
- [ ] Scaffold remains a content-domain capability agents *do*, not only a one-shot CLI
- [ ] Tag `v0.4.0` — “agents that build, not only query”

**Exit criteria:** an agent (or the CLI) can produce a compilable stub from a schema and recover from at least one class of failure via the repair loop.

---

## Phase 5 — Polish for applications

- [ ] Architecture doc: tools vs resources vs prompts; schema→surface generation; auth model; eval strategy; Nocciolo/Maglio seams
- [ ] 2–3 failure postmortems (`docs/postmortems/`) that show prompt/tool intuition — treat as product artifacts
- [ ] Landscape note in `docs/landscape.md` (expand the README paragraph; keep opinions tied to this project’s experiments)
- [ ] Contributor guide callouts: where PRs have the most leverage (evals, primitives, generation, postmortems)
- [ ] Tag `v1.0.0` — project-ready demo

**Exit criteria:** a hiring screen or open-source contributor can follow README-only, run the server + one eval + one surface, and have concrete talking points from the architecture + postmortems + landscape note.

---

## Working cadence

| Cadence     | Action |
|-------------|--------|
| Weekly      | One vertical slice that ends in a commit + README/demo update |
| Per phase   | Release tag + short changelog (what a reviewer should try) |
| Ongoing     | Log agent failures → postmortem or new eval case |
| Before applying / public push | Cold-path test: new machine, follow README only; check that differentiation still reads clearly |

---

## Definition of done (v1.0)

- Public repo with reproducible setup and an honest landscape / differentiation story
- Remote MCP usable from at least one mainstream agent host (Cursor, Claude Code, or equivalent)
- High-signal content primitives (query / mutate / validate / scaffold path), not a miscellaneous tool dump
- Braintrust (or equivalent) evals another engineer can run from docs, with at least one public experiment summary
- MCP app UI **and** AI SDK product path as equal citizens where feasible (minimum: one shipped, the other stubbed with shared contracts)
- Schema documented as the generator of server tools + surfaces + evals
- Written artifacts that double as project talking points (architecture + postmortems + landscape)

---

## Explicit non-goals for v1

Do **not** block the first public tags on:

- Multi-tenant auth perfection
- Full Sanity feature parity
- Polished marketing site
- Large plugin marketplace
- Event-driven multi-repo orchestration (that belongs later or in Maglio)
- Out-competing mcp-use on widget auto-discovery or mcpkit / FastMCP on decorator elegance
- Becoming an agent runtime or durable memory system (Nocciolo / Maglio)

Depth on MCP + evals + coherent multi-surface content instruments beats breadth.

---

## Suggested 6–8 week sequence (compressed)

| Week  | Focus                                      | Output                              |
|-------|--------------------------------------------|-------------------------------------|
| 1–2   | Remote MCP server (content primitives) + Inspector + editor wiring | Public repo, tools documented |
| 3     | Braintrust on that server’s tool path      | First experiment + golden set in `docs/` |
| 4     | ChatGPT MCP app UI on same server          | Demo GIF / short write-up           |
| 5     | Vercel AI SDK (or Anthropic) product path + tests | First-class equal surface     |
| 6     | Scaffolder + repair loop + evals           | Capstone MVP                        |
| 7–8   | Architecture + landscape + postmortems + polish | v1.0 readiness                 |

Minimum credible triad for most applications: **MCP server → Braintrust → MCP app (and AI SDK path)**. Protect the middle step.

---

## Demo goals (what a reviewer should be able to say)

- “Built and deployed a remote MCP server (Streamable HTTP) with content primitives; used from Cursor / Claude Code.”
- “One schema drives server tools, an MCP App widget, and an AI SDK product path — not three hand-forked stacks.”
- “Braintrust evals for tool selection / scaffold quality; caught a real regression — and that evidence shipped before the widget was the whole story.”
- “Scaffold + repair loop with compile/structure checks; agents build, not only query.”
- “Clear handoff story: Nocciolo (knowledge) → Strumentario (instruments) → Maglio (factories).”
- “Architecture + postmortems + landscape note make the craft and the differentiation obvious.”

---

## Resources (start here)

- MCP TypeScript SDK: [modelcontextprotocol/typescript-sdk](https://github.com/modelcontextprotocol/typescript-sdk) · first-server guide
- Braintrust: [Run evaluations](https://www.braintrust.dev/docs/evaluate/run-evaluations) · `autoevals`
- ChatGPT Apps / MCP Apps: [Apps SDK quickstart](https://developers.openai.com/apps-sdk/quickstart) · build MCP server for Apps
- Vercel AI SDK (streamText, tools; React and other web frameworks)
- Sanity official MCP server + Agent Toolkit posts (reference architecture only)
- Landscape peers (acknowledge, don’t clone): mcp-use, MCP Framework / mcpkit-style, FastMCP, official MCP Apps kits

---

## Out of scope for primary effort

Do not spend primary study time on: basic web framework/TypeScript fluency, general Cursor/Claude Code proficiency, writing AGENTS.md/rules/skills in the abstract, configuring third-party MCP servers, or explaining why hooks/quality gates matter. Deepen those only when a gap in the phases above requires it (e.g. skills as the interface to *this* scaffolder).
