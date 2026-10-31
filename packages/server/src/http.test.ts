import type { AddressInfo } from "node:net";
import { request as httpRequest, type Server } from "node:http";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { afterEach, describe, expect, it } from "vitest";
import { DEFAULT_HOST, DEFAULT_PORT, loadConfig } from "./config.js";
import { createMcpHttpServer, shutdownHttpServer, type McpHttpOptions } from "./http.js";
import { runSoak } from "./soak.js";

let running: Server | undefined;

async function start(options: McpHttpOptions = {}): Promise<string> {
  const server = createMcpHttpServer(options);
  running = server;
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  return `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
}

afterEach(async () => {
  if (running) {
    await shutdownHttpServer(running);
    running = undefined;
  }
});

const INIT_BODY = JSON.stringify({
  jsonrpc: "2.0",
  id: 1,
  method: "initialize",
  params: {
    protocolVersion: "2025-03-26",
    capabilities: {},
    clientInfo: { name: "test", version: "0" },
  },
});

function post(base: string, headers: Record<string, string> = {}): Promise<Response> {
  return fetch(`${base}/mcp`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      accept: "application/json, text/event-stream",
      ...headers,
    },
    body: INIT_BODY,
  });
}

describe("loadConfig", () => {
  it("defaults to port 3001 on loopback with auth off", () => {
    expect(loadConfig({})).toEqual({
      port: DEFAULT_PORT,
      host: DEFAULT_HOST,
      authToken: undefined,
    });
    expect(DEFAULT_PORT).toBe(3001);
    expect(DEFAULT_HOST).toBe("127.0.0.1");
  });

  it("reads PORT, HOST and MCP_AUTH_TOKEN", () => {
    expect(loadConfig({ PORT: "4000", HOST: "0.0.0.0", MCP_AUTH_TOKEN: "s3" })).toEqual({
      port: 4000,
      host: "0.0.0.0",
      authToken: "s3",
    });
  });

  it("treats an empty token as unset and rejects a bad port", () => {
    expect(loadConfig({ MCP_AUTH_TOKEN: "" }).authToken).toBeUndefined();
    expect(() => loadConfig({ PORT: "abc" })).toThrow(/PORT must be/);
  });
});

describe("GET /healthz", () => {
  it("returns ok without requiring auth", async () => {
    const base = await start({ authToken: "secret" });
    const response = await fetch(`${base}/healthz`);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ status: "ok" });
  });
});

describe("MCP_AUTH_TOKEN bearer check", () => {
  it("leaves /mcp open when no token is configured", async () => {
    const base = await start();
    expect((await post(base)).status).toBe(200);
  });

  it("rejects missing or wrong tokens with an actionable 401", async () => {
    const base = await start({ authToken: "secret" });

    const missing = await post(base);
    expect(missing.status).toBe(401);
    expect(missing.headers.get("www-authenticate")).toMatch(/^Bearer/);
    expect(JSON.stringify(await missing.json())).toContain("MCP_AUTH_TOKEN");

    expect((await post(base, { authorization: "Bearer wrong" })).status).toBe(401);
  });

  it("accepts the correct token", async () => {
    const base = await start({ authToken: "secret" });
    expect((await post(base, { authorization: "Bearer secret" })).status).toBe(200);
  });
});

describe("X-Strumentario-Agent header", () => {
  async function callValidate(
    base: string,
    headers: Record<string, string>,
  ): Promise<void> {
    const client = new Client({ name: "test", version: "0" });
    await client.connect(
      new StreamableHTTPClientTransport(new URL(`${base}/mcp`), {
        requestInit: { headers },
      }),
    );
    await client.callTool({ name: "validate", arguments: { instance: {} } });
    await client.close();
  }

  it("reaches the tool handler", async () => {
    const seen: Array<string | undefined> = [];
    const base = await start({ onToolCall: (event) => seen.push(event.agent) });
    await callValidate(base, { "x-strumentario-agent": "agent-7" });
    expect(seen).toEqual(["agent-7"]);
  });

  it("is optional", async () => {
    const seen: Array<string | undefined> = [];
    const base = await start({ onToolCall: (event) => seen.push(event.agent) });
    await callValidate(base, {});
    expect(seen).toEqual([undefined]);
  });
});

describe("graceful shutdown", () => {
  it("lets an in-flight request finish before closing", async () => {
    const base = await start();
    const server = running as Server;
    const body = INIT_BODY;

    // Send headers and half the body so the request is in flight when shutdown begins.
    const status = await new Promise<number>((resolve, reject) => {
      const req = httpRequest(
        `${base}/mcp`,
        {
          method: "POST",
          headers: {
            "content-type": "application/json",
            accept: "application/json, text/event-stream",
            "content-length": Buffer.byteLength(body),
          },
        },
        (res) => {
          res.resume();
          res.on("end", () => resolve(res.statusCode ?? 0));
        },
      );
      req.on("error", reject);
      req.write(body.slice(0, 10));

      setTimeout(() => {
        let closed = false;
        const closing = shutdownHttpServer(server).then(() => {
          closed = true;
        });
        setTimeout(() => {
          expect(closed).toBe(false);
          req.end(body.slice(10));
          void closing;
        }, 50);
      }, 50);
    });

    expect(status).toBe(200);
    running = undefined;
  });
});

describe("soak (CI size)", () => {
  it("serves concurrent clients with zero failed calls", async () => {
    const result = await runSoak({ clients: 10, callsPerClient: 5 });
    expect(result.totalCalls).toBe(50);
    expect(result.failedCalls).toBe(0);
    expect(result.errorRate).toBe(0);
    expect(result.latencyMs.p99).toBeGreaterThan(0);
  }, 30_000);
});
