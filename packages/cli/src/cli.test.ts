import { mkdtemp, readdir, rm, writeFile } from "node:fs/promises";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import path from "node:path";
import { createMcpHttpServer, shutdownHttpServer, type ToolCallEvent } from "@strumentario/server";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { EXIT, runCli } from "./cli.js";

interface Run {
  code: number;
  stdout: string;
  stderr: string;
}

async function cli(args: string[], env: NodeJS.ProcessEnv = {}, signal?: AbortSignal, stdin?: string): Promise<Run> {
  let stdout = "";
  let stderr = "";
  const code = await runCli(args, {
    env,
    stdout: (text) => (stdout += text),
    stderr: (text) => (stderr += text),
    ...(signal ? { signal } : {}),
    ...(stdin !== undefined ? { stdin: async () => stdin } : {}),
  });
  return { code, stdout, stderr };
}

let dataDir: string;
let running: Server | undefined;
let calls: ToolCallEvent[];

beforeEach(async () => {
  dataDir = await mkdtemp(path.join(tmpdir(), "strumentario-cli-"));
  process.env.STRUMENTARIO_DATA_DIR = dataDir;
  calls = [];
});

afterEach(async () => {
  delete process.env.STRUMENTARIO_DATA_DIR;
  if (running) {
    await shutdownHttpServer(running);
    running = undefined;
  }
  await rm(dataDir, { recursive: true, force: true });
});

async function start(authToken?: string): Promise<string> {
  const server = createMcpHttpServer({ authToken, onToolCall: (event) => calls.push(event) });
  running = server;
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  return `http://127.0.0.1:${(server.address() as AddressInfo).port}/mcp`;
}

async function freePort(): Promise<number> {
  const probe = createServer();
  await new Promise<void>((resolve) => probe.listen(0, "127.0.0.1", resolve));
  const { port } = probe.address() as AddressInfo;
  await new Promise<void>((resolve) => probe.close(() => resolve()));
  return port;
}

const VALID_PAGE = { title: "Getting started", slug: "getting-started", body: "Draft content." };

describe("serve + call validate --json (end to end)", () => {
  it("starts the server, validates a page over MCP, and stops on abort", async () => {
    const port = await freePort();
    const controller = new AbortController();
    const serving = cli(["serve"], { PORT: String(port) }, controller.signal);

    const url = `http://127.0.0.1:${port}/mcp`;
    for (let i = 0; i < 100; i += 1) {
      const ready = await fetch(`http://127.0.0.1:${port}/healthz`).then((r) => r.ok, () => false);
      if (ready) break;
      await new Promise((resolve) => setTimeout(resolve, 50));
    }

    const result = await cli(["call", "validate", "--json", "--url", url, "--input", JSON.stringify({ instance: VALID_PAGE })]);
    expect(result.code).toBe(EXIT.ok);
    expect(JSON.parse(result.stdout)).toEqual({ valid: true, errors: [] });
    expect(result.stderr).toBe("");

    controller.abort();
    const served = await serving;
    expect(served.code).toBe(EXIT.ok);
    expect(served.stdout).toBe("");
    expect(served.stderr).toContain(`listening on http://127.0.0.1:${port}/mcp`);
  });

  it("reports an occupied port as a tool-level failure with the cause", async () => {
    const url = await start();
    const port = new URL(url).port;
    const result = await cli(["serve"], { PORT: port }, AbortSignal.abort());
    expect(result.code).toBe(EXIT.tool);
    expect(result.stderr).toMatch(/Unable to start/);
  });

  it("rejects an invalid PORT as a usage error", async () => {
    const result = await cli(["serve"], { PORT: "abc" });
    expect(result.code).toBe(EXIT.usage);
    expect(result.stderr).toMatch(/PORT must be/);
  });

  it("serve --stdio --dry-run reports stdio without listening or touching stdout streams", async () => {
    const result = await cli(["serve", "--stdio", "--dry-run", "--json"], { STRUMENTARIO_AGENT: "agent-x" });
    expect(result.code).toBe(EXIT.ok);
    expect(JSON.parse(result.stdout)).toEqual({ transport: "stdio", agent: "agent-x" });
    const viaEnv = await cli(["serve", "--dry-run", "--json"], { MCP_TRANSPORT: "stdio" });
    expect(JSON.parse(viaEnv.stdout)).toEqual({ transport: "stdio", agent: null });
  });

  it("serve --dry-run prints the resolved config and does not listen", async () => {
    const result = await cli(["serve", "--dry-run", "--json"], { PORT: "4555", MCP_AUTH_TOKEN: "s3cret" });
    expect(result.code).toBe(EXIT.ok);
    expect(JSON.parse(result.stdout)).toEqual({ host: "127.0.0.1", port: 4555, auth: true, url: "http://127.0.0.1:4555/mcp" });
    expect(result.stdout).not.toContain("s3cret");
  });
});

describe("tools and call", () => {
  it("lists tools with input schemas from the server", async () => {
    const url = await start();
    const result = await cli(["tools", "--json", "--url", url]);
    expect(result.code).toBe(EXIT.ok);
    const { tools } = JSON.parse(result.stdout) as { tools: { name: string; inputSchema: unknown }[] };
    expect(tools.map((t) => t.name).sort()).toEqual(["mutate", "query", "repair", "scaffold", "validate"]);
    expect(tools.every((t) => typeof t.inputSchema === "object")).toBe(true);
  });

  it("uses STRUMENTARIO_URL when --url is absent", async () => {
    const url = await start();
    const result = await cli(["tools", "--json"], { STRUMENTARIO_URL: url });
    expect(result.code).toBe(EXIT.ok);
  });

  it("prints a tool's description and schema for `call <tool> --help`", async () => {
    const url = await start();
    const result = await cli(["call", "mutate", "--help", "--url", url]);
    expect(result.code).toBe(EXIT.ok);
    expect(result.stdout).toContain("Dry-run by default");
    expect(result.stdout).toContain("dryRun");
  });

  it("exits 1 when validate reports an invalid page", async () => {
    const url = await start();
    const result = await cli(["call", "validate", "--json", "--url", url, "--input", JSON.stringify({ instance: { title: "" } })]);
    expect(result.code).toBe(EXIT.tool);
    expect(JSON.parse(result.stdout)).toMatchObject({ valid: false });
    expect(result.stderr).toMatch(/invalid/);
  });

  it("exits 1 with a next step for an unknown tool", async () => {
    const url = await start();
    const result = await cli(["call", "nope", "--url", url]);
    expect(result.code).toBe(EXIT.tool);
    expect(result.stderr).toMatch(/strumentario tools/);
  });

  it("reads input from --input-file", async () => {
    const url = await start();
    const file = path.join(dataDir, "input.json");
    await writeFile(file, JSON.stringify({ instance: VALID_PAGE }));
    const result = await cli(["call", "validate", "--json", "--url", url, "--input-file", file]);
    expect(result.code).toBe(EXIT.ok);
    expect(JSON.parse(result.stdout)).toEqual({ valid: true, errors: [] });
  });

  it("sends the agent identity header", async () => {
    const url = await start();
    await cli(["call", "validate", "--url", url, "--agent", "agent-7", "--input", JSON.stringify({ instance: VALID_PAGE })]);
    expect(calls).toEqual([{ tool: "validate", agent: "agent-7" }]);
  });
});

describe("scaffold", () => {
  it("call scaffold returns files and writes nothing by default", async () => {
    const url = await start();
    const result = await cli(["call", "scaffold", "--json", "--url", url, "--input", JSON.stringify({ target: "client", outDir: "gen" })]);
    expect(result.code).toBe(EXIT.ok);
    const out = JSON.parse(result.stdout) as { ok: boolean; written: boolean; files: { path: string }[] };
    expect(out).toMatchObject({ ok: true, written: false });
    expect(out.files.map((file) => file.path)).toEqual(["strumentario-client.ts"]);
    await expect(readdir(path.join(dataDir, "gen"))).rejects.toThrow();
  });

  it("call scaffold writes only with write: true and refuses to overwrite", async () => {
    process.env.STRUMENTARIO_SCAFFOLD_ROOT = dataDir;
    try {
      const url = await start();
      const input = JSON.stringify({ target: "host-config", write: true, outDir: "host" });
      const first = await cli(["call", "scaffold", "--json", "--url", url, "--input", input]);
      expect(first.code).toBe(EXIT.ok);
      expect(await readdir(path.join(dataDir, "host"))).toContain(".mcp.json");

      const again = await cli(["call", "scaffold", "--json", "--url", url, "--input", input]);
      expect(again.code).toBe(EXIT.tool);
      expect(JSON.parse(again.stdout)).toMatchObject({ ok: false, error: { code: "exists" } });
    } finally {
      delete process.env.STRUMENTARIO_SCAFFOLD_ROOT;
    }
  });

  it("--dry-run forces write off", async () => {
    process.env.STRUMENTARIO_SCAFFOLD_ROOT = dataDir;
    try {
      const url = await start();
      const input = JSON.stringify({ target: "client", write: true, outDir: "dry" });
      const result = await cli(["call", "scaffold", "--dry-run", "--json", "--url", url, "--input", input]);
      expect(result.code).toBe(EXIT.ok);
      expect(JSON.parse(result.stdout)).toMatchObject({ ok: true, written: false });
      await expect(readdir(path.join(dataDir, "dry"))).rejects.toThrow();
    } finally {
      delete process.env.STRUMENTARIO_SCAFFOLD_ROOT;
    }
  });
});

describe("mutating tools", () => {
  const create = { action: "create", slug: VALID_PAGE.slug, page: VALID_PAGE };

  it("call mutate writes nothing by default (dry-run is inherited from the tool)", async () => {
    const url = await start();
    const result = await cli(["call", "mutate", "--json", "--url", url, "--input", JSON.stringify(create)]);
    expect(result.code).toBe(EXIT.ok);
    const query = await cli(["call", "query", "--json", "--url", url, "--input", JSON.stringify({ slug: VALID_PAGE.slug })]);
    expect(query.stdout).not.toContain("Draft content.");
  });

  it("--dry-run overrides an explicit dryRun: false", async () => {
    const url = await start();
    const result = await cli(["call", "mutate", "--dry-run", "--json", "--url", url, "--input", JSON.stringify({ ...create, dryRun: false })]);
    expect(result.code).toBe(EXIT.ok);
    const query = await cli(["call", "query", "--json", "--url", url]);
    expect(JSON.parse(query.stdout)).toMatchObject({ pages: [] });
  });

  it("writes only when the caller passes dryRun: false to the tool", async () => {
    const url = await start();
    const written = await cli(["call", "mutate", "--json", "--url", url, "--input", JSON.stringify({ ...create, dryRun: false })]);
    expect(written.code).toBe(EXIT.ok);
    const query = await cli(["call", "query", "--json", "--url", url, "--input", JSON.stringify({ slug: VALID_PAGE.slug })]);
    expect(query.stdout).toContain("Draft content.");
  });
});

describe("resource", () => {
  it("reads the page schema resource", async () => {
    const url = await start();
    const result = await cli(["resource", "--json", "--url", url, "strumentario://schemas/handbook-page"]);
    expect(result.code).toBe(EXIT.ok);
    const { contents } = JSON.parse(result.stdout) as { contents: { text: string }[] };
    expect(JSON.parse(contents[0]!.text)).toMatchObject({ type: "object" });
  });

  it("exits 1 for an unknown resource", async () => {
    const url = await start();
    const result = await cli(["resource", "--url", url, "strumentario://pages/missing"]);
    expect(result.code).toBe(EXIT.tool);
  });
});

describe("journal", () => {
  const write = (slug: string) => ({ action: "create", slug, page: { title: slug, slug, body: "Body." }, dryRun: false });

  it("prints journal entries with the agent and continues from a cursor", async () => {
    const url = await start();
    for (const slug of ["one", "two", "three"]) {
      const called = await cli(["call", "mutate", "--json", "--url", url, "--agent", "cli-agent", "--input", JSON.stringify(write(slug))]);
      expect(called.code).toBe(EXIT.ok);
    }

    const first = await cli(["journal", "--json", "--url", url, "--limit", "2"]);
    expect(first.code).toBe(EXIT.ok);
    const page = JSON.parse(first.stdout) as { entries: { slug: string; agent: string; status: string }[]; cursor: string };
    expect(page.entries.map((e) => [e.slug, e.agent, e.status])).toEqual([
      ["one", "cli-agent", "applied"],
      ["two", "cli-agent", "applied"],
    ]);

    const rest = await cli(["journal", "--json", "--url", url, "--since", page.cursor]);
    expect((JSON.parse(rest.stdout) as { entries: { slug: string }[] }).entries.map((e) => e.slug)).toEqual(["three"]);
  });

  it("rejects a malformed cursor or limit as a usage error", async () => {
    expect((await cli(["journal", "--since", "abc"])).code).toBe(EXIT.usage);
    expect((await cli(["journal", "--limit", "0"])).code).toBe(EXIT.usage);
    expect((await cli(["journal", "extra"])).code).toBe(EXIT.usage);
  });

  it("exits 1 with the server's explanation for a cursor past the end", async () => {
    const url = await start();
    const result = await cli(["journal", "--url", url, "--since", "99"]);
    expect(result.code).toBe(EXIT.tool);
    expect(result.stderr).toMatch(/past the end|no journal/);
  });
});

describe("exit codes", () => {
  it("3 when the connection is refused, with nothing on stdout", async () => {
    const port = await freePort();
    const result = await cli(["tools", "--json", "--url", `http://127.0.0.1:${port}/mcp`]);
    expect(result.code).toBe(EXIT.connection);
    expect(result.stdout).toBe("");
    expect(result.stderr).toMatch(/strumentario serve/);
  });

  it("3 when the server needs a token and none (or a wrong one) is given", async () => {
    const url = await start("right");
    const missing = await cli(["tools", "--json", "--url", url]);
    expect(missing.code).toBe(EXIT.connection);
    expect(missing.stdout).toBe("");
    expect(missing.stderr).toMatch(/--token|STRUMENTARIO_TOKEN/);
    const wrong = await cli(["tools", "--json", "--url", url, "--token", "wrong"]);
    expect(wrong.code).toBe(EXIT.connection);
    const ok = await cli(["tools", "--json", "--url", url, "--token", "right"]);
    expect(ok.code).toBe(EXIT.ok);
  });

  it("2 for usage errors", async () => {
    for (const args of [[], ["bogus"], ["call"], ["resource"], ["tools", "extra"], ["--nope"], ["call", "validate", "--input", "{bad"], ["call", "validate", "--input", "[1]"], ["call", "validate", "--input", "{}", "--input-file", "x"], ["tools", "--url", "not a url"]]) {
      const result = await cli(args);
      expect(result.code, JSON.stringify(args)).toBe(EXIT.usage);
      expect(result.stdout, JSON.stringify(args)).toBe("");
      expect(result.stderr).not.toBe("");
    }
  });

  it("--help exits 0", async () => {
    const result = await cli(["--help"]);
    expect(result.code).toBe(EXIT.ok);
    expect(result.stdout).toMatch(/Exit codes/);
  });
});

describe("batch", () => {
  const lines = (...records: unknown[]) => records.map((r) => (typeof r === "string" ? r : JSON.stringify(r))).join("\n");
  const page = (slug: string) => ({ title: slug, slug, body: "Body." });
  const out = (run: Run) => run.stdout.trimEnd().split("\n").map((line) => JSON.parse(line) as Record<string, unknown>);

  it("returns one record per line in input order and exits 1 on any failure", async () => {
    const url = await start();
    const input = lines(
      { id: "a", tool: "validate", input: { instance: VALID_PAGE } },
      "not json at all",
      { id: "b", tool: "nope", input: {} },
      { id: 7, tool: "validate", input: { instance: { title: "" } } },
      { tool: "query" },
      { id: "c", tool: "query", input: { slug: "missing-page" } },
      "",
      { id: "d", tool: "validate", input: "x" },
    );
    const run = await cli(["batch", "--url", url], {}, undefined, input);
    expect(run.code).toBe(EXIT.tool);
    const records = out(run);
    expect(records.map((r) => r.id)).toEqual(["a", null, "b", 7, null, "c", "d"]);
    expect(records.map((r) => r.ok)).toEqual([true, false, false, false, false, expect.any(Boolean), false]);
    expect(records[0]).toEqual({ id: "a", ok: true, result: { valid: true, errors: [] } });
    expect(records[1]).toMatchObject({ error: { code: "invalid_line" } });
    expect(records[2]).toMatchObject({ error: { code: expect.stringMatching(/tool_error|rejected/) } });
    expect(records[3]).toMatchObject({ error: { code: "tool_error" } });
    expect(records[4]).toMatchObject({ error: { code: "invalid_line" } });
    expect(records[6]).toMatchObject({ error: { code: "invalid_line" } });
  });

  it("exits 0 when every call succeeds, reading --input-file", async () => {
    const url = await start();
    const file = path.join(dataDir, "calls.jsonl");
    await writeFile(file, lines({ id: 1, tool: "validate", input: { instance: VALID_PAGE } }, { id: 2, tool: "query" }));
    const run = await cli(["batch", "--url", url, "--input-file", file]);
    expect(run.code).toBe(EXIT.ok);
    expect(out(run).map((r) => [r.id, r.ok])).toEqual([[1, true], [2, true]]);
  });

  it("runs 8 calls in parallel with --concurrency 8 and maps results back by id", async () => {
    const url = await start();
    const slugs = Array.from({ length: 8 }, (_, i) => `page-${i}`);
    const input = lines(...slugs.map((slug) => ({ id: slug, tool: "mutate", input: { action: "create", slug, page: page(slug), dryRun: false } })));
    const run = await cli(["batch", "--url", url, "--concurrency", "8"], {}, undefined, input);
    expect(run.code).toBe(EXIT.ok);
    const records = out(run);
    expect(records.map((r) => r.id)).toEqual(slugs);
    for (const record of records) {
      expect(record).toMatchObject({ ok: true, result: { ok: true, dryRun: false } });
      expect((record.result as { slug: string }).slug).toBe(record.id);
    }
    const query = await cli(["call", "query", "--json", "--url", url]);
    expect((JSON.parse(query.stdout) as { pages: unknown[] }).pages).toHaveLength(8);
  });

  it("--dry-run never writes, even for dryRun: false, and scaffold stays in memory", async () => {
    process.env.STRUMENTARIO_SCAFFOLD_ROOT = dataDir;
    try {
      const url = await start();
      const input = lines(
        { id: "m", tool: "mutate", input: { action: "create", slug: VALID_PAGE.slug, page: VALID_PAGE, dryRun: false } },
        { id: "s", tool: "scaffold", input: { target: "client", write: true, outDir: "gen" } },
        { id: "q", tool: "query" },
      );
      const run = await cli(["batch", "--dry-run", "--url", url], {}, undefined, input);
      expect(run.code).toBe(EXIT.ok);
      const records = out(run);
      expect(records[0]).toMatchObject({ ok: true, result: { ok: true, dryRun: true } });
      expect(records[1]).toMatchObject({ ok: true, result: { written: false } });
      expect(records[2]).toMatchObject({ ok: true, result: { pages: [] } });
      // Nothing but the journal (which records dry runs too) exists: no page file, no scaffold output.
      expect((await readdir(dataDir)).filter((name) => name !== "journal.jsonl")).toEqual([]);
      const journal = JSON.parse((await cli(["journal", "--json", "--url", url])).stdout) as { entries: { dryRun: boolean }[] };
      expect(journal.entries.every((entry) => entry.dryRun)).toBe(true);
    } finally {
      delete process.env.STRUMENTARIO_SCAFFOLD_ROOT;
    }
  });

  it("--stop-on-error skips the remaining calls but still reports every id", async () => {
    const url = await start();
    const input = lines(
      { id: 1, tool: "validate", input: { instance: VALID_PAGE } },
      { id: 2, tool: "validate", input: { instance: {} } },
      { id: 3, tool: "validate", input: { instance: VALID_PAGE } },
    );
    const run = await cli(["batch", "--stop-on-error", "--url", url], {}, undefined, input);
    expect(run.code).toBe(EXIT.tool);
    const records = out(run);
    expect(records.map((r) => r.ok)).toEqual([true, false, false]);
    expect(records[2]).toMatchObject({ id: 3, error: { code: "skipped" } });
  });

  it("rejects a bad --concurrency or missing input as usage errors and a dead server as 3", async () => {
    const url = await start();
    expect((await cli(["batch", "--concurrency", "0", "--url", url], {}, undefined, "")).code).toBe(EXIT.usage);
    expect((await cli(["batch", "--url", url])).code).toBe(EXIT.usage);
    expect((await cli(["batch", "--url", url, "--input-file", path.join(dataDir, "nope")])).code).toBe(EXIT.usage);
    const dead = await cli(["batch", "--url", `http://127.0.0.1:${await freePort()}/mcp`], {}, undefined, lines({ id: 1, tool: "query" }));
    expect(dead.code).toBe(EXIT.connection);
    expect(dead.stdout).toBe("");
  });

  it("an empty batch succeeds with no output", async () => {
    const url = await start();
    const run = await cli(["batch", "--url", url], {}, undefined, "\n\n");
    expect(run).toMatchObject({ code: EXIT.ok, stdout: "" });
  });
});
