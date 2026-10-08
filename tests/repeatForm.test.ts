import { describe, expect, it } from "vitest";

import { repeatValue, rowsFromValue } from "@/lib/render/repeatForm";

const columns = ["description", "amount"];

describe("repeatValue", () => {
  it("serialises rows into the JSON string the renderer reads", () => {
    const out = repeatValue([{ description: "A", amount: "1.00" }], columns);
    expect(out).toBe('[{"description":"A","amount":"1.00"}]');
  });

  it("emits an empty list for no rows", () => {
    expect(repeatValue([], columns)).toBe("[]");
  });

  it("keeps a blank row rather than dropping it mid-edit", () => {
    const out = repeatValue([{ description: "A", amount: "" }], columns);
    expect(JSON.parse(out)).toEqual([{ description: "A", amount: "" }]);
  });

  it("fills missing columns with empty strings so a row always has every key", () => {
    expect(JSON.parse(repeatValue([{ description: "A" }], columns))).toEqual([
      { description: "A", amount: "" },
    ]);
  });
});

describe("rowsFromValue", () => {
  it("reads rows back out of the JSON string", () => {
    expect(rowsFromValue('[{"description":"A","amount":"1.00"}]', columns)).toEqual([
      { description: "A", amount: "1.00" },
    ]);
  });

  it("falls back to one blank row for anything unusable", () => {
    expect(rowsFromValue("nope", columns)).toEqual([{ description: "", amount: "" }]);
  });

  it("falls back to one blank row for an empty string", () => {
    expect(rowsFromValue("", columns)).toEqual([{ description: "", amount: "" }]);
  });
});
