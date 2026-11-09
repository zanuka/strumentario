import { appendFile, mkdir, open, stat } from "node:fs/promises";
import path from "node:path";
import type { TokenScope } from "./auth.js";
import { JOURNAL_DEFAULT_LIMIT, JOURNAL_MAX_LIMIT, JOURNAL_VERSION, type JOURNAL_STATUSES } from "./contracts.js";
import type { MutateInput, MutateResult } from "./mutate.js";
import { revisionOf } from "./store.js";

export const JOURNAL_FILE = "journal.jsonl" as const;

/** Longest string (slug, agent, key) written to the journal, so one line stays small and appends stay atomic. */
const MAX_FIELD_LENGTH = 200;
const READ_CHUNK_BYTES = 64 * 1024;

export type JournalStatus = (typeof JOURNAL_STATUSES)[number];

/** One line of the journal. The authoritative description is docs/journal.md; the JSON Schema is generated in contracts.ts. */
export interface JournalEntry {
  v: typeof JOURNAL_VERSION;
  ts: string;
  tool: "mutate";
  action: MutateInput["action"];
  slug: string;
  status: JournalStatus;
  dryRun: boolean;
  agent: string | null;
  scope: TokenScope | null;
  idempotencyKey: string | null;
  expectedRevision: string | null;
  revisionBefore: string | null;
  revisionAfter: string | null;
  proposedRevision: string | null;
  errorCode: NonNullable<MutateResult["error"]>["code"] | null;
  payload: { bytes: number; hash: string } | null;
}

export interface JournalReadOptions {
  /** Cursor from a previous read (`cursor`); omit to start at the beginning. */
  since?: string | undefined;
  limit?: number | undefined;
}

export interface JournalPage {
  entries: JournalEntry[];
  /** Pass as `since` to read what follows this page. Equal to the input cursor when nothing new was found. */
  cursor: string;
  /** Corrupt lines passed over (for example one torn by a crash). They are never returned as entries. */
  skipped: number;
}

/** Storage seam for the change journal. Append-only: there is no update or delete. */
export interface Journal {
  append(entry: JournalEntry): Promise<void>;
  read(options?: JournalReadOptions): Promise<JournalPage>;
}

export class JournalError extends Error {
  override name = "JournalError";
}

function clamp(value: string | undefined): string | null {
  if (value === undefined) {
    return null;
  }
  return value.length > MAX_FIELD_LENGTH ? `${value.slice(0, MAX_FIELD_LENGTH)}…` : value;
}

function payloadOf(input: MutateInput): JournalEntry["payload"] {
  if (input.action === "delete" || input.page === undefined) {
    return null;
  }
  try {
    const json = JSON.stringify(input.page);
    return typeof json === "string" ? { bytes: Buffer.byteLength(json), hash: revisionOf(json) } : null;
  } catch {
    return null;
  }
}

/**
 * Turn one mutate call and its outcome into a journal entry. Pure: never includes
 * the page body, only its size and hash, and never reads the store.
 */
export function journalEntryFor(
  input: MutateInput,
  result: MutateResult,
  agent: string | undefined,
  now: Date = new Date(),
  scope?: TokenScope,
): JournalEntry {
  const replayed = result.ok && result.replayed === true;
  const status: JournalStatus = !result.ok
    ? result.error?.code === "conflict"
      ? "conflict"
      : "rejected"
    : replayed
      ? "replayed"
      : result.dryRun
        ? "dry_run"
        : "applied";

  const revisionBefore = replayed ? null : (result.previous?.revision ?? result.error?.currentRevision ?? null);
  const applied = status === "applied";
  const revisionAfter = replayed ? null : applied ? (input.action === "delete" ? null : (result.page?.revision ?? null)) : revisionBefore;

  return {
    v: JOURNAL_VERSION,
    ts: now.toISOString(),
    tool: "mutate",
    action: input.action,
    slug: clamp(input.slug) ?? "",
    status,
    dryRun: result.dryRun,
    agent: clamp(agent),
    scope: scope ?? null,
    idempotencyKey: clamp(input.idempotencyKey),
    expectedRevision: clamp(input.expectedRevision),
    revisionBefore,
    revisionAfter,
    proposedRevision: status === "dry_run" && input.action !== "delete" ? (result.page?.revision ?? null) : null,
    errorCode: result.ok ? null : (result.error?.code ?? null),
    payload: payloadOf(input),
  };
}

// Appends from this process are queued per file so one write finishes before the next
// begins; O_APPEND makes each single-write line atomic against other processes too.
const appendQueues = new Map<string, Promise<unknown>>();

function parseCursor(since: string | undefined): number {
  if (since === undefined || since === "") {
    return 0;
  }
  if (!/^\d+$/.test(since) || !Number.isSafeInteger(Number(since))) {
    throw new JournalError(
      `since "${since}" is not a journal cursor. Pass the \`cursor\` from a previous read, or omit since to start from the beginning.`,
    );
  }
  return Number(since);
}

function parseLimit(limit: number | undefined): number {
  if (limit === undefined) {
    return JOURNAL_DEFAULT_LIMIT;
  }
  if (!Number.isInteger(limit) || limit < 1 || limit > JOURNAL_MAX_LIMIT) {
    throw new JournalError(`limit must be an integer between 1 and ${JOURNAL_MAX_LIMIT} (default ${JOURNAL_DEFAULT_LIMIT}).`);
  }
  return limit;
}

function isNotFound(error: unknown): boolean {
  return (error as NodeJS.ErrnoException | undefined)?.code === "ENOENT";
}

/**
 * Append-only JSON Lines journal in the data directory (`journal.jsonl`).
 *
 * A cursor is the byte offset just after the last line returned, so tailing is a
 * seek, not a scan. Only newline-terminated lines are returned: a line still being
 * written is picked up by the next read.
 */
export class FileJournal implements Journal {
  readonly file: string;

  constructor(dir: string) {
    this.file = path.join(path.resolve(dir), JOURNAL_FILE);
  }

  async append(entry: JournalEntry): Promise<void> {
    const line = `${JSON.stringify(entry)}\n`;
    const previous = appendQueues.get(this.file) ?? Promise.resolve();
    const run = previous.then(
      () => this.write(line),
      () => this.write(line),
    );
    const tail = run.catch(() => undefined);
    appendQueues.set(this.file, tail);
    try {
      await run;
    } finally {
      if (appendQueues.get(this.file) === tail) {
        appendQueues.delete(this.file);
      }
    }
  }

  private async write(line: string): Promise<void> {
    await mkdir(path.dirname(this.file), { recursive: true });
    await appendFile(this.file, line, { encoding: "utf8", flag: "a" });
  }

  async read(options: JournalReadOptions = {}): Promise<JournalPage> {
    const start = parseCursor(options.since);
    const limit = parseLimit(options.limit);

    let size: number;
    try {
      size = (await stat(this.file)).size;
    } catch (error) {
      if (isNotFound(error)) {
        if (start > 0) {
          throw this.pastEnd(start, 0);
        }
        return { entries: [], cursor: "0", skipped: 0 };
      }
      throw error;
    }
    if (start > size) {
      throw this.pastEnd(start, size);
    }

    const handle = await open(this.file, "r");
    try {
      if (start > 0) {
        const previous = Buffer.alloc(1);
        await handle.read(previous, 0, 1, start - 1);
        if (previous[0] !== 0x0a) {
          throw new JournalError(
            `since "${start}" does not start a journal line. Pass the \`cursor\` from a previous read unchanged.`,
          );
        }
      }

      const entries: JournalEntry[] = [];
      let skipped = 0;
      let consumed = start;
      let pending = Buffer.alloc(0);
      let position = start;
      const chunk = Buffer.alloc(READ_CHUNK_BYTES);

      while (entries.length < limit) {
        let newline = pending.indexOf(0x0a);
        while (newline === -1) {
          const { bytesRead } = await handle.read(chunk, 0, chunk.length, position);
          if (bytesRead === 0) {
            return { entries, cursor: String(consumed), skipped };
          }
          position += bytesRead;
          pending = Buffer.concat([pending, chunk.subarray(0, bytesRead)]);
          newline = pending.indexOf(0x0a);
        }

        const raw = pending.subarray(0, newline).toString("utf8");
        pending = pending.subarray(newline + 1);
        consumed += newline + 1;
        if (raw.trim() === "") {
          continue;
        }
        const entry = parseEntry(raw);
        if (entry) {
          entries.push(entry);
        } else {
          skipped += 1;
        }
      }
      return { entries, cursor: String(consumed), skipped };
    } finally {
      await handle.close();
    }
  }

  private pastEnd(start: number, size: number): JournalError {
    return new JournalError(
      `since "${start}" is past the end of ${this.file} (${size} bytes); the journal was truncated or replaced. Read again from the beginning by omitting since.`,
    );
  }
}

function parseEntry(raw: string): JournalEntry | undefined {
  try {
    const value: unknown = JSON.parse(raw);
    if (typeof value === "object" && value !== null && !Array.isArray(value) && (value as { v?: unknown }).v === JOURNAL_VERSION) {
      return value as JournalEntry;
    }
  } catch {
    // fall through: a torn or foreign line is counted as skipped, not returned
  }
  return undefined;
}
