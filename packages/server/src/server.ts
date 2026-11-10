import type { IncomingHttpHeaders } from "node:http";
import { McpServer, ResourceTemplate } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { RequestHandlerExtra } from "@modelcontextprotocol/sdk/shared/protocol.js";
import type { ServerNotification, ServerRequest } from "@modelcontextprotocol/sdk/types.js";
import { ErrorCode, McpError } from "@modelcontextprotocol/sdk/types.js";
import { allows, callerScope, requiredScope, scopeDeniedMessage } from "./auth.js";
import { getToolDefinition, journalDefinition, type ToolAnnotations, type ToolDefinition } from "./contracts.js";
import { FileJournal, JournalError, type Journal } from "./journal.js";
import {
  HANDBOOK_PAGE_SCHEMA_URI,
  handbookDomain,
  handbookPageJsonSchema,
} from "./schema.js";
// Registered shapes are generated, so handler input types are asserted here;
// the drift test (contracts.test.ts) keeps shape and handler contract aligned.
import { mutatePage, type MutateInput } from "./mutate.js";
import { queryPages, type QueryInput } from "./query.js";
import { repair, type RepairInput } from "./repair.js";
import { scaffold, type ScaffoldInput } from "./scaffold.js";
import { FileSystemPageStore, type PageStore } from "./store.js";
import { validateHandbookPage } from "./validate.js";

export const PAGE_RESOURCE_TEMPLATE = handbookDomain.resources.instanceTemplate;

export interface CreateMcpServerOptions extends McpServerOptions {
  /** Defaults to a file store at STRUMENTARIO_DATA_DIR (./.strumentario/data). */
  store?: PageStore;
  /** Defaults to journal.jsonl beside a file store's pages; a store without a directory has no journal. */
  journal?: Journal;
}

export const AGENT_HEADER = "x-strumentario-agent" as const;

export interface ToolCallEvent {
  tool: string;
  /** Value of the `X-Strumentario-Agent` header, if the caller sent one. */
  agent: string | undefined;
}

export interface McpServerOptions {
  /** Agent identity used when a call carries no `X-Strumentario-Agent` header (stdio has no headers). */
  defaultAgent?: string | undefined;
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
  const journal = options.journal ?? (store instanceof FileSystemPageStore ? new FileJournal(store.dir) : undefined);
  const agentOf = (headers: Parameters<typeof getAgentId>[0]) => getAgentId(headers) ?? options.defaultAgent;
  const server = new McpServer({
    name: "strumentario",
    version: "0.0.1",
  });

  // Scope enforcement lives here, on every tool registered on this server, and reads only the
  // tool's own annotations: a tool without `readOnlyHint: true` needs the write scope.
  type Handler = (...args: unknown[]) => unknown;
  type ToolConfig = { annotations?: ToolAnnotations; inputSchema?: unknown };
  const registerTool = server.registerTool.bind(server) as unknown as (name: string, config: ToolConfig, handler: Handler) => unknown;
  (server as { registerTool: unknown }).registerTool = (name: string, config: ToolConfig, handler: Handler) =>
    registerTool(name, config, (...args: unknown[]) => {
      // The SDK calls a tool with no input schema as handler(extra) and any other as handler(input, extra).
      const extra = (config.inputSchema === undefined ? args[0] : args[1]) as RequestHandlerExtra<ServerRequest, ServerNotification>;
      const needed = requiredScope(config.annotations);
      const held = callerScope(extra.authInfo);
      if (!allows(held, needed)) {
        return {
          isError: true,
          content: [{ type: "text", text: scopeDeniedMessage(name, needed, held) }],
        };
      }
      return handler(...args);
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
        agent: agentOf(extra.requestInfo?.headers),
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
        agent: agentOf(extra.requestInfo?.headers),
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
    async (input, extra) => {
      const structuredContent = await mutatePage(store, input as unknown as MutateInput, {
        journal,
        agent: agentOf(extra.requestInfo?.headers),
        scope: callerScope(extra.authInfo),
      });

      return {
        content: [{ type: "text", text: JSON.stringify(structuredContent) }],
        structuredContent,
        ...(structuredContent.ok ? {} : { isError: true }),
      };
    },
  );

  server.registerTool(
    "scaffold",
    register(getToolDefinition("scaffold")),
    async (input, extra) => {
      options.onToolCall?.({
        tool: "scaffold",
        agent: agentOf(extra.requestInfo?.headers),
      });
      const structuredContent = await scaffold(input as unknown as ScaffoldInput);

      return {
        content: [{ type: "text", text: JSON.stringify(structuredContent) }],
        structuredContent,
        ...(structuredContent.ok ? {} : { isError: true }),
      };
    },
  );

  server.registerTool(
    "repair",
    register(getToolDefinition("repair")),
    async (input, extra) => {
      options.onToolCall?.({
        tool: "repair",
        agent: agentOf(extra.requestInfo?.headers),
      });
      const structuredContent = await repair(input as unknown as RepairInput);

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

  const readJournal = async (uri: URL, variables: Record<string, string | string[] | undefined>) => {
    if (!journal) {
      throw new McpError(
        ErrorCode.InvalidRequest,
        "This server's store keeps no change journal. Run the server with the default file store to enable it.",
      );
    }
    try {
      const page = await journal.read({
        since: single(variables["since"]),
        limit: parseLimitVariable(single(variables["limit"])),
      });
      return {
        contents: [{ uri: uri.href, mimeType: "application/json", text: JSON.stringify(page, null, 2) }],
      };
    } catch (error) {
      if (error instanceof JournalError) {
        throw new McpError(ErrorCode.InvalidParams, error.message);
      }
      throw error;
    }
  };
  const journalMetadata = {
    title: "Change journal",
    description:
      "Read-only, append-only record of every mutate call (applied, dry run, replay, conflict, rejected) with agent attribution. Query parameters: since (the cursor from the previous read) and limit.",
    mimeType: "application/json",
  };

  server.registerResource("change-journal", journalDefinition.uri, journalMetadata, (uri) => readJournal(uri, {}));
  // The SDK matches a template's query variables literally and in order, so each
  // supported combination is its own template; all of them share one handler.
  for (const query of ["{?since,limit}", "{?limit,since}", "{?since}", "{?limit}"]) {
    server.registerResource(
      `change-journal${query}`,
      new ResourceTemplate(`${journalDefinition.uri}${query}`, { list: undefined }),
      journalMetadata,
      (uri, variables) => readJournal(uri, variables),
    );
  }

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

function single(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

function parseLimitVariable(value: string | undefined): number | undefined {
  if (value === undefined || value === "") {
    return undefined;
  }
  return /^\d+$/.test(value) ? Number(value) : Number.NaN;
}
