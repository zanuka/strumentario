import { spawn, spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdtemp, readdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createMcpServer } from "./server.js";
import { FileSystemPageStore, resolveDataDir, StoreError } from "./store.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const serverRoot = path.resolve(here, "..");
const repoRoot = path.resolve(serverRoot, "../..");

let dir: string;
let store: FileSystemPageStore;

beforeEach(async () => {
  dir = await mkdtemp(path.join(os.tmpdir(), "strumentario-store-"));
  store = new FileSystemPageStore(dir);
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

const page = (slug: string, body = `Body of ${slug}.`) => ({
  title: `Title ${slug}`,
  slug,
  body,
});

describe("FileSystemPageStore", () => {
  it("round-trips pages with a stable content revision", async () => {
    const written = await store.put(page("alpha"));
    const read = await store.get("alpha");
    expect(read).toEqual(written);
    expect(read?.revision).toMatch(/^[0-9a-f]{16}$/);

    const updated = await store.put(page("alpha", "Changed."));
    expect(updated.revision).not.toBe(written.revision);
    expect((await store.put(page("alpha", "Changed."))).revision).toBe(updated.revision);
  });

  it("lists pages sorted by slug and ignores temp files", async () => {
    await store.put(page("beta"));
    await store.put(page("alpha"));
    await writeFile(path.join(dir, ".alpha.x.tmp"), "partial");
    expect((await store.list()).map((p) => p.slug)).toEqual(["alpha", "beta"]);
  });

  it("returns undefined for unknown or unsafe slugs and empty for a missing dir", async () => {
    expect(await store.get("missing")).toBeUndefined();
    expect(await store.get("../etc/passwd")).toBeUndefined();
    expect(await new FileSystemPageStore(path.join(dir, "nope")).list()).toEqual([]);
  });

  it("rejects invalid pages and reports corrupt files actionably", async () => {
    await expect(store.put({ title: "x", slug: "Bad Slug", body: "y" })).rejects.toThrow(StoreError);
    await writeFile(path.join(dir, "broken.json"), "{not json");
    await expect(store.get("broken")).rejects.toThrow(/not valid JSON/);
  });

  it("resolves the data dir from STRUMENTARIO_DATA_DIR with a default", () => {
    expect(resolveDataDir({ STRUMENTARIO_DATA_DIR: dir })).toBe(dir);
    expect(resolveDataDir({})).toBe(path.resolve("./.strumentario/data"));
  });

  it("serves the committed seed pages", async () => {
    const seeds = new FileSystemPageStore(path.join(repoRoot, ".strumentario/data"));
    expect((await seeds.list()).map((p) => p.slug)).toEqual([
      "content-primitives",
      "getting-started",
      "local-data-store",
    ]);
  });
});

describe("concurrent rewrite from another process", () => {
  beforeAll(() => {
    if (!existsSync(path.join(serverRoot, "dist/store.js"))) {
      const tsc = path.join(repoRoot, "node_modules/.bin/tsc");
      const built = spawnSync(tsc, ["-b", serverRoot], { encoding: "utf8" });
      if (built.status !== 0) {
        throw new Error(`Building the server for the rewrite test failed:\n${built.stdout}${built.stderr}`);
      }
    }
  }, 60_000);

  it("never observes a torn read", async () => {
    await store.put(page("probe", "a".repeat(200_000)));

    const child = spawn(
      process.execPath,
      [path.join(serverRoot, "test-fixtures/rewrite-page.mjs"), dir, "probe", "150"],
      { stdio: ["ignore", "inherit", "inherit"] },
    );
    const exited = new Promise<number | null>((resolve) => child.on("exit", resolve));
    let running = true;
    void exited.then(() => {
      running = false;
    });

    let reads = 0;
    const revisions = new Set<string>();
    while (running) {
      const read = await store.get("probe");
      expect(read).toBeDefined();
      // A torn file would fail JSON/schema parsing (throws) or mix a/b bytes.
      expect(new Set(read!.body).size).toBe(1);
      revisions.add(read!.revision);
      reads += 1;
    }

    expect(await exited).toBe(0);
    expect(reads).toBeGreaterThan(10);
    expect(revisions.size).toBeGreaterThan(1);
    expect((await readdir(dir)).filter((n) => n.endsWith(".tmp"))).toEqual([]);
  }, 60_000);
});

describe("query tool and page resource", () => {
  async function connect() {
    const server = createMcpServer({ store });
    const client = new Client({ name: "test", version: "0.0.0" });
    const [a, b] = InMemoryTransport.createLinkedPair();
    await Promise.all([server.connect(a), client.connect(b)]);
    return client;
  }

  beforeEach(async () => {
    await store.put(page("alpha", "Needle in alpha."));
    await store.put(page("beta"));
  });

  it("lists query as a read-only tool next to validate", async () => {
    const client = await connect();
    const { tools } = await client.listTools();
    expect(tools.map((t) => t.name).sort()).toEqual(["mutate", "query", "validate"]);
    expect(tools.find((t) => t.name === "query")?.annotations?.readOnlyHint).toBe(true);
  });

  it("gets a page by slug with its revision", async () => {
    const client = await connect();
    const result = await client.callTool({ name: "query", arguments: { slug: "alpha" } });
    const stored = await store.get("alpha");
    expect(result.structuredContent).toEqual({ ok: true, page: stored });
    expect(stored?.revision).toBeTruthy();
  });

  it("lists pages with text filter and limit", async () => {
    const client = await connect();
    const all = await client.callTool({ name: "query", arguments: {} });
    expect((all.structuredContent as { total: number }).total).toBe(2);

    const filtered = await client.callTool({ name: "query", arguments: { text: "NEEDLE" } });
    expect((filtered.structuredContent as { pages: { slug: string }[] }).pages.map((p) => p.slug)).toEqual(["alpha"]);

    const limited = await client.callTool({ name: "query", arguments: { limit: 1 } });
    const body = limited.structuredContent as { pages: unknown[]; total: number };
    expect(body.pages).toHaveLength(1);
    expect(body.total).toBe(2);
  });

  it("returns a structured not-found error naming the slug and available slugs", async () => {
    const client = await connect();
    const result = await client.callTool({ name: "query", arguments: { slug: "nope" } });
    expect(result.isError).toBe(true);
    const error = (result.structuredContent as { ok: boolean; error: { code: string; message: string; availableSlugs: string[] } });
    expect(error.ok).toBe(false);
    expect(error.error.code).toBe("not_found");
    expect(error.error.message).toContain('"nope"');
    expect(error.error.message).toContain("alpha, beta");
    expect(error.error.availableSlugs).toEqual(["alpha", "beta"]);
  });

  it("reports store failures as structured errors instead of throwing", async () => {
    await writeFile(path.join(dir, "broken.json"), "{oops");
    const client = await connect();
    const result = await client.callTool({ name: "query", arguments: {} });
    expect(result.isError).toBe(true);
    expect((result.structuredContent as { error: { code: string } }).error.code).toBe("store_error");
  });

  it("exposes strumentario://pages/{slug}", async () => {
    const client = await connect();
    const { resourceTemplates } = await client.listResourceTemplates();
    expect(resourceTemplates.map((t) => t.uriTemplate)).toContain("strumentario://pages/{slug}");

    const read = await client.readResource({ uri: "strumentario://pages/alpha" });
    const content = read.contents[0] as { text: string };
    expect(JSON.parse(content.text)).toEqual(await store.get("alpha"));

    await expect(client.readResource({ uri: "strumentario://pages/nope" })).rejects.toThrow(/alpha, beta/);
  });
});
