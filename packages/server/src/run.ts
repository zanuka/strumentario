import type { Readable, Writable } from "node:stream";
import type { Server } from "node:http";
import { loadConfig } from "./config.js";
import { runStdioServer } from "./stdio.js";
import { createMcpHttpServer, MCP_HTTP_PATH, shutdownHttpServer } from "./http.js";

export interface RunServerOptions {
  env?: NodeJS.ProcessEnv;
  /** Resolves the returned promise (after a graceful shutdown) when aborted. */
  signal: AbortSignal;
  log: (message: string) => void;
  error: (message: string) => void;
  /** Serve over stdio instead of HTTP (same as `MCP_TRANSPORT=stdio`). */
  stdio?: boolean | undefined;
  /** Stdio streams; default to the process's. Only used in stdio mode. */
  stdin?: Readable | undefined;
  stdout?: Writable | undefined;
}

/**
 * Start the server (Streamable HTTP, or stdio when selected) from environment configuration and run it
 * until `signal` aborts. Resolves with a process exit code: 0 after a clean
 * shutdown, 1 if the server could not start or shut down, 2 for bad config.
 * Shared by `serve.ts` and the `strumentario serve` command.
 */
export async function runServer(options: RunServerOptions): Promise<number> {
  let config;
  try {
    config = loadConfig(options.env);
  } catch (error) {
    options.error(`Invalid configuration: ${(error as Error).message}`);
    return 2;
  }

  if (options.stdio || config.transport === "stdio") {
    return runStdioServer({
      agent: config.agent,
      signal: options.signal,
      log: options.log,
      error: options.error,
      stdin: options.stdin,
      stdout: options.stdout,
    });
  }

  const server: Server = createMcpHttpServer({ authToken: config.authToken });

  try {
    await new Promise<void>((resolve, reject) => {
      server.once("error", reject);
      server.listen(config.port, config.host, () => {
        server.off("error", reject);
        resolve();
      });
    });
  } catch (error) {
    options.error(`Unable to start Strumentario MCP server: ${(error as Error).message}`);
    return 1;
  }

  const auth = config.authToken ? "bearer auth enabled" : "no auth";
  options.log(
    `Strumentario MCP server listening on http://${config.host}:${config.port}${MCP_HTTP_PATH} (${auth})`,
  );

  await new Promise<void>((resolve) => {
    if (options.signal.aborted) {
      resolve();
    } else {
      options.signal.addEventListener("abort", () => resolve(), { once: true });
    }
  });

  try {
    await shutdownHttpServer(server);
    return 0;
  } catch (error) {
    options.error(`Error during shutdown: ${error instanceof Error ? error.message : String(error)}`);
    return 1;
  }
}
