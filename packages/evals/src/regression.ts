import { FileSystemPageStore } from "@strumentario/server";
import { goldenCases } from "./golden.js";
import { formatSuite, runScoredSuite, type ScoredSuite } from "./suite.js";
import type { GoldenCase } from "./types.js";

/**
 * A deliberate regression for demonstrating that the scorers catch real breakage: the per-slug writer lock
 * becomes a no-op, so read-check-write sequences can interleave. The patch is process-local and always
 * undone; production code is never touched.
 */
export async function withBrokenWriterLock<T>(run: () => Promise<T>): Promise<T> {
  const original = FileSystemPageStore.prototype.withLock;
  FileSystemPageStore.prototype.withLock = async function <R>(_slug: string, fn: () => Promise<R>): Promise<R> {
    // Yield once so two concurrent callers both read before either writes, as an unlocked race would.
    await new Promise((resolve) => setImmediate(resolve));
    return fn();
  };
  try {
    return await run();
  } finally {
    FileSystemPageStore.prototype.withLock = original;
  }
}

export interface RegressionDemo {
  red: ScoredSuite;
  green: ScoredSuite;
}

/** Runs the suite with the lock broken (expected red), then with the real lock (expected green). */
export async function demonstrateRegression(cases: readonly GoldenCase[] = goldenCases): Promise<RegressionDemo> {
  const red = await withBrokenWriterLock(() => runScoredSuite(cases));
  const green = await runScoredSuite(cases);
  return { red, green };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const demo = await demonstrateRegression();
  process.stdout.write(`== RED: writer lock disabled ==\n${formatSuite(demo.red)}\n== GREEN: lock restored ==\n${formatSuite(demo.green)}`);
  // The demonstration succeeds when the regression is caught and the restored code is clean.
  process.exitCode = !demo.red.passed && demo.green.passed ? 0 : 1;
}
