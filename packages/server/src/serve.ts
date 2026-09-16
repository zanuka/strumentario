import { createMcpHttpServer, MCP_HTTP_PATH } from "./http.js";

export const DEFAULT_PORT = 3001;

function getPort(value: string | undefined): number {
  if (value === undefined) {
    return DEFAULT_PORT;
  }

  const port = Number(value);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error("PORT must be an integer between 1 and 65535.");
  }

  return port;
}

const port = getPort(process.env.PORT);
const server = createMcpHttpServer();

server.listen(port, "127.0.0.1", () => {
  console.log(`Strumentario MCP server listening on http://localhost:${port}${MCP_HTTP_PATH}`);
});

server.on("error", (error) => {
  console.error("Unable to start Strumentario MCP server:", error.message);
  process.exitCode = 1;
});
