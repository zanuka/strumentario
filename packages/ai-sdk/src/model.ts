import { createAnthropic } from "@ai-sdk/anthropic";
import { createOpenAI } from "@ai-sdk/openai";
import type { LanguageModel } from "ai";

export const DEFAULT_ANTHROPIC_MODEL = "claude-sonnet-5-5";
export const DEFAULT_OPENAI_MODEL = "gpt-4.1";

export type ModelSelection = { ok: true; model: LanguageModel; label: string } | { ok: false; message: string };

/**
 * Provider keys are optional environment variables. ANTHROPIC_API_KEY wins, then OPENAI_API_KEY (the
 * same order as `pnpm eval:agent`); model names are overridable with AI_SDK_ANTHROPIC_MODEL / AI_SDK_OPENAI_MODEL.
 * With no key it returns an actionable message instead of throwing.
 */
export function selectModel(env: NodeJS.ProcessEnv = process.env): ModelSelection {
  const anthropicKey = env.ANTHROPIC_API_KEY?.trim();
  if (anthropicKey) {
    const name = env.AI_SDK_ANTHROPIC_MODEL?.trim() || DEFAULT_ANTHROPIC_MODEL;
    return { ok: true, model: createAnthropic({ apiKey: anthropicKey })(name), label: `anthropic:${name}` };
  }
  const openaiKey = env.OPENAI_API_KEY?.trim();
  if (openaiKey) {
    const name = env.AI_SDK_OPENAI_MODEL?.trim() || DEFAULT_OPENAI_MODEL;
    return { ok: true, model: createOpenAI({ apiKey: openaiKey })(name), label: `openai:${name}` };
  }
  return {
    ok: false,
    message: "No model key: set ANTHROPIC_API_KEY (or OPENAI_API_KEY) in your environment or .env (see env.example) to run the AI SDK example. The server and the other packages do not need one.",
  };
}
