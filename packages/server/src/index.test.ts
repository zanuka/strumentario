import { describe, expect, it } from "vitest";
import {
  CONTENT_PRIMITIVES,
  getServerPackageInfo,
  PACKAGE_NAME,
  validateHandbookPage,
} from "./index.js";

describe("getServerPackageInfo", () => {
  it("exposes the high-signal content primitive set", () => {
    const info = getServerPackageInfo();
    expect(info.name).toBe(PACKAGE_NAME);
    expect(info.phase).toBe("foundation");
    expect(info.primitives).toEqual(CONTENT_PRIMITIVES);
    expect(info.primitives).toEqual([
      "query",
      "mutate",
      "validate",
      "scaffold",
    ]);
  });
});

describe("validateHandbookPage", () => {
  it("accepts a valid handbook page", () => {
    expect(
      validateHandbookPage({
        title: "Getting started",
        slug: "getting-started",
        body: "Install Strumentario, then connect an MCP host.",
      }),
    ).toEqual({ valid: true, errors: [] });
  });

  it("returns actionable errors for an invalid handbook page", () => {
    const result = validateHandbookPage({
      title: "Draft",
      slug: "Getting Started",
      body: "A draft body.",
    });

    expect(result.valid).toBe(false);
    expect(result.errors).toContain(
      'slug: must use lowercase letters, numbers, and hyphens (for example, "getting-started")',
    );
  });
});
