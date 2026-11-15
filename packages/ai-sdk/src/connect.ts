import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import type { Transport } from "@modelcontextprotocol/sdk/shared/transport.js";

export const DEFAULT_MCP_URL = "http://127.0.0.1:3001/mcp";

export interface ConnectOptions {
  /** Streamable HTTP endpoint of a running server. Defaults to STRUMENTARIO_MCP_URL, then DEFAULT_MCP_URL. */
  url?: string;
  /** Bearer token if the server was started with MCP_*_TOKEN. Defaults to STRUMENTARIO_MCP_TOKEN. */
  token?: string;
  /** Sent as X-Strumentario-Agent so the server's journal attributes the calls. */
  agent?: string;
  /** Any MCP transport instead of HTTP (an in-memory one in tests). */
  transport?: Transport;
}

/** Connects an MCP client the same way any host does. The server is a separate process; this package never imports it. */
export async function connectMcpClient(options: ConnectOptions = {}, env: NodeJS.ProcessEnv = process.env): Promise<Client> {
  const client = new Client({ name: "strumentario-ai-sdk", version: "0.0.0" });
  const token = options.token ?? env.STRUMENTARIO_MCP_TOKEN?.trim();
  const headers: Record<string, string> = {
    ...(token ? { authorization: `Bearer ${token}` } : {}),
    "x-strumentario-agent": options.agent ?? "strumentario-ai-sdk",
  };
  const url = options.url ?? env.STRUMENTARIO_MCP_URL?.trim() ?? DEFAULT_MCP_URL;
  // The SDK's HTTP transport declares sessionId?: string, which exactOptionalPropertyTypes rejects against Transport.
  const transport: Transport = options.transport ?? (new StreamableHTTPClientTransport(new URL(url), { requestInit: { headers } }) as Transport);
  try {
    await client.connect(transport);
  } catch (error) {
    await client.close().catch(() => undefined);
    throw new Error(
      `Could not connect to the Strumentario MCP server at ${options.transport ? "the given transport" : url}: ${error instanceof Error ? error.message : String(error)}. Start it with \`pnpm --filter @strumentario/server serve\`, or set STRUMENTARIO_MCP_URL.`,
    );
  }
  return client;
}
