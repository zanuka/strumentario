import type { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { describe, expect, it } from "vitest";
import { parseBatchInput, runBatch, type BatchRecord } from "./batch.js";

function fakeClient(delays: Record<string, number>) {
  const state = { inFlight: 0, maxInFlight: 0 };
  const client = {
    async callTool({ name }: { name: string }) {
      state.inFlight += 1;
      state.maxInFlight = Math.max(state.maxInFlight, state.inFlight);
      await new Promise((resolve) => setTimeout(resolve, delays[name] ?? 0));
      state.inFlight -= 1;
      return { structuredContent: { name } };
    },
  } as unknown as Client;
  return { client, state };
}

describe("runBatch concurrency", () => {
  it("overlaps calls up to the limit and still emits records in input order", async () => {
    // The first call is the slowest, so completion order is the reverse of input order.
    const { client, state } = fakeClient({ t0: 60, t1: 40, t2: 20, t3: 0 });
    const entries = parseBatchInput([0, 1, 2, 3].map((i) => JSON.stringify({ id: i, tool: `t${i}` })).join("\n"));
    const seen: BatchRecord[] = [];
    const summary = await runBatch(client, entries, { dryRun: false, stopOnError: false, concurrency: 4, onRecord: (r) => seen.push(r) });
    expect(state.maxInFlight).toBe(4);
    expect(seen.map((r) => r.id)).toEqual([0, 1, 2, 3]);
    expect(summary).toEqual({ total: 4, failed: 0, connectionLost: false });
  });

  it("never exceeds the limit", async () => {
    const { client, state } = fakeClient({});
    const entries = parseBatchInput(Array.from({ length: 10 }, (_, i) => JSON.stringify({ id: i, tool: "x" })).join("\n"));
    await runBatch(client, entries, { dryRun: false, stopOnError: false, concurrency: 3, onRecord: () => undefined });
    expect(state.maxInFlight).toBeLessThanOrEqual(3);
  });
});
