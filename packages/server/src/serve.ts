import { runServer } from "./run.js";

const controller = new AbortController();
const stdio = process.argv.includes("--stdio") || process.env.MCP_TRANSPORT?.trim().toLowerCase() === "stdio";

// In stdio mode stdout carries only protocol messages, so every diagnostic goes to stderr.
const log = (message: string) => (stdio ? console.error(message) : console.log(message));

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, () => {
    if (!controller.signal.aborted) {
      log(`Received ${signal}; ${stdio ? "closing." : "waiting for in-flight requests to finish."}`);
      controller.abort();
    }
  });
}

void runServer({
  signal: controller.signal,
  stdio,
  log,
  error: (message) => console.error(message),
}).then((code) => process.exit(code));
