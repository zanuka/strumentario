# AGENTS.md — Strumentario

This file is the primary source of truth for any AI agent working on Strumentario. Cursor rules under `.cursor/rules/` reinforce the same contracts with path-specific detail.

## Project Identity

Strumentario is the **MCP content toolkit**.

It helps developers stand up remote MCP servers, React MCP app widgets, schema-driven scaffolds, AI SDK product paths, and Braintrust evals so agents and humans share one coherent instrument set.

We are building this in public as open source.

Strumentario complements Nocciolo (company-brain / durable knowledge) and Maglio (factory scaffold). Nocciolo supplies context; Maglio shapes production systems; Strumentario provides the MCP instrument layer both can use.

## Core Principles (non-negotiable)

1. **Protocol first, product second**  
   MCP tools, resources, and prompts are the source of truth. React widgets and AI SDK UIs are views over the same capabilities.

2. **Local control first**  
   Prefer self-hostable, version-controlled designs. Do not make a cloud control plane required for the core server loop.

3. **Measurable**  
   Meaningful tool or scaffold changes should be visible in an eval (tool choice, schema validity, compile/structure checks).

4. **Amplify existing craft**  
   Strong TypeScript, tests, and reviews remain the baseline. Agentic scaffolding amplifies that craft; it does not replace it.

5. **Progressive delivery**  
   Remote server + Inspector first; then evals; then human surfaces; then scaffold + repair. Depth on the current phase beats breadth.

6. **Clear boundaries**  
   Keep server, schema, surfaces, scaffold/repair, and evals separated. Do not collapse them into one opaque package.

## Architecture Expectations

- TypeScript (Node.js) monorepo or clear packages: `server`, `cli`, `evals`, optional `widget` / `web`
- Streamable HTTP MCP server as the primary remote path
- Tools remain callable headless (without UI)
- Config snippets for Cursor / Claude Code stay in sync with actual tool names
- Optional integrations (Braintrust, model providers) stay behind env flags

## Coding Standards

- Prefer small, composable functions and clear module boundaries
- Strong typing — avoid `any` unless there is a documented reason
- CLI commands should support `--dry-run` where they mutate state or write files
- Errors should be actionable (tell the user what to do next)
- No silent failures on tool handlers, transport, or scaffold output

## When Working on MCP / Tools

- Prefer a small high-signal tool set (query, mutate, validate, scaffold) over a noisy catalog
- Typed input/output schemas; document tools for Inspector and agent hosts
- Side-effecting tools should be explicit and safe by default
- Resources for data; tools for actions; prompts for reusable workflows

## When Working on Evals / Scaffolds

- Golden datasets belong in the repo or have a documented export path
- Add or update eval cases when tool or scaffold behavior changes
- Scaffolds should be narrow, typed, and reviewable
- Repair loops need a clear feedback signal and a stop condition

## Documentation & Public Development

- Keep README and ROADMAP accurate
- Prefer updating living docs over leaving stale comments
- When completing a phase item, update ROADMAP status
- Architecture notes and failure postmortems are part of the product

## What Agents Should Not Do

- Do not invent architecture that contradicts protocol-first or local-control principles
- Do not expand into multi-tenant auth, full CMS parity, or a plugin marketplace unless the current phase asks for it
- Do not make cloud-only paths the default for the core MCP server
- Do not treat the React widget or AI SDK UI as the source of truth instead of the MCP surface
- Do not write real secrets into the tree

## Current Focus

See `ROADMAP.md`. At the time of writing we are in early foundation (Phase 0 → Phase 1: remote MCP server + Inspector path).
