import { runCase } from "./harness.js";
import { SCORER_NAMES, scoreCase, type ScoredCase } from "./scorers.js";
import type { GoldenCase } from "./types.js";

export interface ScorerSummary {
  name: string;
  /** Mean over the cases the scorer applied to; null when it applied to none. */
  mean: number | null;
  applied: number;
  /** Applied cases that scored below 1. */
  failing: number;
}

export interface ScoredSuite {
  cases: ScoredCase[];
  summary: ScorerSummary[];
  total: number;
  regressions: number;
  passed: boolean;
}

/** Runs every case, then scores it. Offline: no network, no API keys. */
export async function runScoredSuite(cases: readonly GoldenCase[]): Promise<ScoredSuite> {
  const scored: ScoredCase[] = [];
  for (const goldenCase of cases) {
    scored.push(scoreCase(goldenCase, await runCase(goldenCase)));
  }
  return summarize(scored);
}

export function summarize(scored: ScoredCase[]): ScoredSuite {
  const summary = SCORER_NAMES.map((name): ScorerSummary => {
    const values = scored.flatMap((entry) => entry.scores.filter((score) => score.name === name && score.score !== null).map((score) => score.score as number));
    return {
      name,
      mean: values.length === 0 ? null : values.reduce((sum, value) => sum + value, 0) / values.length,
      applied: values.length,
      failing: values.filter((value) => value < 1).length,
    };
  });
  const regressions = scored.filter((entry) => entry.regressed).length;
  return { cases: scored, summary, total: scored.length, regressions, passed: regressions === 0 };
}

/** The plain-text results block printed by `pnpm eval:local` and recorded in docs/evals. */
export function formatSuite(suite: ScoredSuite): string {
  const lines: string[] = [];
  for (const entry of suite.cases) {
    lines.push(`${entry.regressed ? "FAIL" : "PASS"} ${entry.category.padEnd(11)} ${entry.id}`);
    for (const problem of entry.problems) lines.push(`       - ${problem}`);
  }
  lines.push("", "scorer                      mean   applied  failing");
  for (const row of suite.summary) {
    lines.push(
      `${row.name.padEnd(27)} ${(row.mean === null ? "n/a" : row.mean.toFixed(2)).padStart(4)}   ${String(row.applied).padStart(7)}  ${String(row.failing).padStart(7)}`,
    );
  }
  lines.push("", `${suite.total - suite.regressions}/${suite.total} golden cases passed with every scorer at 1.00`);
  return lines.join("\n") + "\n";
}
