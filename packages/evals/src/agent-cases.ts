import type { GoldenPage } from "./types.js";

/**
 * Agent tool-selection dataset (issue #16): one natural-language prompt, the tool a model should
 * pick and the argument shape it should send. Plain data, like golden.ts.
 *
 * `expected.input` is matched as a *subset* of what the model sent (see matchSubset in match.ts):
 * listed keys must match, extra keys are fine, `{ $present: true }` accepts any value and
 * `{ $contains: "text" }` accepts a string containing it. Prompts state their literal values
 * (slugs, revisions, URLs) so the expected arguments are not a guess.
 */
export type AgentCategory = "query" | "validate" | "mutate" | "scaffold";

export interface AgentCase {
  id: string;
  /** The tool that must be chosen; also the bucket accuracy is reported under. */
  category: AgentCategory;
  /** What near miss this case protects, so a failure points at the description to read. */
  intent: string;
  prompt: string;
  /** Pages in the store when the chosen call is executed. */
  seed?: GoldenPage[];
  expected: { tool: AgentCategory; input: Record<string, unknown> };
}

export const agentCases: readonly AgentCase[] = [
  // --- query ---
  {
    id: "query-list-by-text",
    category: "query",
    intent: "A topic search is a read: query with text, not validate or mutate.",
    prompt: "Which pages do we have that mention onboarding?",
    expected: { tool: "query", input: { text: { $present: true } } },
  },
  {
    id: "query-get-by-slug",
    category: "query",
    intent: "Fetching one page by slug is query with slug.",
    prompt: "Show me the page with slug \"intro\".",
    seed: [{ title: "Intro", slug: "intro", body: "Welcome." }],
    expected: { tool: "query", input: { slug: "intro" } },
  },
  {
    id: "query-list-with-limit",
    category: "query",
    intent: "A bounded listing uses query's limit argument.",
    prompt: "List the first 5 pages in the store.",
    expected: { tool: "query", input: { limit: 5 } },
  },
  {
    id: "query-stored-page-check-is-not-validate",
    category: "query",
    intent: "Near miss: validate checks a draft you supply; looking at a page already stored is query.",
    prompt: "Pull up the stored page \"handbook\" so I can see what is in it.",
    seed: [{ title: "Handbook", slug: "handbook", body: "Rules." }],
    expected: { tool: "query", input: { slug: "handbook" } },
  },
  {
    id: "query-count-is-a-read",
    category: "query",
    intent: "Near miss: a question about existing content is a read, never a mutate dry run.",
    prompt: "Find every page that talks about billing.",
    expected: { tool: "query", input: { text: { $present: true } } },
  },

  // --- validate ---
  {
    id: "validate-draft-before-saving",
    category: "validate",
    intent: "Near miss: checking a draft without storing it is validate, not a mutate dry run.",
    prompt: "Before I save anything, check whether this draft is valid: title \"Hello\", slug \"hello\", body \"Hi there\".",
    expected: { tool: "validate", input: { instance: { slug: "hello" } } },
  },
  {
    id: "validate-bad-draft",
    category: "validate",
    intent: "A draft with obvious problems still goes to validate to get the error list.",
    prompt: "Is this page draft valid? { \"title\": \"\", \"slug\": \"Bad Slug!\", \"body\": \"x\" }",
    expected: { tool: "validate", input: { instance: { slug: "Bad Slug!" } } },
  },
  {
    id: "validate-only-no-store",
    category: "validate",
    intent: "Near miss: \"just validate, don't touch the store\" points at validate even though the draft is a would-be create.",
    prompt: "Just validate a new page for me, no saving: title \"Roadmap\", slug \"roadmap\", body \"Q1 goals\".",
    expected: { tool: "validate", input: { instance: { slug: "roadmap" } } },
  },

  // --- mutate: dry run versus write ---
  {
    id: "mutate-create-dry-run",
    category: "mutate",
    intent: "Dry run versus write: a preview request sends mutate with dryRun true and writes nothing.",
    prompt: "Do a dry run of creating a page titled \"Roadmap\" with slug \"roadmap\" and body \"Q1 goals\". Do not save it.",
    expected: { tool: "mutate", input: { action: "create", slug: "roadmap", dryRun: true } },
  },
  {
    id: "mutate-create-write",
    category: "mutate",
    intent: "Dry run versus write: an explicit save must pass dryRun false, otherwise nothing is written.",
    prompt: "Create a page titled \"Roadmap\" with slug \"roadmap\" and body \"Q1 goals\" and actually save it to the store.",
    expected: { tool: "mutate", input: { action: "create", slug: "roadmap", dryRun: false } },
  },
  {
    id: "mutate-update-with-revision",
    category: "mutate",
    intent: "Update carries expectedRevision from the earlier query and writes with dryRun false.",
    prompt: "Update the page \"intro\" to have the body \"New welcome\" and save it. I already looked it up: its current revision is \"rev-1\".",
    seed: [{ title: "Intro", slug: "intro", body: "Welcome." }],
    expected: { tool: "mutate", input: { action: "update", slug: "intro", expectedRevision: "rev-1", dryRun: false } },
  },
  {
    id: "mutate-delete-write",
    category: "mutate",
    intent: "Deleting for real needs the revision and dryRun false.",
    prompt: "Delete the page \"old-notes\" for real, no preview. Its current revision is \"rev-9\".",
    seed: [{ title: "Old notes", slug: "old-notes", body: "Stale." }],
    expected: { tool: "mutate", input: { action: "delete", slug: "old-notes", expectedRevision: "rev-9", dryRun: false } },
  },
  {
    id: "mutate-idempotent-retry",
    category: "mutate",
    intent: "A retry-safe write passes idempotencyKey.",
    prompt: "Save a new page titled \"Retry\" with slug \"retry\" and body \"Hi\". This call may be retried, so use the idempotency key \"job-7\".",
    expected: { tool: "mutate", input: { action: "create", slug: "retry", idempotencyKey: "job-7", dryRun: false } },
  },
  {
    id: "mutate-page-about-scaffold-is-still-mutate",
    category: "mutate",
    intent: "Near miss: a page whose subject is the generated client is still content, so mutate, not scaffold.",
    prompt: "Add a page titled \"API client notes\" with slug \"api-client-notes\" and body \"The typed client lives in clients/\" to the store and save it.",
    expected: { tool: "mutate", input: { action: "create", slug: "api-client-notes", dryRun: false } },
  },

  // --- scaffold ---
  {
    id: "scaffold-client",
    category: "scaffold",
    intent: "Generating code from the schema is scaffold target client, not mutate.",
    prompt: "Generate a typed TypeScript client for the pages API.",
    expected: { tool: "scaffold", input: { target: "client" } },
  },
  {
    id: "scaffold-host-config-url",
    category: "scaffold",
    intent: "Host config for a given endpoint is scaffold target host-config with url.",
    prompt: "Give me the Cursor and Claude Code MCP config for the server at http://localhost:4000/mcp.",
    expected: { tool: "scaffold", input: { target: "host-config", url: "http://localhost:4000/mcp" } },
  },
  {
    id: "scaffold-write-files",
    category: "scaffold",
    intent: "Writing generated files needs write true and outDir; scaffold never touches pages.",
    prompt: "Write the MCP host config files into the directory \"config/mcp\" on disk.",
    expected: { tool: "scaffold", input: { target: "host-config", write: true, outDir: { $contains: "config/mcp" } } },
  },
  {
    id: "scaffold-host-config-auth",
    category: "scaffold",
    intent: "The auth flag belongs to scaffold host-config; it is not a store change.",
    prompt: "Show me the host config entries, with a bearer Authorization header. Don't write any files.",
    expected: { tool: "scaffold", input: { target: "host-config", auth: true } },
  },
];
