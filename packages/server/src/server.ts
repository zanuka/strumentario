import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import {
  HANDBOOK_PAGE_SCHEMA_URI,
  handbookPageJsonSchema,
} from "./schema.js";
import { validateHandbookPage } from "./validate.js";

const VALIDATE_OUTPUT_SCHEMA = {
  valid: z.boolean(),
  errors: z.array(z.string()),
};

export function createMcpServer(): McpServer {
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
    async ({ instance }) => {
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
