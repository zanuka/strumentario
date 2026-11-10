# Schema generation

Core principle 5: the schema is the single source of truth. This note records what is generated from it today, what is planned, and how to add a second domain.

## The generation path

```text
DomainDefinition            packages/server/src/schema.ts   (handbookDomain — the only hand-written input)
        │  domain.ts: buildResourceShape / buildStoredShape
        ▼
zod schema + stored shape   handbookPageSchema, stored page shape (fields + revision)
        │  contracts.ts: buildToolDefinitions
        ▼
ToolDefinition              name, title, description, annotations, zod input/output shapes
        │                         │
        │ toToolContract           │ server.ts: registerTool(...)
        ▼                         ▼
ToolContract (JSON Schema)   MCP tools/list  ◄── drift test (contracts.test.ts)
```

A `DomainDefinition` (`domain.ts`) declares:

| Key | Meaning |
|-----|---------|
| `name`, `noun`, `slots` | Identifier, human noun for titles and descriptions, and the wire property names (`page` / `pages`) |
| `keyField` | Field that identifies one resource (`slug`) |
| `resources` | URI of the schema resource, the URI template for instances, and the URI of the change journal |
| `fields` | Typed fields with constraints and actionable error messages |
| `primitives` | Which of `query` / `mutate` / `validate` apply |

## What is generated today

From `handbookDomain` alone:

- **zod schema** — `handbookPageSchema` (strict), plus the `HandbookPage` type.
- **Resource JSON Schema** — `handbookPageJsonSchema`, served at `strumentario://schemas/handbook-page`.
- **MCP input and output schemas** for `query`, `mutate` and `validate` (`queryInputShape`, `mutateOutputShape`, ...), including the stored-page shape with `revision`.
- **Tool contracts** — `toolContracts`: framework-neutral `{ name, title, description, annotations, inputSchema, outputSchema }` with plain JSON Schema (draft-07, exactly what `tools/list` serves). No zod or SDK types, so the CLI, a scaffold or any other surface can consume them from `@strumentario/server` without a private API.
- **Change-journal contract** — `journalContract` (`uri`, `uriTemplate`, `entrySchema`, `pageSchema`) is generated from the same domain by `buildJournalDefinition`: the entry is keyed by `keyField` and reuses the `mutate` actions and error codes. See [docs/journal.md](../journal.md).
- **Scaffold templates and the `scaffold` tool** — `scaffold.ts` generates a typed TypeScript client (`target: "client"`) from `toolContracts` and the domain, and MCP host entries for Cursor, Claude Code and a generic JSON form (`target: "host-config"`) that list every tool in `toolContracts`. Both are deterministic. The tool returns `{ path, content }` files in memory and writes only with `write: true` and `outDir` (refusing to overwrite unless `overwrite: true`; `outDir` must stay inside the server's working directory or `STRUMENTARIO_SCAFFOLD_ROOT`). `scaffold.test.ts` type-checks the generated client under `tsc`, including against the SDK `Client`, so a contract change that breaks the client fails a test.
- **The `repair` tool** — `repair.ts` closes the loop on scaffold output. It runs the checks the scaffold tests run (`typecheck.ts` is the shared `tsc` check, and the host-config files are schema-validated), asks a fixer for corrections, applies them and re-checks, for at most `maxRounds` rounds (default 3) and stops early when a round does not reduce the error count (that round is discarded, so the result is never worse than the input). The default fixer regenerates a failing file the scaffold generator owns from the schema; it cannot fix other files, and says so by stopping with `no_progress` and returning the remaining errors. An optional model fixer (`STRUMENTARIO_REPAIR_MODEL` + `ANTHROPIC_API_KEY`) is tried only for what the template path could not change. **Why a companion tool and not a `scaffold` mode:** `scaffold` is write-capable (`readOnlyHint: false`), so a mode would force a write token on a call that never writes; `repair` is read-only and gets the read scope automatically. A mode would also change the shipped `scaffold` contract that golden evals and agents already depend on, and repair takes files in, not a target.
- **Tool registration metadata** — `server.ts` registers each tool from its generated definition; only the handlers are hand-written.

Tool names and wire shapes are unchanged by this generation, so golden evals stay valid. Change a shape and the eval cases move in the same change.

## Drift test

`packages/server/src/contracts.test.ts` starts the server in memory, lists the tools over MCP and compares title, description, annotations, input schema and output schema to the generated contracts. It also fails when a tool is registered without a contract or a contract has no tool. If you hand-edit a schema in `server.ts` (or anywhere else), it fails; edit the domain definition or the generator in `contracts.ts` instead.

## Changing a field

Edit the field in `schema.ts`. The zod schema, resource JSON Schema, tool schemas, descriptions that list fields and the contracts all follow with no other edit. The test `a field added to the definition shows up in the tool contracts` demonstrates this.

## Not generated yet (planned)

- Handlers: `query`, `mutate` and `validate` logic is still hand-written for the handbook store; the generator owns their shapes, not their behaviour.
- Widget prop schemas (Phase 3A) and AI SDK tool definitions (Phase 3B) — both will read `toolContracts`.
- More scaffold targets (page, studio stub) (Phase 4).
- Field kinds beyond strings (numbers, enums, references, arrays) and per-field descriptions in the resource JSON Schema.
- Per-domain registration: `createMcpServer` registers the handbook domain only; the slug check in `mutate` still imports `SLUG_PATTERN` directly.

## Adding a second domain

1. Define it with `defineDomain({ name, noun, slots, keyField, resources, fields, primitives })` next to `handbookDomain`. `defineDomain` rejects duplicate fields and an unknown `keyField`.
2. Build its contracts with `buildToolContracts(domain)` and its shapes with `buildToolDefinitions(domain)`; the output is the same `ToolContract` list consumed by every surface.
3. Implement the store and handlers for the new resource, then register them in `server.ts` from `buildToolDefinitions(domain)`. Tool names must not collide with the handbook tools; namespace them (for example `query_<domain>`) when two domains share a server, and add eval cases for the new names.
4. Extend the drift test to cover the new contracts.

Only the handbook page exists today; a second domain is out of scope until a phase asks for it.
