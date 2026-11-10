import type { GoldenCase, GoldenPage } from "./types.js";

const intro: GoldenPage = { title: "Intro", slug: "intro", body: "Welcome to the handbook." };
const onboarding: GoldenPage = { title: "Onboarding", slug: "onboarding", body: "First week checklist." };
const fresh: GoldenPage = { title: "Fresh page", slug: "fresh-page", body: "Brand new content." };

/**
 * The golden dataset: one entry per behaviour agents rely on. Add a case whenever a
 * tool's behaviour changes (see packages/evals/README.md).
 */
export const goldenCases: readonly GoldenCase[] = [
  // --- query -----------------------------------------------------------------
  {
    id: "query-list-all",
    kind: "tool",
    category: "query",
    intent: "Listing with no arguments returns every stored page and the total, so agents can discover content.",
    seed: [intro, onboarding],
    steps: [
      {
        call: { tool: "query", input: {} },
        expect: { isError: false, match: { ok: true, total: 2, pages: [{ slug: "intro" }, { slug: "onboarding" }] } },
      },
    ],
  },
  {
    id: "query-get-by-slug",
    kind: "tool",
    category: "query",
    intent: "Get-by-slug returns the page with its revision, the value an agent needs for a later update.",
    seed: [intro],
    steps: [
      {
        call: { tool: "query", input: { slug: "intro" } },
        expect: { isError: false, match: { ok: true, page: { ...intro, revision: { $present: true } } } },
      },
    ],
  },
  {
    id: "query-text-filter",
    kind: "tool",
    category: "query",
    intent: "A text query filters by title, slug and body, so agents can find pages without knowing slugs.",
    seed: [intro, onboarding],
    steps: [
      {
        call: { tool: "query", input: { text: "checklist" } },
        expect: { isError: false, match: { ok: true, total: 1, pages: [{ slug: "onboarding" }] } },
      },
    ],
  },
  {
    id: "query-unknown-slug",
    kind: "tool",
    category: "query",
    intent: "An unknown slug is a not_found error that lists the available slugs, so the agent can self-correct.",
    seed: [intro],
    steps: [
      {
        call: { tool: "query", input: { slug: "nope" } },
        expect: {
          isError: true,
          match: { ok: false, error: { code: "not_found", availableSlugs: ["intro"] } },
        },
      },
    ],
  },
  {
    id: "query-limit-out-of-range",
    kind: "tool",
    category: "query",
    intent: "A limit outside the documented range is rejected at the schema boundary instead of being silently clamped.",
    seed: [intro],
    steps: [
      {
        call: { tool: "query", input: { limit: 0 } },
        expect: { isError: true },
      },
    ],
  },

  // --- validate ----------------------------------------------------------------
  {
    id: "validate-happy-path",
    kind: "tool",
    category: "validate",
    intent: "A well-formed draft validates with no errors.",
    steps: [
      {
        call: { tool: "validate", input: { instance: fresh } },
        expect: { isError: false, match: { valid: true, errors: [] } },
      },
    ],
  },
  {
    id: "validate-bad-slug",
    kind: "tool",
    category: "validate",
    intent: "A slug that is not lowercase-hyphenated is reported with an actionable example.",
    steps: [
      {
        call: { tool: "validate", input: { instance: { ...fresh, slug: "Bad Slug!" } } },
        expect: {
          isError: false,
          match: { valid: false, errors: [{ $contains: "slug: must use lowercase letters, numbers, and hyphens" }] },
        },
      },
    ],
  },
  {
    id: "validate-empty-body",
    kind: "tool",
    category: "validate",
    intent: "A blank body (whitespace only) is invalid, so empty pages never reach the store.",
    steps: [
      {
        call: { tool: "validate", input: { instance: { ...fresh, body: "   " } } },
        expect: { isError: false, match: { valid: false, errors: ["body: must be a non-empty string"] } },
      },
    ],
  },
  {
    id: "validate-extra-field",
    kind: "tool",
    category: "validate",
    intent: "Unknown fields are rejected (strict schema), so drafts cannot smuggle data the store does not model.",
    steps: [
      {
        call: { tool: "validate", input: { instance: { ...fresh, tags: ["x"] } } },
        expect: { isError: false, match: { valid: false, errors: [{ $contains: "tags" }] } },
      },
    ],
  },
  {
    id: "validate-missing-args",
    kind: "tool",
    category: "validate",
    intent: "Calling validate without its required instance fails loudly instead of reporting a vacuous success.",
    steps: [{ call: { tool: "validate", input: {} }, expect: { isError: true } }],
  },

  // --- mutate ------------------------------------------------------------------
  {
    id: "mutate-create-writes",
    kind: "tool",
    category: "mutate",
    intent: "create with dryRun:false stores the page and returns its revision.",
    steps: [
      {
        call: { tool: "mutate", input: { action: "create", slug: "fresh-page", page: fresh, dryRun: false } },
        expect: { isError: false, match: { ok: true, dryRun: false, page: { ...fresh, revision: { $present: true } } } },
      },
    ],
    after: [{ slug: "fresh-page", exists: true, page: fresh }],
  },
  {
    id: "mutate-dry-run-default-writes-nothing",
    kind: "tool",
    category: "mutate",
    intent: "Mutations are dry runs unless dryRun:false is explicit: the preview succeeds and nothing is written.",
    steps: [
      {
        call: { tool: "mutate", input: { action: "create", slug: "fresh-page", page: fresh } },
        expect: { isError: false, match: { ok: true, dryRun: true, page: fresh } },
      },
    ],
    after: [{ slug: "fresh-page", exists: false }],
  },
  {
    id: "mutate-invalid-payload-writes-nothing",
    kind: "tool",
    category: "mutate",
    intent: "An invalid page (empty body) is refused with the validation errors, and the store stays untouched.",
    steps: [
      {
        call: {
          tool: "mutate",
          input: { action: "create", slug: "fresh-page", page: { ...fresh, body: "" }, dryRun: false },
        },
        expect: {
          isError: true,
          match: { ok: false, error: { code: "invalid", errors: ["body: must be a non-empty string"] } },
        },
      },
    ],
    after: [{ slug: "fresh-page", exists: false }],
  },
  {
    id: "mutate-update-unknown-slug",
    kind: "tool",
    category: "mutate",
    intent: "Updating a page that does not exist is not_found (never an implicit create), with guidance to use create.",
    steps: [
      {
        call: {
          tool: "mutate",
          input: { action: "update", slug: "fresh-page", page: fresh, expectedRevision: "abc", dryRun: false },
        },
        expect: { isError: true, match: { ok: false, error: { code: "not_found" } } },
      },
    ],
    after: [{ slug: "fresh-page", exists: false }],
  },
  {
    id: "mutate-update-requires-revision",
    kind: "tool",
    category: "mutate",
    intent: "An update without expectedRevision is refused and returns the current revision, so blind overwrites cannot happen.",
    seed: [intro],
    steps: [
      {
        call: {
          tool: "mutate",
          input: { action: "update", slug: "intro", page: { ...intro, body: "Changed." }, dryRun: false },
        },
        expect: { isError: true, match: { ok: false, error: { code: "revision_required" } } },
      },
    ],
    after: [{ slug: "intro", exists: true, page: intro }],
  },
  {
    id: "mutate-missing-args",
    kind: "tool",
    category: "mutate",
    intent: "Calling mutate without its required slug fails at the schema boundary.",
    steps: [{ call: { tool: "mutate", input: { action: "create" } }, expect: { isError: true } }],
    after: [{ slug: "fresh-page", exists: false }],
  },

  // --- concurrency -------------------------------------------------------------
  {
    id: "concurrent-updates-same-revision",
    kind: "tool",
    category: "concurrency",
    intent: "Two agents updating from the same expectedRevision at once: exactly one wins and the other gets a conflict.",
    seed: [intro],
    steps: [
      {
        parallel: [
          {
            tool: "mutate",
            input: {
              action: "update",
              slug: "intro",
              page: { ...intro, body: "Agent A edit." },
              expectedRevision: "$revision:intro",
              dryRun: false,
            },
          },
          {
            tool: "mutate",
            input: {
              action: "update",
              slug: "intro",
              page: { ...intro, body: "Agent B edit." },
              expectedRevision: "$revision:intro",
              dryRun: false,
            },
          },
        ],
        expect: { ok: 1, errorCodes: ["conflict"] },
      },
    ],
    after: [{ slug: "intro", exists: true }],
  },
  {
    id: "concurrent-replayed-idempotency-key",
    kind: "tool",
    category: "concurrency",
    intent: "A retry that races its original (same idempotencyKey) writes once: both calls succeed and one is flagged replayed.",
    steps: [
      {
        parallel: [
          {
            tool: "mutate",
            input: { action: "create", slug: "fresh-page", page: fresh, dryRun: false, idempotencyKey: "retry-1" },
          },
          {
            tool: "mutate",
            input: { action: "create", slug: "fresh-page", page: fresh, dryRun: false, idempotencyKey: "retry-1" },
          },
        ],
        expect: { ok: 2, replayed: 1 },
      },
    ],
    after: [{ slug: "fresh-page", exists: true, page: fresh }],
  },
  {
    id: "idempotency-key-reused-for-different-input",
    kind: "tool",
    category: "concurrency",
    intent: "Reusing an idempotencyKey for a different change is refused rather than replaying the wrong result.",
    steps: [
      {
        call: {
          tool: "mutate",
          input: { action: "create", slug: "fresh-page", page: fresh, dryRun: false, idempotencyKey: "k-1" },
        },
        expect: { isError: false, match: { ok: true } },
      },
      {
        call: {
          tool: "mutate",
          input: {
            action: "create",
            slug: "other-page",
            page: { title: "Other", slug: "other-page", body: "Different." },
            dryRun: false,
            idempotencyKey: "k-1",
          },
        },
        expect: { isError: true, match: { ok: false, error: { code: "idempotency_mismatch" } } },
      },
    ],
    after: [
      { slug: "fresh-page", exists: true },
      { slug: "other-page", exists: false },
    ],
  },

  // --- scaffold ----------------------------------------------------------------
  {
    id: "scaffold-client-returns-files",
    kind: "tool",
    category: "scaffold",
    intent: "scaffold target client returns the typed client module in memory and writes nothing, so agents can generate code from the schema.",
    steps: [
      {
        call: { tool: "scaffold", input: { target: "client" } },
        expect: {
          isError: false,
          match: {
            ok: true,
            target: "client",
            written: false,
            files: [{ path: "strumentario-client.ts", content: { $contains: "export function createStrumentarioClient" } }],
          },
        },
      },
    ],
  },
  {
    id: "scaffold-host-config-lists-tools",
    kind: "tool",
    category: "scaffold",
    intent: "scaffold target host-config emits Cursor, Claude Code and generic entries whose tool list names every real tool, so host config never drifts.",
    steps: [
      {
        call: { tool: "scaffold", input: { target: "host-config", url: "https://strumentario.example/mcp" } },
        expect: {
          isError: false,
          match: {
            ok: true,
            written: false,
            files: [
              { path: ".cursor/mcp.json", content: { $contains: "https://strumentario.example/mcp" } },
              { path: ".mcp.json", content: { $contains: '"type": "http"' } },
              {
                path: "strumentario.mcp.json",
                content: { $contains: '"name": "scaffold"' },
              },
            ],
          },
        },
      },
    ],
  },
  {
    id: "scaffold-leaves-pages-alone",
    kind: "tool",
    category: "scaffold",
    intent: "scaffold is not mutate: even with an outDir it creates no pages and changes none, and without write: true it writes no files.",
    seed: [intro],
    steps: [
      {
        call: { tool: "scaffold", input: { target: "client", outDir: "generated" } },
        expect: { isError: false, match: { ok: true, written: false } },
      },
      {
        call: { tool: "query", input: {} },
        expect: { isError: false, match: { ok: true, total: 1, pages: [{ slug: "intro" }] } },
      },
    ],
    after: [{ slug: "intro", exists: true, page: intro }],
  },
  {
    id: "scaffold-write-needs-outdir",
    kind: "tool",
    category: "scaffold",
    intent: "write: true without outDir is refused with an actionable error instead of writing somewhere implicit.",
    steps: [
      {
        call: { tool: "scaffold", input: { target: "client", write: true } },
        expect: {
          isError: true,
          match: { ok: false, written: false, error: { code: "invalid", message: { $contains: "outDir" } } },
        },
      },
    ],
  },

  // --- repair ------------------------------------------------------------------
  {
    id: "repair-converges-broken-client",
    kind: "tool",
    category: "repair",
    intent: "A scaffolded client with a tsc error is regenerated and converges in one round; the result reports the rounds used and the error count before and after.",
    convergeWithin: 3,
    steps: [
      {
        call: { tool: "repair", input: { files: [{ path: "strumentario-client.ts", content: "export interface PageDraft {\n  slug: Missing;\n}\n" }] } },
        expect: {
          isError: false,
          match: {
            ok: true,
            converged: true,
            stopReason: "converged",
            maxRounds: 3,
            roundsUsed: 1,
            errorCounts: [1, 0],
            rounds: [{ round: 1, errorsBefore: 1, errorsAfter: 0, changedFiles: ["strumentario-client.ts"], kept: true, usedModel: false }],
            remainingErrors: [],
            files: [{ path: "strumentario-client.ts", content: { $contains: "export function createStrumentarioClient" } }],
          },
        },
      },
    ],
  },
  {
    id: "repair-converges-broken-host-config",
    kind: "tool",
    category: "repair",
    intent: "A host config that fails schema validation is regenerated, keeping its URL, so a broken config file is not a dead end for an agent.",
    convergeWithin: 3,
    steps: [
      {
        call: {
          tool: "repair",
          input: { files: [{ path: ".mcp.json", content: '{"mcpServers":{"strumentario":{"type":"http","url":"https://strumentario.example/mcp","headers":[]}}}' }], maxRounds: 2 },
        },
        expect: {
          isError: false,
          match: {
            ok: true,
            converged: true,
            maxRounds: 2,
            roundsUsed: 1,
            errorCounts: [1, 0],
            files: [{ path: ".mcp.json", content: { $contains: "https://strumentario.example/mcp" } }],
          },
        },
      },
    ],
  },
  {
    id: "repair-stops-when-errors-do-not-shrink",
    kind: "tool",
    category: "repair",
    intent: "A failing file the generator did not produce cannot be fixed by the template path: the loop stops after one round instead of spinning, keeps the input and returns the remaining errors.",
    steps: [
      {
        call: { tool: "repair", input: { files: [{ path: "mine.ts", content: "export const x: Missing = 1;\n" }] } },
        expect: {
          isError: false,
          match: {
            ok: true,
            converged: false,
            stopReason: "no_progress",
            roundsUsed: 1,
            errorCounts: [1],
            rounds: [{ round: 1, errorsBefore: 1, errorsAfter: 1, changedFiles: [], kept: false }],
            remainingErrors: [{ path: "mine.ts", source: "tsc", code: "TS2304" }],
            files: [{ path: "mine.ts", content: "export const x: Missing = 1;\n" }],
          },
        },
      },
    ],
  },
  {
    id: "repair-passing-files-use-no-rounds",
    kind: "tool",
    category: "repair",
    intent: "Files that already pass come back unchanged with zero rounds, so calling repair on good output is safe.",
    convergeWithin: 0,
    steps: [
      {
        call: { tool: "repair", input: { files: [{ path: "notes.json", content: "{}" }] } },
        expect: { isError: false, match: { ok: true, converged: true, roundsUsed: 0, errorCounts: [0], rounds: [], files: [{ path: "notes.json", content: "{}" }] } },
      },
    ],
  },
  {
    id: "repair-leaves-pages-alone",
    kind: "tool",
    category: "repair",
    intent: "repair is not mutate: it never reads or changes pages, so the store is exactly as it was after a repair.",
    seed: [intro],
    steps: [
      {
        call: { tool: "repair", input: { files: [{ path: "mine.ts", content: "export const x = 1;\n" }] } },
        expect: { isError: false, match: { ok: true, converged: true } },
      },
    ],
    after: [{ slug: "intro", exists: true, page: intro }],
  },
  {
    id: "repair-rejects-an-unsafe-path",
    kind: "tool",
    category: "repair",
    intent: "A path that escapes the output directory is refused with an actionable error instead of being checked.",
    steps: [
      {
        call: { tool: "repair", input: { files: [{ path: "../escape.ts", content: "export {};\n" }] } },
        expect: { isError: true, match: { ok: false, converged: false, error: { code: "invalid", message: { $contains: "inside the output directory" } } } },
      },
    ],
  },

  // --- cli ---------------------------------------------------------------------
  {
    id: "cli-call-validate-json",
    kind: "cli",
    category: "cli",
    intent: "`strumentario call validate --json` exits 0 and prints only the tool result as JSON on stdout.",
    args: ["call", "validate", "--json", "--input", JSON.stringify({ instance: fresh })],
    expect: { exitCode: 0, stdoutJson: { valid: true, errors: [] } },
  },
  {
    id: "cli-call-query-unknown-slug",
    kind: "cli",
    category: "cli",
    intent: "A tool error maps to exit code 1 while --json still carries the structured error for scripts.",
    seed: [intro],
    args: ["call", "query", "--json", "--input", JSON.stringify({ slug: "nope" })],
    expect: {
      exitCode: 1,
      stdoutJson: { ok: false, error: { code: "not_found", availableSlugs: ["intro"] } },
      stderrIncludes: "reported an error",
    },
  },
  {
    id: "cli-call-scaffold-json",
    kind: "cli",
    category: "cli",
    intent: "`strumentario call scaffold --json` returns the generated files on stdout; it is the only CLI path to scaffold.",
    args: ["call", "scaffold", "--json", "--input", JSON.stringify({ target: "host-config" })],
    expect: {
      exitCode: 0,
      stdoutJson: { ok: true, written: false, files: [{ path: ".cursor/mcp.json" }, { path: ".mcp.json" }, { path: "strumentario.mcp.json" }] },
    },
  },
  {
    id: "cli-call-scaffold-dry-run-never-writes",
    kind: "cli",
    category: "cli",
    intent: "--dry-run forces write off for scaffold, so a dry run reports the files and writes none.",
    args: ["call", "scaffold", "--json", "--dry-run", "--input", JSON.stringify({ target: "client", write: true, outDir: "never-written" })],
    expect: { exitCode: 0, stdoutJson: { ok: true, written: false } },
  },
];
