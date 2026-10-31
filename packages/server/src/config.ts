export const DEFAULT_PORT = 3001;
export const DEFAULT_HOST = "127.0.0.1";

export interface ServerConfig {
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

export function loadConfig(env: NodeJS.ProcessEnv = process.env): ServerConfig {
  const host = env.HOST?.trim();
  const authToken = env.MCP_AUTH_TOKEN?.trim();

  return {
    port: parsePort(env.PORT),
    host: host ? host : DEFAULT_HOST,
    authToken: authToken ? authToken : undefined,
  };
}
