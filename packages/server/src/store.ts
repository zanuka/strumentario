import { createHash, randomUUID } from "node:crypto";
import { mkdir, readdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { handbookPageSchema, SLUG_PATTERN, type HandbookPage } from "./schema.js";

export const DATA_DIR_ENV = "STRUMENTARIO_DATA_DIR" as const;
export const DEFAULT_DATA_DIR = "./.strumentario/data" as const;

/** A handbook page plus the revision of the stored bytes it was read from. */
export interface StoredPage extends HandbookPage {
  revision: string;
}

/**
 * Storage seam for handbook pages. Implementations must never expose a
 * partially written page to readers, and must return a `revision` with every
 * page so writers can detect changes later.
 */
export interface PageStore {
  get(slug: string): Promise<StoredPage | undefined>;
  list(): Promise<StoredPage[]>;
  put(page: HandbookPage): Promise<StoredPage>;
  /** Removes a page. Resolves true when a page was deleted, false when none existed. */
  delete(slug: string): Promise<boolean>;
  /**
   * Runs `fn` while holding the writer lock for `slug`, so a read-check-write
   * sequence cannot interleave with another writer to the same slug.
   */
  withLock<T>(slug: string, fn: () => Promise<T>): Promise<T>;
  /** Looks up a recorded idempotent outcome; `undefined` when the key is unused. */
  getIdempotency(key: string): Promise<IdempotencyRecord | undefined>;
  /** Records an outcome for `key`. Never overwrites an existing record. */
  putIdempotency(key: string, record: IdempotencyRecord): Promise<void>;
}

/** The outcome of a write, kept so a replayed key returns it without writing again. */
export interface IdempotencyRecord {
  /** Fingerprint of the input that produced `result`. */
  fingerprint: string;
  result: Record<string, unknown>;
}

export class StoreError extends Error {
  override name = "StoreError";
}

export function revisionOf(content: string | Uint8Array): string {
  return createHash("sha256").update(content).digest("hex").slice(0, 16);
}

/** Exact bytes a page is stored as; its hash is the page revision. */
export function serializePage(page: HandbookPage): string {
  return `${JSON.stringify(page, null, 2)}\n`;
}

export function resolveDataDir(env: NodeJS.ProcessEnv = process.env): string {
  const configured = env[DATA_DIR_ENV]?.trim();
  return path.resolve(configured ? configured : DEFAULT_DATA_DIR);
}

// Writer locks are process-wide and keyed by file path: the HTTP transport builds
// a fresh server and store per request, so instance-level locks would not exclude.
const writerQueues = new Map<string, Promise<unknown>>();

function isNotFound(error: unknown): boolean {
  return (error as NodeJS.ErrnoException | undefined)?.code === "ENOENT";
}

/**
 * Keeps one JSON file per page (`<slug>.json`) in a directory.
 *
 * Writes go to a temp file and are renamed into place, so a concurrent reader
 * (in this or another process) sees either the old or the new file, never a
 * torn one. The revision is a hash of the exact file bytes.
 */
export class FileSystemPageStore implements PageStore {
  readonly dir: string;

  constructor(dir: string = resolveDataDir()) {
    this.dir = path.resolve(dir);
  }

  private fileFor(slug: string): string {
    return path.join(this.dir, `${slug}.json`);
  }

  async get(slug: string): Promise<StoredPage | undefined> {
    if (!SLUG_PATTERN.test(slug)) {
      return undefined;
    }

    let raw: string;
    try {
      raw = await readFile(this.fileFor(slug), "utf8");
    } catch (error) {
      if (isNotFound(error)) {
        return undefined;
      }
      throw error;
    }

    return this.parse(slug, raw);
  }

  async list(): Promise<StoredPage[]> {
    let entries: string[];
    try {
      entries = await readdir(this.dir);
    } catch (error) {
      if (isNotFound(error)) {
        return [];
      }
      throw error;
    }

    const slugs = entries
      .filter((name) => name.endsWith(".json"))
      .map((name) => name.slice(0, -".json".length))
      .filter((slug) => SLUG_PATTERN.test(slug))
      .sort();

    // A page deleted between readdir and read is simply absent from the list.
    const pages = await Promise.all(slugs.map((slug) => this.get(slug)));
    return pages.filter((page): page is StoredPage => page !== undefined);
  }

  async put(page: HandbookPage): Promise<StoredPage> {
    const parsed = handbookPageSchema.safeParse(page);
    if (!parsed.success) {
      throw new StoreError(
        `Cannot store page: ${parsed.error.issues
          .map((issue) => `${issue.path.join(".") || "instance"}: ${issue.message}`)
          .join("; ")}. Run the validate tool first.`,
      );
    }

    const value = parsed.data;
    const content = serializePage(value);
    const target = this.fileFor(value.slug);
    const temp = path.join(this.dir, `.${value.slug}.${randomUUID()}.tmp`);

    await mkdir(this.dir, { recursive: true });
    try {
      await writeFile(temp, content, "utf8");
      await rename(temp, target);
    } catch (error) {
      await rm(temp, { force: true });
      throw error;
    }

    return { ...value, revision: revisionOf(content) };
  }

  async delete(slug: string): Promise<boolean> {
    if (!SLUG_PATTERN.test(slug)) {
      return false;
    }
    try {
      await rm(this.fileFor(slug));
      return true;
    } catch (error) {
      if (isNotFound(error)) {
        return false;
      }
      throw error;
    }
  }

  async withLock<T>(slug: string, fn: () => Promise<T>): Promise<T> {
    const key = this.fileFor(slug);
    const previous = writerQueues.get(key) ?? Promise.resolve();
    const run = previous.then(fn, fn);
    const tail = run.catch(() => undefined);
    writerQueues.set(key, tail);
    try {
      return await run;
    } finally {
      if (writerQueues.get(key) === tail) {
        writerQueues.delete(key);
      }
    }
  }

  private idempotencyFile(key: string): string {
    return path.join(this.dir, ".idempotency", `${revisionOf(key)}.json`);
  }

  async getIdempotency(key: string): Promise<IdempotencyRecord | undefined> {
    try {
      const raw = await readFile(this.idempotencyFile(key), "utf8");
      const entry = JSON.parse(raw) as { key: string } & IdempotencyRecord;
      return entry.key === key ? { fingerprint: entry.fingerprint, result: entry.result } : undefined;
    } catch (error) {
      if (isNotFound(error)) {
        return undefined;
      }
      throw error;
    }
  }

  async putIdempotency(key: string, record: IdempotencyRecord): Promise<void> {
    const file = this.idempotencyFile(key);
    const temp = `${file}.${randomUUID()}.tmp`;
    await mkdir(path.dirname(file), { recursive: true });
    try {
      await writeFile(temp, JSON.stringify({ key, ...record }), "utf8");
      await rename(temp, file);
    } catch (error) {
      await rm(temp, { force: true });
      throw error;
    }
  }

  private parse(slug: string, raw: string): StoredPage {
    const file = this.fileFor(slug);
    let json: unknown;
    try {
      json = JSON.parse(raw);
    } catch {
      throw new StoreError(
        `Page file ${file} is not valid JSON. Fix or delete it, then retry.`,
      );
    }

    const parsed = handbookPageSchema.safeParse(json);
    if (!parsed.success || parsed.data.slug !== slug) {
      throw new StoreError(
        `Page file ${file} does not match the handbook page schema (slug must equal the file name). Fix it, then retry.`,
      );
    }

    return { ...parsed.data, revision: revisionOf(raw) };
  }
}
