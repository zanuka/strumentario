import type { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { McpError } from "@modelcontextprotocol/sdk/types.js";

/**
 * Batch wire format. This is a stable contract for external consumers; see docs/batch.md.
 * One input line per call, one output line per input line, in input order.
 */
export type BatchId = string | number | null;

export type BatchErrorCode =
  /** The line is not valid JSON or not a {id, tool, input} object. */
  | "invalid_line"
  /** The tool reported an error (`isError`) or reported its input as invalid (`valid: false`). */
  | "tool_error"
  /** The server rejected the request, for example an unknown tool or an input that fails its schema. */
  | "rejected"
  /** The connection failed during the call. */
  | "connection"
  /** Not run because `--stop-on-error` stopped the batch after an earlier failure. */
  | "skipped";

export interface BatchError {
  code: BatchErrorCode;
  message: string;
  /** The tool's structured result, when it returned one alongside the error. */
  details?: unknown;
}

export type BatchRecord =
  | { id: BatchId; ok: true; result: unknown }
  | { id: BatchId; ok: false; error: BatchError };

export interface BatchCall {
  id: BatchId;
  tool: string;
  input: Record<string, unknown>;
}

/** A parsed input line: a call to make, or a record that already says why it cannot run. */
export type BatchEntry = { call: BatchCall } | { failed: BatchRecord & { ok: false } };

/** Parse JSON-lines input. Blank lines are ignored; a bad line becomes an error record, never a throw. */
export function parseBatchInput(text: string): BatchEntry[] {
  const entries: BatchEntry[] = [];
  text.split(/\r?\n/).forEach((line, index) => {
    if (line.trim() === "") {
      return;
    }
    entries.push(parseLine(line, index + 1));
  });
  return entries;
}

function invalid(id: BatchId, line: number, message: string): BatchEntry {
  return { failed: { id, ok: false, error: { code: "invalid_line", message: `Line ${line}: ${message}` } } };
}

function parseLine(line: string, lineNumber: number): BatchEntry {
  let value: unknown;
  try {
    value = JSON.parse(line);
  } catch (error) {
    return invalid(null, lineNumber, `not valid JSON (${error instanceof Error ? error.message : String(error)}). Each line must be one JSON object: {"id":"1","tool":"query","input":{}}.`);
  }
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return invalid(null, lineNumber, 'must be a JSON object: {"id":"1","tool":"query","input":{}}.');
  }
  const record = value as Record<string, unknown>;
  const id: BatchId = typeof record.id === "string" || typeof record.id === "number" ? record.id : null;
  if (record.id === undefined || id === null) {
    return invalid(null, lineNumber, '"id" is required and must be a string or number, so results can be matched to calls.');
  }
  if (typeof record.tool !== "string" || record.tool === "") {
    return invalid(id, lineNumber, '"tool" must be a tool name. Run `strumentario tools` to list them.');
  }
  const input = record.input ?? {};
  if (typeof input !== "object" || input === null || Array.isArray(input)) {
    return invalid(id, lineNumber, '"input" must be a JSON object when present.');
  }
  return { call: { id, tool: record.tool, input: input as Record<string, unknown> } };
}

type ToolList = Awaited<ReturnType<Client["listTools"]>>["tools"];

/**
 * `--dry-run`: a tool that declares `dryRun` gets it forced on; one that declares `write`
 * (scaffold) gets it forced off. Tools with neither (query, validate) never write.
 */
export function forceDryRun(tools: ToolList, name: string, input: Record<string, unknown>): Record<string, unknown> {
  const tool = tools.find((candidate) => candidate.name === name);
  const properties = (tool?.inputSchema as { properties?: Record<string, unknown> } | undefined)?.properties;
  if (properties && "dryRun" in properties) {
    return { ...input, dryRun: true };
  }
  if (properties && "write" in properties) {
    return { ...input, write: false };
  }
  return input;
}

export interface BatchOptions {
  dryRun: boolean;
  stopOnError: boolean;
  concurrency: number;
  /** Called once per record, strictly in input order, as soon as that record and all before it are done. */
  onRecord: (record: BatchRecord) => void;
}

export interface BatchSummary {
  total: number;
  failed: number;
  /** True when at least one call failed because the connection broke, which maps to exit code 3. */
  connectionLost: boolean;
}

async function execute(client: Client, call: BatchCall, args: Record<string, unknown>): Promise<BatchRecord> {
  try {
    const result = await client.callTool({ name: call.tool, arguments: args });
    const structured = result.structuredContent;
    const output = structured ?? result.content;
    if (result.isError) {
      return { id: call.id, ok: false, error: { code: "tool_error", message: `Tool "${call.tool}" reported an error. Check the input with \`strumentario call ${call.tool} --help\`.`, details: output } };
    }
    if (typeof structured === "object" && structured !== null && (structured as { valid?: unknown }).valid === false) {
      return { id: call.id, ok: false, error: { code: "tool_error", message: `Tool "${call.tool}" reported the input as invalid; see details.`, details: output } };
    }
    return { id: call.id, ok: true, result: output };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (error instanceof McpError) {
      return { id: call.id, ok: false, error: { code: "rejected", message: `Server rejected the request: ${message}. Run \`strumentario tools\` to check tool names and input schemas.` } };
    }
    return { id: call.id, ok: false, error: { code: "connection", message: `Connection failed: ${message}` } };
  }
}

/** Run every entry over one connection, at most `concurrency` calls in flight, emitting records in input order. */
export async function runBatch(client: Client, entries: BatchEntry[], options: BatchOptions): Promise<BatchSummary> {
  const tools = options.dryRun && entries.some((entry) => "call" in entry) ? (await client.listTools()).tools : [];
  const records: (BatchRecord | undefined)[] = new Array(entries.length).fill(undefined);
  let next = 0;
  let flushed = 0;
  let stopped = false;
  let failed = 0;
  let connectionLost = false;

  const flush = (): void => {
    for (let record = records[flushed]; record !== undefined; record = records[flushed]) {
      options.onRecord(record);
      flushed += 1;
    }
  };
  const settle = (index: number, record: BatchRecord): void => {
    records[index] = record;
    if (!record.ok) {
      failed += 1;
      if (record.error.code === "connection") {
        connectionLost = true;
      }
      if (options.stopOnError && record.error.code !== "skipped") {
        stopped = true;
      }
    }
    flush();
  };

  const worker = async (): Promise<void> => {
    for (let index = next++; index < entries.length; index = next++) {
      const entry = entries[index];
      if (entry === undefined) {
        continue;
      }
      if ("failed" in entry) {
        settle(index, entry.failed);
      } else if (stopped) {
        settle(index, { id: entry.call.id, ok: false, error: { code: "skipped", message: "Not run: --stop-on-error stopped the batch after an earlier failure." } });
      } else {
        const args = options.dryRun ? forceDryRun(tools, entry.call.tool, entry.call.input) : entry.call.input;
        settle(index, await execute(client, entry.call, args));
      }
    }
  };

  await Promise.all(Array.from({ length: Math.max(1, Math.min(options.concurrency, entries.length)) }, worker));
  return { total: entries.length, failed, connectionLost };
}
