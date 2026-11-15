import type { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { jsonSchema, tool, type ToolSet } from "ai";

/**
 * MCP tools as AI SDK tools. Nothing here names a Strumentario tool or restates a schema:
 * the definitions come from the server's own `tools/list`, and every execution is a `tools/call`.
 */

export interface McpToolsOptions {
  /**
   * Rewrites the arguments of a call before it is sent. The place to pin a safety default (the
   * example forces `dryRun: true` on mutate). Receives the tool name the server published.
   */
  prepareArguments?: (toolName: string, args: Record<string, unknown>) => Record<string, unknown>;
  /** Called after every tools/call round trip, for logging or tests. */
  onCall?: (event: { tool: string; arguments: Record<string, unknown>; isError: boolean }) => void;
}

/** Lists the server's tools over MCP and returns them as an AI SDK `ToolSet` ready for `streamText({ tools })`. */
export async function loadMcpTools(client: Client, options: McpToolsOptions = {}): Promise<ToolSet> {
  const { tools } = await client.listTools();
  if (tools.length === 0) {
    throw new Error("The MCP server published no tools. Check that it is the Strumentario server (`pnpm --filter @strumentario/server serve`) and that your token allows tools/list.");
  }
  const set: ToolSet = {};
  for (const published of tools) {
    set[published.name] = tool({
      description: published.description ?? "",
      inputSchema: jsonSchema(published.inputSchema as Parameters<typeof jsonSchema>[0]),
      async execute(input: unknown) {
        const args = options.prepareArguments?.(published.name, asRecord(input)) ?? asRecord(input);
        const result = await client.callTool({ name: published.name, arguments: args });
        options.onCall?.({ tool: published.name, arguments: args, isError: result.isError === true });
        // The model gets the tool's own result, errors included, so it can read the message and retry.
        return result.structuredContent ?? result.content;
      },
    });
  }
  return set;
}

function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}
