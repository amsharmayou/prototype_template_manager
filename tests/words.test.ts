import { describe, expect, it } from "vitest";

import { spellMoney } from "@/lib/render/words";

describe("spellMoney", () => {
  it("spells out a paise amount", () => {
    expect(spellMoney(100, 2)).toBe("One Rupee Only");
    expect(spellMoney(1050, 2)).toBe("Ten Rupees Fifty Paise Only");
  });

  it("handles zero", () => {
    expect(spellMoney(0, 2)).toBe("Zero Rupees Only");
  });

  it("handles rupees above ninety-nine", () => {
    expect(spellMoney(123456, 2)).toBe(
      "One Thousand Two Hundred Thirty Four Rupees Fifty Six Paise Only",
    );
  });

  it("groups Indian numbering correctly", () => {
    // 1,234,567.89 is twelve lakh thirty four thousand five hundred sixty seven,
    // which no Western thousands grouping can express.
    expect(spellMoney(123456789, 2)).toBe(
      "Twelve Lakh Thirty Four Thousand Five Hundred Sixty Seven Rupees Eighty Nine Paise Only",
    );
    // A lakh is 10^5 rupees, so 10^5 * 10^2 minor units.
    expect(spellMoney(10000000, 2)).toBe("One Lakh Rupees Only");
  });

  it("handles crores", () => {
    // A crore is 10^7 rupees, so 10^7 * 10^2 minor units. The lakh above is two
    // digits shorter, which is exactly the off-by-a-hundred a crore/lakh mix-up is.
    expect(spellMoney(1000000000, 2)).toBe("One Crore Rupees Only");
  });

  it("honours a zero decimal scale", () => {
    expect(spellMoney(42, 0)).toBe("Forty Two Rupees Only");
  });

  it("uses the currency it is given", () => {
    expect(spellMoney(100, 2, "USD")).toBe("One Dollar Only");
  });

  it("spells a sub-unit past three digits instead of answering undefined", () => {
    // At four decimals the sub-unit count reaches 9999, so reading it with a
    // helper capped at 999 printed the literal "undefined" on the bill.
    expect(spellMoney(12345, 4)).toBe(
      "One Rupee Two Thousand Three Hundred Forty Five Paise Only",
    );
  });

  it("never produces an empty string for a negative amount", () => {
    expect(spellMoney(-100, 2).length).toBeGreaterThan(0);
  });
});
