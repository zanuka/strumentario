# Strumentario Strategy

## Vision

<!-- vision: author-approved 2026-11-24 -->

`strumentario` exists so that agents and humans can change shared content through one contract that checks, previews, and records every write.
It serves developers and teams who run Claude Code, Cursor, Codex, or headless factory stages against content that more than one writer touches, sometimes unattended.
It turns declarative domain definitions into a small set of MCP instruments and every surface that calls them.
It owns exactly one thing: the write contract between an agent and a piece of shared content - query, validate, mutate, scaffold, repair, and the journal behind them.

### The protocol is the only API

The MCP tools, resources, and prompts are the source of truth.
The CLI, the widget, the AI SDK path, and generated host configs are MCP clients over the same `tools/list`, and none of them gets a private path to the store.
A surface reads tool names, descriptions, and schemas from the server at runtime, or from generated code guarded by a drift test; nothing is copied by hand.
Every tool stays callable headless, from a shell or a factory stage with no UI and no model in the loop.
Tools are grouped by what they do to content, not split one per verb.
A tool's annotations describe everything it can do, and a safety difference between actions lives in the input - a dry run, a revision - not in a new tool.

### One schema, many views

A domain definition generates tool contracts, resource schemas, widget prop types, and scaffold output.
A second domain is welcome when it flows through the same generator with no hand-written tool code and arrives with its own golden cases.
A new surface earns its place by consuming those contracts, not by redefining them.
Framework support means one framework-neutral component used as is from any framework.
A framework binding is welcome only as a thin adapter over the shared controller's state, with no UI, no tool calls, and no logic of its own, verified by the same behavior suite, and only when a real consumer needs it.
Per-framework UI components are refused.
Changing a wire shape is a deliberate act that moves the golden cases with it.

### Writes are safe by default

`mutate` is a dry run unless the caller says otherwise, and `scaffold` returns files in memory unless asked to write.
The server enforces what it can check about the write itself: validation runs inside `mutate`, a stale revision comes back as a conflict with the current page, and idempotency keys stop double writes across processes and restarts.
It does not require a prior dry run, because a required call proves only that a call happened, not that anyone read it; previewing is the client's job, through the widget, a skill, or host approval.
A conflict is never resolved on the server, because combining two edits is a content decision the agent makes with full context, and any merge helper lives in a client that previews the result.
Concurrency guarantees hold across separate server processes on one data directory, and tests that race those processes prove it.
Every outcome lands in an append-only journal with the calling agent's id and no page body, so it stays a short record factories can tail, not a second content store.
History lives in the store, and a revert is an ordinary update of the old body against the current revision.
Bearer tokens decide what a caller may do, and the agent id is attribution, not authentication.

### Measured, and honest about it

A change to a tool's name, description, schema, or behavior ships with golden cases or scorers that would catch its regression, and the local evals are the required check.
Evals land before or with the human surface they protect, never after.
Whether agents preview, validate, and pick the right tool is measured by the tool-selection eval, not forced by the server.
A live tool-selection run gates releases, not merges: no version tag ships without a recorded run in `docs/evals/` compared against the last tag.
A PR that changes a tool's name, description, or schema states whether that live run happened.
A result that was not run is reported as not run, and a run reported as not run does not count as measured.
A scorer is trusted only after it has been shown red on a deliberate regression.

### Local control

The core loop runs on one machine with a file store, loopback binding, and stdio or Streamable HTTP, with no cloud control plane.
The cold path is clone, build, and the checked-in host config, and the project runs no public endpoint; running the same server on a box you control is self-hosting.
The store sits behind one interface, and a backend is welcome only when it runs locally and passes the existing cross-process race, revision-conflict, and idempotency-replay tests unchanged.
Outside edits to a store are tolerable when they surface as conflicts at the next write.
Braintrust and model providers are optional and sit behind env flags, and their absence produces an actionable message, not a broken core.
The repo uses its own instruments on its own handbook, and the gaps found that way become issues.

### Scope

Strumentario is not a general MCP framework, a boilerplate reducer, a widget runtime, a CMS, or an agent runtime.
It does not front a hosted CMS or any store whose writers change content where the contract cannot see it.
It is not a memory system: it never reads an Orto bank, the bank never calls it, and one host config holding both servers is the whole integration.
`validate` stays deterministic and local; a standard every write must meet is encoded in the domain definition, a standard that needs judgment is recalled by the agent before it validates, and scoring against the bank belongs in evals.
`query` returns the current page and its revision the same way every time, and finding content by meaning is the bank's job.
It is not a factory: it does not schedule, queue, order, or retry work across stages, which Maglio owns, and coordination here is revisions and idempotency keys.
It does not implement OAuth or user accounts; a team that exposes the server puts it behind an access layer it already runs.
It does not grow a catalog of miscellaneous tools or a plugin marketplace.

A change aligns when it makes a shared write safer, more checkable, or more traceable, keeps every surface on the published tool contracts, runs on a machine the user controls, and arrives with evidence that would catch its own regression.
A change should be resisted when it adds a private path to content, a hand-written surface contract, a tool that overlaps an existing primitive, server-side policy a client should decide, a dependency on a network or model in the core tools, a hosted endpoint, or a claim of quality that no run demonstrates.
