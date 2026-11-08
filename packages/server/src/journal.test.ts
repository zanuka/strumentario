import { appendFile, mkdtemp, readFile, rm } from "node:fs/promises";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import os from "node:os";
import path from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { z } from "zod";
import { journalContract, journalDefinition } from "./contracts.js";
import { createMcpHttpServer, shutdownHttpServer } from "./http.js";
import { FileJournal, JournalError, journalEntryFor, type JournalEntry, type JournalPage } from "./journal.js";
import { mutatePage } from "./mutate.js";
import { AGENT_HEADER } from "./server.js";
import { FileSystemPageStore } from "./store.js";

let dir: string;
let store: FileSystemPageStore;
let journal: FileJournal;
let running: Server | undefined;

beforeEach(async () => {
  dir = await mkdtemp(path.join(os.tmpdir(), "strumentario-journal-"));
  store = new FileSystemPageStore(dir);
  journal = new FileJournal(dir);
  process.env.STRUMENTARIO_DATA_DIR = dir;
});

afterEach(async () => {
  delete process.env.STRUMENTARIO_DATA_DIR;
  if (running) {
    await shutdownHttpServer(running);
    running = undefined;
  }
  await rm(dir, { recursive: true, force: true });
});

const page = (slug: string, body = `Secret body of ${slug}.`) => ({ title: `Title ${slug}`, slug, body });
const entrySchema = z.object(journalDefinition.entryShape).strict();

async function lines(): Promise<string[]> {
  return (await readFile(journal.file, "utf8")).split("\n").filter(Boolean);
}

async function connect(agent?: string): Promise<Client> {
  const server = createMcpHttpServer();
  running = server;
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const url = new URL(`http://127.0.0.1:${(server.address() as AddressInfo).port}/mcp`);
  const client = new Client({ name: "journal-test", version: "0.0.0" });
  const headers: Record<string, string> = agent ? { [AGENT_HEADER]: agent } : {};
  await client.connect(new StreamableHTTPClientTransport(url, { requestInit: { headers } }) as never);
  return client;
}

async function readJournal(client: Client, query = ""): Promise<JournalPage> {
  const result = await client.readResource({ uri: `${journalDefinition.uri}${query}` });
  return JSON.parse((result.contents[0] as { text: string }).text) as JournalPage;
}

describe("journal entries over MCP", () => {
  it("records applied, dry-run and conflict outcomes with the calling agent", async () => {
    const writer = await connect("agent-a");
    const dry = await writer.callTool({ name: "mutate", arguments: { action: "create", slug: "alpha", page: page("alpha") } });
    expect(dry.isError).toBeFalsy();
    const applied = await writer.callTool({
      name: "mutate",
      arguments: { action: "create", slug: "alpha", page: page("alpha"), dryRun: false, idempotencyKey: "k-1" },
    });
    const revision = (applied.structuredContent as { page: { revision: string } }).page.revision;

    const other = await connect("agent-b");
    const stale = await other.callTool({
      name: "mutate",
      arguments: { action: "update", slug: "alpha", page: page("alpha", "Changed."), expectedRevision: "0000000000000000", dryRun: false },
    });
    expect(stale.isError).toBe(true);
    const anonymous = await connect();
    await anonymous.callTool({ name: "mutate", arguments: { action: "delete", slug: "missing", dryRun: false, overwrite: true } });

    const { entries } = await readJournal(other);
    expect(entries.map((e) => [e.status, e.agent, e.slug, e.action])).toEqual([
      ["dry_run", "agent-a", "alpha", "create"],
      ["applied", "agent-a", "alpha", "create"],
      ["conflict", "agent-b", "alpha", "update"],
      ["rejected", null, "missing", "delete"],
    ]);

    const [dryEntry, appliedEntry, conflictEntry, rejectedEntry] = entries as [JournalEntry, JournalEntry, JournalEntry, JournalEntry];
    expect(dryEntry).toMatchObject({ dryRun: true, revisionBefore: null, revisionAfter: null, proposedRevision: revision });
    expect(appliedEntry).toMatchObject({ dryRun: false, revisionBefore: null, revisionAfter: revision, idempotencyKey: "k-1", errorCode: null });
    expect(conflictEntry).toMatchObject({
      revisionBefore: revision,
      revisionAfter: revision,
      expectedRevision: "0000000000000000",
      errorCode: "conflict",
    });
    expect(rejectedEntry).toMatchObject({ errorCode: "not_found", revisionBefore: null });
    for (const entry of entries) {
      expect(entrySchema.safeParse(entry).success).toBe(true);
    }
    await writer.close();
    await other.close();
    await anonymous.close();
  });

  it("never writes page bodies or titles, only a size and a hash", async () => {
    const client = await connect("agent-a");
    await client.callTool({ name: "mutate", arguments: { action: "create", slug: "alpha", page: page("alpha", "TOP-SECRET-BODY"), dryRun: false } });
    const raw = await readFile(journal.file, "utf8");
    expect(raw).not.toContain("TOP-SECRET-BODY");
    expect(raw).not.toContain("Title alpha");
    const entry = JSON.parse(raw.trim()) as JournalEntry;
    expect(entry.payload).toEqual({ bytes: Buffer.byteLength(JSON.stringify(page("alpha", "TOP-SECRET-BODY"))), hash: expect.stringMatching(/^[0-9a-f]{16}$/) });
    await client.close();
  });

  it("records a replayed idempotent call and a delete", async () => {
    const options = { journal, agent: "agent-a" };
    const input = { action: "create", slug: "alpha", page: page("alpha"), dryRun: false, idempotencyKey: "k-1" } as const;
    const first = await mutatePage(store, input, options);
    await mutatePage(store, input, options);
    await mutatePage(store, { action: "delete", slug: "alpha", expectedRevision: first.page!.revision, dryRun: false }, options);

    const { entries } = await journal.read();
    expect(entries.map((e) => [e.status, e.revisionBefore, e.revisionAfter])).toEqual([
      ["applied", null, first.page!.revision],
      ["replayed", null, null],
      ["applied", first.page!.revision, null],
    ]);
  });

  it("does not change the mutate result when the journal cannot be written", async () => {
    const errors: unknown[] = [];
    const broken = { append: async () => { throw new Error("disk full"); }, read: async () => ({ entries: [], cursor: "0", skipped: 0 }) };
    const result = await mutatePage(store, { action: "create", slug: "alpha", page: page("alpha"), dryRun: false }, {
      journal: broken,
      onJournalError: (error) => errors.push(error),
    });
    expect(result.ok).toBe(true);
    expect(await store.get("alpha")).toBeDefined();
    expect(errors).toHaveLength(1);
  });
});

describe("concurrent appends", () => {
  it("keeps every line parseable and loses no entry across many concurrent writers", async () => {
    const writers = 60;
    const perWriter = 5;
    await Promise.all(
      Array.from({ length: writers }, (_, w) =>
        mutatePage(
          store,
          { action: "create", slug: `page-${w}`, page: page(`page-${w}`, "x".repeat(2000)), dryRun: false },
          { journal, agent: `agent-${w}` },
        ).then(() =>
          Promise.all(
            Array.from({ length: perWriter - 1 }, (_, i) =>
              mutatePage(store, { action: "create", slug: `page-${w}`, page: page(`page-${w}`), idempotencyKey: `${w}-${i}` }, { journal, agent: `agent-${w}` }),
            ),
          ),
        ),
      ),
    );

    const raw = await lines();
    expect(raw).toHaveLength(writers * perWriter);
    const parsed = raw.map((line) => JSON.parse(line) as JournalEntry);
    for (let w = 0; w < writers; w += 1) {
      const mine = parsed.filter((e) => e.agent === `agent-${w}`);
      expect(mine).toHaveLength(perWriter);
      expect(mine.filter((e) => e.status === "applied")).toHaveLength(1);
    }
    expect((await journal.read({ limit: 1000 })).skipped).toBe(0);
  });

  it("serialises raw appends from the same process without interleaving", async () => {
    const entry = journalEntryFor({ action: "delete", slug: "a".repeat(5000) }, { ok: false, action: "delete", slug: "x", dryRun: true, error: { code: "not_found", message: "m" } }, "agent");
    await Promise.all(Array.from({ length: 200 }, () => journal.append(entry)));
    const raw = await lines();
    expect(raw).toHaveLength(200);
    expect(raw.every((line) => (JSON.parse(line) as JournalEntry).slug.length <= 201)).toBe(true);
  });
});

describe("journal resource cursor", () => {
  async function seed(count: number): Promise<void> {
    for (let i = 0; i < count; i += 1) {
      await mutatePage(store, { action: "create", slug: `p-${i}`, page: page(`p-${i}`), dryRun: false }, { journal, agent: "seed" });
    }
  }

  it("returns entries after a given cursor and nothing once caught up", async () => {
    await seed(5);
    const client = await connect();
    const first = await readJournal(client, "?limit=2");
    expect(first.entries.map((e) => e.slug)).toEqual(["p-0", "p-1"]);

    const second = await readJournal(client, `?since=${first.cursor}&limit=2`);
    expect(second.entries.map((e) => e.slug)).toEqual(["p-2", "p-3"]);

    const third = await readJournal(client, `?since=${second.cursor}`);
    expect(third.entries.map((e) => e.slug)).toEqual(["p-4"]);

    const idle = await readJournal(client, `?since=${third.cursor}`);
    expect(idle.entries).toEqual([]);
    expect(idle.cursor).toBe(third.cursor);

    await mutatePage(store, { action: "create", slug: "late", page: page("late"), dryRun: false }, { journal, agent: "seed" });
    expect((await readJournal(client, `?since=${idle.cursor}`)).entries.map((e) => e.slug)).toEqual(["late"]);
    await client.close();
  });

  it("serves an empty journal before any mutate call, and lists the resource", async () => {
    const client = await connect();
    expect(await readJournal(client)).toEqual({ entries: [], cursor: "0", skipped: 0 });
    const { resources } = await client.listResources();
    expect(resources.map((r) => r.uri)).toContain(journalDefinition.uri);
    await client.close();
  });

  it("rejects a bad cursor or limit with an actionable error", async () => {
    await seed(2);
    const client = await connect();
    await expect(readJournal(client, "?since=abc")).rejects.toThrow(/not a journal cursor/);
    await expect(readJournal(client, "?since=3")).rejects.toThrow(/does not start a journal line/);
    await expect(readJournal(client, "?since=999999")).rejects.toThrow(/past the end/);
    await expect(readJournal(client, "?limit=0")).rejects.toThrow(/limit must be/);
    await client.close();
  });

  it("returns only complete lines and counts corrupt ones as skipped", async () => {
    await seed(2);
    await appendFile(journal.file, "{not json}\n");
    await mutatePage(store, { action: "create", slug: "after", page: page("after"), dryRun: false }, { journal });
    await appendFile(journal.file, '{"v":1,"half');
    const result = await journal.read();
    expect(result.entries.map((e) => e.slug)).toEqual(["p-0", "p-1", "after"]);
    expect(result.skipped).toBe(1);
    const raw = await readFile(journal.file, "utf8");
    expect(Number(result.cursor)).toBe(raw.lastIndexOf("\n") + 1);
  });

  it("rejects reads when the journal is missing but a cursor is given", async () => {
    await expect(journal.read({ since: "10" })).rejects.toBeInstanceOf(JournalError);
  });
});

describe("journal contract", () => {
  it("is generated from the domain and describes the resource URI", () => {
    expect(journalContract.uri).toBe("strumentario://journal");
    expect(journalContract.uriTemplate).toBe("strumentario://journal{?since,limit}");
    expect(Object.keys((journalContract.entrySchema as { properties: object }).properties)).toEqual(Object.keys(journalDefinition.entryShape));
    expect((journalContract.entrySchema as { properties: Record<string, unknown> }).properties).toHaveProperty("slug");
  });
});
