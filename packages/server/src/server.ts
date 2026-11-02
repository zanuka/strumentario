import type { IncomingHttpHeaders } from "node:http";
import { McpServer, ResourceTemplate } from "@modelcontextprotocol/sdk/server/mcp.js";
import { ErrorCode, McpError } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";
import {
  HANDBOOK_PAGE_SCHEMA_URI,
  handbookPageJsonSchema,
} from "./schema.js";
import { mutateInputShape, mutateOutputShape, mutatePage } from "./mutate.js";
import { queryInputShape, queryOutputShape, queryPages } from "./query.js";
import { FileSystemPageStore, type PageStore } from "./store.js";
import { validateHandbookPage } from "./validate.js";

export const PAGE_RESOURCE_TEMPLATE = "strumentario://pages/{slug}" as const;

export interface CreateMcpServerOptions extends McpServerOptions {
  /** Defaults to a file store at STRUMENTARIO_DATA_DIR (./.strumentario/data). */
  store?: PageStore;
}

const VALIDATE_OUTPUT_SCHEMA = {
  valid: z.boolean(),
  errors: z.array(z.string()),
};

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

  server.registerTool(
    "validate",
    {
      title: "Validate handbook page",
      description:
        "Validate a handbook page draft with title, slug, and body against the Strumentario schema.",
      inputSchema: {
        instance: z
          .unknown()
          .describe("The handbook page draft to validate."),
      },
      outputSchema: VALIDATE_OUTPUT_SCHEMA,
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        openWorldHint: false,
      },
    },
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
    {
      title: "Query handbook pages",
      description:
        "Read handbook pages. Pass slug to get one page, or omit it to list pages (optional text filter and limit). Every page includes its revision. Read-only.",
      inputSchema: queryInputShape,
      outputSchema: queryOutputShape,
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        openWorldHint: false,
      },
    },
    async (input, extra) => {
      options.onToolCall?.({
        tool: "query",
        agent: getAgentId(extra.requestInfo?.headers),
      });
      const structuredContent = await queryPages(store, input);

      return {
        content: [{ type: "text", text: JSON.stringify(structuredContent) }],
        structuredContent,
        ...(structuredContent.ok ? {} : { isError: true }),
      };
    },
  );

  server.registerTool(
    "mutate",
    {
      title: "Create, update or delete handbook page",
      description:
        "Change the store: create, update or delete one handbook page. Use query to read pages and validate to check a draft without storing it. Dry-run by default (dryRun: true writes nothing); pass dryRun: false to write. Input is validated like the validate tool and invalid pages are refused. Update and delete take expectedRevision from query; a stale one returns a conflict with the current page. Create fails on an existing slug unless overwrite: true. Pass idempotencyKey to make retries safe.",
      inputSchema: mutateInputShape,
      outputSchema: mutateOutputShape,
      annotations: {
        readOnlyHint: false,
        // One tool carries the delete action, so hosts must treat it as destructive;
        // dry-run default and revision checks are the safety net.
        destructiveHint: true,
        idempotentHint: false,
        openWorldHint: false,
      },
    },
    async (input) => {
      const structuredContent = await mutatePage(store, input);

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
