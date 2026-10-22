import { expect, it, describe } from "vitest";

import { formatMinorUnits, parseMinorUnits } from "@/lib/render/computed";

describe("parseMinorUnits", () => {
  it("keeps fractional money exact", () => {
    expect(parseMinorUnits("1.005", 2)).toBe(101);
    expect(parseMinorUnits("-1.005", 2)).toBe(-101);
    expect(parseMinorUnits("  ₹ 3,510 ", 2)).toBe(351000);
  });

  it("rounds half to even only when the manifest says so", () => {
    expect(parseMinorUnits("1.015", 2, "halfEven")).toBe(102);
    expect(parseMinorUnits("1.005", 2, "halfEven")).toBe(100);
    expect(parseMinorUnits("-1.015", 2, "halfEven")).toBe(-102);
    expect(parseMinorUnits("1.0050001", 2, "halfEven")).toBe(101);
  });

  it("refuses figures it cannot hold exactly", () => {
    expect(parseMinorUnits("12345678901234567890", 2)).toBe(0);
  });
});

describe("formatMinorUnits", () => {
  it("mirrors the sign and keeps the scale", () => {
    expect(formatMinorUnits(351000, 2)).toBe("3510.00");
    expect(formatMinorUnits(-5, 2)).toBe("-0.05");
    expect(formatMinorUnits(7, 0)).toBe("7");
  });
});
