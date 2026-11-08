import { mkdtemp, rm } from "node:fs/promises";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import path from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { runCli } from "@strumentario/cli";
import {
  createMcpHttpServer,
  createMcpServer,
  DATA_DIR_ENV,
  FileSystemPageStore,
  shutdownHttpServer,
  toolContracts,
} from "@strumentario/server";
import { matchSubset } from "./match.js";
import type {
  CaseResult,
  CallRecord,
  CaseTrace,
  CliGoldenCase,
  GoldenCase,
  GoldenStep,
  PageSnapshot,
  ParallelExpectation,
  StepRecord,
  SuiteResult,
  ToolCallSpec,
  ToolGoldenCase,
} from "./types.js";

interface CallOutcome {
  isError: boolean;
  structured: unknown;
  text: string;
}

/** Runs every case against a fresh temporary store. Needs no network and no API keys. */
export async function runGolden(cases: readonly GoldenCase[]): Promise<SuiteResult> {
  const results: CaseResult[] = [];
  for (const goldenCase of cases) {
    results.push(await runCase(goldenCase));
  }
  const failed = results.filter((result) => !result.passed).length;
  return { passed: failed === 0, total: results.length, failed, results };
}

export async function runCase(goldenCase: GoldenCase): Promise<CaseResult> {
  const started = Date.now();
  const dir = await mkdtemp(path.join(tmpdir(), "strumentario-eval-"));
  let failures: string[];
  let trace: CaseTrace | undefined;
  try {
    const store = new FileSystemPageStore(dir);
    for (const page of goldenCase.seed ?? []) {
      await store.put(page);
    }
    if (goldenCase.kind === "tool") {
      const run = await runToolCase(goldenCase, store);
      failures = run.failures;
      trace = { steps: run.steps, finalStore: await snapshot(store) };
    } else {
      failures = await runCliCase(goldenCase, dir);
    }
    failures.push(...(await checkStore(goldenCase, store)));
  } catch (error) {
    // A harness or transport crash is a failed case, never a silent pass.
    failures = [`case crashed: ${error instanceof Error ? error.message : String(error)}`];
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
  return {
    id: goldenCase.id,
    category: goldenCase.category,
    passed: failures.length === 0,
    failures,
    durationMs: Date.now() - started,
    ...(trace ? { trace } : {}),
  };
}

// --- tool cases: in-process MCP client <-> createMcpServer() ---------------

async function runToolCase(
  goldenCase: ToolGoldenCase,
  store: FileSystemPageStore,
): Promise<{ failures: string[]; steps: StepRecord[] }> {
  const server = createMcpServer({ store });
  const client = new Client({ name: "strumentario-evals", version: "0.0.0" });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);

  const failures: string[] = [];
  const steps: StepRecord[] = [];
  try {
    const known = new Set(toolContracts.map((contract) => contract.name));
    for (const [index, step] of goldenCase.steps.entries()) {
      const calls = "call" in step ? [step.call] : step.parallel;
      const unknownTool = calls.find((call) => !known.has(call.tool));
      if (unknownTool) {
        failures.push(
          `step ${index + 1}: "${unknownTool.tool}" is not a tool contract (known: ${[...known].join(", ")}). Fix the case.`,
        );
        continue;
      }
      const storeBefore = await snapshot(store);
      const records: CallRecord[] = [];
      failures.push(...(await runStep(client, store, step, `step ${index + 1}`, records)));
      steps.push({ parallel: "parallel" in step, calls: records, storeBefore, storeAfter: await snapshot(store) });
    }
  } finally {
    await client.close().catch(() => undefined);
    await server.close().catch(() => undefined);
  }
  return { failures, steps };
}

async function snapshot(store: FileSystemPageStore): Promise<PageSnapshot[]> {
  const pages = await store.list();
  return pages
    .map(({ slug, title, body, revision }) => ({ slug, title, body, revision }))
    .sort((a, b) => a.slug.localeCompare(b.slug));
}

async function runStep(
  client: Client,
  store: FileSystemPageStore,
  step: GoldenStep,
  label: string,
  record: CallRecord[],
): Promise<string[]> {
  if ("call" in step) {
    const resolvedCall = await resolveCall(store, step.call);
    const outcome = await invoke(client, resolvedCall);
    record.push({ ...resolvedCall, ...outcome });
    const failures: string[] = [];
    if (outcome.isError !== step.expect.isError) {
      failures.push(`${label} (${step.call.tool}): expected isError=${step.expect.isError}, got ${outcome.isError}`);
    }
    if (step.expect.match !== undefined) {
      failures.push(...matchSubset(outcome.structured, step.expect.match, `${label} (${step.call.tool}) output`));
    }
    if (step.expect.errorIncludes !== undefined && !outcome.text.includes(step.expect.errorIncludes)) {
      failures.push(
        `${label} (${step.call.tool}): expected error text to include ${JSON.stringify(step.expect.errorIncludes)}, got ${JSON.stringify(outcome.text)}`,
      );
    }
    return failures;
  }

  // Resolve every input first so all placeholders see the same pre-step store, then start the calls together.
  const resolved = await Promise.all(step.parallel.map((call) => resolveCall(store, call)));
  const outcomes = await Promise.all(resolved.map((call) => invoke(client, call)));
  resolved.forEach((call, index) => record.push({ ...call, ...(outcomes[index] as CallOutcome) }));
  return checkParallel(outcomes, step.expect, label);
}

function checkParallel(outcomes: CallOutcome[], expected: ParallelExpectation, label: string): string[] {
  const failures: string[] = [];
  const succeeded = outcomes.filter((outcome) => !outcome.isError);
  if (succeeded.length !== expected.ok) {
    failures.push(`${label}: expected ${expected.ok} of ${outcomes.length} parallel calls to succeed, got ${succeeded.length}`);
  }
  const codes = outcomes
    .filter((outcome) => outcome.isError)
    .map((outcome) => String((outcome.structured as { error?: { code?: unknown } } | undefined)?.error?.code ?? "protocol_error"))
    .sort();
  const wanted = [...(expected.errorCodes ?? [])].sort();
  if (JSON.stringify(codes) !== JSON.stringify(wanted)) {
    failures.push(`${label}: expected error codes ${JSON.stringify(wanted)}, got ${JSON.stringify(codes)}`);
  }
  if (expected.replayed !== undefined) {
    const replayed = succeeded.filter((outcome) => (outcome.structured as { replayed?: unknown } | undefined)?.replayed === true).length;
    if (replayed !== expected.replayed) {
      failures.push(`${label}: expected ${expected.replayed} replayed result(s), got ${replayed}`);
    }
  }
  return failures;
}

async function invoke(client: Client, call: ToolCallSpec): Promise<CallOutcome> {
  try {
    const result = await client.callTool({ name: call.tool, arguments: call.input });
    const content = Array.isArray(result.content) ? result.content : [];
    const text = content.map((part) => (part.type === "text" ? part.text : "")).join("");
    return { isError: result.isError === true, structured: result.structuredContent, text };
  } catch (error) {
    // Depending on the SDK, an input the schema rejects surfaces as a thrown protocol error.
    return { isError: true, structured: undefined, text: error instanceof Error ? error.message : String(error) };
  }
}

/** Replace "$revision:<slug>" strings with that page's current stored revision. */
async function resolveCall(store: FileSystemPageStore, call: ToolCallSpec): Promise<ToolCallSpec> {
  return { tool: call.tool, input: (await resolveValue(store, call.input)) as Record<string, unknown> };
}

async function resolveValue(store: FileSystemPageStore, value: unknown): Promise<unknown> {
  if (typeof value === "string" && value.startsWith("$revision:")) {
    const slug = value.slice("$revision:".length);
    const page = await store.get(slug);
    if (!page) {
      throw new Error(`placeholder ${value} needs a stored page "${slug}"; seed it in the case.`);
    }
    return page.revision;
  }
  if (Array.isArray(value)) {
    return Promise.all(value.map((item) => resolveValue(store, item)));
  }
  if (typeof value === "object" && value !== null) {
    const entries = await Promise.all(
      Object.entries(value).map(async ([key, item]) => [key, await resolveValue(store, item)] as const),
    );
    return Object.fromEntries(entries);
  }
  return value;
}

// --- CLI cases: real `strumentario call` against a Streamable HTTP server ---

async function runCliCase(goldenCase: CliGoldenCase, dir: string): Promise<string[]> {
  // The HTTP transport builds its store from the environment on each request.
  const previous = process.env[DATA_DIR_ENV];
  process.env[DATA_DIR_ENV] = dir;
  const server = createMcpHttpServer();
  try {
    await new Promise<void>((resolve, reject) => {
      server.once("error", reject);
      server.listen(0, "127.0.0.1", resolve);
    });
    const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}/mcp`;

    let stdout = "";
    let stderr = "";
    const exitCode = await runCli([...goldenCase.args, "--url", url], {
      env: { [DATA_DIR_ENV]: dir },
      stdout: (text) => (stdout += text),
      stderr: (text) => (stderr += text),
    });

    const failures: string[] = [];
    if (exitCode !== goldenCase.expect.exitCode) {
      failures.push(`expected exit code ${goldenCase.expect.exitCode}, got ${exitCode} (stderr: ${stderr.trim() || "empty"})`);
    }
    if (goldenCase.expect.stdoutJson !== undefined) {
      try {
        failures.push(...matchSubset(JSON.parse(stdout), goldenCase.expect.stdoutJson, "stdout"));
      } catch {
        failures.push(`stdout is not valid JSON: ${JSON.stringify(stdout)}`);
      }
    }
    if (goldenCase.expect.stderrIncludes !== undefined && !stderr.includes(goldenCase.expect.stderrIncludes)) {
      failures.push(`expected stderr to include ${JSON.stringify(goldenCase.expect.stderrIncludes)}, got ${JSON.stringify(stderr)}`);
    }
    return failures;
  } finally {
    await shutdownHttpServer(server).catch(() => undefined);
    if (previous === undefined) {
      delete process.env[DATA_DIR_ENV];
    } else {
      process.env[DATA_DIR_ENV] = previous;
    }
  }
}

// --- store post-conditions ---------------------------------------------------

async function checkStore(goldenCase: GoldenCase, store: FileSystemPageStore): Promise<string[]> {
  const failures: string[] = [];
  for (const check of goldenCase.after ?? []) {
    const stored = await store.get(check.slug);
    if (Boolean(stored) !== check.exists) {
      failures.push(`store: expected page "${check.slug}" ${check.exists ? "to exist" : "to be absent"}, but it ${stored ? "exists" : "is absent"}`);
      continue;
    }
    if (stored && check.page) {
      const { revision: _revision, ...page } = stored;
      failures.push(...matchSubset(page, check.page, `store page "${check.slug}"`));
    }
  }
  return failures;
}
