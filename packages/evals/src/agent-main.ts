import { formatAgentSuite, selectModel } from "./agent.js";
import { runAgentEval, writeSummary } from "./agent-run.js";
import { DEFAULT_BRAINTRUST_PROJECT } from "./braintrust.js";

/**
 * `pnpm eval:agent`: gives a model the published tools and scores which it picks.
 * No provider key: prints how to set one and exits 0 (a skip, not a failure).
 * With BRAINTRUST_API_KEY the run is also recorded as an experiment.
 * `--summary <file>` writes the docs/evals markdown from this run's real results.
 */
const selection = selectModel();
if (!selection.ok) {
  process.stdout.write(`${selection.message}\n`);
} else {
  const args = process.argv.slice(2);
  const summaryIndex = args.indexOf("--summary");
  const summaryFile = summaryIndex >= 0 ? args[summaryIndex + 1] : undefined;
  if (summaryIndex >= 0 && !summaryFile) {
    process.stderr.write("--summary needs a file path, for example `--summary docs/evals/2026-11-10-agent-tool-selection.md`.\n");
    process.exit(1);
  }
  const useBraintrust = Boolean(process.env.BRAINTRUST_API_KEY?.trim());
  try {
    const outcome = await runAgentEval({
      model: selection.model,
      ...(useBraintrust ? { braintrust: { project: process.env.BRAINTRUST_PROJECT?.trim() || DEFAULT_BRAINTRUST_PROJECT } } : {}),
    });
    process.stdout.write(formatAgentSuite(outcome.suite));
    if (outcome.experimentUrl) process.stdout.write(`Experiment: ${outcome.experimentUrl}\n`);
    else if (!useBraintrust) process.stdout.write("No BRAINTRUST_API_KEY: results printed only, no experiment recorded.\n");
    if (summaryFile) {
      await writeSummary(summaryFile, outcome, new Date().toISOString().slice(0, 10));
      process.stdout.write(`Wrote ${summaryFile}\n`);
    }
    // Model choice is probabilistic: misses are reported weak spots, not a failed build.
  } catch (error) {
    process.stderr.write(`Agent tool-selection eval failed: ${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  }
}
