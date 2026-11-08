import type { Readable, Writable } from "node:stream";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { createMcpServer } from "./server.js";

export interface RunStdioOptions {
  agent?: string | undefined;
  /** Resolves the returned promise (after closing the server) when aborted. */
  signal: AbortSignal;
  /** Diagnostics. In stdio mode the caller must route these to stderr: stdout carries only protocol messages. */
  log: (message: string) => void;
  error: (message: string) => void;
  stdin?: Readable | undefined;
  stdout?: Writable | undefined;
}

/**
 * Serve the same server and tools as the HTTP path over stdio, for hosts that
 * spawn the server as a child process. Runs until stdin closes or `signal`
 * aborts; resolves 0 after a clean close, 1 if the transport fails.
 */
export async function runStdioServer(options: RunStdioOptions): Promise<number> {
  const stdin = options.stdin ?? process.stdin;
  const stdout = options.stdout ?? process.stdout;
  const server = createMcpServer({ defaultAgent: options.agent });
  const transport = new StdioServerTransport(stdin, stdout);

  let failure: Error | undefined;
  const finished = new Promise<void>((resolve) => {
    const done = () => resolve();
    stdin.once("end", done);
    stdin.once("close", done);
    transport.onclose = done;
    transport.onerror = (error) => {
      failure = error;
      options.error(`stdio transport error: ${error.message}`);
    };
    if (options.signal.aborted) {
      done();
    } else {
      options.signal.addEventListener("abort", done, { once: true });
    }
  });

  try {
    await server.connect(transport);
  } catch (error) {
    options.error(`Unable to start Strumentario MCP server on stdio: ${error instanceof Error ? error.message : String(error)}`);
    return 1;
  }
  options.log("Strumentario MCP server ready on stdio");

  await finished;
  try {
    await server.close();
  } catch (error) {
    options.error(`Error during shutdown: ${error instanceof Error ? error.message : String(error)}`);
    return 1;
  }
  return failure ? 1 : 0;
}
