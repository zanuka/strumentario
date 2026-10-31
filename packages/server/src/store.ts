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
}

export class StoreError extends Error {
  override name = "StoreError";
}

export function revisionOf(content: string | Uint8Array): string {
  return createHash("sha256").update(content).digest("hex").slice(0, 16);
}

export function resolveDataDir(env: NodeJS.ProcessEnv = process.env): string {
  const configured = env[DATA_DIR_ENV]?.trim();
  return path.resolve(configured ? configured : DEFAULT_DATA_DIR);
}

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
    const content = `${JSON.stringify(value, null, 2)}\n`;
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
