# AGENTS.md — Strumentario

This file is the primary source of truth for any AI agent working on Strumentario. Cursor rules under `.cursor/rules/` reinforce the same contracts with path-specific detail.

## Project Identity

Strumentario is a local-first **MCP content toolkit**. One schema produces a remote Streamable HTTP server, MCP App widgets across major web frameworks, AI SDK product paths, and agentic scaffolds — all measurable with Braintrust and designed to sit between durable project knowledge (Nocciolo) and production factories (Maglio). Protocol first, product second, evals non-negotiable.

We are building this in public as open source.

**Not** another generic MCP framework or TypeScript server scaffolder. Peers already own boilerplate reduction (mcpkit / MCP Framework / FastMCP) and React widget auto-registration (mcp-use, official MCP Apps kits). Strumentario wins on evals-as-product, content-domain primitives, multi-surface generation from one schema, and the knowledge ↔ instruments ↔ factory stack.

## Core Principles (non-negotiable)

1. **Protocol first, product second**  
   MCP tools, resources, and prompts are the source of truth. MCP App widgets (any major web framework) and AI SDK UIs are views over the same capabilities.

2. **Local control first**  
   Prefer self-hostable, version-controlled designs. Do not make a cloud control plane required for the core server loop.

3. **Measurable**  
   Meaningful tool or scaffold changes should be visible in an eval (tool choice, schema validity, compile/structure checks). Evals land before (or tightly with) human surfaces — protect Phase 2 sequencing in `ROADMAP.md`.

4. **High-signal content primitives**  
   query / mutate / validate / scaffold are the product. Prefer this small set over a noisy miscellaneous catalog.

5. **Schema generates surfaces**  
   The schema is the single source of truth that generates typed tool handlers, resource definitions, widget prop schemas, AI SDK tool definitions, and scaffold templates. Do not hand-fork divergent surfaces.

6. **Amplify existing craft**  
   Strong TypeScript, tests, and reviews remain the baseline. Agentic scaffolding amplifies that craft; it does not replace it.

7. **Progressive delivery**  
   Remote server + Inspector first; then evals; then human surfaces (MCP App widgets across major frameworks + AI SDK path as equal citizens); then scaffold + repair. Depth on the current phase beats breadth.

8. **Clear boundaries**  
   Keep server, schema, surfaces, scaffold/repair, and evals separated. Do not collapse them into one opaque package.

9. **Complement Nocciolo and Maglio**  
   Nocciolo seeds durable context instruments can recall against; Maglio factories can call Strumentario tools overnight. Keep those seams explicit even before deep integration. Do not absorb runtime/memory or factory concerns into this repo.

## Architecture Expectations

- TypeScript (Node.js) monorepo or clear packages: `server`, `cli`, `evals`, optional `widget` / `web`
- Streamable HTTP MCP server as the primary remote path
- Tools remain callable headless (without UI)
- Surfaces: MCP App widgets for major web frameworks (React first, then Vue, Svelte, and peers) + first-class AI SDK product path — equal citizens, same tool contracts
- Config snippets for Cursor / Claude Code stay in sync with actual tool names
- Optional integrations (Braintrust, model providers) stay behind env flags

## Coding Standards

- Prefer small, composable functions and clear module boundaries
- Strong typing — avoid `any` unless there is a documented reason
- CLI commands should support `--dry-run` where they mutate state or write files
- Errors should be actionable (tell the user what to do next)
- No silent failures on tool handlers, transport, or scaffold output

## When Working on MCP / Tools

- Implement the high-signal set deliberately (query, mutate, validate, plus scaffold-oriented tools) — not a grab-bag of demos
- Typed input/output schemas; document tools for Inspector and agent hosts
- Side-effecting tools should be explicit and safe by default
- Resources for data; tools for actions; prompts for reusable workflows
- Keep contracts stable enough for golden evals; changing a tool shape means updating scorers/cases

## When Working on Surfaces

- Treat MCP App widgets and the AI SDK path as equal outputs of the schema, not optional side demos
- Framework support means major web frameworks, not React-only forever (React may lead; peers must remain first-class)
- Do not invent a parallel private API for UIs — call the same MCP capabilities
- A polished widget without visible eval/content-primitive story is the highest mcp-use overlap risk — avoid that shape

## When Working on Evals / Scaffolds

- Golden datasets belong in the repo or have a documented export path
- Add or update eval cases when tool or scaffold behavior changes
- Prefer a public experiment summary in `docs/` over another hello-world widget demo when sequencing is tight
- Scaffolds should be narrow, typed, and reviewable
- Repair loops need a clear feedback signal and a stop condition
- Scaffold is an agent capability that is eval’d, not only a one-shot CLI

## Documentation & Public Development

- Keep README, ROADMAP, and this file aligned on positioning and phase gates
- Prefer updating living docs over leaving stale comments
- When completing a phase item, update ROADMAP status
- Architecture notes, landscape notes, and failure postmortems are part of the product
- Highest-leverage contributions: content primitives, eval scorers/golden traces, schema→surface generation, repair-loop feedback, architecture/postmortems — not boilerplate shaving or widget polish for its own sake

## What Agents Should Not Do

- Do not invent architecture that contradicts protocol-first or local-control principles
- Do not expand into multi-tenant auth, full CMS parity, or a plugin marketplace unless the current phase asks for it
- Do not make cloud-only paths the default for the core MCP server
- Do not treat any MCP App widget or AI SDK UI as the source of truth instead of the MCP surface
- Do not compete on decorator elegance or richest widget auto-discovery — that is peer territory
- Do not turn Strumentario into an agent runtime or durable memory system (Nocciolo / Maglio)
- Do not add a large miscellaneous tool catalog in Phase 1 to look “complete”
- Do not skip or bury Phase 2 evals to rush a surface demo
- Do not write real secrets into the tree

## Current Focus

See `ROADMAP.md`. At the time of writing we are in early foundation (Phase 0 → Phase 1: remote MCP server + Inspector path). Protect the differentiation bets and phase gates documented there.
