import { z } from "zod";
import { buildResourceShape, defineDomain, type ResourceOf } from "./domain.js";

export const HANDBOOK_PAGE_SCHEMA_URI =
  "strumentario://schemas/handbook-page" as const;

export const JOURNAL_URI = "strumentario://journal" as const;

export const SLUG_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

/** The first (and currently only) domain. Everything else is generated from this. */
export const handbookDomain = defineDomain({
  name: "handbook-page",
  noun: "handbook page",
  slots: { one: "page", many: "pages" },
  keyField: "slug",
  resources: {
    schemaUri: HANDBOOK_PAGE_SCHEMA_URI,
    instanceTemplate: "strumentario://pages/{slug}",
    journalUri: JOURNAL_URI,
  },
  fields: [
    {
      name: "title",
      kind: "string",
      trim: true,
      minLength: 1,
      minLengthMessage: "must be a non-empty string",
    },
    {
      name: "slug",
      kind: "string",
      pattern: SLUG_PATTERN,
      patternMessage:
        'must use lowercase letters, numbers, and hyphens (for example, "getting-started")',
    },
    {
      name: "body",
      kind: "string",
      trim: true,
      minLength: 1,
      minLengthMessage: "must be a non-empty string",
    },
  ],
  primitives: ["query", "mutate", "validate", "scaffold", "repair"],
});

export const handbookPageSchema = z
  .object(buildResourceShape(handbookDomain))
  .strict();

export type HandbookPage = ResourceOf<typeof handbookDomain>;

export const handbookPageJsonSchema = z.toJSONSchema(handbookPageSchema, {
  target: "draft-2020-12",
});
