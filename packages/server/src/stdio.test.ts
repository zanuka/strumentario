import { spawn, spawnSync } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { loadConfig } from "./config.js";
import type { JournalEntry } from "./journal.js";
import type { MutateResult } from "./mutate.js";

const serverRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const repoRoot = path.resolve(serverRoot, "../..");
const serveJs = path.join(serverRoot, "dist/serve.js");

const PROCESSES = 10;
const page = (slug: string, body: string) => ({ title: `Title ${slug}`, slug, body });

let dir: string;
const clients: Client[] = [];

beforeAll(() => {
  // Always rebuild (incremental): the children run dist/serve.js, which must match src/.
  const built = spawnSync(path.join(repoRoot, "node_modules/.bin/tsc"), ["-b", serverRoot], { encoding: "utf8" });
  if (built.status !== 0) {
    throw new Error(`Building the server for the stdio tests failed:\n${built.stdout}${built.stderr}`);
  }
}, 120_000);

beforeEach(async () => {
  dir = await mkdtemp(path.join(os.tmpdir(), "strumentario-stdio-"));
});

afterEach(async () => {
  await Promise.all(clients.splice(0).map((client) => client.close().catch(() => undefined)));
  await rm(dir, { recursive: true, force: true });
});

async function connect(agent?: string, args: string[] = ["--stdio"], extraEnv: Record<string, string> = {}): Promise<Client> {
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [serveJs, ...args],
    env: { STRUMENTARIO_DATA_DIR: dir, ...(agent ? { STRUMENTARIO_AGENT: agent } : {}), ...extraEnv },
    stderr: "ignore",
  });
  const client = new Client({ name: "stdio-test", version: "0.0.0" });
  await client.connect(transport);
  clients.push(client);
  return client;
}

async function mutate(client: Client, args: Record<string, unknown>): Promise<MutateResult> {
  const result = await client.callTool({ name: "mutate", arguments: { dryRun: false, ...args } });
  return result.structuredContent as MutateResult;
}

async function journal(): Promise<JournalEntry[]> {
  const text = await readFile(path.join(dir, "journal.jsonl"), "utf8");
  return text.trimEnd().split("\n").map((line) => JSON.parse(line) as JournalEntry);
}

describe("config", () => {
  it("selects the transport from MCP_TRANSPORT, defaulting to http", () => {
    expect(loadConfig({}).transport).toBe("http");
    expect(loadConfig({ MCP_TRANSPORT: "STDIO" }).transport).toBe("stdio");
    expect(loadConfig({ MCP_TRANSPORT: "http", STRUMENTARIO_AGENT: " a " })).toMatchObject({ transport: "http", agent: "a" });
    expect(() => loadConfig({ MCP_TRANSPORT: "sse" })).toThrow(/MCP_TRANSPORT must be "http" or "stdio"/);
  });
});

describe("stdio transport", () => {
  it("lists tools and calls validate", async () => {
    const client = await connect();
    const { tools } = await client.listTools();
    expect(tools.map((tool) => tool.name).sort()).toEqual(["mutate", "query", "scaffold", "validate"]);

    const result = await client.callTool({
      name: "validate",
      arguments: { instance: page("hello", "Body.") },
    });
    expect(result.structuredContent).toMatchObject({ valid: true });
  }, 30_000);

  it("is also selected by MCP_TRANSPORT=stdio without the flag", async () => {
    const client = await connect(undefined, [], { MCP_TRANSPORT: "stdio" });
    expect((await client.listTools()).tools.length).toBeGreaterThan(0);
  }, 30_000);

  it("writes only protocol messages to stdout and diagnostics to stderr", async () => {
    const child = spawn(process.execPath, [serveJs, "--stdio"], {
      env: { ...process.env, STRUMENTARIO_DATA_DIR: dir },
      stdio: ["pipe", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk: Buffer) => (stdout += chunk.toString()));
    child.stderr.on("data", (chunk: Buffer) => (stderr += chunk.toString()));
    const exited = new Promise<number | null>((resolve) => child.on("exit", resolve));

    const send = (message: unknown) => child.stdin.write(`${JSON.stringify(message)}\n`);
    send({
      jsonrpc: "2.0", id: 1, method: "initialize",
      params: { protocolVersion: "2025-03-26", capabilities: {}, clientInfo: { name: "raw", version: "0" } },
    });
    send({ jsonrpc: "2.0", method: "notifications/initialized" });
    send({ jsonrpc: "2.0", id: 2, method: "tools/list" });
    send({ jsonrpc: "2.0", id: 3, method: "tools/call", params: { name: "validate", arguments: { instance: page("raw", "x") } } });

    await waitFor(() => stdout.split("\n").filter(Boolean).length >= 3);
    child.stdin.end();
    expect(await exited).toBe(0);

    const lines = stdout.split("\n").filter(Boolean);
    expect(lines).toHaveLength(3);
    for (const line of lines) {
      expect(JSON.parse(line)).toMatchObject({ jsonrpc: "2.0" });
    }
    expect(stderr).toContain("ready on stdio");
  }, 30_000);
});

async function waitFor(condition: () => boolean, timeoutMs = 15_000): Promise<void> {
  const start = Date.now();
  while (!condition()) {
    if (Date.now() - start > timeoutMs) {
      throw new Error("Timed out waiting for stdio output.");
    }
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
}

describe(`${PROCESSES} stdio processes sharing one data directory`, () => {
  async function fleet(): Promise<Client[]> {
    return Promise.all(Array.from({ length: PROCESSES }, (_, i) => connect(`agent-${i}`)));
  }

  it("lets exactly one concurrent create win, and keeps the journal intact", async () => {
    const agents = await fleet();
    const results = await Promise.all(
      agents.map((client, i) => mutate(client, { action: "create", slug: "race", page: page("race", `from ${i}`) })),
    );

    expect(results.filter((r) => r.ok)).toHaveLength(1);
    const losers = results.filter((r) => !r.ok);
    expect(losers).toHaveLength(PROCESSES - 1);
    expect(new Set(losers.map((r) => r.error?.code))).toEqual(new Set(["already_exists"]));

    const winner = results.find((r) => r.ok)!;
    const read = await agents[0]!.callTool({ name: "query", arguments: { slug: "race" } });
    expect(JSON.stringify(read.structuredContent)).toContain(winner.page!.revision);

    const entries = await journal();
    expect(entries).toHaveLength(PROCESSES);
    expect(entries.filter((e) => e.status === "applied")).toHaveLength(1);
    expect(entries.filter((e) => e.status === "rejected")).toHaveLength(PROCESSES - 1);
    expect(new Set(entries.map((e) => e.agent))).toEqual(new Set(Array.from({ length: PROCESSES }, (_, i) => `agent-${i}`)));
  }, 60_000);

  it("applies exactly one concurrent update per expected revision", async () => {
    const agents = await fleet();
    const created = await mutate(agents[0]!, { action: "create", slug: "rev", page: page("rev", "start") });
    const results = await Promise.all(
      agents.map((client, i) =>
        mutate(client, {
          action: "update", slug: "rev", page: page("rev", `update ${i}`), expectedRevision: created.page!.revision,
        }),
      ),
    );

    expect(results.filter((r) => r.ok)).toHaveLength(1);
    const losers = results.filter((r) => !r.ok);
    expect(new Set(losers.map((r) => r.error?.code))).toEqual(new Set(["conflict"]));
    const winner = results.find((r) => r.ok)!;
    for (const loser of losers) {
      expect(loser.error?.currentRevision).toBe(winner.page!.revision);
    }

    const entries = (await journal()).filter((e) => e.action === "update");
    expect(entries).toHaveLength(PROCESSES);
    expect(entries.filter((e) => e.status === "applied")).toHaveLength(1);
    expect(entries.filter((e) => e.status === "conflict")).toHaveLength(PROCESSES - 1);
  }, 60_000);

  it("applies a retried idempotent create once and replays it everywhere else", async () => {
    const agents = await fleet();
    const args = { action: "create", slug: "once", page: page("once", "same"), idempotencyKey: "k-1" };
    const results = await Promise.all(agents.map((client) => mutate(client, args)));

    expect(results.every((r) => r.ok)).toBe(true);
    expect(results.filter((r) => !r.replayed)).toHaveLength(1);
    expect(results.filter((r) => r.replayed)).toHaveLength(PROCESSES - 1);
    expect(new Set(results.map((r) => r.page?.revision)).size).toBe(1);

    const entries = await journal();
    expect(entries.filter((e) => e.status === "applied")).toHaveLength(1);
    expect(entries.filter((e) => e.status === "replayed")).toHaveLength(PROCESSES - 1);

    // The same key with different input is refused, from any process.
    const mismatch = await mutate(agents[3]!, { ...args, page: page("once", "different") });
    expect(mismatch).toMatchObject({ ok: false, error: { code: "idempotency_mismatch" } });
  }, 60_000);
});
