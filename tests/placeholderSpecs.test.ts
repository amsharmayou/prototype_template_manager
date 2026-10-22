import { describe, expect, it } from "vitest";

import { normalisePlaceholderSpecs } from "@/lib/canvas/EditorController";

describe("placeholder contract normalization", () => {
  it("preserves starting answers when editor state loads a template", () => {
    expect(normalisePlaceholderSpecs([{ key: "customer", defaultValue: "Acme Ltd", required: true }])).toEqual([
      { key: "customer", defaultValue: "Acme Ltd", required: true },
    ]);
  });
});
