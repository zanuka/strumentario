import { access, rm } from "node:fs/promises";
import path from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { toolContracts } from "@strumentario/server";
import { describe, expect, it, vi } from "vitest";
import { agentCases } from "./agent-cases.js";
import { runAgentEval, type AgentEvalFunction } from "./agent-run.js";
import {
  anthropicModel,
  DEFAULT_ANTHROPIC_MODEL,
  formatAgentSummaryMarkdown,
  listPublishedTools,
  openaiModel,
  runAgentSuite,
  scoreAgentCase,
  selectModel,
  type ModelChoice,
  type ToolChoiceModel,
} from "./agent.js";

/** A model that plays the expected call for every prompt, except where `overrides` say otherwise. */
function scriptedModel(overrides: Record<string, ModelChoice> = {}): ToolChoiceModel & { prompts: string[] } {
  const prompts: string[] = [];
  return {
    label: "mock:scripted",
    prompts,
    async choose(prompt) {
      prompts.push(prompt);
      const agentCase = agentCases.find((candidate) => candidate.prompt === prompt);
      if (!agentCase) throw new Error("unknown prompt");
      if (overrides[agentCase.id]) return overrides[agentCase.id] as ModelChoice;
      return { tool: agentCase.expected.tool, input: materialize(agentCase.expected.input) };
    },
  };
}

/** Turns the shape markers into concrete argument values. */
function materialize(value: unknown): Record<string, unknown> {
  const fill = (v: unknown): unknown => {
    if (Array.isArray(v)) return v.map(fill);
    if (typeof v === "object" && v !== null && "$present" in v) return "some value";
    if (typeof v === "object" && v !== null && "$contains" in v) return `./${(v as { $contains: string }).$contains}`;
    if (typeof v === "object" && v !== null && !Array.isArray(v)) return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, fill(x)]));
    return v;
  };
  return fill(value) as Record<string, unknown>;
}

describe("agent dataset", () => {
  it("has 15 to 20 prompts, unique ids, and covers every published tool", () => {
    expect(agentCases.length).toBeGreaterThanOrEqual(15);
    expect(agentCases.length).toBeLessThanOrEqual(20);
    expect(new Set(agentCases.map((c) => c.id)).size).toBe(agentCases.length);
    for (const contract of toolContracts) {
      expect(agentCases.some((c) => c.expected.tool === contract.name), `no prompt expects ${contract.name}`).toBe(true);
    }
  });

  it("includes the near misses the issue names", () => {
    const has = (id: string) => agentCases.some((c) => c.id === id);
    expect(has("validate-draft-before-saving")).toBe(true); // query vs validate / validate vs mutate dry run
    expect(has("mutate-create-dry-run") && has("mutate-create-write")).toBe(true);
    expect(has("mutate-page-about-scaffold-is-still-mutate")).toBe(true);
    expect(agentCases.some((c) => c.expected.input.dryRun === true)).toBe(true);
    expect(agentCases.some((c) => c.expected.input.dryRun === false)).toBe(true);
  });
});

describe("tool definitions come from tools/list", () => {
  it("lists the live server tools and hands exactly those to the model", async () => {
    const tools = await listPublishedTools();
    expect(tools.map((t) => t.name).sort()).toEqual(toolContracts.map((c) => c.name).sort());
    for (const tool of tools) {
      const contract = toolContracts.find((c) => c.name === tool.name);
      expect(tool.description).toBe(contract?.description);
      expect(tool.inputSchema).toMatchObject({ type: "object" });
    }

    const seen: string[][] = [];
    const model: ToolChoiceModel = {
      label: "mock:spy",
      async choose(_prompt, shown) {
        seen.push(shown.map((t) => `${t.name}:${t.description}`));
        return {};
      },
    };
    await runAgentSuite(agentCases.slice(0, 1), model, tools);
    expect(seen[0]).toEqual(tools.map((t) => `${t.name}:${t.description}`));
  });

  it("issues a real tools/list request over MCP rather than reading the contracts", async () => {
    const spy = vi.spyOn(Client.prototype, "listTools");
    try {
      await listPublishedTools();
      expect(spy).toHaveBeenCalledTimes(1);
    } finally {
      spy.mockRestore();
    }
  });
});

describe("scoring a model choice", () => {
  it("a model that makes the expected call on every prompt scores 1.00 on every applicable scorer", async () => {
    const tools = await listPublishedTools();
    const suite = await runAgentSuite(agentCases, scriptedModel(), tools);
    const failing = suite.results.filter((r) => !r.passed).map((r) => `${r.id}: ${r.problems.join("; ")}`);
    expect(failing).toEqual([]);
    expect(suite.perTool.every((row) => row.accuracy === 1)).toBe(true);
    expect(suite.total).toBe(agentCases.length);
  });

  it("reports a wrong tool as a miss under the expected tool's accuracy", async () => {
    const tools = await listPublishedTools();
    const model = scriptedModel({ "mutate-create-dry-run": { tool: "validate", input: { instance: { slug: "roadmap" } } } });
    const suite = await runAgentSuite(agentCases, model, tools);
    const miss = suite.results.find((r) => r.id === "mutate-create-dry-run");
    expect(miss?.passed).toBe(false);
    expect(miss?.scores.tool_selected).toBe(0);
    expect(miss?.scores.tool_choice).toBe(0);
    expect(miss?.problems.join(" ")).toContain('chose "validate", expected "mutate"');
    const mutate = suite.perTool.find((row) => row.tool === "mutate");
    expect(mutate?.accuracy).toBeLessThan(1);
    expect(suite.perTool.find((row) => row.tool === "query")?.accuracy).toBe(1);
  });

  it("catches a write sent as a dry run (right tool, wrong argument shape)", async () => {
    const tools = await listPublishedTools();
    const agentCase = agentCases.find((c) => c.id === "mutate-create-write");
    if (!agentCase) throw new Error("case missing");
    const scored = await scoreAgentCase(
      agentCase,
      { tool: "mutate", input: { action: "create", slug: "roadmap", dryRun: true, page: { title: "Roadmap", slug: "roadmap", body: "Q1 goals" } } },
      tools,
    );
    expect(scored.scores.tool_selected).toBe(1);
    expect(scored.scores.argument_shape).toBe(0);
    expect(scored.scores.tool_choice).toBeLessThan(1);
    expect(scored.passed).toBe(false);
  });

  it("never writes scaffold output into the working directory", async () => {
    const tools = await listPublishedTools();
    const agentCase = agentCases.find((c) => c.id === "scaffold-write-files");
    if (!agentCase) throw new Error("case missing");
    const target = path.join(process.cwd(), "agent-eval-leak-check");
    try {
      await scoreAgentCase(agentCase, { tool: "scaffold", input: { target: "host-config", write: true, outDir: "agent-eval-leak-check" } }, tools);
      await expect(access(target)).rejects.toThrow();
    } finally {
      await rm(target, { recursive: true, force: true });
    }
  });

  it("flags arguments that violate the published input schema", async () => {
    const tools = await listPublishedTools();
    const agentCase = agentCases.find((c) => c.id === "query-list-with-limit");
    if (!agentCase) throw new Error("case missing");
    const scored = await scoreAgentCase(agentCase, { tool: "query", input: { limit: 5000 } }, tools);
    expect(scored.scores.argument_schema_valid).toBe(0);
    expect(scored.problems.join(" ")).toContain("inputSchema");
  });

  it("scores no tool call as a miss and keeps what the model said", async () => {
    const tools = await listPublishedTools();
    const scored = await scoreAgentCase(agentCases[0] as (typeof agentCases)[number], { text: "Sure, which pages?" }, tools);
    expect(scored.passed).toBe(false);
    expect(scored.scores.tool_selected).toBe(0);
    expect(scored.problems[0]).toContain("no tool call made");
  });

  it("a model call that throws is a failed prompt, not a crash", async () => {
    const tools = await listPublishedTools();
    const model: ToolChoiceModel = { label: "mock:down", choose: async () => { throw new Error("401 bad key"); } };
    const suite = await runAgentSuite(agentCases.slice(0, 2), model, tools);
    expect(suite.passed).toBe(0);
    expect(suite.results[0]?.error).toContain("401");
  });
});

describe("provider selection (no key, no network)", () => {
  it("skips with an actionable message when no key is set", () => {
    const selection = selectModel({});
    expect(selection.ok).toBe(false);
    if (!selection.ok) {
      expect(selection.message).toContain("ANTHROPIC_API_KEY");
      expect(selection.message).toContain("pnpm eval:agent");
    }
  });

  it("prefers Anthropic, defaults to a current Claude model and lets the env override it", () => {
    const fetchFn = vi.fn();
    const def = selectModel({ ANTHROPIC_API_KEY: "k", OPENAI_API_KEY: "o" }, fetchFn);
    expect(def.ok && def.model.label).toBe(`anthropic:${DEFAULT_ANTHROPIC_MODEL}`);
    expect(DEFAULT_ANTHROPIC_MODEL).toBe("claude-sonnet-5-5");
    const custom = selectModel({ ANTHROPIC_API_KEY: "k", EVAL_ANTHROPIC_MODEL: "claude-opus-5-5" }, fetchFn);
    expect(custom.ok && custom.model.label).toBe("anthropic:claude-opus-5-5");
    const openai = selectModel({ OPENAI_API_KEY: "o" }, fetchFn);
    expect(openai.ok && openai.model.label.startsWith("openai:")).toBe(true);
    expect(fetchFn).not.toHaveBeenCalled();
  });

  it("the Anthropic client sends the tools/list definitions and reads the first tool_use", async () => {
    const tools = await listPublishedTools();
    const fetchFn = vi.fn(async () => ({
      ok: true,
      status: 200,
      text: async () => JSON.stringify({ content: [{ type: "text", text: "ok" }, { type: "tool_use", name: "query", input: { slug: "intro" } }] }),
    }));
    const choice = await anthropicModel("secret", "claude-sonnet-5-5", fetchFn).choose("hi", tools);
    expect(choice).toMatchObject({ tool: "query", input: { slug: "intro" } });
    const call = fetchFn.mock.calls[0] as unknown as [string, { headers: Record<string, string>; body: string }];
    const body = JSON.parse(call[1].body) as { tools: Array<{ name: string; description: string; input_schema: unknown }>; model: string };
    expect(body.model).toBe("claude-sonnet-5-5");
    expect(body.tools).toEqual(tools.map((t) => ({ name: t.name, description: t.description, input_schema: t.inputSchema })));
    expect(call[1].headers["x-api-key"]).toBe("secret");
  });

  it("the OpenAI client parses function-call arguments and surfaces API errors with a next step", async () => {
    const tools = await listPublishedTools();
    const ok = vi.fn(async () => ({
      ok: true,
      status: 200,
      text: async () => JSON.stringify({ choices: [{ message: { tool_calls: [{ function: { name: "scaffold", arguments: '{"target":"client"}' } }] } }] }),
    }));
    expect(await openaiModel("o", "m", ok).choose("hi", tools)).toMatchObject({ tool: "scaffold", input: { target: "client" } });
    const bad = vi.fn(async () => ({ ok: false, status: 401, text: async () => "nope" }));
    await expect(anthropicModel("k", "m", bad).choose("hi", tools)).rejects.toThrow(/401.*Check the API key/);
  });
});

describe("Braintrust path (SDK mocked)", () => {
  it("runs the same task and scorers inside Eval() and returns the experiment URL", async () => {
    const calls: Array<Parameters<AgentEvalFunction>> = [];
    const evalFn: AgentEvalFunction = async (project, evaluator) => {
      calls.push([project, evaluator]);
      const results = [];
      for (const row of evaluator.data) results.push({ input: row.input, output: await evaluator.task(row.input) });
      return { results, summary: { experimentUrl: "https://example.invalid/experiment" } };
    };
    const outcome = await runAgentEval({ model: scriptedModel(), cases: agentCases.slice(0, 3), braintrust: { project: "p", evalFn } });
    expect(outcome.experimentUrl).toBe("https://example.invalid/experiment");
    expect(outcome.suite.total).toBe(3);
    expect(calls[0]?.[0]).toBe("p");
    expect(calls[0]?.[1].scores.map((s) => s({ input: agentCases[0] as never, output: outcome.suite.results[0] as never }).name)).toEqual([
      "tool_selected", "tool_choice", "argument_shape", "argument_schema_valid", "output_schema_valid",
    ]);
  });
});

describe("summary markdown", () => {
  it("contains only numbers from the suite it was given", async () => {
    const tools = await listPublishedTools();
    const suite = await runAgentSuite(agentCases.slice(0, 2), scriptedModel(), tools);
    const md = formatAgentSummaryMarkdown(suite, { date: "2026-01-01" });
    expect(md).toContain("mock:scripted");
    expect(md).toContain("| `query` | 2 | 1.00 |");
    expect(md).toContain("No Braintrust experiment was recorded");
  });
});
