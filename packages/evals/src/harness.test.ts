import { toolContracts } from "@strumentario/server";
import { describe, expect, it } from "vitest";
import { goldenCases } from "./golden.js";
import { runCase, runGolden } from "./harness.js";
import { matchSubset } from "./match.js";
import { runLocal } from "./report.js";
import type { CliGoldenCase, GoldenCase, ToolGoldenCase } from "./types.js";

function find<T extends GoldenCase>(id: string): T {
  const found = goldenCases.find((candidate) => candidate.id === id);
  if (!found) throw new Error(`no golden case ${id}`);
  return found as T;
}

describe("golden dataset", () => {
  it("has unique ids and a documented intent for every case", () => {
    const ids = goldenCases.map((goldenCase) => goldenCase.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const goldenCase of goldenCases) {
      expect(goldenCase.intent.length, goldenCase.id).toBeGreaterThan(20);
    }
  });

  it("covers query, mutate, validate, scaffold, repair, concurrency and CLI usage", () => {
    const categories = new Set(goldenCases.map((goldenCase) => goldenCase.category));
    expect([...categories].sort()).toEqual(["cli", "concurrency", "mutate", "query", "repair", "scaffold", "validate"]);
  });

  it("exercises every tool contract the server publishes", () => {
    const used = new Set<string>();
    for (const goldenCase of goldenCases) {
      if (goldenCase.kind !== "tool") continue;
      for (const step of goldenCase.steps) {
        for (const call of "call" in step ? [step.call] : step.parallel) used.add(call.tool);
      }
    }
    expect([...used].sort()).toEqual(toolContracts.map((contract) => contract.name).sort());
  });
});

describe("offline harness", () => {
  it("passes every golden case without any secrets", async () => {
    const env = process.env.BRAINTRUST_API_KEY;
    delete process.env.BRAINTRUST_API_KEY;
    try {
      const suite = await runGolden(goldenCases);
      const failing = suite.results.filter((result) => !result.passed);
      expect(failing).toEqual([]);
      expect(suite.passed).toBe(true);
    } finally {
      if (env !== undefined) process.env.BRAINTRUST_API_KEY = env;
    }
  }, 60_000);

  it("fails a tool case whose expectation is deliberately wrong", async () => {
    const broken: ToolGoldenCase = {
      ...find<ToolGoldenCase>("validate-happy-path"),
      id: "broken-validate",
      steps: [
        {
          call: { tool: "validate", input: { instance: { title: "T", slug: "t", body: "b" } } },
          expect: { isError: false, match: { valid: false } },
        },
      ],
    };
    const result = await runCase(broken);
    expect(result.passed).toBe(false);
    expect(result.failures.join("\n")).toContain("output.valid");
  });

  it("fails a case whose store post-condition is wrong (a dry run that did write would be caught)", async () => {
    const broken: ToolGoldenCase = {
      ...find<ToolGoldenCase>("mutate-dry-run-default-writes-nothing"),
      id: "broken-dry-run",
      after: [{ slug: "fresh-page", exists: true }],
    };
    const result = await runCase(broken);
    expect(result.passed).toBe(false);
    expect(result.failures.join("\n")).toContain("to exist");
  });

  it("fails a concurrency case that expects the wrong winner count", async () => {
    const original = find<ToolGoldenCase>("concurrent-updates-same-revision");
    const [step] = original.steps;
    if (!step || !("parallel" in step)) throw new Error("expected a parallel step");
    const result = await runCase({
      ...original,
      id: "broken-concurrency",
      steps: [{ parallel: step.parallel, expect: { ok: 2 } }],
    });
    expect(result.passed).toBe(false);
  });

  it("fails a CLI case with the wrong exit code", async () => {
    const result = await runCase({
      ...find<CliGoldenCase>("cli-call-validate-json"),
      id: "broken-cli",
      expect: { exitCode: 1 },
    });
    expect(result.passed).toBe(false);
    expect(result.failures.join("\n")).toContain("expected exit code 1, got 0");
  });

  it("fails a case that names a tool the server does not publish", async () => {
    const result = await runCase({
      id: "broken-tool-name",
      kind: "tool",
      category: "query",
      intent: "A misspelled tool name must fail the case, not pass vacuously.",
      steps: [{ call: { tool: "qeury" as "query", input: {} }, expect: { isError: false } }],
    });
    expect(result.passed).toBe(false);
    expect(result.failures.join("\n")).toContain("not a tool contract");
  });

  it("exits non-zero when any case fails and zero when all pass", async () => {
    const broken: ToolGoldenCase = {
      ...find<ToolGoldenCase>("validate-happy-path"),
      id: "broken-for-exit-code",
      steps: [
        {
          call: { tool: "validate", input: { instance: fresh() } },
          expect: { isError: true },
        },
      ],
    };
    let out = "";
    let err = "";
    const failing = await runLocal([broken], (text) => (out += text), (text) => (err += text));
    expect(failing).toBe(1);
    expect(out).toContain("FAIL validate    broken-for-exit-code");
    expect(err).toContain("1 golden case(s) failed");

    const passing = await runLocal([find("validate-happy-path")], () => undefined, () => undefined);
    expect(passing).toBe(0);
  });
});

function fresh() {
  return { title: "Fresh page", slug: "fresh-page", body: "Brand new content." };
}

describe("matchSubset", () => {
  it("matches objects as subsets and arrays exactly", () => {
    expect(matchSubset({ a: 1, b: 2 }, { a: 1 })).toEqual([]);
    expect(matchSubset({ a: [1, 2] }, { a: [1] })).toHaveLength(1);
    expect(matchSubset({ a: 1 }, { b: 1 })).toHaveLength(1);
  });

  it("supports $contains, $present and $absent markers", () => {
    expect(matchSubset({ m: "hello world" }, { m: { $contains: "world" } })).toEqual([]);
    expect(matchSubset({ m: "hello" }, { m: { $contains: "world" } })).toHaveLength(1);
    expect(matchSubset({ r: "abc" }, { r: { $present: true } })).toEqual([]);
    expect(matchSubset({}, { r: { $present: true } })).toHaveLength(1);
    expect(matchSubset({}, { r: { $absent: true } })).toEqual([]);
    expect(matchSubset({ r: 1 }, { r: { $absent: true } })).toHaveLength(1);
  });
});
