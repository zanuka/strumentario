import { z } from "zod";
import {
  buildStoredShape,
  type ContentPrimitiveName,
  type DomainDefinition,
} from "./domain.js";
import { handbookDomain } from "./schema.js";

export const QUERY_DEFAULT_LIMIT = 20;
export const QUERY_MAX_LIMIT = 100;

export const MUTATE_ACTIONS = ["create", "update", "delete"] as const;

export const QUERY_ERROR_CODES = ["not_found", "store_error"] as const;

export const MUTATE_ERROR_CODES = [
  "invalid",
  "not_found",
  "already_exists",
  "revision_required",
  "conflict",
  "idempotency_mismatch",
  "store_error",
] as const;

export const SCAFFOLD_TARGETS = ["client", "host-config"] as const;

export const SCAFFOLD_ERROR_CODES = ["invalid", "exists", "write_error"] as const;

/** Default MCP endpoint written into generated host config; matches `strumentario serve`. */
export const SCAFFOLD_DEFAULT_URL = "http://127.0.0.1:3001/mcp";

export const JOURNAL_DEFAULT_LIMIT = 100;
export const JOURNAL_MAX_LIMIT = 1000;
export const JOURNAL_VERSION = 1;

/** applied/dry_run/replayed are successes; conflict is a stale revision; rejected is every other refusal. */
export const JOURNAL_STATUSES = ["applied", "dry_run", "replayed", "conflict", "rejected"] as const;

export type ZodShape = Record<string, z.ZodType>;

export interface ToolAnnotations {
  readOnlyHint?: boolean;
  destructiveHint?: boolean;
  idempotentHint?: boolean;
  openWorldHint?: boolean;
}

/** Framework-neutral description of one MCP tool: no zod, no SDK types. */
export interface ToolContract {
  name: ContentPrimitiveName;
  title: string;
  description: string;
  annotations: ToolAnnotations;
  /** JSON Schema (draft-07, as served by tools/list) for the tool arguments. */
  inputSchema: Record<string, unknown>;
  /** JSON Schema (draft-07, as served by tools/list) for structuredContent. */
  outputSchema: Record<string, unknown>;
}

/** The contract plus the zod shapes the MCP server registers it with. */
export interface ToolDefinition extends Omit<ToolContract, "inputSchema" | "outputSchema"> {
  inputShape: ZodShape;
  outputShape: ZodShape;
}

export function shapeToJsonSchema(
  shape: ZodShape,
  io: "input" | "output",
): Record<string, unknown> {
  const schema = z.toJSONSchema(z.object(shape), { target: "draft-7", io });
  // The MCP SDK serves output schemas as closed objects; input schemas stay open.
  return (io === "output" ? { ...schema, additionalProperties: false } : schema) as Record<
    string,
    unknown
  >;
}

export function buildQueryDefinition(domain: DomainDefinition): ToolDefinition {
  const { one, many } = domain.slots;
  const stored = z.object(buildStoredShape(domain, { describeRevision: true }));
  return {
    name: "query",
    title: `Query ${domain.noun}s`,
    description: `Read ${domain.noun}s. Pass ${domain.keyField} to get one ${one}, or omit it to list ${many} (optional text filter and limit). Every ${one} includes its revision. Read-only.`,
    annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false },
    inputShape: {
      [domain.keyField]: z
        .string()
        .optional()
        .describe(
          `Return the single ${one} with this ${domain.keyField}. When set, text and limit are ignored.`,
        ),
      text: z
        .string()
        .optional()
        .describe(
          `List only ${many} whose ${domain.fields.map((f) => f.name).slice(0, -1).join(", ")}, or ${domain.fields.at(-1)?.name} contains this text (case-insensitive).`,
        ),
      limit: z
        .number()
        .int()
        .min(1)
        .max(QUERY_MAX_LIMIT)
        .optional()
        .describe(
          `Maximum ${many} to list (default ${QUERY_DEFAULT_LIMIT}, max ${QUERY_MAX_LIMIT}).`,
        ),
    },
    outputShape: {
      ok: z.boolean(),
      [one]: stored.optional().describe(`Set for a successful get-by-${domain.keyField}.`),
      [many]: z.array(stored).optional().describe("Set for a successful list."),
      total: z
        .number()
        .int()
        .optional()
        .describe(`${capitalize(many)} matching before limit was applied.`),
      error: z
        .object({
          code: z.enum(QUERY_ERROR_CODES),
          message: z.string(),
          [`available${capitalize(domain.keyField)}s`]: z.array(z.string()),
        })
        .optional(),
    },
  };
}

export function buildMutateDefinition(domain: DomainDefinition): ToolDefinition {
  const { one } = domain.slots;
  const stored = z.object(buildStoredShape(domain));
  return {
    name: "mutate",
    title: `Create, update or delete ${domain.noun}`,
    description: `Change the store: create, update or delete one ${domain.noun}. Use query to read ${domain.slots.many} and validate to check a draft without storing it. Dry-run by default (dryRun: true writes nothing); pass dryRun: false to write. Input is validated like the validate tool and invalid ${domain.slots.many} are refused. Update and delete take expectedRevision from query; a stale one returns a conflict with the current ${one}. Create fails on an existing ${domain.keyField} unless overwrite: true. Pass idempotencyKey to make retries safe.`,
    annotations: {
      readOnlyHint: false,
      // One tool carries the delete action, so hosts must treat it as destructive;
      // dry-run default and revision checks are the safety net.
      destructiveHint: true,
      idempotentHint: false,
      openWorldHint: false,
    },
    inputShape: {
      action: z
        .enum(MUTATE_ACTIONS)
        .describe(
          `create adds a new ${one}, update replaces an existing ${one}, delete removes a ${one}.`,
        ),
      [domain.keyField]: z
        .string()
        .describe(
          `${capitalize(domain.keyField)} of the ${one} to change. For create and update it must equal ${one}.${domain.keyField}.`,
        ),
      [one]: z
        .unknown()
        .optional()
        .describe(
          `The full ${one} ({ ${domain.fields.map((f) => f.name).join(", ")} }) for create and update. Ignored for delete.`,
        ),
      dryRun: z
        .boolean()
        .optional()
        .describe("Default true: report the intended change and write nothing. Pass false to write."),
      expectedRevision: z
        .string()
        .optional()
        .describe(
          "Revision from query that this change is based on. Required for update and delete unless overwrite is true; a stale value returns a conflict.",
        ),
      overwrite: z
        .boolean()
        .optional()
        .describe(
          `Allow create over an existing ${domain.keyField}, or update/delete without expectedRevision. Default false.`,
        ),
      idempotencyKey: z
        .string()
        .min(1)
        .max(200)
        .optional()
        .describe(
          "Retry token. Replaying the same key with the same input returns the original result and writes nothing again.",
        ),
    },
    outputShape: {
      ok: z.boolean(),
      action: z.enum(MUTATE_ACTIONS),
      [domain.keyField]: z.string(),
      dryRun: z.boolean().describe("True when nothing was written."),
      replayed: z
        .boolean()
        .optional()
        .describe(
          "True when this is the stored result of an earlier call with the same idempotencyKey.",
        ),
      [one]: stored
        .optional()
        .describe(`The ${one} after the change (for a dry run, as it would be). Absent for delete.`),
      previous: stored.optional().describe(`The ${one} before the change, when one existed.`),
      error: z
        .object({
          code: z.enum(MUTATE_ERROR_CODES),
          message: z.string(),
          errors: z
            .array(z.string())
            .optional()
            .describe("Validation errors, identical to the validate tool."),
          currentRevision: z.string().optional(),
          [`current${capitalize(one)}`]: stored
            .optional()
            .describe(`Fresh state to retry from, set on conflict and already_exists.`),
        })
        .optional(),
    },
  };
}

export function buildValidateDefinition(domain: DomainDefinition): ToolDefinition {
  return {
    name: "validate",
    title: `Validate ${domain.noun}`,
    description: `Validate a ${domain.noun} draft with ${listWithAnd(domain.fields.map((f) => f.name))} against the Strumentario schema.`,
    annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false },
    inputShape: {
      instance: z.unknown().describe(`The ${domain.noun} draft to validate.`),
    },
    outputShape: {
      valid: z.boolean(),
      errors: z.array(z.string()),
    },
  };
}

export function buildScaffoldDefinition(domain: DomainDefinition): ToolDefinition {
  const { many } = domain.slots;
  const file = z.object({
    path: z.string().describe("Path relative to the output directory, with forward slashes."),
    content: z.string(),
  });
  return {
    name: "scaffold",
    title: "Scaffold client or host config",
    description: `Generate code or config from the Strumentario schema: target "client" is a typed TypeScript client for ${domain.noun}s, target "host-config" is MCP server entries (Cursor, Claude Code, generic JSON) listing the real tool names. Returns the files in memory as { path, content } and writes nothing unless write: true with outDir; existing files are never replaced unless overwrite: true. It never reads or changes ${many} in the store: use mutate to create, update or delete ${many} and query to read them. Output is deterministic.`,
    annotations: {
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    },
    inputShape: {
      target: z
        .enum(SCAFFOLD_TARGETS)
        .describe(
          `client: typed TypeScript client module for ${domain.noun}s. host-config: MCP server entries for Cursor, Claude Code and a generic JSON form.`,
        ),
      url: z
        .string()
        .min(1)
        .optional()
        .describe(`host-config only: MCP endpoint to write into the entries (default ${SCAFFOLD_DEFAULT_URL}).`),
      auth: z
        .boolean()
        .optional()
        .describe(
          "host-config only: add a bearer Authorization header read from the MCP_AUTH_TOKEN environment variable. Default false.",
        ),
      write: z
        .boolean()
        .optional()
        .describe("Default false: return the files and write nothing. Pass true, with outDir, to write them."),
      outDir: z
        .string()
        .min(1)
        .optional()
        .describe(
          "Required when write is true. Directory to write into, relative to the server's scaffold root (its working directory unless STRUMENTARIO_SCAFFOLD_ROOT is set); it must stay inside that root.",
        ),
      overwrite: z
        .boolean()
        .optional()
        .describe("Allow write to replace files that already exist. Default false: any existing file refuses the whole write."),
    },
    outputShape: {
      ok: z.boolean(),
      target: z.enum(SCAFFOLD_TARGETS),
      files: z.array(file).describe("The generated files, in a stable order. Present on success."),
      written: z.boolean().describe("True only when the files were written to disk."),
      outDir: z.string().optional().describe("Absolute directory the files were written to, when written."),
      error: z
        .object({
          code: z.enum(SCAFFOLD_ERROR_CODES),
          message: z.string(),
          existing: z
            .array(z.string())
            .optional()
            .describe("Paths that already exist, set when code is exists."),
        })
        .optional(),
    },
  };
}

export interface JournalDefinition {
  /** Resource URI without query parameters. */
  uri: string;
  /** RFC 6570 template served for the resource: `uri` plus `{?since,limit}`. */
  uriTemplate: string;
  /** Shape of one journal line. */
  entryShape: ZodShape;
  /** Shape of the resource payload: a page of entries plus the cursor to continue from. */
  pageShape: ZodShape;
}

const nullableString = (description: string) => z.string().nullable().describe(description);

/**
 * The change-journal resource, generated from the same domain as the tools: the
 * entry is keyed by the domain's keyField and its error codes and actions are
 * the mutate tool's. Journal entries never carry resource bodies, only hashes and sizes.
 */
export function buildJournalDefinition(domain: DomainDefinition): JournalDefinition {
  const { one } = domain.slots;
  const entryShape: ZodShape = {
    v: z.literal(JOURNAL_VERSION).describe("Journal format version."),
    ts: z.string().describe("ISO 8601 UTC time the outcome was recorded."),
    tool: z.literal("mutate"),
    action: z.enum(MUTATE_ACTIONS),
    [domain.keyField]: z.string().describe(`${capitalize(domain.keyField)} the call targeted (truncated at 200 characters).`),
    status: z.enum(JOURNAL_STATUSES),
    dryRun: z.boolean().describe("True when the call wrote nothing because it was a dry run."),
    agent: nullableString("Agent identity from the X-Strumentario-Agent header; null when the caller sent none."),
    idempotencyKey: nullableString("The idempotencyKey the caller passed, if any."),
    expectedRevision: nullableString(`The expectedRevision the caller passed, if any.`),
    revisionBefore: nullableString(
      `Revision of the ${one} before the call; null when none existed, or for a replay (a replay does not read the store).`,
    ),
    revisionAfter: nullableString(
      `Revision of the ${one} after the call. Equals revisionBefore unless the call applied a change; null after a delete or for a replay.`,
    ),
    proposedRevision: nullableString(`For a dry run, the revision the ${one} would have had.`),
    errorCode: z.enum(MUTATE_ERROR_CODES).nullable().describe("The mutate error code for conflict and rejected entries."),
    payload: z
      .object({
        bytes: z.number().int().describe(`Size in bytes of the submitted ${one} as JSON.`),
        hash: z.string().describe(`Content hash of the submitted ${one} as JSON.`),
      })
      .nullable()
      .describe(`Size and hash of the ${one} the caller submitted; null for delete or when none was sent.`),
  };
  return {
    uri: domain.resources.journalUri,
    uriTemplate: `${domain.resources.journalUri}{?since,limit}`,
    entryShape,
    pageShape: {
      entries: z.array(z.object(entryShape)),
      cursor: z.string().describe("Pass as `since` to read the entries after this page."),
      skipped: z.number().int().describe("Corrupt journal lines passed over in this page."),
    },
  };
}

const BUILDERS: Record<ContentPrimitiveName, (domain: DomainDefinition) => ToolDefinition> = {
  query: buildQueryDefinition,
  mutate: buildMutateDefinition,
  validate: buildValidateDefinition,
  scaffold: buildScaffoldDefinition,
};

/** Tool definitions (contract + zod shapes) for every primitive the domain declares. */
export function buildToolDefinitions(domain: DomainDefinition): ToolDefinition[] {
  return domain.primitives.map((primitive) => BUILDERS[primitive](domain));
}

export function toToolContract(definition: ToolDefinition): ToolContract {
  const { inputShape, outputShape, ...rest } = definition;
  return {
    ...rest,
    inputSchema: shapeToJsonSchema(inputShape, "input"),
    outputSchema: shapeToJsonSchema(outputShape, "output"),
  };
}

/** Framework-neutral tool contracts for a domain. */
export function buildToolContracts(domain: DomainDefinition): ToolContract[] {
  return buildToolDefinitions(domain).map(toToolContract);
}

export const handbookToolDefinitions = buildToolDefinitions(handbookDomain);

/** Contracts for the handbook-page domain, exported for the CLI, scaffold and later surfaces. */
export const toolContracts: readonly ToolContract[] = handbookToolDefinitions.map(toToolContract);

export const journalDefinition = buildJournalDefinition(handbookDomain);

/** Framework-neutral journal contract: URI plus plain JSON Schema for an entry and a resource page. */
export const journalContract = {
  uri: journalDefinition.uri,
  uriTemplate: journalDefinition.uriTemplate,
  entrySchema: shapeToJsonSchema(journalDefinition.entryShape, "output"),
  pageSchema: shapeToJsonSchema(journalDefinition.pageShape, "output"),
} as const;

export function getToolDefinition(name: ContentPrimitiveName): ToolDefinition {
  const definition = handbookToolDefinitions.find((tool) => tool.name === name);
  if (!definition) {
    throw new Error(`Handbook domain does not declare the "${name}" tool.`);
  }
  return definition;
}

function capitalize(value: string): string {
  return value.charAt(0).toUpperCase() + value.slice(1);
}

function listWithAnd(values: string[]): string {
  return values.length <= 1
    ? (values[0] ?? "")
    : `${values.slice(0, -1).join(", ")}, and ${values.at(-1)}`;
}
