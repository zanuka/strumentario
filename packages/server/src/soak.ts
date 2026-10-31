import { performance } from "node:perf_hooks";
import type { AddressInfo } from "node:net";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import type { Transport } from "@modelcontextprotocol/sdk/shared/transport.js";
import { createMcpHttpServer, MCP_HTTP_PATH, shutdownHttpServer } from "./http.js";

export interface SoakOptions {
  /** Number of concurrent in-process MCP clients. */
  clients: number;
  /** `validate` calls each client makes in sequence. */
  callsPerClient: number;
}

export interface SoakResult {
  clients: number;
  callsPerClient: number;
  totalCalls: number;
  failedCalls: number;
  errorRate: number;
  durationMs: number;
  throughputPerSec: number;
  latencyMs: { min: number; p50: number; p95: number; p99: number; max: number };
  firstError: string | undefined;
}

const VALID_PAGE = {
  title: "Getting started",
  slug: "getting-started",
  body: "Install Strumentario, then connect an MCP host.",
};

function percentile(sorted: readonly number[], p: number): number {
  if (sorted.length === 0) {
    return 0;
  }
  const index = Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1);
  return sorted[Math.max(0, index)] ?? 0;
}

async function runClient(
  url: URL,
  index: number,
  callsPerClient: number,
  latencies: number[],
  errors: string[],
): Promise<void> {
  const client = new Client({ name: `soak-client-${index}`, version: "0.0.0" });
  const transport = new StreamableHTTPClientTransport(url, {
    requestInit: { headers: { "x-strumentario-agent": `soak-${index}` } },
  });

  try {
    // SDK transport declarations conflict with exactOptionalPropertyTypes.
    await client.connect(transport as unknown as Transport);
  } catch (error) {
    // A client that cannot connect fails every call it was meant to make.
    for (let i = 0; i < callsPerClient; i += 1) {
      errors.push(`connect: ${error instanceof Error ? error.message : String(error)}`);
    }
    return;
  }

  try {
    for (let i = 0; i < callsPerClient; i += 1) {
      const started = performance.now();
      try {
        const result = await client.callTool({
          name: "validate",
          arguments: { instance: VALID_PAGE },
        });
        const structured = result.structuredContent as { valid?: boolean } | undefined;
        if (result.isError || structured?.valid !== true) {
          errors.push("validate returned an error or an unexpected result");
        }
      } catch (error) {
        errors.push(error instanceof Error ? error.message : String(error));
      }
      latencies.push(performance.now() - started);
    }
  } finally {
    await client.close().catch(() => undefined);
  }
}

/** Start an in-process server on an ephemeral loopback port and hammer `validate`. */
export async function runSoak(options: SoakOptions): Promise<SoakResult> {
  const server = createMcpHttpServer();
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address() as AddressInfo;
  const url = new URL(`http://127.0.0.1:${port}${MCP_HTTP_PATH}`);

  const latencies: number[] = [];
  const errors: string[] = [];
  const started = performance.now();

  try {
    await Promise.all(
      Array.from({ length: options.clients }, (_, index) =>
        runClient(url, index, options.callsPerClient, latencies, errors),
      ),
    );
  } finally {
    await shutdownHttpServer(server);
  }

  const durationMs = performance.now() - started;
  const totalCalls = options.clients * options.callsPerClient;
  const sorted = [...latencies].sort((a, b) => a - b);

  return {
    clients: options.clients,
    callsPerClient: options.callsPerClient,
    totalCalls,
    failedCalls: errors.length,
    errorRate: totalCalls === 0 ? 0 : errors.length / totalCalls,
    durationMs,
    throughputPerSec: durationMs === 0 ? 0 : (totalCalls / durationMs) * 1000,
    latencyMs: {
      min: sorted[0] ?? 0,
      p50: percentile(sorted, 50),
      p95: percentile(sorted, 95),
      p99: percentile(sorted, 99),
      max: sorted[sorted.length - 1] ?? 0,
    },
    firstError: errors[0],
  };
}

export function formatSoakResult(result: SoakResult): string {
  const l = result.latencyMs;
  return [
    `clients=${result.clients} calls/client=${result.callsPerClient} total=${result.totalCalls}`,
    `failed=${result.failedCalls} errorRate=${(result.errorRate * 100).toFixed(2)}%`,
    `latency ms: min=${l.min.toFixed(1)} p50=${l.p50.toFixed(1)} p95=${l.p95.toFixed(1)} p99=${l.p99.toFixed(1)} max=${l.max.toFixed(1)}`,
    `duration=${(result.durationMs / 1000).toFixed(2)}s throughput=${result.throughputPerSec.toFixed(0)} calls/s`,
  ].join("\n");
}
