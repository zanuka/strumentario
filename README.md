# Strumentario

**The instrumentarium for agentic MCP servers.**

Strumentario is the local-first MCP content toolkit. One schema produces a remote Streamable HTTP server, MCP App widgets across major web frameworks, AI SDK product paths, and agentic scaffolds — all measurable with Braintrust and designed to sit between durable project knowledge (Nocciolo) and production factories (Maglio). Protocol first, product second, evals non-negotiable.

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![Status: Early](https://img.shields.io/badge/Status-Early%20%2F%20Public-orange)]()

---

## Goal

Give developers a single, declarative toolkit to:

- stand up a **remote MCP server** (Streamable HTTP) with real tools, resources, and prompts
- expose the same capabilities through an **MCP app widget** (ChatGPT Apps / MCP Apps path) across common web frameworks
- **scaffold** typed clients, pages, or studio stubs from a schema
- call the same tools from a **Vercel AI SDK / Anthropic** product surface
- measure quality with **Braintrust** golden traces and scaffold compile checks

Agents and humans share one coherent instrument set instead of reinventing the wiring every time.

The schema is the single source of truth that *generates* those surfaces: typed tool handlers, resource definitions, widget prop schemas, AI SDK tool definitions, and scaffold templates. Discovery and registration matter; coherence across protocol, product UI, product code path, and evals is the point.

Aligns with [Nocciolo](https://github.com/) (durable company-brain / memory config) and [Maglio](https://github.com/) (factory scaffold and assembly-line config). Nocciolo supplies durable context; Maglio shapes production systems; Strumentario provides the MCP instrument layer that both can use.

## The Problem

Building a useful MCP server is still too much boilerplate and too little product thinking.

Most teams either:

- copy a minimal stdio example and never ship a remote, multi-client surface
- treat the server as a throwaway adapter with no evals, no repair loop, and no human-facing UI
- rebuild the same query / mutate / validate / scaffold patterns for every new domain

The result is fragile tool surfaces that agents rediscover every session, UIs that drift from the protocol, and no measurable way to know whether a change improved tool selection or scaffold quality.

Generic MCP frameworks optimize for arbitrary tool authoring and boilerplate reduction. Content and knowledge domains keep re-implementing the same high-signal primitives — and almost never ship evals or a multi-surface story from one declarative core.

## The Vision

Strumentario is the **MCP content toolkit**.

It starts from a schema (or a small set of domain resources) and produces:

1. A remote MCP server with **query, mutate, validate, and scaffold** as the product surface (not a grab-bag of demos)
2. An MCP app widget across major web frameworks (React, Vue, Svelte, and peers) that can be embedded in ChatGPT Apps (and similar hosts)
3. A CLI / skill pack that scaffolds a minimal app or studio from the same schema
4. A first-class product path using the Vercel AI SDK (or Anthropic) that calls the identical tools
5. A Braintrust suite with golden tool traces and compile/structure checks
6. Architecture notes, eval summaries, and failure postmortems that double as interview artifacts

Everything stays local-first and standards-first. You own the data, the hosting, and the evaluation criteria.

## How Strumentario differs

The MCP landscape already has strong remote servers (MCP Framework, FastMCP), excellent React widget runtimes and auto-registration (mcp-use, official MCP Apps kits), and elegant zero-boilerplate tool definition (mcpkit-style frameworks). Competing on decorator elegance or the richest widget discovery path is a losing bet.

Strumentario leans where those projects are thin:

| Bet | Why it matters |
|-----|----------------|
| **Evals as product** | Braintrust golden traces, tool-choice scorers, and scaffold compile checks land *before* (or tightly with) human surfaces — not as an afterthought |
| **One schema → three surfaces + evals** | Protocol server, MCP App widgets across major web frameworks, and AI SDK product path are equal citizens generated from one declarative core |
| **Content-domain primitives** | query / mutate / validate / scaffold — a small high-signal set, not an unbounded tool catalog |
| **Scaffold + repair as an agent capability** | Schema → artifacts → compile/structure feedback → stop condition, measured in evals |
| **Knowledge ↔ instruments ↔ factory** | Explicit seams with Nocciolo (durable context instruments recall against) and Maglio (factories that call these tools overnight) |
| **Local control, hard** | Core loop works without a cloud control plane |
| **Craft artifacts as product** | Architecture notes and failure postmortems are deliverables, not leftover docs |

**Why contribute here** instead of adjacent MCP projects: if you care about proving tools got better, keeping content primitives coherent across protocol and product surfaces, and building the instrument layer in a knowledge→instruments→factory stack, this is the repo that treats those as non-negotiable. If you want the fastest path to arbitrary tools + auto-registered React widgets, mcp-use and the official Apps kits already own that lane — we are not trying to out-run them there.

What we deliberately do **not** chase for differentiation: pure boilerplate reduction, richest widget auto-discovery, multi-tenant auth perfection, plugin marketplaces, full CMS parity, or becoming “the” agent runtime / memory system (that is Nocciolo / Maglio territory).

## What Strumentario Does

| Layer | Capability |
|-------|------------|
| **Schema** | Single declarative core → tools, resources, widget props, AI SDK defs, scaffold templates |
| **Server** | Streamable HTTP MCP server — high-signal tools, resources, prompts; Inspector-ready |
| **Surfaces** | MCP app widgets for major web frameworks (ChatGPT Apps / MCP Apps) + first-class AI SDK web path — views over the same tools |
| **Scaffold** | Schema → typed client / page / studio stub + repair loop |
| **Evals** | Braintrust golden traces, tool-choice scorers, scaffold compile checks |
| **Agent wiring** | Config snippets + skills / slash commands so Cursor, Claude Code, and peers can use the same instruments |
| **Docs** | Architecture, landscape notes, eval results, failure postmortems — written for contributors and hiring screens |

Later phases grow multi-schema support, event-driven updates, and tighter Nocciolo/Maglio integration.

## Quick Start (Coming Soon)

```bash
# From your project root (or a fresh directory)
npx @strumentario/cli init

# Scaffold a minimal remote MCP server + schema
strumentario scaffold --schema ./content-schema.ts

# Run the server (Streamable HTTP)
strumentario serve

# Emit agent host config + MCP Inspector instructions
strumentario mcp

# Run the Braintrust eval suite (requires keys)
strumentario eval
```

The CLI and packages are under active development. Goal: a working remote server + one surface + one eval path in under an hour once the foundation lands.

## Core Principles

- **Protocol first, product second** — the MCP tools, resources, and prompts are the source of truth; UIs and scaffolds are views over them
- **Local control** — self-hostable, version-controlled, no forced cloud runtime for the core loop
- **Measurable** — every meaningful change to tools or scaffolds should be visible in an eval run; evals ship before (or tightly with) human surfaces
- **High-signal content primitives** — query / mutate / validate / scaffold over a noisy miscellaneous catalog
- **Traditional craft + agents** — clear TypeScript architecture, tests, and reviews remain the baseline; agentic scaffolding amplifies that craft
- **Progressive** — start with a single remote server and Inspector; grow into MCP app widgets, AI SDK paths, and repair loops only when the foundation is solid
- **Complement, don’t compete** — designed to sit next to Nocciolo (knowledge) and Maglio (factory); not a replacement for either

## Status

Strumentario is in the earliest public stage. We are building in the open.

See [ROADMAP.md](./ROADMAP.md) for the phased plan, differentiation bets, and definition of done for v1.0.

## Relationship to Nocciolo & Maglio

| Layer        | Project       | Role                                              |
|--------------|---------------|---------------------------------------------------|
| Knowledge    | Nocciolo      | Durable company brain / memory bank config        |
| Instruments  | Strumentario  | MCP content toolkit — tools, surfaces, scaffolds  |
| Production   | Maglio        | Factory scaffold and assembly-line config         |

**Intended seams (even before deep integration):** Nocciolo seeds durable context that Strumentario instruments can recall and validate against; Maglio factories can call Strumentario tools overnight as part of production assembly. Use them together or independently — the stack story should stay coherent either way.

## Contributing

Issues, ideas, and early design feedback are welcome. Highest-leverage contributions reinforce what makes this project distinct: content primitives, eval scorers and golden traces, schema→surface generation, repair-loop feedback, architecture notes, and failure postmortems. Widget polish and boilerplate shaving matter less than making the measurable, multi-surface story obvious.

See [CONTRIBUTING.md](./CONTRIBUTING.md) (stub) for the working agreements.

## License

MIT
