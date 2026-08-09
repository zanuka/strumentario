import { CONTENT_PRIMITIVES } from "@strumentario/server";

export type EvalGateReason =
  | "missing_braintrust_api_key"
  | "ready"
  | "not_implemented";

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
        "Set BRAINTRUST_API_KEY to run evals. Copy env.example to .env, then retry `pnpm eval`.",
      primitives,
    };
  }

  return {
    ok: false,
    reason: "not_implemented",
    message:
      "Eval suite is scaffolded for Phase 2. Golden datasets and Braintrust scorers are not wired yet.",
    primitives,
  };
}
