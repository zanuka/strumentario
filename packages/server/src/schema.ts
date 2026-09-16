import { z } from "zod";

export const HANDBOOK_PAGE_SCHEMA_URI =
  "strumentario://schemas/handbook-page" as const;

export const handbookPageSchema = z
  .object({
    title: z
      .string()
      .trim()
      .min(1, "must be a non-empty string"),
    slug: z
      .string()
      .regex(
        /^[a-z0-9]+(?:-[a-z0-9]+)*$/,
        'must use lowercase letters, numbers, and hyphens (for example, "getting-started")',
      ),
    body: z
      .string()
      .trim()
      .min(1, "must be a non-empty string"),
  })
  .strict();

export type HandbookPage = z.infer<typeof handbookPageSchema>;

export const handbookPageJsonSchema = z.toJSONSchema(handbookPageSchema, {
  target: "draft-2020-12",
});
