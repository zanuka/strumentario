import { mkdir, mkdtemp, readFile, readdir, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { toolContracts } from "./contracts.js";
import { generateScaffoldFiles, scaffold, SCAFFOLD_ROOT_ENV } from "./scaffold.js";
import { createMcpServer } from "./server.js";
import type { PageStore } from "./store.js";
import { typeCheckSources } from "./typecheck.js";

const emptyStore = { list: async () => [], get: async () => undefined } as unknown as PageStore;

async function connect() {
  const server = createMcpServer({ store: emptyStore });
  const [serverSide, clientSide] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: "scaffold-test", version: "0.0.0" });
  await Promise.all([server.connect(serverSide), client.connect(clientSide)]);
  return client;
}

let root: string;

beforeEach(async () => {
  root = await mkdtemp(path.join(tmpdir(), "strumentario-scaffold-"));
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

async function listFiles(dir: string): Promise<string[]> {
  const entries = await readdir(dir, { recursive: true, withFileTypes: true }).catch(() => []);
  return entries
    .filter((entry) => entry.isFile())
    .map((entry) => path.relative(dir, path.join(entry.parentPath, entry.name)))
    .sort();
}

describe("scaffold over MCP", () => {
  it("is listed, and its description says how it differs from mutate", async () => {
    const client = await connect();
    const { tools } = await client.listTools();
    const tool = tools.find((candidate) => candidate.name === "scaffold");
    expect(tool).toBeDefined();
    expect(tool?.description).toMatch(/never reads or changes pages/);
    expect(tool?.description).toMatch(/use mutate to create, update or delete pages/);
    expect(tool?.description).toMatch(/writes nothing unless write: true/);
    expect(tool?.annotations?.readOnlyHint).toBe(false);
    await client.close();
  });

  it("returns files for both targets and writes nothing", async () => {
    const client = await connect();
    for (const target of ["client", "host-config"]) {
      const result = await client.callTool({ name: "scaffold", arguments: { target } });
      expect(result.isError).toBeFalsy();
      const out = result.structuredContent as { ok: boolean; written: boolean; files: Array<{ path: string; content: string }> };
      expect(out.ok).toBe(true);
      expect(out.written).toBe(false);
      expect(out.files.length).toBeGreaterThan(0);
    }
    await client.close();
  });

  it("rejects an unknown target before the tool runs", async () => {
    const client = await connect();
    const result = await client.callTool({ name: "scaffold", arguments: { target: "widget" } }).catch((error: Error) => error);
    const failed = result instanceof Error || (result as { isError?: boolean }).isError === true;
    expect(failed).toBe(true);
    await client.close();
  });
});

describe("deterministic output", () => {
  it.each(["client", "host-config"] as const)("%s output is identical on every run", async (target) => {
    const first = await scaffold({ target });
    const second = await scaffold({ target });
    expect(second).toEqual(first);
    expect(JSON.stringify(first.files)).toBe(JSON.stringify(second.files));
  });

  it("returns the files in a fixed order", async () => {
    const result = await scaffold({ target: "host-config" });
    expect(result.files.map((file) => file.path)).toEqual([".cursor/mcp.json", ".mcp.json", "strumentario.mcp.json"]);
  });
});

describe("host-config", () => {
  it("lists every registered tool name and the server URL in every entry", async () => {
    const client = await connect();
    const registered = (await client.listTools()).tools.map((tool) => tool.name).sort();
    await client.close();
    expect(registered).toEqual(toolContracts.map((contract) => contract.name).sort());

    const { files } = await scaffold({ target: "host-config", url: "https://example.test/mcp" });
    const byPath = new Map(files.map((file) => [file.path, JSON.parse(file.content)]));

    const generic = byPath.get("strumentario.mcp.json");
    expect(generic.url).toBe("https://example.test/mcp");
    expect(generic.tools.map((tool: { name: string }) => tool.name).sort()).toEqual(registered);

    expect(byPath.get(".cursor/mcp.json").mcpServers.strumentario.url).toBe("https://example.test/mcp");
    expect(byPath.get(".mcp.json").mcpServers.strumentario).toMatchObject({ type: "http", url: "https://example.test/mcp" });
  });

  it("defaults to the local server URL and adds no secret", async () => {
    const { files } = await scaffold({ target: "host-config" });
    for (const file of files) {
      expect(file.content).toContain("http://127.0.0.1:3001/mcp");
      expect(file.content).not.toContain("Authorization");
    }
  });

  it("references the token by environment variable when auth is requested", async () => {
    const { files } = await scaffold({ target: "host-config", auth: true });
    const content = Object.fromEntries(files.map((file) => [file.path, file.content]));
    expect(content[".cursor/mcp.json"]).toContain("Bearer ${env:MCP_AUTH_TOKEN}");
    expect(content[".mcp.json"]).toContain("Bearer ${MCP_AUTH_TOKEN}");
  });

  it("refuses a URL that is not http(s) with a hint", async () => {
    const result = await scaffold({ target: "host-config", url: "localhost:3001" });
    expect(result.ok).toBe(false);
    expect(result.files).toEqual([]);
    expect(result.error?.code).toBe("invalid");
    expect(result.error?.message).toContain("http://127.0.0.1:3001/mcp");
  });
});

describe("client", () => {
  it("is generated from the tool contracts", async () => {
    const [file] = (await scaffold({ target: "client" })).files;
    expect(file?.path).toBe("strumentario-client.ts");
    const content = file?.content ?? "";
    for (const contract of toolContracts.filter((c) => c.name !== "scaffold")) {
      expect(content).toContain(`call<${contract.name[0]?.toUpperCase()}${contract.name.slice(1)}Output>("${contract.name}"`);
    }
    // A property from the schema shows up in the generated types, so nothing is restated by hand.
    expect(content).toContain("expectedRevision?: string;");
    expect(content).toContain("page?: HandbookPageDraft;");
  });

  it("tracks the domain: a new field appears in the draft type", async () => {
    const { handbookDomain } = await import("./schema.js");
    const { defineDomain } = await import("./domain.js");
    const { buildToolContracts } = await import("./contracts.js");
    const extended = defineDomain({
      ...handbookDomain,
      fields: [...handbookDomain.fields, { name: "summary", kind: "string" as const }],
    });
    const [file] = generateScaffoldFiles({ target: "client" }, { domain: extended, contracts: buildToolContracts(extended) });
    expect(file?.content).toContain("summary: string;");
  });

  it("type-checks under tsc, strictly, and works with the SDK Client", async () => {
    const [file] = generateScaffoldFiles({ target: "client" });
    // Lives under packages/server so the import of the MCP SDK resolves; never written to disk.
    const here = path.dirname(fileURLToPath(import.meta.url));
    const clientPath = path.join(here, "__virtual__", "strumentario-client.ts");
    const usagePath = path.join(here, "__virtual__", "usage.ts");
    const usage = `
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { createStrumentarioClient, pageUri, TOOL_NAMES, type MutateOutput } from "./strumentario-client.js";

declare const sdk: Client;
const client = createStrumentarioClient(sdk);

export async function demo(): Promise<string> {
  const listed = await client.query();
  const one = await client.query({ slug: "intro" });
  const dry: MutateOutput = await client.mutate({
    action: "create",
    slug: "intro",
    page: { title: "Intro", slug: "intro", body: "Hello" },
  });
  const checked = await client.validate({ instance: { title: 1 } });
  const names: readonly string[] = TOOL_NAMES;
  return [listed.total, one.page?.revision, dry.dryRun, checked.errors.length, names.length, pageUri("intro")].join();
}

// @ts-expect-error mutate needs an action and a slug
void client.mutate({});
// @ts-expect-error the page draft is typed: body must be a string
void client.mutate({ action: "create", slug: "a", page: { title: "A", slug: "a", body: 1 } });
`;
    const diagnostics = await typeCheck(
      new Map([
        [clientPath, file?.content ?? ""],
        [usagePath, usage],
      ]),
    );
    expect(diagnostics).toEqual([]);
  });

  it("the type check does catch a broken client", async () => {
    const here = path.dirname(fileURLToPath(import.meta.url));
    const clientPath = path.join(here, "__virtual__", "strumentario-client.ts");
    const broken = (generateScaffoldFiles({ target: "client" })[0]?.content ?? "").replace("slug: string;\n  /** The full page", "slug: Missing;\n  /** The full page");
    expect((await typeCheck(new Map([[clientPath, broken]]))).length).toBeGreaterThan(0);
  });
});

async function typeCheck(sources: Map<string, string>): Promise<string[]> {
  const diagnostics = await typeCheckSources(sources);
  return diagnostics.map((diagnostic) => `${diagnostic.file ? `${path.basename(diagnostic.file)}: ` : ""}${diagnostic.message}`);
}
