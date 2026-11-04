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
| `resources` | URI of the schema resource and the URI template for instances |
| `fields` | Typed fields with constraints and actionable error messages |
| `primitives` | Which of `query` / `mutate` / `validate` apply |

## What is generated today

From `handbookDomain` alone:

- **zod schema** — `handbookPageSchema` (strict), plus the `HandbookPage` type.
- **Resource JSON Schema** — `handbookPageJsonSchema`, served at `strumentario://schemas/handbook-page`.
- **MCP input and output schemas** for `query`, `mutate` and `validate` (`queryInputShape`, `mutateOutputShape`, ...), including the stored-page shape with `revision`.
- **Tool contracts** — `toolContracts`: framework-neutral `{ name, title, description, annotations, inputSchema, outputSchema }` with plain JSON Schema (draft-07, exactly what `tools/list` serves). No zod or SDK types, so the CLI, a scaffold or any other surface can consume them from `@strumentario/server` without a private API.
- **Tool registration metadata** — `server.ts` registers each tool from its generated definition; only the handlers are hand-written.

Tool names and wire shapes are unchanged by this generation, so golden evals stay valid. Change a shape and the eval cases move in the same change.

## Drift test

`packages/server/src/contracts.test.ts` starts the server in memory, lists the tools over MCP and compares title, description, annotations, input schema and output schema to the generated contracts. It also fails when a tool is registered without a contract or a contract has no tool. If you hand-edit a schema in `server.ts` (or anywhere else), it fails; edit the domain definition or the generator in `contracts.ts` instead.

## Changing a field

Edit the field in `schema.ts`. The zod schema, resource JSON Schema, tool schemas, descriptions that list fields and the contracts all follow with no other edit. The test `a field added to the definition shows up in the tool contracts` demonstrates this.

## Not generated yet (planned)

- Handlers: `query`, `mutate` and `validate` logic is still hand-written for the handbook store; the generator owns their shapes, not their behaviour.
- Widget prop schemas (Phase 3A) and AI SDK tool definitions (Phase 3B) — both will read `toolContracts`.
- Scaffold templates and the scaffold tool (Phase 4).
- Field kinds beyond strings (numbers, enums, references, arrays) and per-field descriptions in the resource JSON Schema.
- Per-domain registration: `createMcpServer` registers the handbook domain only; the slug check in `mutate` still imports `SLUG_PATTERN` directly.

## Adding a second domain

1. Define it with `defineDomain({ name, noun, slots, keyField, resources, fields, primitives })` next to `handbookDomain`. `defineDomain` rejects duplicate fields and an unknown `keyField`.
2. Build its contracts with `buildToolContracts(domain)` and its shapes with `buildToolDefinitions(domain)`; the output is the same `ToolContract` list consumed by every surface.
3. Implement the store and handlers for the new resource, then register them in `server.ts` from `buildToolDefinitions(domain)`. Tool names must not collide with the handbook tools; namespace them (for example `query_<domain>`) when two domains share a server, and add eval cases for the new names.
4. Extend the drift test to cover the new contracts.

Only the handbook page exists today; a second domain is out of scope until a phase asks for it.
