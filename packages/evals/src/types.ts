import type { ContentPrimitiveName } from "@strumentario/server";

/**
 * Golden case data. Everything here is plain, serializable data (no functions),
 * so the same dataset can later be uploaded to Braintrust unchanged (issue #9).
 *
 * Matching rules for `match` values (see matchSubset in match.ts):
 * - objects match when every listed key matches (extra keys in the output are fine)
 * - arrays must have equal length and match element by element
 * - `{ "$contains": "text" }` matches a string that includes "text"
 * - `{ "$absent": true }` matches a missing key
 * - `{ "$present": true }` matches any non-null value (for example a revision hash)
 * - anything else must be deeply equal
 *
 * Placeholders in tool inputs: the string "$revision:<slug>" is replaced with the
 * current stored revision of that page when the step runs.
 */

export type GoldenCategory = "query" | "mutate" | "validate" | "concurrency" | "cli";

export interface GoldenPage {
  title: string;
  slug: string;
  body: string;
}

export interface ToolCallSpec {
  tool: ContentPrimitiveName;
  input: Record<string, unknown>;
}

/** Expected result of one call. */
export interface CallExpectation {
  /** The MCP result's `isError` flag (a protocol-level input rejection also counts as an error). */
  isError: boolean;
  /** Subset-matched against the structured output. */
  match?: unknown;
  /** For rejections that carry no structured output: text the error message must include. */
  errorIncludes?: string;
}

/** Expected outcome of several calls started at the same moment (order is not asserted). */
export interface ParallelExpectation {
  /** How many calls must succeed. */
  ok: number;
  /** Sorted error codes the failing calls must report, e.g. ["conflict"]. */
  errorCodes?: string[];
  /** How many successful calls must be flagged `replayed: true`. */
  replayed?: number;
}

export type GoldenStep =
  | { call: ToolCallSpec; expect: CallExpectation }
  | { parallel: ToolCallSpec[]; expect: ParallelExpectation };

/** Checked against the store after all steps ran. */
export interface StoreCheck {
  slug: string;
  exists: boolean;
  /** When the page must exist, its exact stored contents. */
  page?: GoldenPage;
}

interface GoldenCaseBase {
  id: string;
  category: GoldenCategory;
  /** One sentence: what behaviour this case protects and why it matters to agents. */
  intent: string;
  /** Pages written to the store before the case runs. */
  seed?: GoldenPage[];
  after?: StoreCheck[];
}

/** Calls tools through an in-process MCP client connected to createMcpServer(). */
export interface ToolGoldenCase extends GoldenCaseBase {
  kind: "tool";
  steps: GoldenStep[];
}

/** Runs the real `strumentario` CLI against a Streamable HTTP server on a temp store. */
export interface CliGoldenCase extends GoldenCaseBase {
  kind: "cli";
  /** Arguments after the binary name; the harness appends `--url`. */
  args: string[];
  expect: {
    exitCode: number;
    /** Subset-matched against stdout parsed as JSON (use with --json). */
    stdoutJson?: unknown;
    stderrIncludes?: string;
  };
}

export type GoldenCase = ToolGoldenCase | CliGoldenCase;

export interface CaseResult {
  id: string;
  category: GoldenCategory;
  passed: boolean;
  /** Empty when the case passed; otherwise one actionable line per failed check. */
  failures: string[];
  durationMs: number;
}

export interface SuiteResult {
  passed: boolean;
  total: number;
  failed: number;
  results: CaseResult[];
}
