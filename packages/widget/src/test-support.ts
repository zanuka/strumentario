import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { createMcpServer, FileSystemPageStore } from "@strumentario/server";
import { createWidgetController, mcpToolCaller, type ToolCaller, type WidgetController } from "./controller.js";
import type { ToolInputs, WidgetToolName } from "./generated/contracts.js";

export interface Rig {
  caller: ToolCaller;
  store: FileSystemPageStore;
  /** Every tool call the widget side made, in order. */
  calls: Array<{ name: string; arguments: Record<string, unknown> }>;
  controller(options?: { validateDelayMs?: number; newIdempotencyKey?: () => string }): WidgetController;
  close(): Promise<void>;
}

/** A real Strumentario MCP server over an in-memory transport with a temp file store: no network, no secrets. */
export async function startRig(): Promise<Rig> {
  const dir = await mkdtemp(path.join(tmpdir(), "strumentario-widget-test-"));
  const store = new FileSystemPageStore(dir);
  const server = createMcpServer({ store });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);
  const client = new Client({ name: "widget-test", version: "0.0.0" });
  await client.connect(clientTransport);
  const calls: Rig["calls"] = [];
  const inner = mcpToolCaller(client);
  const caller: ToolCaller = {
    call<N extends WidgetToolName>(name: N, args: ToolInputs[N]) {
      calls.push({ name, arguments: args as Record<string, unknown> });
      return inner.call(name, args);
    },
  };
  return {
    caller,
    store,
    calls,
    controller: (options = {}) => createWidgetController({ caller, validateDelayMs: 0, ...options }),
    async close() {
      await client.close().catch(() => undefined);
      await server.close().catch(() => undefined);
      await rm(dir, { recursive: true, force: true });
    },
  };
}

export const SAMPLE_PAGES = [
  { title: "Getting started", slug: "getting-started", body: "Install the toolkit and run the server." },
  { title: "Style guide", slug: "style-guide", body: "Write short sentences." },
] as const;

/** Writes the sample pages through the same mutate tool the widget uses. */
export async function seed(rig: Rig): Promise<void> {
  for (const page of SAMPLE_PAGES) {
    const result = await rig.caller.call("mutate", { action: "create", slug: page.slug, page, dryRun: false });
    if (!result.ok) throw new Error(`seed failed: ${result.error?.message}`);
  }
  rig.calls.length = 0;
}
