# Strumentario

**The instrumentarium for agentic MCP servers.**

Strumentario (Italian for *instrumentarium* / set of instruments) — a local-first MCP content toolkit that turns schemas, tools, and constraints into production-ready remote MCP servers, web surfaces, and agentic scaffolds.

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

Aligns with [Nocciolo](https://github.com/) (durable company-brain / memory config) and [Maglio](https://github.com/) (factory scaffold and assembly-line config). Nocciolo supplies durable context; Maglio shapes production systems; Strumentario provides the MCP instrument layer that both can use.

## The Problem

Building a useful MCP server is still too much boilerplate and too little product thinking.

Most teams either:

- copy a minimal stdio example and never ship a remote, multi-client surface
- treat the server as a throwaway adapter with no evals, no repair loop, and no human-facing UI
- rebuild the same query / mutate / validate / scaffold patterns for every new domain

The result is fragile tool surfaces that agents rediscover every session, UIs that drift from the protocol, and no measurable way to know whether a change improved tool selection or scaffold quality.

## The Vision

Strumentario is the **MCP content toolkit**.

It starts from a schema (or a small set of domain resources) and produces:

1. A remote MCP server with query, mutate, validate, and scaffold endpoints
2. An MCP app widget (React and other web frameworks) that can be embedded in ChatGPT Apps (and similar hosts)
3. A CLI / skill pack that scaffolds a minimal app or studio from the same schema
4. A thin product path using the Vercel AI SDK (or Anthropic) that calls the identical tools
5. A Braintrust suite with golden tool traces and compile/structure checks
6. Architecture notes, eval summaries, and failure postmortems that double as interview artifacts

Everything stays local-first and standards-first. You own the data, the hosting, and the evaluation criteria.

## What Strumentario Does

| Layer | Capability |
|-------|------------|
| **Server** | Streamable HTTP MCP server — tools, resources, prompts; Inspector-ready |
| **Surfaces** | MCP app widget for ChatGPT Apps / MCP Apps (React and other web frameworks) + optional AI SDK web UI |
| **Scaffold** | Schema → typed client / page / studio stub + repair loop |
| **Evals** | Braintrust golden traces, tool-choice scorers, scaffold compile checks |
| **Agent wiring** | Config snippets + skills / slash commands so Cursor, Claude Code, and peers can use the same instruments |
| **Docs** | Architecture, eval results, failure postmortems — written for both contributors and hiring screens |

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
- **Measurable** — every meaningful change to tools or scaffolds should be visible in an eval run
- **Traditional craft + agents** — clear TypeScript architecture, tests, and reviews remain the baseline; agentic scaffolding amplifies that craft
- **Progressive** — start with a single remote server and Inspector; grow into MCP app widgets, AI SDK paths, and repair loops only when the foundation is solid
- **Complement, don’t compete** — designed to sit next to Nocciolo (knowledge) and Maglio (factory); not a replacement for either

## Status

Strumentario is in the earliest public stage. We are building in the open.

See [ROADMAP.md](./ROADMAP.md) for the phased plan and definition of done for v1.0.

## Relationship to Nocciolo & Maglio

| Layer        | Project       | Role                                              |
|--------------|---------------|---------------------------------------------------|
| Knowledge    | Nocciolo      | Durable company brain / memory bank config        |
| Production   | Maglio        | Factory scaffold and assembly-line config         |
| Instruments  | Strumentario  | MCP content toolkit — tools, surfaces, scaffolds  |

Use them together or independently. Strumentario assumes good project knowledge exists and that you may later want a factory that can call these tools overnight.

## Contributing

Issues, ideas, and early design feedback are welcome. Once the server and eval skeleton land, small focused PRs on tools, scorers, widgets, and docs will be the highest-leverage contributions.

See [CONTRIBUTING.md](./CONTRIBUTING.md) (stub) for the working agreements.

## License

MIT
