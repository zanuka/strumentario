import { goldenCases } from "./golden.js";
import { runLocal } from "./report.js";

/** Offline entry point behind `pnpm eval:local`: no Braintrust key, no network. */
process.exitCode = await runLocal(
  goldenCases,
  (text) => process.stdout.write(text),
  (text) => process.stderr.write(text),
);
