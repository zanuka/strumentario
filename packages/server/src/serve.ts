import { loadConfig } from "./config.js";
import { createMcpHttpServer, MCP_HTTP_PATH, shutdownHttpServer } from "./http.js";

const config = loadConfig();
const server = createMcpHttpServer({ authToken: config.authToken });

server.listen(config.port, config.host, () => {
  const auth = config.authToken ? "bearer auth enabled" : "no auth";
  console.log(
    `Strumentario MCP server listening on http://${config.host}:${config.port}${MCP_HTTP_PATH} (${auth})`,
  );
});

server.on("error", (error) => {
  console.error("Unable to start Strumentario MCP server:", error.message);
  process.exitCode = 1;
});

let shuttingDown = false;
function shutdown(signal: string): void {
  if (shuttingDown) {
    return;
  }
  shuttingDown = true;
  console.log(`Received ${signal}; waiting for in-flight requests to finish.`);
  void shutdownHttpServer(server).then(
    () => process.exit(0),
    (error: unknown) => {
      console.error("Error during shutdown:", error);
      process.exit(1);
    },
  );
}

process.on("SIGINT", () => shutdown("SIGINT"));
process.on("SIGTERM", () => shutdown("SIGTERM"));
