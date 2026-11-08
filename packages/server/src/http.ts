import {
  createServer,
  type IncomingMessage,
  type Server,
  type ServerResponse,
} from "node:http";
import type { AuthInfo } from "@modelcontextprotocol/sdk/server/auth/types.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import type { Transport } from "@modelcontextprotocol/sdk/shared/transport.js";
import { authEnabled, authInfoFor, resolveScope } from "./auth.js";
import { createMcpServer, type McpServerOptions } from "./server.js";

export const MCP_HTTP_PATH = "/mcp" as const;
export const HEALTH_PATH = "/healthz" as const;

export interface McpHttpOptions extends McpServerOptions {
  /** Shared bearer secret for `/mcp` that acts as a write token (`MCP_AUTH_TOKEN`). */
  authToken?: string | undefined;
  /** Bearer secret limited to read-only tools and resources (`MCP_READ_TOKEN`). */
  readToken?: string | undefined;
  /** Bearer secret that may call everything (`MCP_WRITE_TOKEN`). */
  writeToken?: string | undefined;
}

function bearerOf(request: IncomingMessage): string | undefined {
  const match = /^Bearer\s+(.+)$/i.exec(request.headers.authorization ?? "");
  return match?.[1]?.trim();
}

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
  options: McpHttpOptions = {},
): Promise<void> {
  const url = new URL(request.url ?? "/", "http://localhost");

  if (url.pathname === HEALTH_PATH) {
    if (request.method !== "GET" && request.method !== "HEAD") {
      response.writeHead(405, { allow: "GET, HEAD" });
      response.end("Method not allowed");
      return;
    }
    response.writeHead(200, { "content-type": "application/json" });
    response.end(request.method === "HEAD" ? undefined : JSON.stringify({ status: "ok" }));
    return;
  }

  if (url.pathname !== MCP_HTTP_PATH) {
    response.writeHead(404);
    response.end("Not found");
    return;
  }

  const tokens = { read: options.readToken, write: [options.authToken, options.writeToken] };
  const bearer = bearerOf(request);
  const scope = bearer === undefined ? undefined : resolveScope(tokens, bearer);
  if (authEnabled(tokens) && scope === undefined) {
    response.writeHead(401, {
      "content-type": "application/json",
      "www-authenticate": 'Bearer realm="strumentario"',
    });
    response.end(
      JSON.stringify({
        jsonrpc: "2.0",
        error: {
          code: -32001,
          message:
            "Unauthorized: send 'Authorization: Bearer <token>' matching the server's MCP_READ_TOKEN, MCP_WRITE_TOKEN or MCP_AUTH_TOKEN, or unset them all to disable auth.",
        },
        id: null,
      }),
    );
    return;
  }

  if (request.method !== "POST") {
    response.writeHead(405, { allow: "POST" });
    response.end("Method not allowed");
    return;
  }

  // The transport hands this to tool handlers as `extra.authInfo`, where the scope is enforced.
  if (scope !== undefined) {
    (request as IncomingMessage & { auth?: AuthInfo }).auth = authInfoFor(scope);
  }

  const server = createMcpServer(options);
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

export function createMcpHttpServer(options: McpHttpOptions = {}): Server {
  return createServer((request, response) => {
    void handleMcpHttpRequest(request, response, options);
  });
}

/**
 * Stop accepting connections and resolve once in-flight requests have finished.
 * Idle keep-alive connections are closed immediately; busy ones are left to complete.
 */
export function shutdownHttpServer(server: Server): Promise<void> {
  return new Promise((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()));
    server.closeIdleConnections();
  });
}
