import { mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import os from "node:os";
import path from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { authInfoFor, requiredScope, resolveScope } from "./auth.js";
import { toolContracts } from "./contracts.js";
import { createMcpHttpServer, shutdownHttpServer, type McpHttpOptions } from "./http.js";
import { createMcpServer } from "./server.js";
import { FileSystemPageStore } from "./store.js";

const READ = "test-read-token";
const WRITE = "test-write-token";
const LEGACY = "test-legacy-token";

let dir: string;
let running: Server | undefined;

beforeEach(async () => {
  dir = await mkdtemp(path.join(os.tmpdir(), "strumentario-scopes-"));
});

afterEach(async () => {
  if (running) {
    await shutdownHttpServer(running);
    running = undefined;
  }
  await rm(dir, { recursive: true, force: true });
});

async function connect(options: McpHttpOptions, token: string | undefined): Promise<Client> {
  const server = createMcpHttpServer({ store: new FileSystemPageStore(dir), ...options });
  running = server;
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const url = new URL(`http://127.0.0.1:${(server.address() as AddressInfo).port}/mcp`);
  const client = new Client({ name: "test", version: "0" });
  await client.connect(
    new StreamableHTTPClientTransport(url, {
      requestInit: { headers: token ? { authorization: `Bearer ${token}` } : {} },
    }),
  );
  return client;
}

const PAGE = { slug: "intro", title: "Intro", body: "Hello" };
const mutateArgs = { action: "create", slug: "intro", page: PAGE, dryRun: false };

describe("read and write bearer tokens", () => {
  const tokens = { readToken: READ, writeToken: WRITE };

  it("lets a read token call query and validate and read resources", async () => {
    const client = await connect(tokens, READ);
    expect((await client.callTool({ name: "validate", arguments: { instance: PAGE } })).isError).toBeFalsy();
    expect((await client.callTool({ name: "query", arguments: {} })).isError).toBeFalsy();
    expect((await client.listResources()).resources).toBeDefined();
    expect((await client.readResource({ uri: "strumentario://journal" })).contents).toHaveLength(1);
    await client.close();
  });

  it("refuses a read token on mutate with a message naming the missing scope, and writes nothing", async () => {
    const client = await connect(tokens, READ);
    const result = await client.callTool({ name: "mutate", arguments: mutateArgs });
    expect(result.isError).toBe(true);
    const text = JSON.stringify(result.content);
    expect(text).toContain("write scope");
    expect(text).toContain("MCP_WRITE_TOKEN");
    expect(text).not.toContain(READ);
    expect(await readdir(dir)).toEqual([]);
    await client.close();
  });

  it("refuses a read token on scaffold, including write: true, and writes no files", async () => {
    const client = await connect(tokens, READ);
    const out = path.join(dir, "out");
    const result = await client.callTool({
      name: "scaffold",
      arguments: { target: "host-config", write: true, outDir: out },
    });
    expect(result.isError).toBe(true);
    expect(JSON.stringify(result.content)).toContain("write scope");
    expect(await readdir(dir)).toEqual([]);
    await client.close();
  });

  it("lets a write token call every tool, and records the write scope in the journal", async () => {
    const client = await connect(tokens, WRITE);
    const created = await client.callTool({ name: "mutate", arguments: mutateArgs });
    expect(created.isError).toBeFalsy();
    expect((await client.callTool({ name: "query", arguments: { slug: "intro" } })).isError).toBeFalsy();
    expect((await client.callTool({ name: "scaffold", arguments: { target: "host-config" } })).isError).toBeFalsy();
    const lines = (await readFile(path.join(dir, "journal.jsonl"), "utf8")).trim().split("\n");
    expect(lines.map((line) => JSON.parse(line).scope)).toEqual(["write"]);
    await client.close();
  });

  it("keeps the single MCP_AUTH_TOKEN working as a write token", async () => {
    const client = await connect({ authToken: LEGACY, readToken: READ }, LEGACY);
    expect((await client.callTool({ name: "mutate", arguments: mutateArgs })).isError).toBeFalsy();
    await client.close();
  });

  it("rejects unknown and missing tokens with 401 before any tool runs", async () => {
    await expect(connect(tokens, "wrong")).rejects.toThrow();
    await shutdownHttpServer(running as Server);
    running = undefined;
    await expect(connect(tokens, undefined)).rejects.toThrow();
  });

  it("records a null scope when auth is off", async () => {
    const client = await connect({}, undefined);
    await client.callTool({ name: "mutate", arguments: mutateArgs });
    const line = (await readFile(path.join(dir, "journal.jsonl"), "utf8")).trim();
    expect(JSON.parse(line).scope).toBeNull();
    await client.close();
  });
});

describe("scope resolution", () => {
  it("maps tokens to scopes and prefers write when a secret is shared", () => {
    expect(resolveScope({ read: "r", write: ["w", undefined] }, "r")).toBe("read");
    expect(resolveScope({ read: "r", write: ["w", undefined] }, "w")).toBe("write");
    expect(resolveScope({ read: "same", write: "same" }, "same")).toBe("write");
    expect(resolveScope({ read: "r", write: "w" }, "x")).toBeUndefined();
    expect(resolveScope({ read: "r" }, "")).toBeUndefined();
  });

  it("never puts a token value in the auth info", () => {
    expect(JSON.stringify(authInfoFor("read"))).not.toContain(READ);
  });
});

describe("scope follows the tool annotations", () => {
  it("makes exactly the readOnlyHint: true tools readable, from the generated contracts", () => {
    const byScope = Object.fromEntries(toolContracts.map((tool) => [tool.name, requiredScope(tool.annotations)]));
    expect(byScope).toEqual({ query: "read", validate: "read", mutate: "write", scaffold: "write", repair: "read" });
  });

  it("treats a missing or false readOnlyHint as write", () => {
    expect(requiredScope(undefined)).toBe("write");
    expect(requiredScope({})).toBe("write");
    expect(requiredScope({ readOnlyHint: false })).toBe("write");
  });

  it("makes a newly registered tool with readOnlyHint: false write-only, with no list to update", async () => {
    const run = async (scope: "read" | "write") => {
      const server = createMcpServer({ store: new FileSystemPageStore(dir) });
      let ran = 0;
      server.registerTool("shiny-new-tool", { annotations: { readOnlyHint: false } }, () => {
        ran += 1;
        return { content: [{ type: "text" as const, text: "ran" }] };
      });
      server.registerTool("shiny-new-reader", { annotations: { readOnlyHint: true } }, () => ({
        content: [{ type: "text" as const, text: "ran" }],
      }));
      const [clientSide, serverSide] = InMemoryTransport.createLinkedPair();
      await server.connect(serverSide);
      // Stamp every incoming message with the scope, as the HTTP transport does from the bearer token.
      const deliver = serverSide.onmessage;
      serverSide.onmessage = (message, extra) => deliver?.(message, { ...extra, authInfo: authInfoFor(scope) });
      const client = new Client({ name: "test", version: "0" });
      await client.connect(clientSide);
      const write = await client.callTool({ name: "shiny-new-tool", arguments: {} });
      const read = await client.callTool({ name: "shiny-new-reader", arguments: {} });
      await client.close();
      return { write, read, ran };
    };

    const asRead = await run("read");
    expect(asRead.write.isError).toBe(true);
    expect((asRead.write.content as Array<{ text: string }>)[0]?.text).toContain('"shiny-new-tool" needs the write scope');
    expect(asRead.ran).toBe(0);
    expect(asRead.read.isError).toBeFalsy();

    const asWrite = await run("write");
    expect(asWrite.write.isError).toBeFalsy();
    expect(asWrite.ran).toBe(1);
  });
});
