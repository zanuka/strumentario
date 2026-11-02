import { createHash } from "node:crypto";
import { z } from "zod";
import { handbookPageSchema, SLUG_PATTERN } from "./schema.js";
import { revisionOf, serializePage, type PageStore, type StoredPage } from "./store.js";
import { validateHandbookPage } from "./validate.js";

export const mutateInputShape = {
  action: z
    .enum(["create", "update", "delete"])
    .describe("create adds a new page, update replaces an existing page, delete removes a page."),
  slug: z
    .string()
    .describe("Slug of the page to change. For create and update it must equal page.slug."),
  page: z
    .unknown()
    .optional()
    .describe("The full page ({ title, slug, body }) for create and update. Ignored for delete."),
  dryRun: z
    .boolean()
    .optional()
    .describe("Default true: report the intended change and write nothing. Pass false to write."),
  expectedRevision: z
    .string()
    .optional()
    .describe("Revision from query that this change is based on. Required for update and delete unless overwrite is true; a stale value returns a conflict."),
  overwrite: z
    .boolean()
    .optional()
    .describe("Allow create over an existing slug, or update/delete without expectedRevision. Default false."),
  idempotencyKey: z
    .string()
    .min(1)
    .max(200)
    .optional()
    .describe("Retry token. Replaying the same key with the same input returns the original result and writes nothing again."),
};

const pageShape = z.object({
  title: z.string(),
  slug: z.string(),
  body: z.string(),
  revision: z.string(),
});

export const mutateOutputShape = {
  ok: z.boolean(),
  action: z.enum(["create", "update", "delete"]),
  slug: z.string(),
  dryRun: z.boolean().describe("True when nothing was written."),
  replayed: z.boolean().optional().describe("True when this is the stored result of an earlier call with the same idempotencyKey."),
  page: pageShape.optional().describe("The page after the change (for a dry run, as it would be). Absent for delete."),
  previous: pageShape.optional().describe("The page before the change, when one existed."),
  error: z
    .object({
      code: z.enum([
        "invalid",
        "not_found",
        "already_exists",
        "revision_required",
        "conflict",
        "idempotency_mismatch",
        "store_error",
      ]),
      message: z.string(),
      errors: z.array(z.string()).optional().describe("Validation errors, identical to the validate tool."),
      currentRevision: z.string().optional(),
      currentPage: pageShape.optional().describe("Fresh state to retry from, set on conflict and already_exists."),
    })
    .optional(),
};

export interface MutateInput {
  action: "create" | "update" | "delete";
  slug: string;
  page?: unknown;
  dryRun?: boolean | undefined;
  expectedRevision?: string | undefined;
  overwrite?: boolean | undefined;
  idempotencyKey?: string | undefined;
}

type ErrorCode = NonNullable<MutateResult["error"]>["code"];

export interface MutateResult extends Record<string, unknown> {
  ok: boolean;
  action: MutateInput["action"];
  slug: string;
  dryRun: boolean;
  replayed?: boolean;
  page?: StoredPage;
  previous?: StoredPage;
  error?: {
    code:
      | "invalid"
      | "not_found"
      | "already_exists"
      | "revision_required"
      | "conflict"
      | "idempotency_mismatch"
      | "store_error";
    message: string;
    errors?: string[];
    currentRevision?: string;
    currentPage?: StoredPage;
  };
}

function fingerprintOf(input: MutateInput): string {
  const { idempotencyKey: _key, ...rest } = input;
  return createHash("sha256")
    .update(JSON.stringify({ ...rest, dryRun: rest.dryRun ?? true, overwrite: rest.overwrite ?? false }))
    .digest("hex");
}

/**
 * Create, update or delete a page. Never throws.
 *
 * Validation uses the same function as the validate tool. Writes happen only with
 * `dryRun: false`, under the slug's writer lock, with the revision checked inside
 * the lock so concurrent writers based on one revision cannot both succeed.
 */
export async function mutatePage(store: PageStore, input: MutateInput): Promise<MutateResult> {
  const dryRun = input.dryRun ?? true;
  const base = { action: input.action, slug: input.slug, dryRun };
  const fail = (
    code: ErrorCode,
    message: string,
    extra: Partial<NonNullable<MutateResult["error"]>> = {},
  ): MutateResult => ({ ok: false, ...base, error: { code, message, ...extra } });

  try {
    // Idempotency applies to real writes only; a dry run is already side-effect free.
    const key = dryRun ? undefined : input.idempotencyKey;
    const fingerprint = fingerprintOf(input);

    const run = async (): Promise<MutateResult> => {
      if (key !== undefined) {
        const recorded = await store.getIdempotency(key);
        if (recorded) {
          if (recorded.fingerprint !== fingerprint) {
            return fail(
              "idempotency_mismatch",
              `idempotencyKey "${key}" was already used with different input. Use a new key for a different change.`,
            );
          }
          return { ...(recorded.result as MutateResult), replayed: true };
        }
      }

      const result = await apply();
      if (key !== undefined && result.ok) {
        await store.putIdempotency(key, { fingerprint, result });
      }
      return result;
    };

    const apply = async (): Promise<MutateResult> => {
      let candidate: ReturnType<typeof handbookPageSchema.parse> | undefined;
      if (input.action !== "delete") {
        const validation = validateHandbookPage(input.page);
        if (!validation.valid) {
          return fail("invalid", `Page is invalid: ${validation.errors.join("; ")}. Fix these (see validate) and retry.`, {
            errors: validation.errors,
          });
        }
        candidate = handbookPageSchema.parse(input.page);
        if (candidate.slug !== input.slug) {
          return fail("invalid", `slug "${input.slug}" does not match page.slug "${candidate.slug}". Make them equal.`, {
            errors: [`page.slug: must equal "${input.slug}"`],
          });
        }
      } else if (!SLUG_PATTERN.test(input.slug)) {
        return fail("invalid", `slug "${input.slug}" is not a valid slug.`, {
          errors: [`slug: must use lowercase letters, numbers, and hyphens (for example, "getting-started")`],
        });
      }

      const current = await store.get(input.slug);
      const overwrite = input.overwrite ?? false;

      if (input.action === "create") {
        if (current && !overwrite) {
          return fail(
            "already_exists",
            `Page "${input.slug}" already exists. Use update with expectedRevision "${current.revision}", or pass overwrite: true.`,
            { currentRevision: current.revision, currentPage: current },
          );
        }
      } else {
        if (!current) {
          return fail("not_found", `No page with slug "${input.slug}" to ${input.action}. Use create, or check the slug with query.`);
        }
        if (input.expectedRevision === undefined && !overwrite) {
          return fail(
            "revision_required",
            `${input.action} needs expectedRevision (current: "${current.revision}"). Read the page with query and pass its revision, or pass overwrite: true.`,
            { currentRevision: current.revision, currentPage: current },
          );
        }
        if (input.expectedRevision !== undefined && input.expectedRevision !== current.revision) {
          return fail(
            "conflict",
            `Page "${input.slug}" changed: expected revision "${input.expectedRevision}" but current is "${current.revision}". Re-read currentPage and retry.`,
            { currentRevision: current.revision, currentPage: current },
          );
        }
      }

      if (input.action === "delete") {
        if (!dryRun) {
          await store.delete(input.slug);
        }
        return { ok: true, ...base, previous: current! };
      }

      const prospective = candidate!;
      if (dryRun) {
        const preview = { ...prospective, revision: revisionOf(serializePage(prospective)) };
        return { ok: true, ...base, page: preview, ...(current ? { previous: current } : {}) };
      }
      const written = await store.put(prospective);
      return { ok: true, ...base, page: written, ...(current ? { previous: current } : {}) };
    };

    // Dry runs read only; real writes (and their idempotency check) run under the slug lock.
    return dryRun ? await apply() : await store.withLock(input.slug, run);
  } catch (error) {
    return fail("store_error", error instanceof Error ? error.message : String(error));
  }
}
