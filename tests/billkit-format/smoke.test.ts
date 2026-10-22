import { describe, expect, it } from "vitest";

import { PACKAGE_VERSION } from "@/lib/package/format";

describe("vendored format sources", () => {
  it("exposes the package format version", () => {
    expect(PACKAGE_VERSION).toBe(2);
  });
});
