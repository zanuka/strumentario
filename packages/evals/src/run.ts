import { DEFAULT_BRAINTRUST_PROJECT, runBraintrustExperiment } from "./braintrust.js";
import { goldenCases } from "./golden.js";
import { checkEvalGate } from "./index.js";

/** `pnpm eval`: a Braintrust experiment over the golden dataset. Exit 0 only when every case and scorer passes. */
const gate = checkEvalGate();

if (!gate.ok) {
  process.stderr.write(`${gate.message}\n`);
  process.exitCode = 1;
} else {
  process.stdout.write(`${gate.message}\n`);
  const project = process.env.BRAINTRUST_PROJECT?.trim() || DEFAULT_BRAINTRUST_PROJECT;
  try {
    const outcome = await runBraintrustExperiment({ cases: goldenCases, project });
    if (outcome.experimentUrl) process.stdout.write(`Experiment: ${outcome.experimentUrl}\n`);
    if (outcome.ok) {
      process.stdout.write(`${outcome.total}/${outcome.total} golden cases passed every scorer (project ${outcome.project}).\n`);
    } else {
      for (const line of outcome.report) process.stderr.write(`REGRESSION ${line}\n`);
      process.stderr.write(
        `${outcome.regressions} of ${outcome.total} golden case(s) regressed. Run \`pnpm eval:local\` for the problem detail, then fix the behaviour or update the golden case on purpose.\n`,
      );
      process.exitCode = 1;
    }
  } catch (error) {
    process.stderr.write(
      `Braintrust experiment failed to run: ${error instanceof Error ? error.message : String(error)}. Check BRAINTRUST_API_KEY and network access, or use \`pnpm eval:local\`.\n`,
    );
    process.exitCode = 1;
  }
}
