# Nocciolo knowledge bank for Strumentario

Strumentario uses [Nocciolo](https://github.com/zanuka/nocciolo) to turn durable project docs into a [Hindsight](https://hindsight.vectorize.io) memory bank that coding agents can **recall** and **reflect** against over MCP.

This is not a dump of the whole repo into a vector store. Nocciolo scans conservative durable sources (README, AGENTS.md, `docs/**`, ADRs), extracts high-signal sections, and retains them into a project bank with provenance. Agents inherit architecture, principles, and domain context instead of rediscovering them every session.

| Layer | Role |
|-------|------|
| **Docs in git** | Source of truth (README, AGENTS.md, ADRs, eval strategy, …) |
| **Nocciolo** | Config + scan/extract/seed + MCP / Cursor wiring |
| **Hindsight bank `strumentario`** | Structured memories agents query via MCP |
| **Agents** | Prefer `recall` / `reflect` on the bank before re-deriving from scattered files |

Local Hindsight is typically at `http://localhost:8888`. The single-bank MCP endpoint for this project is:

```text
http://localhost:8888/mcp/strumentario/
```

Auth (when the server requires a tenant key) uses the same secret as seed: set `NOCCIOLO_HINDSIGHT_API_KEY` in the environment Cursor inherits — never commit the key.

---

## What’s under `.nocciolo/`

```text
.nocciolo/
  config.json                 # project identity + bank id (commit)
  hindsight/
    bank-template.json        # Hindsight mission / directives / mental models (commit)
  local/
    seed-manifest.json        # incremental seed state (usually gitignore; machine-local)
```

Related agent wiring (also produced by Nocciolo, outside `.nocciolo/`):

| Path | Purpose |
|------|---------|
| `.cursor/mcp.json` | Cursor MCP entry for the project bank |
| `.cursor/rules/hindsight-bank.mdc` | Always-on rule: prefer bank recall for durable questions |
| `AGENTS.md` section between `<!-- nocciolo:hindsight-bank -->` markers | Same preference for non-Cursor agents |

### `config.json`

Written by `nocciolo init`. Portable project identity for this repo:

- `bankId`: `strumentario` — Hindsight bank name (project-specific)
- `provider`: `hindsight`
- `docker.containerName` / `volumeName` — which **local Docker server** hosts the bank (one container can hold many banks; not 1:1 with bank id)

Commit this file. It tells every clone which bank to seed and wire.

### `hindsight/bank-template.json`

Written by `nocciolo configure`. Importable Hindsight bank template (version `"1"`) that shapes how the bank thinks:

- **Retain / observations / reflect missions** — extract durable architecture, standards, and domain facts; ignore secrets and ephemeral noise
- **Mental models** — living summaries (project context, architecture decisions, coding standards) refreshed after consolidation
- **Directives** — e.g. prefer durable sources, cite provenance, do not invent conventions, local-first defaults

Commit this file. It is the *personality and policy* of the bank, separate from the retained memories themselves. Apply/import it into Hindsight (Control Plane or API) so mission and directives match the project before or alongside seeding.

### `local/seed-manifest.json`

Written by live `nocciolo seed`. Tracks **what was already retained** so re-seeds are incremental:

- Per source path: content hash, list of stable fact / `document_id`s, last seeded time
- Unchanged files are skipped on the next `seed` unless you pass `--force`
- Fact ids look like `nocciolo:README.md#the-vision` — Hindsight upserts by id instead of duplicating

This is **machine-local seed state**, not documentation. Prefer keeping it out of git (alongside other `.nocciolo/local/` cache). The bank in Hindsight is the shared memory; the manifest only speeds up re-seed on this machine.

Example shape (illustrative):

```json
{
  "version": 1,
  "bankId": "strumentario",
  "sources": {
    "README.md": {
      "contentHash": "…",
      "factIds": ["nocciolo:README.md#the-vision", "nocciolo:README.md#goal"]
    }
  }
}
```

---

## Happy path (this repo)

From a machine with Nocciolo built or on `PATH`, and a running Hindsight instance:

```bash
# already done for dogfood — re-run only when resetting
nocciolo init --bank-id strumentario --container-name <your-hindsight-container> --yes
nocciolo configure
# import .nocciolo/hindsight/bank-template.json into Hindsight for bank "strumentario"

nocciolo seed --dry-run
NOCCIOLO_HINDSIGHT_API_KEY='…' nocciolo seed

nocciolo mcp --write --write-agents --write-cursor-rules --include-auth
```

Preview first with `--dry-run`. Live seed can take several minutes (LLM extraction per candidate). Do not interrupt mid-retain; if you do, re-run `seed` (use `--force` if needed).

---

## How agents use it (MCP recall)

With Cursor MCP connected to `http://localhost:8888/mcp/strumentario/` and a valid API key env:

1. Agent asks a durable question (“What is Strumentario’s vision?”, “How do we treat Braintrust evals?”)
2. Rule / AGENTS guidance steers it to Hindsight **`recall`** (or **`reflect`** for synthesis)
3. Bank returns structured memories with provenance (source file / section ids), not a raw markdown paste
4. Docs in git remain authoritative; the bank is the agent-facing index of those docs

Verify connectivity: refresh MCP in Cursor Settings after writing `.cursor/mcp.json`, and confirm `NOCCIOLO_HINDSIGHT_API_KEY` is set for the Cursor process (GUI apps often miss terminal-only `export`s).

---

## What gets seeded (and what does not)

**In scope for this bank (current sources):**

- `README.md` — vision, principles, differentiation, relationship to Nocciolo/Maglio
- `AGENTS.md` — agent-facing project rules
- `docs/braintrust-eval-details.md` — eval architecture and local-first/secrets stance

**Out of scope by design:**

- Secrets, `.env`, credentials, keys
- Ephemeral chat, lockfiles, generated noise
- Every file in the tree — only durable, high-signal sections

See Nocciolo’s [sensitive-data](https://github.com/zanuka/nocciolo/blob/main/docs/sensitive-data.md) policy for the denylist mindset.

---

## Why this matters for Strumentario

Strumentario sits between durable knowledge (Nocciolo) and production factories (Maglio). Seeding this bank means agents working on the MCP content toolkit start with:

- Protocol-first / local-first product bets
- Eval-as-product expectations
- Clear boundaries vs Nocciolo and Maglio

…without re-reading the entire README every session. Update docs → `nocciolo seed --dry-run` → live `seed` when you want the bank to catch up.

## Related

- [AGENTS.md](../AGENTS.md) — principles + Hindsight bank section
- [README.md](../README.md) — product overview
- [Braintrust eval details](./braintrust-eval-details.md) — measurement layer
- [Nocciolo](https://github.com/zanuka/nocciolo) — CLI, roadmap, and dogfood docs
