import { describe, expect, it, vi } from "vitest";
import { runBraintrustExperiment, type EvalFunction } from "./braintrust.js";
import { goldenCases } from "./golden.js";
import type { CaseResult, GoldenCase } from "./types.js";

/** A stand-in for braintrust's Eval(): runs the task and every scorer locally, never touching the network. */
function fakeEval(overrides: { failCase?: string } = {}): { fn: EvalFunction; calls: Parameters<EvalFunction>[] } {
  const calls: Parameters<EvalFunction>[] = [];
  const fn: EvalFunction = async (project, evaluator) => {
    calls.push([project, evaluator]);
    const results = [];
    for (const row of evaluator.data) {
      let output: CaseResult = await evaluator.task(row.input);
      if (row.input.id === overrides.failCase) output = { ...output, passed: false };
      const scores: Record<string, number | null> = {};
      for (const score of evaluator.scores) {
        const scored = score({ input: row.input, output });
        scores[scored.name] = scored.score;
      }
      results.push({ input: row.input as GoldenCase, scores });
    }
    return { results, summary: { experimentName: "fake-run" } };
  };
  return { fn, calls };
}

describe("runBraintrustExperiment (SDK mocked, no network)", () => {
  const subset = goldenCases.filter((candidate) => ["validate-happy-path", "concurrent-updates-same-revision"].includes(candidate.id));

  it("sends the golden cases, every scorer and the project name to Eval()", async () => {
    const { fn, calls } = fakeEval();
    const outcome = await runBraintrustExperiment({ cases: subset, project: "my-project", evalFn: fn });
    expect(outcome.ok).toBe(true);
    expect(outcome.project).toBe("my-project");
    expect(outcome.total).toBe(2);
    const [project, evaluator] = calls[0] as Parameters<EvalFunction>;
    expect(project).toBe("my-project");
    expect(evaluator.data.map((row) => row.input.id)).toEqual(subset.map((candidate) => candidate.id));
    expect(evaluator.maxConcurrency).toBe(1);
    const names = evaluator.scores.map((score) => score({ input: subset[0] as GoldenCase, output: { id: "x", category: "validate", passed: true, failures: [], durationMs: 0 } }).name);
    expect(names).toEqual(["expectations_met", "tool_choice", "output_schema_valid", "no_unexpected_side_effect", "concurrency_safety"]);
  }, 30_000);

  it("reports not-ok with the failing case when a score is below 1", async () => {
    const { fn } = fakeEval({ failCase: "validate-happy-path" });
    const outcome = await runBraintrustExperiment({ cases: subset, evalFn: fn });
    expect(outcome.ok).toBe(false);
    expect(outcome.regressions).toBe(1);
    expect(outcome.report[0]).toContain("validate-happy-path: expectations_met=0.00");
  }, 30_000);

  it("reports not-ok when a case errored inside the experiment", async () => {
    const evalFn: EvalFunction = async () => ({ results: [{ input: subset[0], error: new Error("boom"), scores: {} }] });
    const outcome = await runBraintrustExperiment({ cases: subset.slice(0, 1), evalFn });
    expect(outcome.ok).toBe(false);
    expect(outcome.report[0]).toContain("case errored: boom");
  });

  it("is not ok when the experiment returns fewer results than cases", async () => {
    const evalFn: EvalFunction = async () => ({ results: [] });
    expect((await runBraintrustExperiment({ cases: subset, evalFn })).ok).toBe(false);
  });

  it("defaults the project to strumentario and surfaces the experiment URL", async () => {
    const evalFn = vi.fn<EvalFunction>(async () => ({ results: [], summary: { experimentUrl: "https://example.invalid/exp" } }));
    const outcome = await runBraintrustExperiment({ cases: [], evalFn });
    expect(evalFn.mock.calls[0]?.[0]).toBe("strumentario");
    expect(outcome.experimentUrl).toBe("https://example.invalid/exp");
  });
});
