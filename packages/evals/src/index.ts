import { CONTENT_PRIMITIVES } from "@strumentario/server";

export type EvalGateReason = "missing_braintrust_api_key" | "ready";

export interface EvalGateResult {
  ok: boolean;
  reason: EvalGateReason;
  message: string;
  primitives: typeof CONTENT_PRIMITIVES;
}

export function checkEvalGate(
  env: NodeJS.ProcessEnv = process.env,
): EvalGateResult {
  const primitives = CONTENT_PRIMITIVES;
  const apiKey = env.BRAINTRUST_API_KEY?.trim();

  if (!apiKey) {
    return {
      ok: false,
      reason: "missing_braintrust_api_key",
      message:
        "Set BRAINTRUST_API_KEY to run evals. Copy env.example to .env, then retry `pnpm eval`. To run the golden suite and scorers without Braintrust, use `pnpm eval:local`.",
      primitives,
    };
  }

  return {
    ok: true,
    reason: "ready",
    message: "BRAINTRUST_API_KEY found; running the golden dataset as a Braintrust experiment.",
    primitives,
  };
}

export { runBraintrustExperiment, DEFAULT_BRAINTRUST_PROJECT } from "./braintrust.js";
export type { ExperimentOutcome, ExperimentOptions, EvalFunction } from "./braintrust.js";
export { scorers, scoreCase, SCORER_NAMES } from "./scorers.js";
export type { Scorer, ScorerInput, ScorerOutput, ScoredCase } from "./scorers.js";
