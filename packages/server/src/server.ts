import type { IncomingHttpHeaders } from "node:http";
import { McpServer, ResourceTemplate } from "@modelcontextprotocol/sdk/server/mcp.js";
import { ErrorCode, McpError } from "@modelcontextprotocol/sdk/types.js";
import { getToolDefinition, type ToolDefinition } from "./contracts.js";
import {
  HANDBOOK_PAGE_SCHEMA_URI,
  handbookDomain,
  handbookPageJsonSchema,
} from "./schema.js";
// Registered shapes are generated, so handler input types are asserted here;
// the drift test (contracts.test.ts) keeps shape and handler contract aligned.
import { mutatePage, type MutateInput } from "./mutate.js";
import { queryPages, type QueryInput } from "./query.js";
import { FileSystemPageStore, type PageStore } from "./store.js";
import { validateHandbookPage } from "./validate.js";

export const PAGE_RESOURCE_TEMPLATE = handbookDomain.resources.instanceTemplate;

export interface CreateMcpServerOptions extends McpServerOptions {
  /** Defaults to a file store at STRUMENTARIO_DATA_DIR (./.strumentario/data). */
  store?: PageStore;
}

export const AGENT_HEADER = "x-strumentario-agent" as const;

export interface ToolCallEvent {
  tool: string;
  /** Value of the `X-Strumentario-Agent` header, if the caller sent one. */
  agent: string | undefined;
}

export interface McpServerOptions {
  /** Observer invoked for each tool call, for attribution and tests. */
  onToolCall?: (event: ToolCallEvent) => void;
}

/** Read the agent identity from request headers; a missing header is allowed. */
export function getAgentId(
  headers: IncomingHttpHeaders | Record<string, string | string[] | undefined> | undefined,
): string | undefined {
  const raw = headers?.[AGENT_HEADER];
  const value = Array.isArray(raw) ? raw[0] : raw;
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
}

export function createMcpServer(options: CreateMcpServerOptions = {}): McpServer {
  const store = options.store ?? new FileSystemPageStore();
  const server = new McpServer({
    name: "strumentario",
    version: "0.0.1",
  });

  // Tool metadata and schemas come from the generated definitions (contracts.ts);
  // only the handlers live here.
  const register = (definition: ToolDefinition) => ({
    title: definition.title,
    description: definition.description,
    inputSchema: definition.inputShape,
    outputSchema: definition.outputShape,
    annotations: definition.annotations,
  });

  server.registerTool(
    "validate",
    register(getToolDefinition("validate")),
    async ({ instance }, extra) => {
      options.onToolCall?.({
        tool: "validate",
        agent: getAgentId(extra.requestInfo?.headers),
      });
      const structuredContent = validateHandbookPage(instance);

      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(structuredContent),
          },
        ],
        structuredContent,
      };
    },
  );

  server.registerTool(
    "query",
    register(getToolDefinition("query")),
    async (input, extra) => {
      options.onToolCall?.({
        tool: "query",
        agent: getAgentId(extra.requestInfo?.headers),
      });
      const structuredContent = await queryPages(store, input as QueryInput);

      return {
        content: [{ type: "text", text: JSON.stringify(structuredContent) }],
        structuredContent,
        ...(structuredContent.ok ? {} : { isError: true }),
      };
    },
  );

  server.registerTool(
    "mutate",
    register(getToolDefinition("mutate")),
    async (input) => {
      const structuredContent = await mutatePage(store, input as unknown as MutateInput);

      return {
        content: [{ type: "text", text: JSON.stringify(structuredContent) }],
        structuredContent,
        ...(structuredContent.ok ? {} : { isError: true }),
      };
    },
  );

  server.registerResource(
    "handbook-page",
    new ResourceTemplate(PAGE_RESOURCE_TEMPLATE, {
      list: async () => ({
        resources: (await store.list()).map((page) => ({
          uri: `strumentario://pages/${page.slug}`,
          name: page.slug,
          title: page.title,
          mimeType: "application/json",
        })),
      }),
    }),
    {
      title: "Handbook page",
      description: "A stored handbook page (with revision) by slug.",
      mimeType: "application/json",
    },
    async (uri, variables) => {
      const slug = String(variables["slug"]);
      const result = await queryPages(store, { slug });
      if (!result.ok || !result.page) {
        throw new McpError(
          ErrorCode.InvalidParams,
          result.error?.message ?? `Unable to read page "${slug}".`,
        );
      }
      return {
        contents: [
          {
            uri: uri.href,
            mimeType: "application/json",
            text: JSON.stringify(result.page, null, 2),
          },
        ],
      };
    },
  );

  server.registerResource(
    "handbook-page-schema",
    HANDBOOK_PAGE_SCHEMA_URI,
    {
      title: "Handbook page schema",
      description: "JSON Schema for a handbook page draft.",
      mimeType: "application/schema+json",
    },
    async () => ({
      contents: [
        {
          uri: HANDBOOK_PAGE_SCHEMA_URI,
          mimeType: "application/schema+json",
          text: JSON.stringify(handbookPageJsonSchema, null, 2),
        },
      ],
    }),
  );

  server.registerPrompt(
    "review-draft",
    {
      title: "Review handbook draft",
      description: "Review a handbook draft, validating it before any mutation.",
    },
    async () => ({
      messages: [
        {
          role: "user",
          content: {
            type: "text",
            text: "Review this handbook page draft. Call validate first and resolve every reported error before attempting any mutate action.",
          },
        },
      ],
    }),
  );

  return server;
}
