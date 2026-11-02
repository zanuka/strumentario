import { runServer } from "./run.js";

const controller = new AbortController();

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, () => {
    if (!controller.signal.aborted) {
      console.log(`Received ${signal}; waiting for in-flight requests to finish.`);
      controller.abort();
    }
  });
}

void runServer({
  signal: controller.signal,
  log: (message) => console.log(message),
  error: (message) => console.error(message),
}).then((code) => process.exit(code));
