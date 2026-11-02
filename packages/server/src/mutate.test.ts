import { mkdtemp, readdir, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mutatePage } from "./mutate.js";
import { createMcpServer } from "./server.js";
import { FileSystemPageStore } from "./store.js";
import { validateHandbookPage } from "./validate.js";

let dir: string;
let store: FileSystemPageStore;

beforeEach(async () => {
  dir = await mkdtemp(path.join(os.tmpdir(), "strumentario-mutate-"));
  store = new FileSystemPageStore(dir);
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

const page = (slug: string, body = `Body of ${slug}.`) => ({ title: `Title ${slug}`, slug, body });
const files = async () => (await readdir(dir)).filter((n) => !n.startsWith(".")).sort();

describe("mutatePage", () => {
  it("defaults to a dry run that reports the change and writes nothing", async () => {
    const result = await mutatePage(store, { action: "create", slug: "alpha", page: page("alpha") });
    expect(result).toMatchObject({ ok: true, dryRun: true, page: { slug: "alpha" } });
    expect(await files()).toEqual([]);

    await mutatePage(store, { action: "create", slug: "alpha", page: page("alpha"), dryRun: false });
    const stored = await store.get("alpha");
    // The dry-run revision is the one a real write produces.
    expect(result.page?.revision).toBe(stored?.revision);

    const dryUpdate = await mutatePage(store, {
      action: "update", slug: "alpha", page: page("alpha", "New."), expectedRevision: stored!.revision,
    });
    expect(dryUpdate).toMatchObject({ ok: true, dryRun: true, previous: stored });
    expect(await store.get("alpha")).toEqual(stored);

    const dryDelete = await mutatePage(store, { action: "delete", slug: "alpha", expectedRevision: stored!.revision });
    expect(dryDelete.ok).toBe(true);
    expect(await store.get("alpha")).toEqual(stored);
  });

  it("creates, updates and deletes with revision checks", async () => {
    const created = await mutatePage(store, { action: "create", slug: "alpha", page: page("alpha"), dryRun: false });
    expect(created).toMatchObject({ ok: true, dryRun: false });
    expect(await store.get("alpha")).toEqual(created.page);

    const updated = await mutatePage(store, {
      action: "update", slug: "alpha", page: page("alpha", "Changed."),
      expectedRevision: created.page!.revision, dryRun: false,
    });
    expect(updated.ok).toBe(true);
    expect(updated.page?.body).toBe("Changed.");
    expect(updated.previous).toEqual(created.page);

    const deleted = await mutatePage(store, {
      action: "delete", slug: "alpha", expectedRevision: updated.page!.revision, dryRun: false,
    });
    expect(deleted).toMatchObject({ ok: true, previous: updated.page });
    expect(await store.get("alpha")).toBeUndefined();
    expect(await files()).toEqual([]);
  });

  it("refuses invalid input with the validate tool's errors and writes nothing", async () => {
    const draft = { title: "", slug: "Bad Slug", body: "x" };
    const { errors } = validateHandbookPage(draft);
    const result = await mutatePage(store, { action: "create", slug: "Bad Slug", page: draft, dryRun: false });
    expect(result.ok).toBe(false);
    expect(result.error?.code).toBe("invalid");
    expect(result.error?.errors).toEqual(errors);
    expect(await files()).toEqual([]);
  });

  it("refuses a slug that differs from page.slug", async () => {
    const result = await mutatePage(store, { action: "create", slug: "one", page: page("two"), dryRun: false });
    expect(result.error?.code).toBe("invalid");
    expect(await files()).toEqual([]);
  });

  it("fails create on an existing slug unless overwrite is set", async () => {
    const first = await mutatePage(store, { action: "create", slug: "alpha", page: page("alpha"), dryRun: false });
    const clash = await mutatePage(store, { action: "create", slug: "alpha", page: page("alpha", "Other."), dryRun: false });
    expect(clash.error).toMatchObject({ code: "already_exists", currentRevision: first.page!.revision });
    expect((await store.get("alpha"))?.body).toBe("Body of alpha.");

    const over = await mutatePage(store, { action: "create", slug: "alpha", page: page("alpha", "Other."), overwrite: true, dryRun: false });
    expect(over.ok).toBe(true);
    expect((await store.get("alpha"))?.body).toBe("Other.");
  });

  it("requires expectedRevision for update and delete, and reports not_found", async () => {
    await store.put(page("alpha"));
    const noRev = await mutatePage(store, { action: "update", slug: "alpha", page: page("alpha", "x"), dryRun: false });
    expect(noRev.error?.code).toBe("revision_required");
    const noDelRev = await mutatePage(store, { action: "delete", slug: "alpha", dryRun: false });
    expect(noDelRev.error?.code).toBe("revision_required");
    expect(await store.get("alpha")).toBeDefined();

    const forced = await mutatePage(store, { action: "delete", slug: "alpha", overwrite: true, dryRun: false });
    expect(forced.ok).toBe(true);

    const missing = await mutatePage(store, { action: "update", slug: "alpha", page: page("alpha"), expectedRevision: "abc", dryRun: false });
    expect(missing.error?.code).toBe("not_found");
  });

  it("rejects a stale revision with a conflict carrying the current page", async () => {
    const original = await store.put(page("alpha"));
    const current = await store.put(page("alpha", "Edited elsewhere."));
    const result = await mutatePage(store, {
      action: "update", slug: "alpha", page: page("alpha", "Mine."), expectedRevision: original.revision, dryRun: false,
    });
    expect(result.error).toMatchObject({ code: "conflict", currentRevision: current.revision, currentPage: current });
    expect(await store.get("alpha")).toEqual(current);

    const del = await mutatePage(store, { action: "delete", slug: "alpha", expectedRevision: original.revision, dryRun: false });
    expect(del.error?.code).toBe("conflict");
    expect(await store.get("alpha")).toEqual(current);
  });

  it("lets exactly one of many concurrent updates from the same revision win", async () => {
    const { revision } = await store.put(page("alpha"));
    // Separate store instances model separate per-request servers over one directory.
    const results = await Promise.all(
      Array.from({ length: 12 }, (_, i) =>
        mutatePage(new FileSystemPageStore(dir), {
          action: "update", slug: "alpha", page: page("alpha", `Writer ${i}.`),
          expectedRevision: revision, dryRun: false,
        }),
      ),
    );
    const winners = results.filter((r) => r.ok);
    const losers = results.filter((r) => !r.ok);
    expect(winners).toHaveLength(1);
    expect(losers).toHaveLength(11);
    for (const loser of losers) {
      expect(loser.error?.code).toBe("conflict");
      expect(loser.error?.currentPage).toEqual(winners[0]!.page);
    }
    expect(await store.get("alpha")).toEqual(winners[0]!.page);
  });

  it("replays an idempotency key without writing a second time", async () => {
    const input = { action: "create" as const, slug: "alpha", page: page("alpha"), dryRun: false, idempotencyKey: "k1" };
    const first = await mutatePage(store, input);
    expect(first.ok).toBe(true);

    // Another writer changes the page; a retry of the create must not clobber or fail.
    const changed = await store.put(page("alpha", "Later edit."));
    const replay = await mutatePage(new FileSystemPageStore(dir), input);
    expect(replay).toMatchObject({ ok: true, replayed: true, page: first.page });
    expect(await store.get("alpha")).toEqual(changed);

    const mismatch = await mutatePage(store, { ...input, page: page("alpha", "Different.") });
    expect(mismatch.error?.code).toBe("idempotency_mismatch");
    expect(await store.get("alpha")).toEqual(changed);
  });

  it("replays a delete instead of failing with not_found", async () => {
    const { revision } = await store.put(page("alpha"));
    const input = { action: "delete" as const, slug: "alpha", expectedRevision: revision, dryRun: false, idempotencyKey: "del-1" };
    expect((await mutatePage(store, input)).ok).toBe(true);
    expect(await mutatePage(store, input)).toMatchObject({ ok: true, replayed: true });
  });

  it("does not record failures or dry runs against a key", async () => {
    const key = "k2";
    await mutatePage(store, { action: "create", slug: "alpha", page: page("alpha"), idempotencyKey: key });
    const bad = await mutatePage(store, { action: "create", slug: "alpha", page: { slug: "alpha" }, dryRun: false, idempotencyKey: key });
    expect(bad.ok).toBe(false);
    const good = await mutatePage(store, { action: "create", slug: "alpha", page: page("alpha"), dryRun: false, idempotencyKey: key });
    expect(good).toMatchObject({ ok: true });
    expect(good.replayed).toBeUndefined();
  });
});

describe("mutate tool over MCP", () => {
  async function connect() {
    const server = createMcpServer({ store });
    const client = new Client({ name: "test", version: "0.0.0" });
    const [a, b] = InMemoryTransport.createLinkedPair();
    await Promise.all([server.connect(a), client.connect(b)]);
    return client;
  }

  it("is annotated as a non-read-only tool", async () => {
    const client = await connect();
    const { tools } = await client.listTools();
    const mutate = tools.find((t) => t.name === "mutate");
    expect(mutate?.annotations).toMatchObject({ readOnlyHint: false, destructiveHint: true });
    expect(mutate?.description).toMatch(/query/);
    expect(mutate?.description).toMatch(/validate/);
  });

  it("round-trips create, conflict, update and delete through the protocol", async () => {
    const client = await connect();
    const call = async (args: Record<string, unknown>) =>
      client.callTool({ name: "mutate", arguments: args });

    const dry = await call({ action: "create", slug: "alpha", page: page("alpha") });
    expect((dry.structuredContent as { dryRun: boolean }).dryRun).toBe(true);
    expect(await store.get("alpha")).toBeUndefined();

    const created = await call({ action: "create", slug: "alpha", page: page("alpha"), dryRun: false, idempotencyKey: "mcp-1" });
    const revision = (created.structuredContent as { page: { revision: string } }).page.revision;
    expect(created.isError).toBeUndefined();

    const queried = await client.callTool({ name: "query", arguments: { slug: "alpha" } });
    expect((queried.structuredContent as { page: { revision: string } }).page.revision).toBe(revision);

    const invalid = await call({ action: "update", slug: "alpha", page: { title: "t", slug: "alpha" }, expectedRevision: revision, dryRun: false });
    expect(invalid.isError).toBe(true);
    expect((invalid.structuredContent as { error: { code: string } }).error.code).toBe("invalid");

    const stale = await call({ action: "update", slug: "alpha", page: page("alpha", "Z"), expectedRevision: "0000000000000000", dryRun: false });
    expect(stale.isError).toBe(true);
    expect((stale.structuredContent as { error: { code: string; currentRevision: string } }).error).toMatchObject({ code: "conflict", currentRevision: revision });

    const updated = await call({ action: "update", slug: "alpha", page: page("alpha", "Z"), expectedRevision: revision, dryRun: false });
    const next = (updated.structuredContent as { page: { revision: string } }).page.revision;
    expect(next).not.toBe(revision);

    const replay = await call({ action: "create", slug: "alpha", page: page("alpha"), dryRun: false, idempotencyKey: "mcp-1" });
    expect((replay.structuredContent as { replayed: boolean }).replayed).toBe(true);
    expect((await store.get("alpha"))?.body).toBe("Z");

    const deleted = await call({ action: "delete", slug: "alpha", expectedRevision: next, dryRun: false });
    expect(deleted.isError).toBeUndefined();
    expect(await store.get("alpha")).toBeUndefined();
  });
});
