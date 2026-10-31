export const PACKAGE_NAME = "@strumentario/server" as const;

export type ContentPrimitive = "query" | "mutate" | "validate" | "scaffold";

export const CONTENT_PRIMITIVES: readonly ContentPrimitive[] = [
  "query",
  "mutate",
  "validate",
  "scaffold",
] as const;

export interface ServerPackageInfo {
  name: typeof PACKAGE_NAME;
  phase: "foundation";
  primitives: readonly ContentPrimitive[];
}

export function getServerPackageInfo(): ServerPackageInfo {
  return {
    name: PACKAGE_NAME,
    phase: "foundation",
    primitives: CONTENT_PRIMITIVES,
  };
}

export { DEFAULT_HOST, DEFAULT_PORT, loadConfig, type ServerConfig } from "./config.js";
export {
  createMcpHttpServer,
  handleMcpHttpRequest,
  HEALTH_PATH,
  MCP_HTTP_PATH,
  shutdownHttpServer,
  type McpHttpOptions,
} from "./http.js";
export { HANDBOOK_PAGE_SCHEMA_URI, handbookPageJsonSchema, handbookPageSchema } from "./schema.js";
export {
  AGENT_HEADER,
  createMcpServer,
  getAgentId,
  type McpServerOptions,
  type ToolCallEvent,
} from "./server.js";
export type { HandbookPage } from "./schema.js";
export {
  validateHandbookPage,
  type HandbookPageValidationResult,
} from "./validate.js";
export { queryPages, type QueryInput, type QueryResult } from "./query.js";
export {
  DATA_DIR_ENV,
  DEFAULT_DATA_DIR,
  FileSystemPageStore,
  resolveDataDir,
  revisionOf,
  StoreError,
  type PageStore,
  type StoredPage,
} from "./store.js";
