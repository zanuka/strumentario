import { runCase } from "./harness.js";
import { scorers, SCORER_NAMES } from "./scorers.js";
import type { CaseResult, GoldenCase } from "./types.js";

export const DEFAULT_BRAINTRUST_PROJECT = "strumentario";

type ScoreFn = (args: { input: GoldenCase; output: CaseResult }) => { name: string; score: number | null };

/** The slice of braintrust's `Eval()` result this package reads. */
export interface ExperimentResults {
  results: Array<{ input: unknown; error?: unknown; scores: Record<string, number | null> }>;
  summary?: { experimentUrl?: string; experimentName?: string };
}

/** The slice of braintrust's `Eval()` signature this package calls, so tests can inject a fake. */
export type EvalFunction = (
  project: string,
  evaluator: {
    data: Array<{ input: GoldenCase; metadata: { category: string } }>;
    task: (input: GoldenCase) => Promise<CaseResult>;
    scores: ScoreFn[];
    experimentName?: string | undefined;
    maxConcurrency?: number;
    metadata?: Record<string, unknown>;
  },
) => Promise<ExperimentResults>;

export interface ExperimentOptions {
  cases: readonly GoldenCase[];
  project?: string;
  experimentName?: string | undefined;
  /** Defaults to the real SDK, loaded lazily so the server and offline runs never import it. */
  evalFn?: EvalFunction;
}

export interface ExperimentOutcome {
  ok: boolean;
  project: string;
  experimentUrl?: string | undefined;
  experimentName?: string | undefined;
  total: number;
  regressions: number;
  /** One line per regressed case, for the console. */
  report: string[];
}

/**
 * Runs the golden dataset as a Braintrust experiment. Needs BRAINTRUST_API_KEY in the environment
 * (the caller checks the gate). The task runs each case through the offline harness; the scorers in
 * scorers.ts grade the recorded trace. `ok` is false if any case errored or any applicable score is below 1.
 */
export async function runBraintrustExperiment(options: ExperimentOptions): Promise<ExperimentOutcome> {
  const project = options.project ?? DEFAULT_BRAINTRUST_PROJECT;
  const evalFn = options.evalFn ?? (await loadBraintrustEval());

  const scoreFns: ScoreFn[] = [
    // The harness verdict: every expectation written in the golden case held.
    ({ output }) => ({ name: "expectations_met", score: output.passed ? 1 : 0 }),
    ...scorers.map((scorer, index): ScoreFn => ({ input, output }) => ({
      name: SCORER_NAMES[index] ?? scorer.name,
      score: scorer({ case: input, result: output }).score,
    })),
  ];

  const outcome = await evalFn(project, {
    data: options.cases.map((goldenCase) => ({ input: goldenCase, metadata: { category: goldenCase.category } })),
    task: (input) => runCase(input),
    scores: scoreFns,
    experimentName: options.experimentName,
    // Case runs share process.env and a temp store; run them one at a time.
    maxConcurrency: 1,
    metadata: { cases: options.cases.length, source: "packages/evals/src/golden.ts" },
  });

  const report: string[] = [];
  for (const row of outcome.results) {
    const id = (row.input as GoldenCase | undefined)?.id ?? "unknown-case";
    const low = Object.entries(row.scores).filter(([, score]) => score !== null && score < 1);
    if (row.error !== undefined && row.error !== null) {
      report.push(`${id}: case errored: ${row.error instanceof Error ? row.error.message : String(row.error)}`);
    } else if (low.length > 0) {
      report.push(`${id}: ${low.map(([name, score]) => `${name}=${(score as number).toFixed(2)}`).join(", ")}`);
    }
  }

  return {
    ok: report.length === 0 && outcome.results.length === options.cases.length,
    project,
    experimentUrl: outcome.summary?.experimentUrl,
    experimentName: outcome.summary?.experimentName,
    total: outcome.results.length,
    regressions: report.length,
    report,
  };
}

export async function loadBraintrustEval(): Promise<EvalFunction> {
  const { Eval } = await import("braintrust");
  return Eval as unknown as EvalFunction;
}
