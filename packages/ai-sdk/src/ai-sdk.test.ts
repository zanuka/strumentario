import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import type { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import type { AddressInfo } from "node:net";
import { createMcpHttpServer, createMcpServer, FileSystemPageStore, shutdownHttpServer } from "@strumentario/server";
import { simulateReadableStream } from "ai";
import { MockLanguageModelV2 } from "ai/test";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { connectMcpClient } from "./connect.js";
import { selectModel } from "./model.js";
import { loadMcpTools } from "./tools.js";
import { runWorkflow } from "./workflow.js";

let dir: string;
let client: Client;
let server: ReturnType<typeof createMcpServer>;
let store: FileSystemPageStore;

beforeEach(async () => {
  dir = await mkdtemp(path.join(tmpdir(), "strumentario-ai-sdk-test-"));
  store = new FileSystemPageStore(dir);
  server = createMcpServer({ store });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);
  client = await connectMcpClient({ transport: clientTransport });
});

afterEach(async () => {
  await client.close().catch(() => undefined);
  await server.close().catch(() => undefined);
  await rm(dir, { recursive: true, force: true });
});

/** A model that makes the given tool calls one step at a time, then answers with text. */
function scriptedModel(calls: Array<{ toolName: string; input: unknown }>) {
  let step = 0;
  return new MockLanguageModelV2({
    doStream: async () => {
      const call = calls[step];
      step += 1;
      const chunks = call
        ? [
            { type: "tool-call" as const, toolCallId: `call-${step}`, toolName: call.toolName, input: JSON.stringify(call.input) },
            { type: "finish" as const, finishReason: "tool-calls" as const, usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 } },
          ]
        : [
            { type: "text-start" as const, id: "t" },
            { type: "text-delta" as const, id: "t", delta: "done" },
            { type: "text-end" as const, id: "t" },
            { type: "finish" as const, finishReason: "stop" as const, usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 } },
          ];
      return { stream: simulateReadableStream({ chunks }) };
    },
  });
}

describe("loadMcpTools", () => {
  it("exposes exactly the tools the server publishes, with the server's description and schema", async () => {
    const published = (await client.listTools()).tools;
    const tools = await loadMcpTools(client);
    expect(Object.keys(tools).sort()).toEqual(published.map((t) => t.name).sort());
    expect(Object.keys(tools)).toEqual(expect.arrayContaining(["query", "validate", "mutate", "scaffold"]));
    for (const t of published) {
      expect(tools[t.name]?.description).toBe(t.description ?? "");
    }
  });

  it("executes through tools/call and returns the tool's own result", async () => {
    await store.put({ title: "Intro", slug: "intro", body: "Welcome." });
    const tools = await loadMcpTools(client);
    const out = await tools.query?.execute?.({ slug: "intro" }, { toolCallId: "c", messages: [] });
    expect(JSON.stringify(out)).toContain("Welcome.");
  });
});

describe("runWorkflow", () => {
  it("runs query, validate, then mutate as MCP calls and pins mutate to dry run", async () => {
    const model = scriptedModel([
      { toolName: "query", input: { limit: 5 } },
      { toolName: "validate", input: { instance: { title: "Example", slug: "intro", body: "Hello" } } },
      // The model asks to write; the example must send dryRun: true anyway.
      { toolName: "mutate", input: { action: "create", slug: "intro", page: { title: "Example", slug: "intro", body: "Hello" }, dryRun: false } },
    ]);
    const result = await runWorkflow({ client, model, slug: "intro" });
    expect(result.calls.map((c) => c.tool)).toEqual(["query", "validate", "mutate"]);
    expect(result.calls.every((c) => !c.isError)).toBe(true);
    expect(result.calls[2]?.arguments.dryRun).toBe(true);
    expect(result.text).toBe("done");
    // Nothing was stored.
    const after = await client.callTool({ name: "query", arguments: { slug: "intro" } });
    expect(after.isError).toBe(true);
  });

  it("lets mutate write only when write is set", async () => {
    const model = scriptedModel([{ toolName: "mutate", input: { action: "create", slug: "intro", page: { title: "Example", slug: "intro", body: "Hello" }, dryRun: false } }]);
    const result = await runWorkflow({ client, model, slug: "intro", write: true });
    expect(result.calls[0]?.arguments.dryRun).toBe(false);
    const after = await client.callTool({ name: "query", arguments: { slug: "intro" } });
    expect(after.isError).not.toBe(true);
  });
});

describe("selectModel", () => {
  it("needs no key: returns an actionable message", () => {
    const selection = selectModel({});
    expect(selection.ok).toBe(false);
    if (!selection.ok) expect(selection.message).toContain("ANTHROPIC_API_KEY");
  });

  it("prefers Anthropic, falls back to OpenAI, honours model overrides", () => {
    const a = selectModel({ ANTHROPIC_API_KEY: "k", OPENAI_API_KEY: "k", AI_SDK_ANTHROPIC_MODEL: "m1" });
    expect(a.ok && a.label).toBe("anthropic:m1");
    const o = selectModel({ OPENAI_API_KEY: "k" });
    expect(o.ok && o.label).toMatch(/^openai:/);
  });
});

describe("over Streamable HTTP", () => {
  it("lists and calls query and validate against a local server", async () => {
    const httpServer = createMcpHttpServer({ store });
    await new Promise<void>((resolve) => httpServer.listen(0, "127.0.0.1", resolve));
    const { port } = httpServer.address() as AddressInfo;
    const http = await connectMcpClient({ url: `http://127.0.0.1:${port}/mcp` });
    try {
      const model = scriptedModel([
        { toolName: "query", input: { limit: 5 } },
        { toolName: "validate", input: { instance: { title: "Example", slug: "intro", body: "Hello" } } },
      ]);
      const result = await runWorkflow({ client: http, model });
      expect(result.calls.map((c) => [c.tool, c.isError])).toEqual([["query", false], ["validate", false]]);
    } finally {
      await http.close().catch(() => undefined);
      await shutdownHttpServer(httpServer);
    }
  });
});
