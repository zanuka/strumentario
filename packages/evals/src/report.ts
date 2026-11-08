import { formatSuite, runScoredSuite } from "./suite.js";
import type { GoldenCase } from "./types.js";

/** Runs the suite with scorers, prints the results, and returns the process exit code (non-zero on any regression). */
export async function runLocal(
  cases: readonly GoldenCase[],
  out: (text: string) => void,
  err: (text: string) => void,
): Promise<number> {
  const suite = await runScoredSuite(cases);
  out(formatSuite(suite));

  if (suite.passed) {
    return 0;
  }
  err(
    `${suite.regressions} golden case(s) failed. Fix the regression, or update the case in packages/evals/src/golden.ts if the contract changed on purpose.\n`,
  );
  return 1;
}
