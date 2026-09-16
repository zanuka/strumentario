import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import type { Transport } from "@modelcontextprotocol/sdk/shared/transport.js";
import { createMcpServer } from "./server.js";

export const MCP_HTTP_PATH = "/mcp" as const;

function sendJsonRpcError(
  response: ServerResponse,
  statusCode: number,
  message: string,
): void {
  response.writeHead(statusCode, { "content-type": "application/json" });
  response.end(
    JSON.stringify({
      jsonrpc: "2.0",
      error: { code: -32603, message },
      id: null,
    }),
  );
}

export async function handleMcpHttpRequest(
  request: IncomingMessage,
  response: ServerResponse,
): Promise<void> {
  const url = new URL(request.url ?? "/", "http://localhost");

  if (url.pathname !== MCP_HTTP_PATH) {
    response.writeHead(404);
    response.end("Not found");
    return;
  }

  if (request.method !== "POST") {
    response.writeHead(405, { allow: "POST" });
    response.end("Method not allowed");
    return;
  }

  const server = createMcpServer();
  const transport = new StreamableHTTPServerTransport();

  response.once("close", () => {
    void transport.close();
    void server.close();
  });

  try {
    // The SDK's HTTP transport declarations expose optional callbacks as explicit
    // `undefined`, which conflicts with exactOptionalPropertyTypes.
    await server.connect(transport as unknown as Transport);
    await transport.handleRequest(request, response);
  } catch (error) {
    if (!response.headersSent) {
      sendJsonRpcError(response, 500, "Unable to handle MCP request.");
    }
    console.error("MCP request failed:", error);
  }
}

export function createMcpHttpServer() {
  return createServer((request, response) => {
    void handleMcpHttpRequest(request, response);
  });
}
