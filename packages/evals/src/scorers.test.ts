import { describe, expect, it } from "vitest";
import { goldenCases } from "./golden.js";
import { runCase } from "./harness.js";
import { demonstrateRegression } from "./regression.js";
import { concurrencySafety, noUnexpectedSideEffect, outputSchemaValid, scoreCase, toolChoice } from "./scorers.js";
import type { CallRecord, CaseResult, GoldenCase, PageSnapshot, StepRecord, ToolGoldenCase } from "./types.js";

const page = (slug: string, revision: string): PageSnapshot => ({ slug, title: slug, body: "b", revision });

function call(tool: string, input: Record<string, unknown>, structured: unknown, isError = false): CallRecord {
  return { tool, input, isError, structured, text: "" };
}

function step(calls: CallRecord[], before: PageSnapshot[] = [], after: PageSnapshot[] = before, parallel = false): StepRecord {
  return { parallel, calls, storeBefore: before, storeAfter: after };
}

function toolCase(steps: ToolGoldenCase["steps"]): ToolGoldenCase {
  return { id: "synthetic", kind: "tool", category: "mutate", intent: "A synthetic case used to unit test a scorer.", steps };
}

function resultOf(steps: StepRecord[], passed = true): CaseResult {
  return { id: "synthetic", category: "mutate", passed, failures: [], durationMs: 0, trace: { steps, finalStore: [] } };
}

describe("tool_choice", () => {
  const spec = toolCase([{ call: { tool: "query", input: { slug: "intro" } }, expect: { isError: false } }]);

  it("scores 1 when the expected tool and arguments were sent", () => {
    const out = toolChoice({ case: spec, result: resultOf([step([call("query", { slug: "intro" }, {})])]) });
    expect(out.score).toBe(1);
  });

  it("fails when a different tool was called", () => {
    const out = toolChoice({ case: spec, result: resultOf([step([call("validate", { slug: "intro" }, {})])]) });
    expect(out.score).toBeLessThan(1);
    expect(out.problems.join("\n")).toContain('expected a call to "query"');
  });

  it("fails when the arguments differ from the golden spec", () => {
    const out = toolChoice({ case: spec, result: resultOf([step([call("query", { slug: "other" }, {})])]) });
    expect(out.score).toBeLessThan(1);
    expect(out.problems.join("\n")).toContain("different arguments");
  });

  it("fails when the golden spec names a tool the server does not publish", () => {
    const bad = toolCase([{ call: { tool: "qeury" as "query", input: {} }, expect: { isError: false } }]);
    const out = toolChoice({ case: bad, result: resultOf([]) });
    expect(out.score).toBe(0);
    expect(out.problems.join("\n")).toContain("not a published tool contract");
  });

  it("is not applicable to CLI cases", () => {
    const cli = goldenCases.find((candidate) => candidate.kind === "cli") as GoldenCase;
    expect(toolChoice({ case: cli, result: { id: cli.id, category: "cli", passed: true, failures: [], durationMs: 0 } }).score).toBeNull();
  });
});

describe("output_schema_valid", () => {
  const spec = toolCase([]);

  it("accepts output that matches the published outputSchema", () => {
    const out = outputSchemaValid({
      case: spec,
      result: resultOf([step([call("validate", {}, { valid: true, errors: [] })])]),
    });
    expect(out.score).toBe(1);
  });

  it("fails output with a wrong type or an undeclared field", () => {
    const out = outputSchemaValid({
      case: spec,
      result: resultOf([
        step([call("validate", {}, { valid: "yes", errors: [], surprise: 1 }), call("validate", {}, { valid: true, errors: [] })]),
      ]),
    });
    expect(out.score).toBe(0.5);
    expect(out.problems.join("\n")).toContain("does not match its outputSchema");
  });

  it("skips protocol rejections that carry no structured output", () => {
    const out = outputSchemaValid({ case: spec, result: resultOf([step([call("query", { limit: 0 }, undefined, true)])]) });
    expect(out.score).toBeNull();
  });
});

describe("no_unexpected_side_effect", () => {
  const spec = toolCase([]);
  const dryRun = call("mutate", { action: "create", slug: "a", dryRun: true }, { ok: true, dryRun: true });

  it("scores 1 when a dry run leaves the store untouched", () => {
    const out = noUnexpectedSideEffect({ case: spec, result: resultOf([step([dryRun], [page("x", "1")], [page("x", "1")])]) });
    expect(out.score).toBe(1);
  });

  it("treats mutate without dryRun as a dry run (the safe default)", () => {
    const implicit = call("mutate", { action: "create", slug: "a" }, { ok: true, dryRun: true });
    const out = noUnexpectedSideEffect({ case: spec, result: resultOf([step([implicit], [], [page("a", "1")])]) });
    expect(out.score).toBe(0);
  });

  it("fails when a dry run wrote a page", () => {
    const out = noUnexpectedSideEffect({ case: spec, result: resultOf([step([dryRun], [], [page("a", "1")])]) });
    expect(out.score).toBe(0);
    expect(out.problems.join("\n")).toContain("+a");
  });

  it("fails when a query changed a revision", () => {
    const query = call("query", {}, { ok: true });
    const out = noUnexpectedSideEffect({ case: spec, result: resultOf([step([query], [page("a", "1")], [page("a", "2")])]) });
    expect(out.score).toBe(0);
    expect(out.problems.join("\n")).toContain("~a");
  });

  it("fails when a dry run reports it wrote", () => {
    const lying = call("mutate", { action: "create", slug: "a", dryRun: true }, { ok: true, dryRun: false });
    expect(noUnexpectedSideEffect({ case: spec, result: resultOf([step([lying])]) }).score).toBe(0);
  });

  it("does not judge steps that are allowed to write", () => {
    const write = call("mutate", { action: "create", slug: "a", dryRun: false }, { ok: true, dryRun: false });
    expect(noUnexpectedSideEffect({ case: spec, result: resultOf([step([write], [], [page("a", "1")])]) }).score).toBeNull();
  });
});

describe("concurrency_safety", () => {
  const spec = toolCase([]);
  const update = (revision: string, result: unknown, isError = false) =>
    call("mutate", { action: "update", slug: "intro", dryRun: false, expectedRevision: "r0" }, result, isError);
  const won = (revision: string) => ({ ok: true, page: { revision } });

  it("scores 1 when one writer wins and the other gets a conflict", () => {
    const group = step([update("r1", won("r1")), update("r2", { ok: false, error: { code: "conflict" } }, true)], [page("intro", "r0")], [page("intro", "r1")], true);
    expect(concurrencySafety({ case: spec, result: resultOf([group]) }).score).toBe(1);
  });

  it("fails when two writers both succeed from the same revision (lost update)", () => {
    const group = step([update("r1", won("r1")), update("r2", won("r2"))], [page("intro", "r0")], [page("intro", "r2")], true);
    const out = concurrencySafety({ case: spec, result: resultOf([group]) });
    expect(out.score).toBe(0);
    expect(out.problems.join("\n")).toContain("lost update");
  });

  it("fails when the store ends at a revision no accepted call produced", () => {
    const group = step([update("r1", won("r1")), update("r2", { ok: false }, true)], [page("intro", "r0")], [page("intro", "zzz")], true);
    expect(concurrencySafety({ case: spec, result: resultOf([group]) }).problems.join("\n")).toContain("no accepted call produced");
  });

  it("fails when one idempotency key is applied twice (double apply)", () => {
    const create = () => call("mutate", { action: "create", slug: "n", dryRun: false, idempotencyKey: "k" }, won("r1"));
    const out = concurrencySafety({ case: spec, result: resultOf([step([create(), create()], [], [page("n", "r1")], true)]) });
    expect(out.score).toBe(0);
    expect(out.problems.join("\n")).toContain("double apply");
  });

  it("accepts a replayed second call", () => {
    const first = call("mutate", { action: "create", slug: "n", dryRun: false, idempotencyKey: "k" }, won("r1"));
    const replay = call("mutate", { action: "create", slug: "n", dryRun: false, idempotencyKey: "k" }, { ...won("r1"), replayed: true });
    expect(concurrencySafety({ case: spec, result: resultOf([step([first, replay], [], [page("n", "r1")], true)]) }).score).toBe(1);
  });

  it("is not applicable without parallel steps", () => {
    expect(concurrencySafety({ case: spec, result: resultOf([step([])]) }).score).toBeNull();
  });
});

describe("scoring the real golden dataset", () => {
  it("scores every tool case 1 on every applicable scorer", async () => {
    for (const goldenCase of goldenCases.filter((candidate) => candidate.kind === "tool")) {
      const scored = scoreCase(goldenCase, await runCase(goldenCase));
      expect(scored.problems, goldenCase.id).toEqual([]);
      expect(scored.regressed, goldenCase.id).toBe(false);
    }
  }, 60_000);

  it("catches the deliberate regression (writer lock disabled) red, then passes green once restored", async () => {
    const { red, green } = await demonstrateRegression();
    expect(red.passed).toBe(false);
    const concurrency = red.summary.find((row) => row.name === "concurrency_safety");
    expect(concurrency?.failing).toBeGreaterThan(0);
    expect(red.cases.filter((entry) => entry.regressed).map((entry) => entry.category)).toEqual(["concurrency", "concurrency"]);
    expect(green.passed).toBe(true);
  }, 60_000);
});
