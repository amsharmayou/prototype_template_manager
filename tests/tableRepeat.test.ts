import { describe, expect, it } from "vitest";

import { normaliseRepeat } from "@/lib/canvas/tableRepeat";

describe("normaliseRepeat", () => {
  it("accepts a band inside the table and fills the defaults", () => {
    expect(normaliseRepeat({ startRow: 1, endRow: 2, key: "items" }, 4)).toEqual({
      startRow: 1,
      endRow: 2,
      key: "items",
      repeatHeader: false,
      maxItems: 200,
    });
  });

  it("keeps an explicit maxItems and repeatHeader", () => {
    expect(
      normaliseRepeat({ startRow: 0, endRow: 0, key: "items", maxItems: 5, repeatHeader: true }, 2),
    ).toMatchObject({ maxItems: 5, repeatHeader: true });
  });

  it("trims the key", () => {
    expect(normaliseRepeat({ startRow: 1, endRow: 1, key: "  items  " }, 4)?.key).toBe("items");
  });

  it("refuses a band past the last row", () => {
    expect(normaliseRepeat({ startRow: 1, endRow: 4, key: "items" }, 4)).toBeNull();
  });

  it("refuses an inverted band", () => {
    expect(normaliseRepeat({ startRow: 3, endRow: 1, key: "items" }, 4)).toBeNull();
  });

  it("refuses an empty key", () => {
    expect(normaliseRepeat({ startRow: 1, endRow: 1, key: "  " }, 4)).toBeNull();
  });

  it("refuses a non-integer row", () => {
    expect(normaliseRepeat({ startRow: 1.5, endRow: 2, key: "items" }, 4)).toBeNull();
  });

  it("refuses null", () => {
    expect(normaliseRepeat(null, 4)).toBeNull();
  });
});
