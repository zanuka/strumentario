import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { createMcpServer, FileSystemPageStore } from "@strumentario/server";
import { Ajv } from "ajv";
import type { AgentCase, AgentCategory } from "./agent-cases.js";
import { runCase } from "./harness.js";
import { matchSubset } from "./match.js";
import { outputSchemaValid, toolChoice, type ScorerOutput } from "./scorers.js";
import type { CaseResult, ToolGoldenCase } from "./types.js";

/**
 * Agent tool-selection eval (issue #16, docs/braintrust-eval-details.md "agent tool-selection path").
 * A model sees the published tool definitions and one prompt; we score the call it makes. It reuses
 * the #9 scorers (`toolChoice`, `outputSchemaValid`) and the offline harness rather than a parallel path.
 */

// --- tool definitions come from a live tools/list -----------------------------------

export interface PublishedTool {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
}

/** Reads the tool list the way an MCP host does: an MCP client calling tools/list on createMcpServer(). Never hand-copied. */
export async function listPublishedTools(): Promise<PublishedTool[]> {
  const dir = await mkdtemp(path.join(tmpdir(), "strumentario-agent-eval-"));
  const server = createMcpServer({ store: new FileSystemPageStore(dir) });
  const client = new Client({ name: "strumentario-agent-eval", version: "0.0.0" });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  try {
    await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
    const { tools } = await client.listTools();
    return tools.map((tool) => ({
      name: tool.name,
      description: tool.description ?? "",
      inputSchema: tool.inputSchema as Record<string, unknown>,
    }));
  } finally {
    await client.close().catch(() => undefined);
    await server.close().catch(() => undefined);
    await rm(dir, { recursive: true, force: true });
  }
}

// --- model clients -------------------------------------------------------------------

/** What the model did with one prompt: the first tool call it made, or none. */
export interface ModelChoice {
  tool?: string;
  input?: unknown;
  /** Any plain text the model returned (useful when it called no tool). */
  text?: string;
}

export interface ToolChoiceModel {
  /** Provider and model, recorded in the results. */
  label: string;
  choose(prompt: string, tools: readonly PublishedTool[]): Promise<ModelChoice>;
}

export const DEFAULT_ANTHROPIC_MODEL = "claude-sonnet-5-5";
export const DEFAULT_OPENAI_MODEL = "gpt-4.1";

const SYSTEM_PROMPT =
  "You are an agent connected to a content server through the tools provided. Do what the user asks by calling the single most appropriate tool with correct arguments. Do not ask questions; use the values given in the request.";

type FetchLike = (url: string, init: { method: string; headers: Record<string, string>; body: string }) => Promise<{
  ok: boolean;
  status: number;
  text(): Promise<string>;
}>;

export type ModelSelection =
  | { ok: true; model: ToolChoiceModel }
  | { ok: false; message: string };

/**
 * Picks a provider from the environment: ANTHROPIC_API_KEY first, then OPENAI_API_KEY. The model
 * defaults to a current Claude model and is overridable with EVAL_ANTHROPIC_MODEL / EVAL_OPENAI_MODEL.
 * With no key it returns an actionable skip message instead of throwing.
 */
export function selectModel(env: NodeJS.ProcessEnv = process.env, fetchFn: FetchLike = defaultFetch): ModelSelection {
  const anthropicKey = env.ANTHROPIC_API_KEY?.trim();
  if (anthropicKey) {
    return { ok: true, model: anthropicModel(anthropicKey, env.EVAL_ANTHROPIC_MODEL?.trim() || DEFAULT_ANTHROPIC_MODEL, fetchFn) };
  }
  const openaiKey = env.OPENAI_API_KEY?.trim();
  if (openaiKey) {
    return { ok: true, model: openaiModel(openaiKey, env.EVAL_OPENAI_MODEL?.trim() || DEFAULT_OPENAI_MODEL, fetchFn) };
  }
  return {
    ok: false,
    message:
      "Skipping the agent tool-selection eval: no model key. Set ANTHROPIC_API_KEY (or OPENAI_API_KEY) in .env (see env.example) and run `pnpm eval:agent`. The golden suite is unaffected: `pnpm eval:local` needs no key.",
  };
}

const defaultFetch: FetchLike = async (url, init) => {
  const response = await fetch(url, init);
  return { ok: response.ok, status: response.status, text: () => response.text() };
};

async function postJson(fetchFn: FetchLike, url: string, headers: Record<string, string>, body: unknown, provider: string): Promise<unknown> {
  const response = await fetchFn(url, { method: "POST", headers: { "content-type": "application/json", ...headers }, body: JSON.stringify(body) });
  const text = await response.text();
  if (!response.ok) {
    throw new Error(`${provider} API returned ${response.status}: ${text.slice(0, 300)}. Check the API key and the model name (EVAL_ANTHROPIC_MODEL / EVAL_OPENAI_MODEL).`);
  }
  return JSON.parse(text) as unknown;
}

export function anthropicModel(apiKey: string, model: string, fetchFn: FetchLike = defaultFetch): ToolChoiceModel {
  return {
    label: `anthropic:${model}`,
    async choose(prompt, tools) {
      const json = (await postJson(
        fetchFn,
        "https://api.anthropic.com/v1/messages",
        { "x-api-key": apiKey, "anthropic-version": "2023-06-01" },
        {
          model,
          max_tokens: 1024,
          temperature: 0,
          system: SYSTEM_PROMPT,
          tools: tools.map((tool) => ({ name: tool.name, description: tool.description, input_schema: tool.inputSchema })),
          messages: [{ role: "user", content: prompt }],
        },
        "Anthropic",
      )) as { content?: Array<{ type: string; name?: string; input?: unknown; text?: string }> };
      const content = json.content ?? [];
      const use = content.find((part) => part.type === "tool_use");
      const text = content.filter((part) => part.type === "text").map((part) => part.text ?? "").join("");
      return { ...(use ? { tool: use.name as string, input: use.input } : {}), text };
    },
  };
}

export function openaiModel(apiKey: string, model: string, fetchFn: FetchLike = defaultFetch): ToolChoiceModel {
  return {
    label: `openai:${model}`,
    async choose(prompt, tools) {
      const json = (await postJson(
        fetchFn,
        "https://api.openai.com/v1/chat/completions",
        { authorization: `Bearer ${apiKey}` },
        {
          model,
          temperature: 0,
          tools: tools.map((tool) => ({ type: "function", function: { name: tool.name, description: tool.description, parameters: tool.inputSchema } })),
          messages: [
            { role: "system", content: SYSTEM_PROMPT },
            { role: "user", content: prompt },
          ],
        },
        "OpenAI",
      )) as { choices?: Array<{ message?: { content?: string | null; tool_calls?: Array<{ function?: { name?: string; arguments?: string } }> } }> };
      const message = json.choices?.[0]?.message;
      const call = message?.tool_calls?.[0]?.function;
      if (!call?.name) return { text: message?.content ?? "" };
      let input: unknown;
      try {
        input = JSON.parse(call.arguments ?? "{}");
      } catch {
        input = call.arguments; // not JSON: the argument scorer will report it
      }
      return { tool: call.name, input, text: message?.content ?? "" };
    },
  };
}

// --- scoring -------------------------------------------------------------------------

export const AGENT_SCORER_NAMES = ["tool_selected", "tool_choice", "argument_shape", "argument_schema_valid", "output_schema_valid"] as const;
export type AgentScorerName = (typeof AGENT_SCORER_NAMES)[number];

export interface AgentCaseResult {
  id: string;
  category: AgentCategory;
  prompt: string;
  chosen: ModelChoice;
  /** Score per scorer; null when the scorer did not apply (for example nothing was called). */
  scores: Record<AgentScorerName, number | null>;
  /** One actionable line per problem; empty when everything is 1. */
  problems: string[];
  passed: boolean;
  /** Set when the model call itself failed (network, auth). Counts as a failed case. */
  error?: string;
}

const ajv = new Ajv({ allErrors: true, strict: false, validateFormats: false });

/**
 * Scores one model choice.
 *  - tool_selected: the right tool by name (this is what accuracy per tool is computed from)
 *  - tool_choice: the #9 scorer. Expected call versus the call the harness recorded, also failing for an unpublished tool.
 *    Argument *shape* is judged by argument_shape (subset match), so when the shape matches the spec passed to tool_choice
 *    carries the model's own arguments; otherwise it carries the expected ones and tool_choice reports the difference.
 *  - argument_shape: the model's arguments contain the expected keys and values
 *  - argument_schema_valid: the arguments validate against the published inputSchema
 *  - output_schema_valid: the #9 scorer, on the result of executing the call against a seeded temp store
 */
export async function scoreAgentCase(
  agentCase: AgentCase,
  choice: ModelChoice,
  tools: readonly PublishedTool[],
): Promise<Omit<AgentCaseResult, "error">> {
  const problems: string[] = [];
  const scores: Record<AgentScorerName, number | null> = {
    tool_selected: null,
    tool_choice: null,
    argument_shape: null,
    argument_schema_valid: null,
    output_schema_valid: null,
  };

  if (!choice.tool) {
    scores.tool_selected = 0;
    scores.tool_choice = 0;
    problems.push(`no tool call made; expected "${agentCase.expected.tool}"${choice.text ? ` (model said: ${JSON.stringify(choice.text.slice(0, 160))})` : ""}`);
    return { id: agentCase.id, category: agentCase.category, prompt: agentCase.prompt, chosen: choice, scores, problems, passed: false };
  }

  scores.tool_selected = choice.tool === agentCase.expected.tool ? 1 : 0;
  if (scores.tool_selected === 0) problems.push(`chose "${choice.tool}", expected "${agentCase.expected.tool}"`);

  const input = isRecord(choice.input) ? choice.input : {};
  const shapeProblems = scores.tool_selected === 1 ? matchSubset(input, agentCase.expected.input, "arguments") : [];
  scores.argument_shape = scores.tool_selected === 0 ? 0 : shapeProblems.length === 0 ? 1 : 0;
  problems.push(...shapeProblems);

  const published = tools.find((tool) => tool.name === choice.tool);
  if (!published) {
    scores.argument_schema_valid = 0;
    problems.push(`"${choice.tool}" is not in the published tools/list`);
  } else {
    const validate = ajv.compile(published.inputSchema);
    if (validate(input)) {
      scores.argument_schema_valid = 1;
    } else {
      scores.argument_schema_valid = 0;
      problems.push(`arguments do not match "${choice.tool}" inputSchema: ${(validate.errors ?? []).map((e) => `${e.instancePath || "/"} ${e.message}`).join("; ")}`);
    }
  }

  // Execute the chosen call through the same harness the golden suite uses, then reuse the #9 scorers on its trace.
  const sent = { tool: choice.tool as AgentCategory, input };
  const spec = scores.argument_shape === 1 ? sent : agentCase.expected;
  const specCase: ToolGoldenCase = {
    id: agentCase.id,
    kind: "tool",
    category: agentCase.category,
    intent: agentCase.intent,
    ...(agentCase.seed ? { seed: agentCase.seed } : {}),
    steps: [{ call: spec, expect: { isError: false } }],
  };
  const executed: ToolGoldenCase = { ...specCase, steps: [{ call: sent, expect: { isError: false } }] };
  const result: CaseResult = await runCase(executed);
  const chosen = toolChoice({ case: specCase, result });
  scores.tool_choice = chosen.score;
  problems.push(...dedupe(chosen.problems, problems));
  const output: ScorerOutput = outputSchemaValid({ case: specCase, result });
  scores.output_schema_valid = output.score;
  problems.push(...output.problems);

  const passed = Object.values(scores).every((score) => score === null || score >= 1);
  return { id: agentCase.id, category: agentCase.category, prompt: agentCase.prompt, chosen: choice, scores, problems, passed };
}

export async function runAgentSuite(
  cases: readonly AgentCase[],
  model: ToolChoiceModel,
  tools: readonly PublishedTool[],
): Promise<AgentSuite> {
  const results: AgentCaseResult[] = [];
  for (const agentCase of cases) {
    try {
      const choice = await model.choose(agentCase.prompt, tools);
      results.push(await scoreAgentCase(agentCase, choice, tools));
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      results.push({
        id: agentCase.id,
        category: agentCase.category,
        prompt: agentCase.prompt,
        chosen: {},
        scores: { tool_selected: 0, tool_choice: 0, argument_shape: 0, argument_schema_valid: 0, output_schema_valid: null },
        problems: [`model call failed: ${message}`],
        passed: false,
        error: message,
      });
    }
  }
  return summarizeAgent(results, model.label, tools);
}

export interface ToolAccuracy {
  tool: AgentCategory;
  cases: number;
  /** Fraction of this tool's cases where the model chose it. */
  accuracy: number;
}

export interface AgentSuite {
  model: string;
  /** Names of the tools the model was shown (from tools/list). */
  tools: string[];
  results: AgentCaseResult[];
  perTool: ToolAccuracy[];
  /** Mean per scorer over the cases it applied to. */
  means: Record<AgentScorerName, number | null>;
  passed: number;
  total: number;
}

export function summarizeAgent(results: AgentCaseResult[], model: string, tools: readonly PublishedTool[]): AgentSuite {
  const categories = [...new Set(results.map((result) => result.category))];
  const perTool = categories.map((tool): ToolAccuracy => {
    const rows = results.filter((result) => result.category === tool);
    return { tool, cases: rows.length, accuracy: rows.filter((row) => row.scores.tool_selected === 1).length / rows.length };
  });
  const means = Object.fromEntries(
    AGENT_SCORER_NAMES.map((name) => {
      const values = results.map((result) => result.scores[name]).filter((value): value is number => value !== null);
      return [name, values.length === 0 ? null : values.reduce((sum, value) => sum + value, 0) / values.length];
    }),
  ) as Record<AgentScorerName, number | null>;
  return { model, tools: tools.map((tool) => tool.name), results, perTool, means, passed: results.filter((r) => r.passed).length, total: results.length };
}

/** Plain-text report: one line per case, then accuracy per tool and the mean of each scorer. */
export function formatAgentSuite(suite: AgentSuite): string {
  const lines = [`model: ${suite.model}`, `tools (from tools/list): ${suite.tools.join(", ")}`, ""];
  for (const result of suite.results) {
    lines.push(`${result.passed ? "PASS" : "FAIL"} ${result.category.padEnd(8)} ${result.id}`);
    for (const problem of result.problems) lines.push(`       - ${problem}`);
  }
  lines.push("", "tool        cases  tool-choice accuracy");
  for (const row of suite.perTool) lines.push(`${row.tool.padEnd(10)} ${String(row.cases).padStart(6)}  ${row.accuracy.toFixed(2)}`);
  lines.push("", "scorer                      mean");
  for (const name of AGENT_SCORER_NAMES) {
    const mean = suite.means[name];
    lines.push(`${name.padEnd(27)} ${mean === null ? "n/a" : mean.toFixed(2)}`);
  }
  lines.push("", `${suite.passed}/${suite.total} prompts passed every scorer`);
  return lines.join("\n") + "\n";
}

/** Markdown for docs/evals/: only numbers from the suite that actually ran. */
export function formatAgentSummaryMarkdown(suite: AgentSuite, meta: { date: string; experimentUrl?: string | undefined }): string {
  const out = [
    `# Agent tool-selection eval — ${meta.date}`,
    "",
    `Model: \`${suite.model}\`. Tools shown to the model came from a live \`tools/list\`: ${suite.tools.map((t) => `\`${t}\``).join(", ")}. ${suite.total} prompts (\`packages/evals/src/agent-cases.ts\`), single turn, temperature 0.`,
    "",
    meta.experimentUrl ? `Braintrust experiment: ${meta.experimentUrl}` : "No Braintrust experiment was recorded for this run (no `BRAINTRUST_API_KEY`).",
    "",
    "## Tool-choice accuracy per tool",
    "",
    "| Tool | Prompts | Accuracy |",
    "|------|--------:|---------:|",
    ...suite.perTool.map((row) => `| \`${row.tool}\` | ${row.cases} | ${row.accuracy.toFixed(2)} |`),
    "",
    "## Scorers",
    "",
    "| Scorer | Mean |",
    "|--------|-----:|",
    ...AGENT_SCORER_NAMES.map((name) => `| \`${name}\` | ${suite.means[name] === null ? "n/a" : (suite.means[name] as number).toFixed(2)} |`),
    "",
    `${suite.passed} of ${suite.total} prompts passed every scorer.`,
    "",
    "## Misses",
    "",
  ];
  const misses = suite.results.filter((result) => !result.passed);
  if (misses.length === 0) out.push("None.");
  for (const miss of misses) {
    out.push(`- \`${miss.id}\` (${miss.category}): ${miss.problems.join("; ")}`);
  }
  out.push("");
  return out.join("\n");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function dedupe(candidates: string[], existing: string[]): string[] {
  return candidates.filter((line) => !existing.includes(line));
}
