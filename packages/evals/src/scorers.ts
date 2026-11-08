import { toolContracts } from "@strumentario/server";
import { Ajv, type ValidateFunction } from "ajv";
import type {
  CallRecord,
  CaseResult,
  GoldenCase,
  GoldenStep,
  PageSnapshot,
  StepRecord,
  ToolCallSpec,
} from "./types.js";

/**
 * Code scorers for the golden dataset (docs/braintrust-eval-details.md, "Scorer philosophy").
 *
 * Each scorer reads what the harness recorded (`CaseResult.trace`) and returns a score in
 * [0, 1], or `null` when the case has nothing for it to judge (Braintrust shows null as "not
 * applicable"). Scores are deterministic, so a regression is a score below 1 — there is no
 * threshold to tune.
 */

export interface ScorerInput {
  case: GoldenCase;
  result: CaseResult;
}

export interface ScorerOutput {
  name: string;
  /** 0..1, or null when the scorer does not apply to this case. */
  score: number | null;
  /** One actionable line per problem found; empty when the score is 1 or null. */
  problems: string[];
}

export type Scorer = (input: ScorerInput) => ScorerOutput;

export const SCORER_NAMES = [
  "tool_choice",
  "output_schema_valid",
  "no_unexpected_side_effect",
  "concurrency_safety",
] as const;

// --- tool_choice ---------------------------------------------------------------

/**
 * Expected tool and arguments (the golden spec) versus the tool and arguments actually sent.
 * Also fails when the tool is not a published contract. In the direct-invocation task this guards the
 * tool/argument contract; whether a *model* picks the right tool is the agent path (issue #16).
 */
export const toolChoice: Scorer = ({ case: goldenCase, result }) => {
  const name = "tool_choice";
  if (goldenCase.kind !== "tool" || !result.trace) return skipped(name);

  const expected = goldenCase.steps.flatMap(callsOf);
  const actual = result.trace.steps.flatMap((step) => step.calls);
  const published = new Set(toolContracts.map((contract) => contract.name));
  const problems: string[] = [];
  const unmatched = [...actual];

  for (const want of expected) {
    if (!published.has(want.tool)) {
      problems.push(`expected tool "${want.tool}" is not a published tool contract (published: ${[...published].join(", ")})`);
      continue;
    }
    const index = unmatched.findIndex((call) => call.tool === want.tool && argsAgree(want.input, call.input));
    if (index === -1) {
      const sameTool = actual.find((call) => call.tool === want.tool);
      problems.push(
        sameTool
          ? `"${want.tool}" was called with different arguments than the golden spec: expected ${JSON.stringify(want.input)}, got ${JSON.stringify(sameTool.input)}`
          : `expected a call to "${want.tool}" but none was made`,
      );
    } else {
      unmatched.splice(index, 1);
    }
  }
  for (const extra of unmatched) {
    problems.push(`unexpected call to "${extra.tool}" with ${JSON.stringify(extra.input)}`);
  }

  const total = Math.max(expected.length, actual.length, 1);
  return { name, score: ratio(total - problems.length, total), problems };
};

/** Spec arguments agree with the sent ones; "$revision:" placeholders match any resolved string. */
function argsAgree(spec: unknown, sent: unknown): boolean {
  if (typeof spec === "string" && spec.startsWith("$revision:")) return typeof sent === "string" && sent.length > 0;
  if (Array.isArray(spec)) {
    return Array.isArray(sent) && sent.length === spec.length && spec.every((item, i) => argsAgree(item, sent[i]));
  }
  if (typeof spec === "object" && spec !== null) {
    if (typeof sent !== "object" || sent === null || Array.isArray(sent)) return false;
    const specKeys = Object.keys(spec);
    const sentKeys = Object.keys(sent);
    return (
      specKeys.length === sentKeys.length &&
      specKeys.every((key) => key in sent && argsAgree((spec as Record<string, unknown>)[key], (sent as Record<string, unknown>)[key]))
    );
  }
  return Object.is(spec, sent);
}

// --- output_schema_valid ---------------------------------------------------------

const ajv = new Ajv({ allErrors: true, strict: false, validateFormats: false });
const validators = new Map<string, ValidateFunction>();

function validatorFor(tool: string): ValidateFunction | undefined {
  const cached = validators.get(tool);
  if (cached) return cached;
  const contract = toolContracts.find((candidate) => candidate.name === tool);
  if (!contract) return undefined;
  const validate = ajv.compile(contract.outputSchema);
  validators.set(tool, validate);
  return validate;
}

/** Every structured result matches the tool's declared outputSchema (the one tools/list serves). */
export const outputSchemaValid: Scorer = ({ case: goldenCase, result }) => {
  const name = "output_schema_valid";
  if (goldenCase.kind !== "tool" || !result.trace) return skipped(name);

  // Protocol-level rejections (bad arguments) carry no structured output; nothing to validate there.
  const judged = result.trace.steps.flatMap((step) => step.calls).filter((call) => call.structured !== undefined);
  if (judged.length === 0) return skipped(name);

  const problems: string[] = [];
  for (const call of judged) {
    const validate = validatorFor(call.tool);
    if (!validate) {
      problems.push(`"${call.tool}" has no published output schema to validate against`);
    } else if (!validate(call.structured)) {
      const detail = (validate.errors ?? []).map((error) => `${error.instancePath || "/"} ${error.message}`).join("; ");
      problems.push(`"${call.tool}" output does not match its outputSchema: ${detail}`);
    }
  }
  return { name, score: ratio(judged.length - problems.length, judged.length), problems };
};

// --- no_unexpected_side_effect ---------------------------------------------------

/**
 * Steps that must not change the store (query, validate, and mutate unless dryRun is explicitly false)
 * leave it exactly as it was, and dry-run mutations report `dryRun: true`.
 */
export const noUnexpectedSideEffect: Scorer = ({ case: goldenCase, result }) => {
  const name = "no_unexpected_side_effect";
  if (goldenCase.kind !== "tool" || !result.trace) return skipped(name);

  const readOnlySteps = result.trace.steps.filter((step) => step.calls.every(isReadOnly));
  if (readOnlySteps.length === 0) return skipped(name);

  const problems: string[] = [];
  let badSteps = 0;
  for (const step of readOnlySteps) {
    const found: string[] = [];
    const label = step.calls.map((call) => call.tool).join("+");
    if (JSON.stringify(step.storeBefore) !== JSON.stringify(step.storeAfter)) {
      found.push(`${label} must not write, but the store changed: ${describeDiff(step.storeBefore, step.storeAfter)}`);
    }
    for (const call of step.calls) {
      const reported = (call.structured as { dryRun?: unknown } | undefined)?.dryRun;
      if (call.tool === "mutate" && !call.isError && reported !== true) {
        found.push(`a dry-run mutate reported dryRun=${JSON.stringify(reported)}; it must report true`);
      }
    }
    if (found.length > 0) badSteps += 1;
    problems.push(...found);
  }
  return { name, score: ratio(readOnlySteps.length - badSteps, readOnlySteps.length), problems };
};

function isReadOnly(call: CallRecord): boolean {
  if (call.tool === "query" || call.tool === "validate") return true;
  // mutate defaults to a dry run; only an explicit dryRun:false is allowed to write.
  return call.tool === "mutate" && call.input.dryRun !== false;
}

function describeDiff(before: PageSnapshot[], after: PageSnapshot[]): string {
  const bySlug = (pages: PageSnapshot[]) => new Map(pages.map((page) => [page.slug, page.revision]));
  const was = bySlug(before);
  const now = bySlug(after);
  const changes: string[] = [];
  for (const [slug, revision] of now) {
    if (!was.has(slug)) changes.push(`+${slug}`);
    else if (was.get(slug) !== revision) changes.push(`~${slug}`);
  }
  for (const slug of was.keys()) if (!now.has(slug)) changes.push(`-${slug}`);
  return changes.join(", ") || "contents differ";
}

// --- concurrency_safety ----------------------------------------------------------

/**
 * For calls started together: no lost update (every accepted write is accounted for in the final store,
 * and two writers never both win from the same revision) and no double apply (one idempotency key is
 * applied at most once; the rest are replays).
 */
export const concurrencySafety: Scorer = ({ case: goldenCase, result }) => {
  const name = "concurrency_safety";
  if (goldenCase.kind !== "tool" || !result.trace) return skipped(name);

  const groups = result.trace.steps.filter((step) => step.parallel);
  if (groups.length === 0) return skipped(name);

  const problems: string[] = [];
  let unsafeGroups = 0;
  for (const group of groups) {
    const found = checkGroup(group);
    if (found.length > 0) unsafeGroups += 1;
    problems.push(...found);
  }
  return { name, score: ratio(groups.length - unsafeGroups, groups.length), problems };
};

function checkGroup(group: StepRecord): string[] {
  const problems: string[] = [];
  const applied = group.calls.filter(
    (call) => call.tool === "mutate" && call.input.dryRun === false && !call.isError && !isReplay(call),
  );

  // Two writers from the same base revision cannot both be accepted.
  const byBase = new Map<string, CallRecord[]>();
  for (const call of applied) {
    if (call.input.action === "create") continue;
    const base = `${String(call.input.action)}:${String(call.input.slug)}@${String(call.input.expectedRevision ?? "any")}`;
    byBase.set(base, [...(byBase.get(base) ?? []), call]);
  }
  for (const [base, calls] of byBase) {
    if (calls.length > 1 && !base.endsWith("@any")) {
      problems.push(`lost update: ${calls.length} writers all succeeded from the same revision (${base}); only one may win`);
    }
  }

  // One idempotency key is applied once; its other calls must come back as replays.
  const byKey = new Map<string, number>();
  for (const call of applied) {
    const key = call.input.idempotencyKey;
    if (typeof key === "string") byKey.set(key, (byKey.get(key) ?? 0) + 1);
  }
  for (const [key, count] of byKey) {
    if (count > 1) problems.push(`double apply: idempotency key "${key}" was applied ${count} times; retries must replay`);
  }

  // Two creates of one slug cannot both be freshly accepted unless overwrite was requested.
  const creates = new Map<string, number>();
  for (const call of applied) {
    if (call.input.action === "create" && call.input.overwrite !== true) {
      const slug = String(call.input.slug);
      creates.set(slug, (creates.get(slug) ?? 0) + 1);
    }
  }
  for (const [slug, count] of creates) {
    if (count > 1) problems.push(`double apply: ${count} creates of "${slug}" all succeeded`);
  }

  // Every slug a write touched must end in a state one accepted call actually produced.
  for (const slug of new Set(applied.map((call) => String(call.input.slug)))) {
    const finalPage = group.storeAfter.find((page) => page.slug === slug);
    const produced = group.calls
      .filter((call) => call.tool === "mutate" && !call.isError && call.input.slug === slug)
      .map((call) => (call.structured as { page?: { revision?: string } } | undefined)?.page?.revision);
    const deleted = group.calls.some((call) => call.input.action === "delete" && !call.isError && call.input.slug === slug);
    if (finalPage && !produced.includes(finalPage.revision)) {
      problems.push(`lost update: "${slug}" ended at revision ${finalPage.revision}, which no accepted call produced`);
    } else if (!finalPage && !deleted) {
      problems.push(`lost update: "${slug}" is missing from the store although no accepted call deleted it`);
    }
  }
  return problems;
}

function isReplay(call: CallRecord): boolean {
  return (call.structured as { replayed?: unknown } | undefined)?.replayed === true;
}

// --- shared -----------------------------------------------------------------------

export const scorers: readonly Scorer[] = [toolChoice, outputSchemaValid, noUnexpectedSideEffect, concurrencySafety];

export interface ScoredCase {
  id: string;
  category: CaseResult["category"];
  /** The harness verdict: every expectation in the golden case held. */
  passed: boolean;
  scores: ScorerOutput[];
  /** Harness failures plus every scorer problem. */
  problems: string[];
  regressed: boolean;
}

/** A case regresses when its expectations failed or any applicable scorer is below 1. */
export function scoreCase(goldenCase: GoldenCase, result: CaseResult): ScoredCase {
  const scores = scorers.map((scorer) => scorer({ case: goldenCase, result }));
  const problems = [...result.failures, ...scores.flatMap((score) => score.problems)];
  const regressed = !result.passed || scores.some((score) => score.score !== null && score.score < 1);
  return { id: result.id, category: result.category, passed: result.passed, scores, problems, regressed };
}

function callsOf(step: GoldenStep): ToolCallSpec[] {
  return "call" in step ? [step.call] : step.parallel;
}

function skipped(name: string): ScorerOutput {
  return { name, score: null, problems: [] };
}

function ratio(good: number, total: number): number {
  return total <= 0 ? 1 : Math.max(0, Math.min(1, good / total));
}
