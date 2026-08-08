# Real-world use cases

Strumentario is for teams that need a **durable, measurable content instrument set**—not another one-off MCP adapter. Other projects mostly help you *build a server* (or widgets on top of one). These scenarios show when owning instruments under local control is the better bet.

Audience spans **solo developers**, **product / platform teams**, and **companies** already running agents in Cursor, Claude Code, ChatGPT Apps, or overnight factory jobs. Each scenario maps to the [differentiation bets](../README.md#differentiation-bets) and suggests a **demo shape** you can later turn into a Loom, Inspector walkthrough, or Braintrust experiment summary.

Related: [Braintrust eval strategy](./braintrust-eval-details.md) · [Nocciolo / Hindsight bank](./nocciolo-brain-details.md) · [ROADMAP](../ROADMAP.md)

---

## Who this is for

| Audience | Typical pain | What Strumentario changes |
|----------|--------------|---------------------------|
| **Solo developer / contractor** | Stdio hello-world never becomes a remote multi-client surface; no proof the tools got better; portfolio reads as “I wired MCP” | Schema → remote server + eval summary + architecture note as craft artifacts |
| **Product / content team** | Agents and humans drift: Cursor tools ≠ widget behavior ≠ product AI SDK path; every domain reimplements query/mutate/validate | One schema → shared primitives across hosts and UIs |
| **Platform / company** | Knowledge lives in docs; instruments are throwaway; overnight jobs reinvent wiring; cloud control planes conflict with ownership | Local-first instruments between knowledge (Nocciolo) and factories (Maglio), with golden traces in CI |

---

## Scenarios

### 1. Docs-as-content instruments for an agentic engineering team

**Who:** A 5–20 person product team using Cursor / Claude Code daily against a CMS-like or custom content store (articles, ADRs, product copy, release notes).

**Today:** Someone pastes a FastMCP / SDK stdio example, adds ten ad-hoc tools (`list_posts`, `get_post`, `update_post`, `search_tags`, …), and never ships evals. A React widget demo appears later with a *second* client API. Agents pick the wrong tool; nobody can prove a prompt change helped.

**With Strumentario:** One content schema drives **query / mutate / validate / scaffold**. The same contracts are called from the agent host, MCP Inspector, and (later) an MCP App widget + AI SDK path. Braintrust golden cases catch “agent chose mutate without validate” or invalid payloads before the widget is the story.

**Bets shown:** Content-domain primitives · Evals as product · One schema → three surfaces + evals · Local control

**Demo sketch:**

1. Point Cursor at the Streamable HTTP server; ask it to update a draft and validate before save.
2. Run the golden suite; break a tool description on purpose; show the scorer fail.
3. Open the same mutate path from Inspector (and later the widget) — identical args/results.

---

### 2. “Did this tool change help?” before the polished widget ships

**Who:** Platform engineer or tech lead accountable for agent quality, not just “MCP works in demo.”

**Today:** Peers optimize decorator DX or React auto-registration. Reviews ask “does the widget look good?” Regression in tool choice is vibes-only. Phase gates collapse: UI ships first; evals never land.

**With Strumentario:** Phase 2 is non-negotiable. A checked-in golden dataset + tool-choice / schema scorers + a public experiment summary under `docs/` answer “did this change improve quality?” Braintrust is how you *measure*; it is not required to *run* the core server.

**Bets shown:** Evals as product · Craft artifacts as product · Progressive delivery (evals before surfaces)

**Demo sketch:**

1. Clone → run eval from docs → pass/fail that would catch a real regression.
2. Side-by-side: peer “server + widget” repo with no golden set vs Strumentario experiment diff after a tool rename.
3. Short postmortem: “wrong tool selected → new golden case → green again.”

---

### 3. Same instruments in Cursor and in a ChatGPT App / product UI

**Who:** Product team shipping an assistant in-chat (MCP App widget) *and* letting engineers use the same capabilities in the IDE.

**Today:** mcp-use / Apps kits excel at widgets. Separate product path (Vercel AI SDK) hand-forks tool defs. Cursor config drifts. Users report “the app can edit X but the agent can’t” (or the reverse).

**With Strumentario:** Schema generates MCP tool handlers, widget prop schemas, and AI SDK tool definitions as **equal citizens**. Protocol stays source of truth; UIs are views. Headless agents keep working without the widget.

**Bets shown:** One schema → three surfaces + evals · Protocol first, product second

**Demo sketch:**

1. One schema file; show generated (or synced) tool contracts for server, widget, AI SDK.
2. Same user intent: “list drafts older than 30 days” in Cursor, then in the widget, then via `streamText` + tools.
3. Call out what you are *not* competing on: richest React auto-discovery (mcp-use / official kits already own that).

---

### 4. High-signal content ops instead of a noisy tool catalog

**Who:** Knowledge / docs / CMS-adjacent squad tired of “50 tools, none of them coherent.”

**Today:** Generation tools (API → MCP) or frameworks encourage unbounded catalogs. Agents drown in similar tools. Content domains still reimplement list/get/create/update/validate every project.

**With Strumentario:** Productize **query, mutate, validate, scaffold**. Prefer a small discoverable set over completeness theater. Resources for data; tools for actions; prompts for workflows.

**Bets shown:** Content-domain primitives · High-signal over noisy catalog

**Demo sketch:**

1. Inspector tool list: four primitives + 1 resource + 1 prompt — readable in one screen.
2. Contrast slide: generated 40-tool server vs Strumentario’s four; agent tool-choice eval on both.
3. Domain swap (blog ↔ internal handbook) without inventing new verb soup—same primitives, new schema.

---

### 5. Scaffold a typed studio stub, then repair until it compiles

**Who:** Developer (or Maglio-style overnight job) who needs a narrow typed client / page / studio stub from the schema—not a one-shot CLI dump that bitrots.

**Today:** Scaffolds are fire-and-forget. Failures are “open a PR and hope.” No stop condition, no compile/structure scorer, no agent capability to *repair*.

**With Strumentario:** Scaffold is an **agent capability** with compile/structure feedback and a stop condition, measured in evals. CLI may exist; agents can do the same loop.

**Bets shown:** Scaffold + repair as an agent capability · Evals as product

**Demo sketch:**

1. `scaffold` from schema → intentional type error in the stub.
2. Repair loop: feedback → patch → stop when `tsc` (or structure check) passes.
3. Braintrust trajectory scorer: step budget, unexpected tools, runaway loops fail the case.

---

### 6. Company knowledge → instruments → overnight factory

**Who:** Company with ADRs, standards, and domain docs already curated (or moving onto Nocciolo), and production assembly jobs (or Maglio factories) that should call real tools overnight.

**Today:** Memory/runtime projects and factory scaffolds don’t own the MCP content instrument layer. Teams rebuild wiring each time. Agents rediscover conventions every session; batch jobs call brittle scripts instead of stable tools.

**With Strumentario:** Explicit seams—**Nocciolo** seeds durable context instruments can recall/validate against; **Strumentario** owns the measurable MCP instruments; **Maglio** factories call those tools in structured loops. Use together or independently; boundaries stay clear (Strumentario is not the memory system or the factory).

**Bets shown:** Knowledge ↔ instruments ↔ factory · Local control · Complement, don’t compete

**Demo sketch:**

1. Architecture diagram: Nocciolo bank → Strumentario tools → Maglio overnight step.
2. Agent recalls project standards (Nocciolo/Hindsight), then **validate**s a content mutation against schema-backed instruments.
3. Factory job invokes the same mutate/validate tools headless—no widget required.

---

### 7. Regulated or ownership-sensitive teams that refuse a cloud control plane

**Who:** Enterprise, contractor, or OSS maintainer who will self-host agents and tools; cloud may be used for optional eval dashboards, not for the core instrument loop.

**Today:** Some MCP stacks soft-push hosted paths. Core loop becomes entangled with a vendor control plane. Hard to version-control “what agents can do.”

**With Strumentario:** Local control is a **hard principle**. Server, schemas, golden cases, and scaffolds live in git. Optional Braintrust keys measure quality; they are not required to serve MCP.

**Bets shown:** Local control, hard · Measurable without mandatory cloud runtime

**Demo sketch:**

1. Airplane-mode / keys-optional path: serve MCP + run unit/structure checks offline.
2. With keys: same suite uploads a Braintrust experiment; without keys: server still runs.
3. Show `.env.example` only—no secrets in tree.

---

### 8. Hiring screen / public craft: evals and postmortems as deliverables

**Who:** Contractor, staff+ candidate, or open-source maintainer who needs evidence of agentic engineering practice—not only a widget GIF.

**Today:** Repos show “I connected MCP.” Little on regressions caught, landscape honesty, or failure analysis.

**With Strumentario:** Architecture notes, experiment summaries, and failure postmortems are **product**. A reviewer can say: remote content primitives, measurable tool changes, multi-surface coherence, clear Nocciolo/Maglio seams.

**Bets shown:** Craft artifacts as product · Landscape honesty

**Demo sketch:**

1. README cold path + one eval summary + one postmortem linked from the demo.
2. Talking points match [ROADMAP demo goals](../ROADMAP.md#demo-goals-what-a-reviewer-should-be-able-to-say).
3. Explicit non-goals slide: not out-running mcp-use on widgets or FastMCP on decorators.

---

## Differentiation → demo matrix

Use this when planning real demos. Prefer vertical slices that make the bet *obvious* in under 15 minutes.

| Differentiation bet | Real-world proof | Peer contrast (honest) | Minimum demo artifact |
|---------------------|------------------|------------------------|------------------------|
| **Evals as product** | Regression caught by golden tool-choice / schema scorer before UI polish | mcp-use / Apps kits / FastMCP: evals rare or afterthought | Runnable suite + checked-in experiment summary |
| **One schema → three surfaces + evals** | Same mutate args from Cursor, widget, AI SDK | Hand-forked tool defs per surface | One schema → three call sites, identical contracts |
| **Content-domain primitives** | query / mutate / validate / scaffold as the product surface | Unbounded generated or decorator catalogs | Inspector screenshot of the small high-signal set |
| **Scaffold + repair** | Stub fails compile → repair → stop; scored in evals | One-shot CLI / generators without feedback loop | Loom of repair loop + structure/compile scorer |
| **Knowledge ↔ instruments ↔ factory** | Recall standards → validate content → factory calls same tools | Standalone MCP servers with no stack story | Diagram + headless factory invocation |
| **Local control, hard** | Core loop without cloud control plane | Soft cloud defaults elsewhere | Offline serve + optional Braintrust |
| **Craft artifacts as product** | Postmortem + landscape note as demo assets | Docs as leftover | `docs/postmortems/` + eval write-up in the walkthrough |

---

## Suggested flagship demos (build order)

Aligned with roadmap phase gates—**do not** lead with a generic widget if Phase 2 evidence is missing.

### Demo A — Eval-first content instruments (credibility)

**Story:** “Other repos show a widget. We show a failing eval that protects tool choice—then the same tools in Cursor.”

1. Content schema + remote Streamable HTTP server (query / mutate / validate / scaffold-oriented tool).
2. Golden dataset: happy path + missing args + invalid payload + refuse/do-nothing.
3. Code scorers for tool choice and output shape; one public summary in `docs/`.
4. Optional: deliberately regress a tool description; show red → fix → green.

**Primary bets:** Evals as product · Content primitives · Local control

### Demo B — Multi-surface without drift

**Story:** “One schema; agents and humans share instruments.”

1. Same tools from Demo A.
2. MCP App widget (React first) *and* a thin AI SDK path calling identical handlers.
3. Side-by-side recording: one intent, three surfaces.
4. Point to generation/sync path so reviewers see why forks won’t silently diverge.

**Primary bets:** One schema → three surfaces · Protocol first

### Demo C — Scaffold + repair overnight

**Story:** “Agents build, not only query—and we measure when they stop.”

1. Scaffold typed studio stub from schema.
2. Inject a compile/structure failure; run repair with clear stop condition.
3. Trajectory / step-budget scorer in Braintrust.
4. Optional Maglio-shaped job: overnight scaffold + validate against golden structure.

**Primary bets:** Scaffold + repair · Knowledge ↔ instruments ↔ factory

### Demo D — Stack seams (Nocciolo → Strumentario → Maglio)

**Story:** “Memory, instruments, and factories are complementary layers.”

1. Seed/recall durable standards via Nocciolo/Hindsight (as this repo already does for agents).
2. Strumentario validate/mutate against schema-backed content.
3. Document (or stub) a Maglio factory step that calls the same MCP tools headless.

**Primary bets:** Knowledge ↔ instruments ↔ factory · Complement, don’t compete

---

## Anti-scenarios (choose a peer instead)

Be honest in demos and sales conversations:

| If you mainly need… | Prefer |
|---------------------|--------|
| Fastest arbitrary tools + React widget auto-registration | mcp-use / official MCP Apps kits |
| Decorator elegance / Python tool servers | FastMCP / mcpkit-style frameworks |
| One-shot generate server from OpenAPI / NL | Generation tools (e.g. mcp-anything) |
| Durable memory / company brain | Nocciolo |
| Overnight factory / assembly-line config | Maglio |

Strumentario wins when the job is **owning measurable content instruments** shared by agents and humans—from schema through evals, surfaces, and repair—under local control.

---

## How to extend this doc

When a phase lands, replace “demo sketch” bullets with links to:

- GIFs / Looms in the README
- Concrete golden case IDs and experiment summaries under `docs/evals/`
- Postmortems under `docs/postmortems/`

Keep scenarios high-signal. Prefer updating an existing vignette over adding a tenth overlapping story.
