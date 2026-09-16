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

export { createMcpHttpServer, handleMcpHttpRequest, MCP_HTTP_PATH } from "./http.js";
export { HANDBOOK_PAGE_SCHEMA_URI, handbookPageJsonSchema, handbookPageSchema } from "./schema.js";
export { createMcpServer } from "./server.js";
export type { HandbookPage } from "./schema.js";
export {
  validateHandbookPage,
  type HandbookPageValidationResult,
} from "./validate.js";
