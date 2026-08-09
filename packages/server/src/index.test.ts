import { describe, expect, it } from "vitest";
import {
  CONTENT_PRIMITIVES,
  getServerPackageInfo,
  PACKAGE_NAME,
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
