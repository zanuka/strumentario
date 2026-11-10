export const PACKAGE_NAME = "@strumentario/server" as const;

export type ContentPrimitive = "query" | "mutate" | "validate" | "scaffold" | "repair";

export const CONTENT_PRIMITIVES: readonly ContentPrimitive[] = [
  "query",
  "mutate",
  "validate",
  "scaffold",
  "repair",
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

export { DEFAULT_HOST, DEFAULT_PORT, loadConfig, TRANSPORTS, type ServerConfig, type Transport } from "./config.js";
export {
  createMcpHttpServer,
  handleMcpHttpRequest,
  HEALTH_PATH,
  MCP_HTTP_PATH,
  shutdownHttpServer,
  type McpHttpOptions,
} from "./http.js";
export { runServer, type RunServerOptions } from "./run.js";
export { runStdioServer, type RunStdioOptions } from "./stdio.js";
export {
  HANDBOOK_PAGE_SCHEMA_URI,
  JOURNAL_URI,
  handbookDomain,
  handbookPageJsonSchema,
  handbookPageSchema,
  SLUG_PATTERN,
} from "./schema.js";
export {
  buildResourceShape,
  buildStoredShape,
  defineDomain,
  type ContentPrimitiveName,
  type DomainDefinition,
  type FieldName,
  type ResourceOf,
  type FieldDefinition,
  type StringFieldDefinition,
} from "./domain.js";
export {
  buildJournalDefinition,
  buildToolContracts,
  buildToolDefinitions,
  JOURNAL_DEFAULT_LIMIT,
  JOURNAL_MAX_LIMIT,
  JOURNAL_STATUSES,
  SCAFFOLD_DEFAULT_URL,
  SCAFFOLD_TARGETS,
  journalContract,
  toolContracts,
  toToolContract,
  type ToolAnnotations,
  type ToolContract,
  type ToolDefinition,
} from "./contracts.js";
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
export { mutatePage, type MutateInput, type MutateOptions, type MutateResult } from "./mutate.js";
export {
  FileJournal,
  JOURNAL_FILE,
  journalEntryFor,
  JournalError,
  type Journal,
  type JournalEntry,
  type JournalPage,
  type JournalReadOptions,
  type JournalStatus,
} from "./journal.js";
export {
  generateScaffoldFiles,
  scaffold,
  SCAFFOLD_ROOT_ENV,
  type ScaffoldError,
  type ScaffoldFile,
  type ScaffoldInput,
  type ScaffoldOptions,
  type ScaffoldResult,
  type ScaffoldTarget,
} from "./scaffold.js";
export {
  checkFiles,
  createModelFixer,
  createTemplateFixer,
  repair,
  REPAIR_MODEL_ENV,
  type RepairError,
  type RepairFixer,
  type RepairInput,
  type RepairOptions,
  type RepairResult,
  type RepairRound,
  type RepairStopReason,
} from "./repair.js";
export { queryPages, type QueryInput, type QueryResult } from "./query.js";
export {
  DATA_DIR_ENV,
  DEFAULT_DATA_DIR,
  FileSystemPageStore,
  resolveDataDir,
  revisionOf,
  serializePage,
  StoreError,
  type IdempotencyRecord,
  type PageStore,
  type StoredPage,
} from "./store.js";
