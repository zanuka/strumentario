import {
  getToolDefinition,
  QUERY_DEFAULT_LIMIT,
  QUERY_MAX_LIMIT,
} from "./contracts.js";
import type { PageStore, StoredPage } from "./store.js";

export { QUERY_DEFAULT_LIMIT, QUERY_MAX_LIMIT };

// Generated from the domain definition (contracts.ts); never hand-edit the shapes.
export const queryInputShape = getToolDefinition("query").inputShape;
export const queryOutputShape = getToolDefinition("query").outputShape;

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
