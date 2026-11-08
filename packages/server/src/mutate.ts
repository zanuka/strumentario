import { createHash } from "node:crypto";
import { getToolDefinition } from "./contracts.js";
import { journalEntryFor, type Journal } from "./journal.js";
import { handbookPageSchema, SLUG_PATTERN } from "./schema.js";
import { revisionOf, serializePage, type PageStore, type StoredPage } from "./store.js";
import { validateHandbookPage } from "./validate.js";

// Generated from the domain definition (contracts.ts); never hand-edit the shapes.
export const mutateInputShape = getToolDefinition("mutate").inputShape;
export const mutateOutputShape = getToolDefinition("mutate").outputShape;

export interface MutateInput {
  action: "create" | "update" | "delete";
  slug: string;
  page?: unknown;
  dryRun?: boolean | undefined;
  expectedRevision?: string | undefined;
  overwrite?: boolean | undefined;
  idempotencyKey?: string | undefined;
}

export interface MutateOptions {
  /** Where to record this call's outcome (applied, dry run, replay, conflict or rejection). */
  journal?: Journal | undefined;
  /** Agent identity to attribute the call to in the journal. */
  agent?: string | undefined;
  /** Called when the journal cannot be written; the mutation outcome is still returned. Defaults to stderr. */
  onJournalError?: (error: unknown) => void;
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
 *
 * With `options.journal`, every outcome is appended to the journal (under the same
 * lock for real writes, so entries follow the order changes were applied). A journal
 * failure is reported through `onJournalError` and never changes the returned result.
 */
export async function mutatePage(
  store: PageStore,
  input: MutateInput,
  options: MutateOptions = {},
): Promise<MutateResult> {
  const dryRun = input.dryRun ?? true;
  const base = { action: input.action, slug: input.slug, dryRun };
  const fail = (
    code: ErrorCode,
    message: string,
    extra: Partial<NonNullable<MutateResult["error"]>> = {},
  ): MutateResult => ({ ok: false, ...base, error: { code, message, ...extra } });

  const record = async (result: MutateResult): Promise<MutateResult> => {
    if (options.journal) {
      try {
        await options.journal.append(journalEntryFor(input, result, options.agent));
      } catch (error) {
        (options.onJournalError ?? defaultJournalError)(error);
      }
    }
    return result;
  };

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
    return dryRun ? await record(await apply()) : await store.withLock(input.slug, async () => record(await run()));
  } catch (error) {
    return record(fail("store_error", error instanceof Error ? error.message : String(error)));
  }
}

function defaultJournalError(error: unknown): void {
  console.error(
    `Strumentario could not write the change journal: ${error instanceof Error ? error.message : String(error)}. The change itself was not affected; fix the data directory permissions or free disk space, then retry.`,
  );
}
