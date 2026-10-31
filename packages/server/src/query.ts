import { z } from "zod";
import type { PageStore, StoredPage } from "./store.js";

export const QUERY_DEFAULT_LIMIT = 20;
export const QUERY_MAX_LIMIT = 100;

export const queryInputShape = {
  slug: z
    .string()
    .optional()
    .describe("Return the single page with this slug. When set, text and limit are ignored."),
  text: z
    .string()
    .optional()
    .describe("List only pages whose title, slug, or body contains this text (case-insensitive)."),
  limit: z
    .number()
    .int()
    .min(1)
    .max(QUERY_MAX_LIMIT)
    .optional()
    .describe(`Maximum pages to list (default ${QUERY_DEFAULT_LIMIT}, max ${QUERY_MAX_LIMIT}).`),
};

const storedPageShape = z.object({
  title: z.string(),
  slug: z.string(),
  body: z.string(),
  revision: z.string().describe("Content hash of the stored page; changes whenever the page changes."),
});

export const queryOutputShape = {
  ok: z.boolean(),
  page: storedPageShape.optional().describe("Set for a successful get-by-slug."),
  pages: z.array(storedPageShape).optional().describe("Set for a successful list."),
  total: z.number().int().optional().describe("Pages matching before limit was applied."),
  error: z
    .object({
      code: z.enum(["not_found", "store_error"]),
      message: z.string(),
      availableSlugs: z.array(z.string()),
    })
    .optional(),
};

export interface QueryInput {
  slug?: string | undefined;
  text?: string | undefined;
  limit?: number | undefined;
}

export interface QueryResult extends Record<string, unknown> {
  ok: boolean;
  page?: StoredPage;
  pages?: StoredPage[];
  total?: number;
  error?: { code: "not_found" | "store_error"; message: string; availableSlugs: string[] };
}

function formatAvailable(slugs: string[]): string {
  return slugs.length === 0
    ? "The store has no pages yet."
    : `Available slugs: ${slugs.join(", ")}.`;
}

/** Read-only get-by-slug / list over a page store. Never throws. */
export async function queryPages(
  store: PageStore,
  input: QueryInput,
): Promise<QueryResult> {
  try {
    if (input.slug !== undefined) {
      const page = await store.get(input.slug);
      if (page) {
        return { ok: true, page };
      }
      const availableSlugs = (await store.list()).map((entry) => entry.slug);
      return {
        ok: false,
        error: {
          code: "not_found",
          message: `No page with slug "${input.slug}". ${formatAvailable(availableSlugs)}`,
          availableSlugs,
        },
      };
    }

    const needle = input.text?.trim().toLowerCase();
    const all = await store.list();
    const matching = needle
      ? all.filter((page) =>
          [page.title, page.slug, page.body].some((field) =>
            field.toLowerCase().includes(needle),
          ),
        )
      : all;
    const limit = input.limit ?? QUERY_DEFAULT_LIMIT;

    return { ok: true, pages: matching.slice(0, limit), total: matching.length };
  } catch (error) {
    return {
      ok: false,
      error: {
        code: "store_error",
        message: error instanceof Error ? error.message : String(error),
        availableSlugs: [],
      },
    };
  }
}
