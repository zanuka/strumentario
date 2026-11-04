import { runGolden } from "./harness.js";
import type { GoldenCase } from "./types.js";

/** Runs the suite, prints one line per case, and returns the process exit code (non-zero on any failed case). */
export async function runLocal(
  cases: readonly GoldenCase[],
  out: (text: string) => void,
  err: (text: string) => void,
): Promise<number> {
  const suite = await runGolden(cases);

  for (const result of suite.results) {
    out(`${result.passed ? "PASS" : "FAIL"} ${result.category.padEnd(11)} ${result.id} (${result.durationMs}ms)\n`);
    for (const failure of result.failures) {
      out(`       - ${failure}\n`);
    }
  }
  out(`\n${suite.total - suite.failed}/${suite.total} golden cases passed\n`);

  if (suite.passed) {
    return 0;
  }
  err(
    `${suite.failed} golden case(s) failed. Fix the regression, or update the case in packages/evals/src/golden.ts if the contract changed on purpose.\n`,
  );
  return 1;
}
