import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { agentCases, type AgentCase } from "./agent-cases.js";
import {
  AGENT_SCORER_NAMES,
  formatAgentSummaryMarkdown,
  listPublishedTools,
  runAgentSuite,
  scoreAgentCase,
  summarizeAgent,
  type AgentCaseResult,
  type AgentSuite,
  type ToolChoiceModel,
} from "./agent.js";
import { DEFAULT_BRAINTRUST_PROJECT, loadBraintrustEval } from "./braintrust.js";

/** The slice of braintrust's `Eval()` this path calls, so tests can inject a fake. */
export type AgentEvalFunction = (
  project: string,
  evaluator: {
    data: Array<{ input: AgentCase; metadata: { category: string } }>;
    task: (input: AgentCase) => Promise<AgentCaseResult>;
    scores: Array<(args: { input: AgentCase; output: AgentCaseResult }) => { name: string; score: number | null }>;
    experimentName?: string | undefined;
    maxConcurrency?: number;
    metadata?: Record<string, unknown>;
  },
) => Promise<{
  results: Array<{ input: unknown; output?: unknown; error?: unknown }>;
  summary?: { experimentUrl?: string; experimentName?: string };
}>;

export interface AgentRunOptions {
  model: ToolChoiceModel;
  cases?: readonly AgentCase[];
  /** Set (BRAINTRUST_API_KEY present) to record the run as a Braintrust experiment. */
  braintrust?: { project?: string; evalFn?: AgentEvalFunction };
}

export interface AgentRunOutcome {
  suite: AgentSuite;
  experimentUrl?: string | undefined;
}

/**
 * Runs the agent tool-selection suite. Without `braintrust` it calls the model directly; with it the
 * same task and scorers run inside a Braintrust experiment (same gate as `pnpm eval`).
 */
export async function runAgentEval(options: AgentRunOptions): Promise<AgentRunOutcome> {
  const cases = options.cases ?? agentCases;
  const tools = await listPublishedTools();
  if (!options.braintrust) return { suite: await runAgentSuite(cases, options.model, tools) };

  const evalFn = options.braintrust.evalFn ?? ((await loadBraintrustEval()) as unknown as AgentEvalFunction);
  const results: AgentCaseResult[] = [];
  const outcome = await evalFn(options.braintrust.project ?? DEFAULT_BRAINTRUST_PROJECT, {
    data: cases.map((agentCase) => ({ input: agentCase, metadata: { category: agentCase.category } })),
    task: async (agentCase) => {
      const choice = await options.model.choose(agentCase.prompt, tools);
      const scored = await scoreAgentCase(agentCase, choice, tools);
      results.push(scored);
      return scored;
    },
    scores: AGENT_SCORER_NAMES.map((name) => ({ output }: { output: AgentCaseResult }) => ({ name, score: output.scores[name] })),
    maxConcurrency: 1,
    metadata: { model: options.model.label, tools: tools.map((tool) => tool.name), source: "packages/evals/src/agent-cases.ts" },
  });
  const failed = outcome.results.filter((row) => row.error !== undefined && row.error !== null).length;
  if (failed > 0) throw new Error(`${failed} prompt(s) errored inside the Braintrust experiment; check the model key and network access.`);
  return { suite: summarizeAgent(results, options.model.label, tools), experimentUrl: outcome.summary?.experimentUrl };
}

export async function writeSummary(file: string, outcome: AgentRunOutcome, date: string): Promise<void> {
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, formatAgentSummaryMarkdown(outcome.suite, { date, experimentUrl: outcome.experimentUrl }), "utf8");
}
