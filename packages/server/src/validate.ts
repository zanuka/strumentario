import { handbookPageSchema } from "./schema.js";

export interface HandbookPageValidationResult extends Record<string, unknown> {
  valid: boolean;
  errors: string[];
}

/**
 * Validates an unknown draft against the handbook-page schema.
 *
 * This pure function is also used by the MCP tool so later surfaces and evals
 * can keep the same validation contract.
 */
export function validateHandbookPage(
  instance: unknown,
): HandbookPageValidationResult {
  const result = handbookPageSchema.safeParse(instance);

  if (result.success) {
    return { valid: true, errors: [] };
  }

  return {
    valid: false,
    errors: result.error.issues.map((issue) => {
      const path = issue.path.length === 0 ? "instance" : issue.path.join(".");
      return `${path}: ${issue.message}`;
    }),
  };
}
