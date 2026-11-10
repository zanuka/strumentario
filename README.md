# Strumentario

**One schema → shared instruments for agents and humans.**

![One schema → shared instruments for agents and humans](images/strumentario-schema-diagram.png)

Strumentario is a local-first MCP content toolkit. One schema produces a remote Streamable HTTP server, MCP App widgets across major web frameworks, AI SDK product paths, and agentic scaffolds — all measurable with Braintrust and designed to sit between durable project knowledge (Nocciolo) and production factories (Maglio). Protocol first, product second, evals non-negotiable.

It treats MCP as a **durable content instrument layer** instead of another one-off tool adapter. Most options today solve the “make a server run” problem. Strumentario aims at the harder, more common problem: standing up a coherent, measurable, multi-surface set of instruments that agents and humans can actually share—and keeping that set under the developer’s control.

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![Status: Early](https://img.shields.io/badge/Status-Early%20%2F%20Public-orange)]()

---

## Goal

Give developers a single, declarative toolkit to:

- stand up a **remote MCP server** (Streamable HTTP) with real tools, resources, and prompts
- expose the same capabilities through an **MCP app widget** (ChatGPT Apps / MCP Apps path) across common web frameworks
- **scaffold** typed clients, pages, or studio stubs from a schema
- call the same tools from an **AI SDK product surface** (Vercel AI SDK, OpenAI, Anthropic, and peers)
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

### Where other options leave developers

| Approach | What it optimizes for | Typical developer friction |
|----------|-----------------------|----------------------------|
| **Official SDKs + stdio examples** | Protocol compliance | Heavy plumbing; remote/multi-client rarely ships; no product surfaces or evals |
| **mcp-use** | Server + React MCP App widgets + scaffolder | Excellent DX for widgets and remote transport, but less emphasis on content primitives, AI SDK paths as equals, or eval-first measurability; cloud path is available |
| **MCP Framework / mcpkit-style** | Boilerplate reduction, discovery, multi-transport, auth | Strong server scaffolding; stops at “good tools”; little on widgets, scaffolds-as-capabilities, or golden-trace evals |
| **FastMCP (Python)** | Decorator DX and rapid tool servers | Great for Python tool servers; weak on React/TS product surfaces and the content-toolkit story |
| **Official MCP Apps kits** | Interactive UI resources / widgets | Strong on the widget layer; thinner on the full server + eval + scaffold loop |
| **Generation tools (e.g. mcp-anything)** | Auto-generate servers from APIs/code/NL | Fast start; weaker on ongoing ownership, local control, and measurable iteration |

Common outcome: developers still rebuild query / mutate / validate / list patterns per domain, ship fragile adapters, and have no reliable way to know whether a tool or scaffold change actually improved quality.

## The Vision

Strumentario starts from a schema (or a small set of domain resources) and produces:

1. A remote MCP server with **query, mutate, validate, and scaffold** as the product surface (not a grab-bag of demos)
2. An MCP app widget across major web frameworks (React, Vue, Svelte, and peers) that can be embedded in ChatGPT Apps (and similar hosts)
3. A CLI / skill pack that scaffolds a minimal app or studio from the same schema
4. A first-class product path using common AI SDKs (Vercel AI SDK, OpenAI, Anthropic, and peers) that calls the identical tools
5. A Braintrust suite with golden tool traces and compile/structure checks
6. Architecture notes, eval summaries, and failure postmortems that double as interview artifacts

Everything stays local-first and standards-first. You own the data, the hosting, and the evaluation criteria.

## How Strumentario differs

The MCP landscape already has strong remote servers (MCP Framework, FastMCP), excellent React widget runtimes and auto-registration (mcp-use, official MCP Apps kits), elegant zero-boilerplate tool definition (mcpkit-style frameworks), and fast generation paths from APIs or natural language. Competing on decorator elegance or the richest widget discovery path is a losing bet. Other projects mostly help you *build an MCP server* (or widgets on top of one). Strumentario is designed to help you *own a durable, measurable instrument set*.

### Differentiation bets

| Bet | Why it matters |
|-----|----------------|
| **Evals as product** | Braintrust golden traces, tool-choice scorers, and scaffold compile checks land *before* (or tightly with) human surfaces — not as an afterthought |
| **One schema → three surfaces + evals** | Protocol server, MCP App widgets across major web frameworks, and AI SDK product path are equal citizens generated from one declarative core |
| **Content-domain primitives** | query / mutate / validate / scaffold — a small high-signal set, not an unbounded tool catalog |
| **Scaffold + repair as an agent capability** | Schema → artifacts → compile/structure feedback → stop condition, measured in evals |
| **Knowledge ↔ instruments ↔ factory** | Explicit seams with Nocciolo (durable context instruments recall against) and Maglio (factories that call these tools overnight) |
| **Local control, hard** | Core loop works without a cloud control plane |
| **Craft artifacts as product** | Architecture notes and failure postmortems are deliverables, not leftover docs |

### How the local-first content toolkit helps

1. **Local control as the default, not an afterthought** — Core loop (server, schemas, evals, scaffolds) is self-hostable and version-controlled. No forced cloud runtime for the instruments themselves. Matches teams that already run local agents (Cursor, Claude Code, etc.) and want the same ownership model for the tools those agents call.

2. **Content primitives instead of “any tool”** — Productizes a small, high-signal set—query, mutate, validate, scaffold—rather than encouraging a large catalog of ad-hoc tools. These are the patterns content and knowledge domains keep re-implementing. Developers get a coherent instrument set instead of rediscovering the same shapes every project.

3. **One declarative core → multiple coherent surfaces** — A schema (or small set of domain resources) drives a remote Streamable HTTP MCP server (Inspector-ready, multi-client), MCP App widgets across major web frameworks, a thin AI SDK product path (Vercel AI SDK, OpenAI, Anthropic, and peers) that calls the *same* tools, and CLI / skill scaffolding of typed clients, pages, or studio stubs. Protocol stays the source of truth; UIs and product code are views over it. Headless agents and human surfaces stay aligned.

4. **Measurability built in (Braintrust golden traces)** — Evals are not an optional later stage. Golden traces / datasets + tool-choice scorers + scaffold compile/structure checks make changes visible. Developers can answer “did this tool or scaffold change improve quality?” instead of relying on vibes or manual inspection.

5. **Progressive, craft-respecting path** — Remote server + Inspector first; evals next (so quality is measurable early); human surfaces (widget and/or AI SDK); then agentic scaffolding + repair loops. Traditional TypeScript architecture, tests, and reviews remain the baseline; agents amplify them. This avoids “prompt theater” and keeps the output reviewable.

6. **Clear place in a larger agentic stack** — Sits between durable project knowledge (Nocciolo / company-brain config) and production factories (Maglio). Developers who already curate ADRs, standards, and domain docs can turn that knowledge into instruments agents inherit, then later wire those instruments into structured overnight loops—without rebuilding the wiring each time.

7. **Portfolio- and contributor-ready artifacts** — Architecture notes, eval summaries, and failure postmortems are treated as product. For contractors and open-source contributors this turns the repo into both a working toolkit and a concrete demonstration of agentic engineering practice.

### Practical developer outcomes

- Faster path from “I need tools for this domain” to a remote, multi-client MCP surface that agents can already call
- Less repeated boilerplate around query/mutate/validate and surface wiring
- Same tools usable by Cursor/Claude Code *and* by a React widget or AI SDK UI without drift
- Confidence that tool and scaffold changes are measurable (via golden traces and scorers)
- Ownership stays local; no requirement to adopt a hosted control plane for the core instruments
- A clear growth path toward repair loops and tighter knowledge/factory integration without rewriting the foundation

**Why contribute here** instead of adjacent MCP projects: if you care about proving tools got better, keeping content primitives coherent across protocol and product surfaces, and building the instrument layer in a knowledge→instruments→factory stack, this is the repo that treats those as non-negotiable. If you want the fastest path to arbitrary tools + auto-registered React widgets, mcp-use and the official Apps kits already own that lane — we are not trying to out-run them there.

What we deliberately do **not** chase for differentiation: pure boilerplate reduction, richest widget auto-discovery, multi-tenant auth perfection, plugin marketplaces, full CMS parity, or becoming “the” agent runtime / memory system (that is Nocciolo / Maglio territory).

**Bottom line:** Other projects mostly help you *build an MCP server* (or widgets on top of one). Strumentario’s local-first content toolkit is designed to help you *own a durable, measurable instrument set*—the same tools agents and humans share—starting from schemas and progressing through remote protocol, evals, product surfaces, and scaffolding, while staying under your control and aligned with traditional engineering craft.

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

## Quick Start

```bash
pnpm install
pnpm --filter @strumentario/server serve
```

This starts the local Streamable HTTP MCP endpoint at `http://localhost:3001/mcp`. Configuration (see `env.example`):

- `PORT` — listen port, default `3001`.
- `HOST` — bind address, default `127.0.0.1` (loopback only).
- `MCP_AUTH_TOKEN` — optional shared secret; when set, `/mcp` requires `Authorization: Bearer <token>`. It acts as a write token.
- `MCP_READ_TOKEN` / `MCP_WRITE_TOKEN` — optional split: a read token may call `readOnlyHint: true` tools (`query`, `validate`, `repair`) and read resources; a write token may call everything (`mutate`, `scaffold`). Not applied over stdio. See [token scopes](docs/server-transport-and-soak.md#token-scopes).
- `MCP_TRANSPORT` — `http` (default) or `stdio`. Streamable HTTP stays the primary path; stdio is the same server and tools for hosts that spawn it as a child process, with no port. Equivalent to the `--stdio` flag.
- `STRUMENTARIO_AGENT` — stdio only: the agent name recorded for calls (there are no headers over stdio).

To use stdio, point the host at `node /abs/path/to/packages/server/dist/serve.js --stdio` (after `pnpm build`) with `STRUMENTARIO_DATA_DIR` set; many such processes can share one data directory. stdout carries only protocol messages. See [docs/server-transport-and-soak.md](docs/server-transport-and-soak.md#stdio-transport) for a host config.

`GET /healthz` returns `200` for liveness checks. Send an optional `X-Strumentario-Agent` header to identify the calling agent. See [docs/server-transport-and-soak.md](docs/server-transport-and-soak.md) for the stateless-transport decision and soak results.

### Tools, resources and prompts (v0.1.0)

| Tool | Read-only | What it does |
| --- | --- | --- |
| `query` | yes | Get one handbook page by `slug`, or list pages (`text` filter, `limit`). Every page carries its `revision`. |
| `validate` | yes | Check a page draft against the schema without storing it. |
| `mutate` | no | Create, update or delete one page. Dry-run by default; `expectedRevision` guards updates and deletes, `idempotencyKey` makes retries safe. Every call is journaled. |
| `scaffold` | no | Generate a typed client or host config from the schema. Returns files in memory; writes only with `write: true` and `outDir`. |
| `repair` | yes | Fix scaffold files that fail `tsc` (`.ts`) or schema validation (`.json` host config). Feeds the errors back and re-checks, at most `maxRounds` (default 3) and stops early when a round does not shrink the errors. Returns the corrected files, rounds used, error counts per round and any remaining errors. Deterministic; touches no files or pages. |

| Resource | Contents |
| --- | --- |
| `strumentario://schemas/handbook-page` | JSON Schema of a page |
| `strumentario://pages/{slug}` | A stored page with its revision |
| `strumentario://journal` (`?since=<cursor>&limit=<n>`) | Append-only change journal, see [docs/journal.md](docs/journal.md) |

Prompt: `review-draft` (validate before any mutate).

### Connect an agent host

Start the server first (`pnpm --filter @strumentario/server serve`, default `http://localhost:3001/mcp`). Each snippet below was run against that server; the `X-Strumentario-Agent` header is optional and shows up in the [change journal](docs/journal.md) so you can tell hosts apart.

**Claude Code** (project-scoped, written to `.mcp.json`; use `--scope user` to make it global):

```bash
claude mcp add --transport http --scope project strumentario http://localhost:3001/mcp \
  --header "X-Strumentario-Agent: claude-code"
```

Put the name and URL before `--header`: the flag takes several values and swallows a trailing name.

**Cursor** (`.cursor/mcp.json` in the project, or `~/.cursor/mcp.json`):

```json
{
  "mcpServers": {
    "strumentario": {
      "url": "http://localhost:3001/mcp",
      "headers": { "X-Strumentario-Agent": "cursor" }
    }
  }
}
```

**Any other host** that speaks Streamable HTTP: point it at `http://localhost:3001/mcp`, transport `streamable-http`, and send `X-Strumentario-Agent: <your-agent-id>` if it supports custom headers. `strumentario call scaffold --json --input '{"target":"host-config"}'` prints all three files generated from the live tool list, so they cannot drift from the tool names.

**Server with bearer tokens.** If you started the server with `MCP_READ_TOKEN` / `MCP_WRITE_TOKEN` / `MCP_AUTH_TOKEN`, add `--header "Authorization: Bearer $TOKEN"` (Claude Code) or `"Authorization": "Bearer <token>"` under `headers` (Cursor). Give an agent the read token to limit it to `query` and `validate`. Do not commit tokens; use your host's env-var interpolation where it has one.

**Host that spawns the server (stdio).** No port, no token; see [server transport](docs/server-transport-and-soak.md#stdio-transport) for the entry.

What the host sees: tools `query`, `validate`, `mutate`, `scaffold`, `repair`; resources `strumentario://schemas/handbook-page`, `strumentario://pages/{slug}` and `strumentario://journal`; prompt `review-draft`.

Terminal agents and several agents at once: see the [CLI guide](docs/cli-guide.md) and the [multi-agent guide](docs/multi-agent.md).

### CLI quick start

The `strumentario` CLI is a thin MCP client: every command goes through the server's tools and resources, so there is no CLI-only API or write path.

```bash
pnpm --filter @strumentario/cli build
alias strumentario="node $PWD/packages/cli/dist/main.js"

strumentario serve                                   # same config as `pnpm --filter @strumentario/server serve`
strumentario serve --stdio                           # serve over stdin/stdout for hosts that spawn the server
strumentario tools                                   # tools and input schemas, straight from tools/list
strumentario call validate --json \
  --input '{"instance":{"title":"Getting started","slug":"getting-started","body":"Draft content."}}'
strumentario call mutate --input-file page.json      # dry-run unless the input says "dryRun": false
strumentario call mutate --help                      # description and schema come from the server
strumentario call scaffold --input '{"target":"host-config"}'   # typed client or host config, generated from the schema; returns files, writes nothing
strumentario call repair --input '{"files":[{"path":"strumentario-client.ts","content":"..."}]}'   # fix scaffold files that fail tsc or schema checks
strumentario batch --input-file calls.jsonl --concurrency 8    # many calls over one connection; {id,tool,input} lines in, {id,ok,result|error} lines out (see docs/batch.md)
strumentario resource strumentario://schemas/handbook-page
strumentario journal --limit 20                      # who changed what, from the change journal (see docs/journal.md)
```

Global options: `--url` (default `$STRUMENTARIO_URL` or `http://127.0.0.1:3001/mcp`), `--token` (default `$STRUMENTARIO_TOKEN` or `$MCP_AUTH_TOKEN`), `--agent <id>` (sent as `X-Strumentario-Agent`; default `$STRUMENTARIO_AGENT`), `--json` (only the result on stdout, diagnostics on stderr), `--dry-run` (`serve`: print the resolved config and exit; `call` and `batch`: force `dryRun: true` for tools that accept it, or `write: false` for `scaffold`).

| Exit code | Meaning |
| --- | --- |
| `0` | Success |
| `1` | Tool or validation error (for `batch`, any failed call or invalid line; including `validate` returning `valid: false`, an unknown tool, or a missing resource) |
| `2` | Usage error: unknown command or option, malformed `--input` |
| `3` | Connection or auth error: server unreachable or token rejected |

### MCP Inspector walkthrough

![MCP Inspector connected to Strumentario: four tools listed, validate called, structured result shown](images/inspector-validate.png)

1. Start the server with `pnpm --filter @strumentario/server serve`.
2. In another terminal, run `npx @modelcontextprotocol/inspector` and open its local URL.
3. **Add Servers → Add manually**, set the transport to `streamable-http` and the URL to `http://localhost:3001/mcp` (older Inspector versions: pick **Streamable HTTP** and enter the URL), then connect.
4. Open **Tools**: `query`, `mutate`, `validate`, `scaffold` and `repair` are listed. Open **Resources** for the page schema, stored pages and the change journal, and **Prompts** for `review-draft`.
5. Choose `validate`, enter `{"title":"Getting started","slug":"getting-started","body":"Draft content."}` as `instance` and run it: the result is `{"valid": true, "errors": []}`.

Inspector 2.13 shows a "Schema portability" warning on `validate` and `mutate`: their `instance` / `page` input is declared as an unconstrained value. The calls work; see the [changelog](CHANGELOG.md#known-issues).

## Why route agents through Strumentario

Strumentario is not an alternative to Claude Code, Cursor or Codex. It is the MCP server those hosts call, and the agent still does the reasoning: it decides what to write, Strumentario decides whether the write is allowed and records it. The alternative to calling the tools is the agent editing content files directly.

What the tools give you over raw file edits:

- **Stale writes are refused.** `mutate` update and delete take `expectedRevision` from `query`; if another agent changed the page first, the call returns a `conflict` with the current page instead of overwriting it.
- **Check before you write.** `validate` checks a draft without storing it, and `mutate` is a dry run by default (`dryRun: false` to write).
- **Retries are safe.** An `idempotencyKey` replays the original result instead of applying the change twice.
- **You can see who changed what.** Callers identify themselves (`X-Strumentario-Agent` or `--agent`) and every `mutate` outcome lands in the [change journal](docs/journal.md). The id is attribution, not authentication.
- **Access has two levels.** `MCP_READ_TOKEN` may call `query` and `validate` only; `MCP_WRITE_TOKEN` may call everything.
- **One contract everywhere.** Every host, the [CLI](docs/cli-guide.md) (including [`batch`](docs/batch.md)) and headless factories such as Maglio call the same four tools.

Plain agent editing is enough for one person, one agent and occasional edits. Put Strumentario in front when several agents write to the same content, when runs are unattended, or when content has to stay valid and traceable. The [multi-agent guide](docs/multi-agent.md) walks through two agents racing on one page.

### Why there is a tool-selection eval

None of this helps if an agent picks the wrong tool, for example a write when it meant a dry run, or `validate` when it meant `query`. Agents choose from the published names, descriptions and input schemas, so those are part of the contract. `pnpm eval:agent` gives a model the tool list from a live `tools/list` and scores which tool and arguments it picks. Run it when a tool, description or schema changes; it is a change-time check, not a daily one, and `pnpm eval:local` cannot see a description regression. It needs a model key and skips without one. **No live run has been recorded yet**; see the [evals doc](docs/evals/2026-11-10-agent-tool-selection.md).

## Core Principles

- **Protocol first, product second** — the MCP tools, resources, and prompts are the source of truth; UIs and scaffolds are views over them
- **Local control** — self-hostable, version-controlled, no forced cloud runtime for the core loop
- **Measurable** — every meaningful change to tools or scaffolds should be visible in an eval run; evals ship before (or tightly with) human surfaces
- **High-signal content primitives** — query / mutate / validate / scaffold over a noisy miscellaneous catalog
- **Traditional craft + agents** — clear TypeScript architecture, tests, and reviews remain the baseline; agentic scaffolding amplifies that craft
- **Progressive** — start with a single remote server and Inspector; grow into MCP app widgets, AI SDK paths, and repair loops only when the foundation is solid
- **Complement, don’t compete** — designed to sit next to Nocciolo (knowledge) and Maglio (factory); not a replacement for either

## Status

Strumentario is in the earliest public stage. We are building in the open. The TypeScript monorepo (`packages/server`, `packages/cli`, `packages/evals`) ships the Phase 1 MCP server (`query`, `mutate`, `validate`, `scaffold`, the change journal resource) and the Phase 2 local eval harness; `v0.1.0` is the first tagged release. See the [changelog](CHANGELOG.md).

```bash
pnpm install
pnpm typecheck
pnpm test
```

Guides: [CLI-first usage](docs/cli-guide.md), [several agents at once](docs/multi-agent.md), [how the stack fits together](docs/architecture/stack-seams.md). See [ROADMAP.md](./ROADMAP.md) for the phased plan, differentiation bets, and definition of done for v1.0. See [docs/use-cases.md](./docs/use-cases.md) for real-world scenarios and differentiation demos. See [docs/braintrust-eval-details.md](./docs/braintrust-eval-details.md) for the Braintrust eval strategy. See [docs/nocciolo-brain-details.md](./docs/nocciolo-brain-details.md) for the Nocciolo / Hindsight project memory bank (`.nocciolo/`, MCP recall).

## Relationship to Nocciolo & Maglio

| Layer        | Project       | Role                                              |
|--------------|---------------|---------------------------------------------------|
| Knowledge    | Nocciolo      | Durable company brain / memory bank config        |
| Instruments  | Strumentario  | MCP content toolkit — tools, surfaces, scaffolds  |
| Production   | Maglio        | Factory scaffold and assembly-line config         |

**Intended seams (even before deep integration):** Nocciolo seeds durable context that Strumentario instruments can recall and validate against; Maglio factories can call Strumentario tools overnight as part of production assembly. Use them together or independently — the stack story should stay coherent either way.

## Contributing

Issues, ideas, and PRs are welcome once the foundation lands. For now the best way to help is feedback on the vision and the initial CLI surface.

## Author

Created by [zanuka](https://github.com/zanuka) (Michael Delucchi)

## License

Copyright © 2026 Michael Delucchi. Released under the [MIT License](LICENSE).
