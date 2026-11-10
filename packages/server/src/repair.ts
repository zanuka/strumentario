import path from "node:path";
import {
  REPAIR_DEFAULT_ROUNDS,
  REPAIR_ERROR_SOURCES,
  REPAIR_MAX_FILE_BYTES,
  REPAIR_MAX_FILES,
  REPAIR_MAX_ROUNDS,
  REPAIR_STOP_REASONS,
  SCAFFOLD_DEFAULT_URL,
  toolContracts,
  type ToolContract,
} from "./contracts.js";
import { generateScaffoldFiles, type ScaffoldFile } from "./scaffold.js";
import { typeCheckSources, VIRTUAL_DIR } from "./typecheck.js";


/** Setting this to a model id turns on the optional model-backed fixer; it also needs ANTHROPIC_API_KEY. */
export const REPAIR_MODEL_ENV = "STRUMENTARIO_REPAIR_MODEL";

export type RepairStopReason = (typeof REPAIR_STOP_REASONS)[number];


export interface RepairInput {
  files: ScaffoldFile[];
  maxRounds?: number | undefined;
}

/** One failure from a check: tsc for `.ts` files, schema validation for `.json` files. */
export interface RepairError {
  path: string;
  source: (typeof REPAIR_ERROR_SOURCES)[number];
  message: string;
  line?: number;
  /** The `TS####` code, for tsc errors. */
  code?: string;
}

export interface RepairRound {
  round: number;
  /** Errors found before this round's fix; the first round's value is the starting error count. */
  errorsBefore: number;
  /** Errors left after this round's fix was applied and the checks re-run. */
  errorsAfter: number;
  /** Paths whose content the fixer changed (whether or not the round was kept). */
  changedFiles: string[];
  /** False when the fix did not shrink the error set: it is discarded and the loop stops. */
  kept: boolean;
  /** True when the optional model-backed fixer produced the change. */
  usedModel: boolean;
  /** Why a fixer produced nothing, when it failed rather than found nothing to change. */
  note?: string;
}

export interface RepairToolError {
  code: "invalid";
  message: string;
}

export interface RepairResult extends Record<string, unknown> {
  ok: boolean;
  /** True when every check passes on the returned files. */
  converged: boolean;
  stopReason?: RepairStopReason;
  maxRounds: number;
  roundsUsed: number;
  /** Error count before round 1, then after each round that was kept: the shrinking series. */
  errorCounts: number[];
  rounds: RepairRound[];
  /** Errors still present in `files`; empty exactly when converged. */
  remainingErrors: RepairError[];
  /** The best files reached (never worse than the input). */
  files: ScaffoldFile[];
  error?: RepairToolError;
}

/** Proposes replacement files for the failing ones. It may return only the files it changed. */
export type RepairFixer = (input: { files: ScaffoldFile[]; errors: RepairError[]; round: number }) => Promise<ScaffoldFile[]>;

export interface RepairOptions {
  /** Replaces the default fixers entirely; for tests and for hosts wiring their own. */
  fixer?: RepairFixer;
  /** Optional fixer tried only when the deterministic one changed nothing. Defaults to the env-flagged model fixer. */
  modelFixer?: RepairFixer | undefined;
  contracts?: readonly ToolContract[];
  environment?: NodeJS.ProcessEnv;
}

// --- checks: the same tsc and schema validation the scaffold tests use ------------------

/** Run every check that applies to the files. Files of other kinds are not checked. */
export async function checkFiles(files: readonly ScaffoldFile[], contracts: readonly ToolContract[] = toolContracts): Promise<RepairError[]> {
  const errors: RepairError[] = [];

  const sources = new Map<string, string>();
  const byVirtual = new Map<string, string>();
  for (const file of files) {
    if (file.path.endsWith(".ts")) {
      const virtual = path.join(VIRTUAL_DIR, file.path);
      sources.set(virtual, file.content);
      byVirtual.set(virtual, file.path);
    }
  }
  for (const diagnostic of await typeCheckSources(sources)) {
    const owner = byVirtual.get(diagnostic.file);
    if (owner === undefined && diagnostic.file !== "") {
      continue; // a diagnostic inside a dependency, not in the files under repair
    }
    errors.push({
      path: owner ?? "",
      source: "tsc",
      message: diagnostic.message,
      code: diagnostic.code,
      ...(diagnostic.line !== undefined ? { line: diagnostic.line } : {}),
    });
  }

  for (const file of files) {
    if (file.path.endsWith(".json")) {
      for (const message of schemaErrors(file, contracts)) {
        errors.push({ path: file.path, source: "schema", message });
      }
    }
  }
  return errors;
}

const SERVER_ENTRY_FILES = new Set([".cursor/mcp.json", ".mcp.json"]);
const GENERIC_CONFIG_FILE = "strumentario.mcp.json";

function schemaErrors(file: ScaffoldFile, contracts: readonly ToolContract[]): string[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(file.content);
  } catch (error) {
    return [`is not valid JSON: ${error instanceof Error ? error.message : String(error)}`];
  }
  const root = asRecord(parsed);
  if (!root) {
    return ["must be a JSON object"];
  }
  const problems: string[] = [];
  if (SERVER_ENTRY_FILES.has(file.path)) {
    const entry = asRecord(asRecord(root["mcpServers"])?.["strumentario"]);
    if (!entry) {
      return ['must have an "mcpServers.strumentario" entry'];
    }
    problems.push(...urlAndHeaderProblems(entry, "mcpServers.strumentario."));
  } else if (file.path === GENERIC_CONFIG_FILE) {
    if (root["name"] !== "strumentario") problems.push('"name" must be "strumentario"');
    if (root["transport"] !== "streamable-http") problems.push('"transport" must be "streamable-http"');
    problems.push(...urlAndHeaderProblems(root, ""));
    const listed = Array.isArray(root["tools"]) ? root["tools"].map((tool) => asRecord(tool)?.["name"]) : undefined;
    if (listed === undefined) {
      problems.push('"tools" must be an array of tool entries');
    } else {
      const missing = contracts.map((contract) => contract.name).filter((name) => !listed.includes(name));
      if (missing.length > 0) {
        problems.push(`"tools" must list every registered tool; missing ${missing.join(", ")}`);
      }
    }
  }
  return problems;
}

function urlAndHeaderProblems(entry: Record<string, unknown>, prefix: string): string[] {
  const problems: string[] = [];
  if (!isHttpUrl(entry["url"])) {
    problems.push(`"${prefix}url" must be an http(s) URL`);
  }
  const headers = asRecord(entry["headers"]);
  if (!headers || Object.values(headers).some((value) => typeof value !== "string")) {
    problems.push(`"${prefix}headers" must be an object of string values`);
  }
  return problems;
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return typeof value === "object" && value !== null && !Array.isArray(value) ? (value as Record<string, unknown>) : undefined;
}

function isHttpUrl(value: unknown): value is string {
  if (typeof value !== "string") return false;
  try {
    const protocol = new URL(value).protocol;
    return protocol === "http:" || protocol === "https:";
  } catch {
    return false;
  }
}

// --- the deterministic fixer: regenerate a failing file from the schema ------------------

/**
 * For a failing file the scaffold generator owns (`strumentario-client.ts` and the host-config files),
 * return the freshly generated version. A host-config file keeps its URL and auth choice when they can
 * still be read. A failing file the generator does not own is left alone: the template path cannot fix
 * what it did not generate, and the loop reports that rather than guessing.
 */
export function createTemplateFixer(contracts: readonly ToolContract[] = toolContracts): RepairFixer {
  return async ({ files, errors }) => {
    const failing = new Set(errors.map((error) => error.path));
    const fixed: ScaffoldFile[] = [];
    for (const file of files) {
      if (!failing.has(file.path)) continue;
      const regenerated = regenerate(file, contracts);
      if (regenerated !== undefined) fixed.push(regenerated);
    }
    return fixed;
  };
}

function regenerate(file: ScaffoldFile, contracts: readonly ToolContract[]): ScaffoldFile | undefined {
  if (file.path === "strumentario-client.ts") {
    return generateScaffoldFiles({ target: "client" }, { contracts }).find((generated) => generated.path === file.path);
  }
  if (SERVER_ENTRY_FILES.has(file.path) || file.path === GENERIC_CONFIG_FILE) {
    return generateScaffoldFiles({ target: "host-config", url: recoverUrl(file), auth: /"Authorization"/.test(file.content) }, { contracts }).find(
      (generated) => generated.path === file.path,
    );
  }
  return undefined;
}

function recoverUrl(file: ScaffoldFile): string {
  try {
    const root = asRecord(JSON.parse(file.content));
    const candidate = SERVER_ENTRY_FILES.has(file.path) ? asRecord(asRecord(root?.["mcpServers"])?.["strumentario"])?.["url"] : root?.["url"];
    if (isHttpUrl(candidate)) return candidate;
  } catch {
    // unreadable file: fall back to the default endpoint
  }
  return SCAFFOLD_DEFAULT_URL;
}

// --- the optional model-backed fixer (behind STRUMENTARIO_REPAIR_MODEL) -------------------

type FetchLike = (url: string, init: { method: string; headers: Record<string, string>; body: string }) => Promise<{ ok: boolean; status: number; text: () => Promise<string> }>;

/** The model-backed fixer when STRUMENTARIO_REPAIR_MODEL and ANTHROPIC_API_KEY are both set; otherwise undefined. */
export function createModelFixer(environment: NodeJS.ProcessEnv = process.env, fetchImpl: FetchLike = fetch as unknown as FetchLike): RepairFixer | undefined {
  const model = environment[REPAIR_MODEL_ENV]?.trim();
  const apiKey = environment["ANTHROPIC_API_KEY"]?.trim();
  if (!model || !apiKey) return undefined;
  return async ({ files, errors }) => {
    const prompt = [
      "Fix the errors in these generated files. Change only what the errors require.",
      'Reply with JSON only: {"files":[{"path":"...","content":"..."}]} listing every file you changed, using the paths given.',
      `Errors:\n${JSON.stringify(errors, null, 2)}`,
      `Files:\n${JSON.stringify(files, null, 2)}`,
    ].join("\n\n");
    const response = await fetchImpl("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: { "content-type": "application/json", "x-api-key": apiKey, "anthropic-version": "2023-06-01" },
      body: JSON.stringify({ model, max_tokens: 8192, messages: [{ role: "user", content: prompt }] }),
    });
    const text = await response.text();
    if (!response.ok) {
      throw new Error(`model request failed with status ${response.status}`);
    }
    const body = asRecord(JSON.parse(text));
    const reply = (Array.isArray(body?.["content"]) ? body["content"] : []).map((part) => asRecord(part)?.["text"]).find((value) => typeof value === "string");
    if (typeof reply !== "string") throw new Error("model reply had no text");
    const start = reply.indexOf("{");
    const end = reply.lastIndexOf("}");
    const parsed = asRecord(JSON.parse(reply.slice(start, end + 1)));
    const proposed = Array.isArray(parsed?.["files"]) ? parsed["files"] : [];
    return proposed.flatMap((entry) => {
      const file = asRecord(entry);
      return typeof file?.["path"] === "string" && typeof file["content"] === "string" ? [{ path: file["path"], content: file["content"] }] : [];
    });
  };
}

// --- the loop ----------------------------------------------------------------------------------

/**
 * Check the files, ask a fixer for corrections, apply them, and check again. Stops when the checks
 * pass, when `maxRounds` is used up, or as soon as a round fails to shrink the error set (that
 * round's change is discarded, so the result is never worse than what it started with).
 */
export async function repair(input: RepairInput, options: RepairOptions = {}): Promise<RepairResult> {
  const contracts = options.contracts ?? toolContracts;
  const maxRounds = input.maxRounds ?? REPAIR_DEFAULT_ROUNDS;
  const invalid = (message: string): RepairResult => ({
    ok: false,
    converged: false,
    maxRounds,
    roundsUsed: 0,
    errorCounts: [],
    rounds: [],
    remainingErrors: [],
    files: input.files,
    error: { code: "invalid", message },
  });

  const problem = inputProblem(input, maxRounds);
  if (problem) return invalid(problem);

  const fixers: Array<{ fix: RepairFixer; model: boolean }> = options.fixer
    ? [{ fix: options.fixer, model: false }]
    : [
        { fix: createTemplateFixer(contracts), model: false },
        ...((): Array<{ fix: RepairFixer; model: boolean }> => {
          const model = "modelFixer" in options ? options.modelFixer : createModelFixer(options.environment);
          return model ? [{ fix: model, model: true }] : [];
        })(),
      ];

  let files = input.files.map((file) => ({ ...file }));
  let errors = await checkFiles(files, contracts);
  const errorCounts = [errors.length];
  const rounds: RepairRound[] = [];
  let stopReason: RepairStopReason = "converged";

  while (errors.length > 0) {
    if (rounds.length >= maxRounds) {
      stopReason = "max_rounds";
      break;
    }
    const round = rounds.length + 1;
    const attempt = await attemptFix(files, errors, round, fixers);
    const after = attempt.changed.length > 0 ? await checkFiles(attempt.files, contracts) : errors;
    const kept = attempt.changed.length > 0 && after.length < errors.length;
    rounds.push({
      round,
      errorsBefore: errors.length,
      errorsAfter: after.length,
      changedFiles: attempt.changed,
      kept,
      usedModel: attempt.usedModel,
      ...(attempt.note ? { note: attempt.note } : {}),
    });
    if (!kept) {
      stopReason = "no_progress";
      break;
    }
    files = attempt.files;
    errors = after;
    errorCounts.push(errors.length);
  }

  return {
    ok: true,
    converged: errors.length === 0,
    stopReason,
    maxRounds,
    roundsUsed: rounds.length,
    errorCounts,
    rounds,
    remainingErrors: errors,
    files,
  };
}

interface Attempt {
  files: ScaffoldFile[];
  changed: string[];
  usedModel: boolean;
  note?: string;
}

async function attemptFix(
  files: ScaffoldFile[],
  errors: RepairError[],
  round: number,
  fixers: Array<{ fix: RepairFixer; model: boolean }>,
): Promise<Attempt> {
  const notes: string[] = [];
  for (const { fix, model } of fixers) {
    try {
      const proposed = await fix({ files, errors, round });
      const byPath = new Map(proposed.map((file) => [file.path, file.content]));
      const changed: string[] = [];
      // Only paths that were passed in can change: a fixer cannot add files.
      const next = files.map((file) => {
        const content = byPath.get(file.path);
        if (content === undefined || content === file.content) return file;
        changed.push(file.path);
        return { path: file.path, content };
      });
      if (changed.length > 0) {
        return { files: next, changed, usedModel: model, ...(notes.length > 0 ? { note: notes.join("; ") } : {}) };
      }
    } catch (error) {
      notes.push(`${model ? "model fixer" : "fixer"} failed: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  return { files, changed: [], usedModel: false, ...(notes.length > 0 ? { note: notes.join("; ") } : {}) };
}

function inputProblem(input: RepairInput, maxRounds: number): string | undefined {
  if (!Number.isInteger(maxRounds) || maxRounds < 1 || maxRounds > REPAIR_MAX_ROUNDS) {
    return `maxRounds must be a whole number from 1 to ${REPAIR_MAX_ROUNDS}. Omit it for the default of ${REPAIR_DEFAULT_ROUNDS}.`;
  }
  if (input.files.length === 0 || input.files.length > REPAIR_MAX_FILES) {
    return `files must hold 1 to ${REPAIR_MAX_FILES} files. Pass the files a scaffold call returned.`;
  }
  const seen = new Set<string>();
  for (const file of input.files) {
    const normalized = path.posix.normalize(file.path);
    if (file.path === "" || path.isAbsolute(file.path) || file.path.includes("\\") || normalized === ".." || normalized.startsWith("../") || normalized !== file.path) {
      return `file path "${file.path}" must be relative, use forward slashes and stay inside the output directory (no "..").`;
    }
    if (seen.has(file.path)) {
      return `file path "${file.path}" appears twice. Send each file once.`;
    }
    seen.add(file.path);
    if (Buffer.byteLength(file.content) > REPAIR_MAX_FILE_BYTES) {
      return `file "${file.path}" is larger than ${REPAIR_MAX_FILE_BYTES} bytes. Repair only the failing generated files.`;
    }
  }
  return undefined;
}
