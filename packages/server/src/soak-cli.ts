import { formatSoakResult, runSoak } from "./soak.js";

const sizes = (process.env.SOAK_CLIENTS ?? "10,30,100")
  .split(",")
  .map((value) => Number(value.trim()));
const callsPerClient = Number(process.env.SOAK_CALLS ?? "50");

if (
  sizes.some((n) => !Number.isInteger(n) || n < 1) ||
  !Number.isInteger(callsPerClient) ||
  callsPerClient < 1
) {
  console.error(
    "SOAK_CLIENTS must be a comma-separated list of positive integers and SOAK_CALLS a positive integer.",
  );
  process.exit(2);
}

let failed = 0;
for (const clients of sizes) {
  const result = await runSoak({ clients, callsPerClient });
  console.log(formatSoakResult(result));
  if (result.firstError) {
    console.log(`first error: ${result.firstError}`);
  }
  console.log("");
  failed += result.failedCalls;
}

process.exit(failed === 0 ? 0 : 1);
