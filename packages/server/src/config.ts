export const DEFAULT_PORT = 3001;
export const DEFAULT_HOST = "127.0.0.1";

export const TRANSPORTS = ["http", "stdio"] as const;
export type Transport = (typeof TRANSPORTS)[number];

export interface ServerConfig {
  /** `MCP_TRANSPORT`: Streamable HTTP (default) or stdio for hosts that spawn the server. */
  transport: Transport;
  /** `STRUMENTARIO_AGENT`: attribution for stdio calls, which carry no headers. */
  agent: string | undefined;
  port: number;
  host: string;
  /** Shared secret for `/mcp`; auth is off when undefined. */
  authToken: string | undefined;
}

function parsePort(value: string | undefined): number {
  if (value === undefined || value === "") {
    return DEFAULT_PORT;
  }

  const port = Number(value);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error("PORT must be an integer between 1 and 65535.");
  }

  return port;
}

function parseTransport(value: string | undefined): Transport {
  const transport = value?.trim().toLowerCase();
  if (!transport) {
    return "http";
  }
  if (!(TRANSPORTS as readonly string[]).includes(transport)) {
    throw new Error(`MCP_TRANSPORT must be "http" or "stdio", got "${value}".`);
  }
  return transport as Transport;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): ServerConfig {
  const host = env.HOST?.trim();
  const authToken = env.MCP_AUTH_TOKEN?.trim();

  const agent = env.STRUMENTARIO_AGENT?.trim();

  return {
    transport: parseTransport(env.MCP_TRANSPORT),
    agent: agent ? agent : undefined,
    port: parsePort(env.PORT),
    host: host ? host : DEFAULT_HOST,
    authToken: authToken ? authToken : undefined,
  };
}
