import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { describe, expect, it } from "vitest";
import { toolContracts } from "./contracts.js";
import { checkFiles, createModelFixer, repair, type RepairFixer, type RepairResult } from "./repair.js";
import { generateScaffoldFiles, type ScaffoldFile } from "./scaffold.js";
import { createMcpServer } from "./server.js";
import type { PageStore } from "./store.js";

const emptyStore = { list: async () => [], get: async () => undefined } as unknown as PageStore;

async function connect() {
  const server = createMcpServer({ store: emptyStore });
  const [serverSide, clientSide] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: "repair-test", version: "0.0.0" });
  await Promise.all([server.connect(serverSide), client.connect(clientSide)]);
  return client;
}

const [cleanClient] = generateScaffoldFiles({ target: "client" }) as [ScaffoldFile];
const cleanHostConfig = generateScaffoldFiles({ target: "host-config", url: "https://strumentario.example/mcp", auth: true });

/** The same break the scaffold test uses: a field type that does not exist. */
function brokenClient(): ScaffoldFile {
  return { ...cleanClient, content: cleanClient.content.replace("slug: string;\n  /** The full page", "slug: Missing;\n  /** The full page") };
}

describe("checks", () => {
  it("pass on every freshly generated scaffold file", async () => {
    expect(await checkFiles([cleanClient, ...cleanHostConfig])).toEqual([]);
  });

  it("report tsc errors with a line and code, and schema errors for host config", async () => {
    const errors = await checkFiles([brokenClient(), { path: ".mcp.json", content: '{"mcpServers":{"strumentario":{"url":"ftp://x","headers":{}}}}' }]);
    expect(errors.find((e) => e.source === "tsc")).toMatchObject({ path: "strumentario-client.ts", code: "TS2304" });
    expect(errors.find((e) => e.source === "tsc")?.line).toBeGreaterThan(0);
    expect(errors.find((e) => e.source === "schema")).toMatchObject({ path: ".mcp.json", message: expect.stringContaining("http(s)") });
  });

  it("flag a generic host config that drops a tool", async () => {
    const generic = cleanHostConfig.find((f) => f.path === "strumentario.mcp.json") as ScaffoldFile;
    const parsed = JSON.parse(generic.content) as { tools: Array<{ name: string }> };
    parsed.tools = parsed.tools.filter((tool) => tool.name !== "repair");
    const errors = await checkFiles([{ path: generic.path, content: JSON.stringify(parsed) }]);
    expect(errors.map((e) => e.message).join()).toContain("missing repair");
  });
});

describe("repair loop", () => {
  it("converges a deliberately broken scaffold within the round limit", async () => {
    const result = await repair({ files: [brokenClient(), ...cleanHostConfig] });
    expect(result).toMatchObject({ ok: true, converged: true, stopReason: "converged", maxRounds: 3, roundsUsed: 1, remainingErrors: [] });
    expect(result.errorCounts[0]).toBeGreaterThan(0);
    expect(result.errorCounts.at(-1)).toBe(0);
    expect(result.rounds).toEqual([
      { round: 1, errorsBefore: result.errorCounts[0], errorsAfter: 0, changedFiles: ["strumentario-client.ts"], kept: true, usedModel: false },
    ]);
    expect(result.files.find((f) => f.path === "strumentario-client.ts")?.content).toBe(cleanClient.content);
  });

  it("repairs a broken host config and keeps its URL and auth choice", async () => {
    const broken: ScaffoldFile = { path: ".mcp.json", content: '{"mcpServers":{"strumentario":{"type":"http","url":"https://strumentario.example/mcp","headers":"oops","Authorization":"x"}}}' };
    const result = await repair({ files: [broken] });
    expect(result.converged).toBe(true);
    const fixed = JSON.parse(result.files[0]?.content ?? "{}") as { mcpServers: { strumentario: { url: string } } };
    expect(fixed.mcpServers.strumentario.url).toBe("https://strumentario.example/mcp");
  });

  it("reports zero rounds when the files already pass", async () => {
    const result = await repair({ files: [cleanClient] });
    expect(result).toMatchObject({ converged: true, roundsUsed: 0, rounds: [], errorCounts: [0], stopReason: "converged" });
  });

  it("stops at the round limit and returns the remaining errors", async () => {
    // A fixer that removes one broken line per round can never finish within 2 rounds.
    const broken: ScaffoldFile = { path: "a.ts", content: "export const a: Missing1 = 1;\nexport const b: Missing2 = 1;\nexport const c: Missing3 = 1;\nexport const d: Missing4 = 1;\n" };
    const dropOne: RepairFixer = async ({ files }) => files.map((file) => ({ ...file, content: file.content.split("\n").slice(1).join("\n") }));
    const result = await repair({ files: [broken], maxRounds: 2 }, { fixer: dropOne });
    expect(result).toMatchObject({ converged: false, stopReason: "max_rounds", maxRounds: 2, roundsUsed: 2, errorCounts: [4, 3, 2] });
    expect(result.remainingErrors).toHaveLength(2);
    expect(result.remainingErrors.every((e) => e.source === "tsc" && e.path === "a.ts")).toBe(true);
    expect(result.rounds.map((r) => [r.errorsBefore, r.errorsAfter, r.kept])).toEqual([
      [4, 3, true],
      [3, 2, true],
    ]);
  });

  it("stops early, keeps the input, and reports the errors when the error set does not shrink", async () => {
    const own: ScaffoldFile = { path: "mine.ts", content: "export const x: Missing = 1;\n" };
    const result = await repair({ files: [own] });
    expect(result).toMatchObject({ converged: false, stopReason: "no_progress", roundsUsed: 1, errorCounts: [1] });
    expect(result.rounds[0]).toMatchObject({ kept: false, changedFiles: [] });
    expect(result.files).toEqual([own]);
    expect(result.remainingErrors).toHaveLength(1);
  });

  it("discards a fix that makes things worse", async () => {
    const original: ScaffoldFile = { path: "a.ts", content: "export const a: Missing = 1;\n" };
    const worse: RepairFixer = async () => [{ path: "a.ts", content: "export const a: M1 = 1;\nexport const b: M2 = 1;\n" }];
    const result = await repair({ files: [original] }, { fixer: worse });
    expect(result).toMatchObject({ stopReason: "no_progress", errorCounts: [1] });
    expect(result.rounds[0]).toMatchObject({ errorsBefore: 1, errorsAfter: 2, kept: false });
    expect(result.files).toEqual([original]);
  });

  it("never lets a fixer add a file", async () => {
    const original: ScaffoldFile = { path: "a.ts", content: "export const a: Missing = 1;\n" };
    const adds: RepairFixer = async () => [{ path: "extra.ts", content: "export {};\n" }];
    const result = await repair({ files: [original] }, { fixer: adds });
    expect(result.files).toEqual([original]);
    expect(result.rounds[0]?.changedFiles).toEqual([]);
  });

  it("rejects bad input with an actionable error", async () => {
    for (const files of [[], [{ path: "../x.ts", content: "" }], [{ path: "/abs.ts", content: "" }], [{ path: "a.ts", content: "" }, { path: "a.ts", content: "" }]]) {
      const result = await repair({ files });
      expect(result).toMatchObject({ ok: false, converged: false, error: { code: "invalid" } });
    }
    expect((await repair({ files: [cleanClient], maxRounds: 0 })).error?.message).toContain("maxRounds");
  });
});

describe("model-backed fixer", () => {
  const reply = (files: ScaffoldFile[]) => async () => ({
    ok: true,
    status: 200,
    text: async () => JSON.stringify({ content: [{ type: "text", text: JSON.stringify({ files }) }] }),
  });

  it("is off unless the flag and key are set", () => {
    expect(createModelFixer({})).toBeUndefined();
    expect(createModelFixer({ STRUMENTARIO_REPAIR_MODEL: "m" })).toBeUndefined();
    expect(createModelFixer({ STRUMENTARIO_REPAIR_MODEL: "m", ANTHROPIC_API_KEY: "k" }, reply([]))).toBeTypeOf("function");
  });

  it("is used only for what the template path cannot fix, with a mocked model", async () => {
    const mine: ScaffoldFile = { path: "mine.ts", content: "export const x: Missing = 1;\n" };
    const fixer = createModelFixer({ STRUMENTARIO_REPAIR_MODEL: "m", ANTHROPIC_API_KEY: "k" }, reply([{ path: "mine.ts", content: "export const x = 1;\n" }]));
    const result = await repair({ files: [mine, brokenClient()] }, { modelFixer: fixer });
    expect(result).toMatchObject({ converged: true, roundsUsed: 2 });
    expect(result.rounds.map((r) => r.usedModel)).toEqual([false, true]);
  });

  it("surfaces a failing model instead of hiding it", async () => {
    const mine: ScaffoldFile = { path: "mine.ts", content: "export const x: Missing = 1;\n" };
    const failing = createModelFixer({ STRUMENTARIO_REPAIR_MODEL: "m", ANTHROPIC_API_KEY: "k" }, async () => ({ ok: false, status: 529, text: async () => "" }));
    const result = await repair({ files: [mine] }, { modelFixer: failing });
    expect(result.stopReason).toBe("no_progress");
    expect(result.rounds[0]?.note).toContain("status 529");
  });
});

describe("repair over MCP", () => {
  it("is listed read-only, so a read token may call it, and describes itself against scaffold", async () => {
    const client = await connect();
    const tool = (await client.listTools()).tools.find((t) => t.name === "repair");
    expect(tool?.annotations).toMatchObject({ readOnlyHint: true, destructiveHint: false });
    expect(tool?.description).toContain("scaffold");
    expect(toolContracts.map((c) => c.name)).toContain("repair");
  });

  it("repairs through the tool and validates its structured result", async () => {
    const client = await connect();
    const result = await client.callTool({ name: "repair", arguments: { files: [brokenClient()] } });
    expect(result.isError).toBeFalsy();
    const structured = result.structuredContent as RepairResult;
    expect(structured).toMatchObject({ ok: true, converged: true, roundsUsed: 1 });
  });

  it("rejects a bad maxRounds before the tool runs", async () => {
    const client = await connect();
    const result = await client.callTool({ name: "repair", arguments: { files: [cleanClient], maxRounds: 99 } }).catch((error: unknown) => ({ isError: true, error }));
    expect(result.isError).toBe(true);
  });
});
