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

  it("spells the sub-unit in the singular for exactly one", () => {
    // Every other sub-unit assertion has a count of two or more, so swapping the
    // two forms for each other left the suite green.
    expect(spellMoney(101, 2)).toBe("One Rupee One Paisa Only");
    expect(spellMoney(1101, 2)).toBe("Eleven Rupees One Paisa Only");
  });

  it("puts the sign in the words, where a bill prints it", () => {
    expect(spellMoney(-100, 2)).toBe("Minus One Rupee Only");
    expect(spellMoney(-40, 2)).toBe("Minus Forty Paise Only");
  });

  it("reads a negative figure that rounds to zero as plain zero", () => {
    // "-0.40" is a rounding remainder, not a debt, and "Minus Zero Rupees Only"
    // is not a line any bill can carry.
    expect(spellMoney(-0.4, 2)).toBe("Zero Rupees Only");
  });

  it("names the groups above a crore", () => {
    // An arab is 100 crore, a kharab is 100 arab.
    expect(spellMoney(500000000000, 2)).toBe("Five Arab Rupees Only");
    expect(spellMoney(10000000000000, 2)).toBe("One Kharab Rupees Only");
    expect(spellMoney(250000000000, 2)).toBe("Two Arab Fifty Crore Rupees Only");
  });

  it("stops naming groups at a magnitude no group word covers", () => {
    // Recursing through Crore repeated the name once per level, so 10^21 read
    // as "One Lakh Crore Crore". Digits are unambiguous where a word is not.
    expect(spellMoney(1e21, 2)).toBe("100000000 Kharab Rupees Only");
  });
});
