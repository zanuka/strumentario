import { describe, expect, it } from "vitest";
import { checkEvalGate } from "./index.js";

describe("checkEvalGate", () => {
  it("fails with an actionable message when BRAINTRUST_API_KEY is missing", () => {
    const result = checkEvalGate({});
    expect(result.ok).toBe(false);
    expect(result.reason).toBe("missing_braintrust_api_key");
    expect(result.message).toContain("BRAINTRUST_API_KEY");
    expect(result.message).toContain("pnpm eval");
    expect(result.primitives).toContain("query");
  });

  it("reports not_implemented when a key is present", () => {
    const result = checkEvalGate({ BRAINTRUST_API_KEY: "test-key" });
    expect(result.ok).toBe(false);
    expect(result.reason).toBe("not_implemented");
    expect(result.message).toContain("Phase 2");
  });
});
