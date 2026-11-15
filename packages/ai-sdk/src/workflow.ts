import type { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { stepCountIs, streamText, type LanguageModel } from "ai";
import { loadMcpTools } from "./tools.js";

export interface ToolCallRecord {
  tool: string;
  arguments: Record<string, unknown>;
  isError: boolean;
}

export interface WorkflowOptions {
  client: Client;
  model: LanguageModel;
  /** Slug of the page to read, check and propose a change to. */
  slug?: string;
  /** Let mutate write. Off by default: every mutate call is sent with dryRun true. */
  write?: boolean;
  /** Receives streamed text as it arrives. */
  onText?: (delta: string) => void;
  maxSteps?: number;
}

export interface WorkflowResult {
  text: string;
  calls: ToolCallRecord[];
}

export const WORKFLOW_SYSTEM =
  "You are an agent connected to a content server through MCP tools. Work through the steps the user lists, in order, calling the tool that fits each one. Use the values given in the request. Report briefly what each tool returned.";

export function workflowPrompt(slug: string): string {
  return [
    `1. Query the page with slug "${slug}" (if it does not exist, query a short list of pages instead).`,
    `2. Validate a draft page with title "Example", slug "${slug}" and a short body.`,
    `3. Mutate: preview an update of "${slug}" with that draft (use the revision from step 1; if the page does not exist, preview a create).`,
    "Finish with one sentence on what would change.",
  ].join("\n");
}

/**
 * The runnable example: query, then validate, then mutate, driven by a model through `streamText`.
 * The tools are the server's own (tools/list); mutate is pinned to dryRun unless `write` is set.
 */
export async function runWorkflow(options: WorkflowOptions): Promise<WorkflowResult> {
  const calls: ToolCallRecord[] = [];
  const tools = await loadMcpTools(options.client, {
    prepareArguments: (name, args) => (name === "mutate" && !options.write ? { ...args, dryRun: true } : args),
    onCall: (event) => calls.push(event),
  });
  const result = streamText({
    model: options.model,
    system: WORKFLOW_SYSTEM,
    prompt: workflowPrompt(options.slug ?? "intro"),
    tools,
    stopWhen: stepCountIs(options.maxSteps ?? 8),
    temperature: 0,
  });
  let text = "";
  for await (const delta of result.textStream) {
    text += delta;
    options.onText?.(delta);
  }
  return { text, calls };
}
