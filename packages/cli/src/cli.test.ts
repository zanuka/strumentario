import { mkdtemp, rm, writeFile } from "node:fs/promises";
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

async function cli(args: string[], env: NodeJS.ProcessEnv = {}, signal?: AbortSignal): Promise<Run> {
  let stdout = "";
  let stderr = "";
  const code = await runCli(args, {
    env,
    stdout: (text) => (stdout += text),
    stderr: (text) => (stderr += text),
    ...(signal ? { signal } : {}),
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
    expect(tools.map((t) => t.name).sort()).toEqual(["mutate", "query", "validate"]);
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
