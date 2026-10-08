import { describe, expect, it } from "vitest";

import {
  computeAll,
  formatMinorUnits,
  itemsOf,
  parseMinorUnits,
} from "@/lib/render/computed";

const v = (o: Record<string, unknown>) => o as Record<string, string>;

describe("parseMinorUnits", () => {
  it("reads a decimal string exactly", () => {
    expect(parseMinorUnits("19.99", 2)).toBe(1999);
  });

  it("reads an integer string", () => {
    expect(parseMinorUnits("20", 2)).toBe(2000);
  });

  it("pads a short fraction", () => {
    expect(parseMinorUnits("5.5", 2)).toBe(550);
  });

  it("treats a missing or unusable value as zero", () => {
    expect(parseMinorUnits(undefined, 2)).toBe(0);
    expect(parseMinorUnits("", 2)).toBe(0);
    expect(parseMinorUnits("abc", 2)).toBe(0);
  });

  it("does not go through a float", () => {
    // parseFloat("1.005") * 100 is 100.49999999999999. Exact string handling
    // rounds the half up at the declared scale instead.
    expect(parseMinorUnits("1.005", 2)).toBe(101);
    expect(Number.isSafeInteger(parseMinorUnits("0.07", 2))).toBe(true);
  });

  it("tolerates thousands separators", () => {
    expect(parseMinorUnits("1,23,456.78", 2)).toBe(12345678);
  });

  it("reads a prefixed figure rather than giving up at the first dot", () => {
    // The strip allowed a leading dot, so "Rs. 100" left ". 100" behind and the
    // whole figure was refused.
    expect(parseMinorUnits("Rs. 100", 2)).toBe(10000);
    expect(parseMinorUnits(".50", 2)).toBe(50);
  });

  it("refuses a magnitude it cannot hold, on the rounding path too", () => {
    // The non-rounding branch guarded this; the rounding branch did not, so a
    // figure past 2^53 came back as a plausible wrong number rather than zero.
    expect(parseMinorUnits("99999999999999999999.555", 2)).toBe(0);
    expect(parseMinorUnits("99999999999999999999", 2)).toBe(0);
    expect(parseMinorUnits("99999999999999.99", 2)).toBe(0);
    expect(parseMinorUnits("90071992547409.91", 2)).toBe(9007199254740991);
  });

  it("reads an unquoted JSON number exactly as the same text", () => {
    // A cell is a number whenever the host leaves it unquoted, so the two shapes
    // must not differ by a paisa. At scale 2 the float path gave 1.00 / 1.01 /
    // 0.14 where the text gives 1.01 / 1.02 / 0.15.
    expect(parseMinorUnits(1.005, 2)).toBe(parseMinorUnits("1.005", 2));
    expect(parseMinorUnits("1.005", 2)).toBe(101);
    expect(parseMinorUnits(1.015, 2)).toBe(parseMinorUnits("1.015", 2));
    expect(parseMinorUnits("1.015", 2)).toBe(102);
    expect(parseMinorUnits(0.145, 2)).toBe(parseMinorUnits("0.145", 2));
    expect(parseMinorUnits("0.145", 2)).toBe(15);
    expect(parseMinorUnits(19.99, 2)).toBe(1999);
    expect(parseMinorUnits(Number.NaN, 2)).toBe(0);
  });
});

describe("formatMinorUnits", () => {
  it("renders two decimals", () => {
    expect(formatMinorUnits(1999, 2)).toBe("19.99");
  });

  it("shows decimals on a whole amount", () => {
    expect(formatMinorUnits(2000, 2)).toBe("20.00");
  });

  it("renders a zero scale without a point", () => {
    expect(formatMinorUnits(42, 0)).toBe("42");
  });
});

describe("itemsOf", () => {
  it("reads the JSON array a host passes for a repeat key", () => {
    expect(itemsOf(v({ items: '[{"a":1}]' }), "items")).toEqual([{ a: 1 }]);
  });

  it("returns an empty list for anything unusable", () => {
    expect(itemsOf(v({ items: "nope" }), "items")).toEqual([]);
    expect(itemsOf(v({}), "items")).toEqual([]);
  });
});

describe("computeAll", () => {
  it("sums a column across items", () => {
    expect(
      computeAll(
        [{ key: "subtotal", op: "sum", args: ["items.amount"] }],
        v({ items: '[{"amount":"100.00"},{"amount":"250.50"}]' }),
        2,
      ),
    ).toEqual({ subtotal: "350.50" });
  });

  it("multiplies then sums, which is what a rate column needs", () => {
    expect(
      computeAll(
        [{ key: "total", op: "sum-times", args: ["items.qty", "items.rate"] }],
        v({ items: '[{"qty":"3","rate":"10.00"},{"qty":"2","rate":"7.25"}]' }),
        2,
      ),
    ).toEqual({ total: "44.50" });
  });

  it("adds flat values", () => {
    expect(
      computeAll([{ key: "total", op: "add", args: ["a", "b"] }], v({ a: "10.00", b: "5.25" }), 2),
    ).toEqual({ total: "15.25" });
  });

  it("applies a percentage rate", () => {
    expect(
      computeAll(
        [{ key: "tax", op: "percent", args: ["subtotal"], rateKey: "tax_rate" }],
        v({ subtotal: "200.00", tax_rate: "18" }),
        2,
      ),
    ).toEqual({ tax: "36.00" });
  });

  it("resolves a chain, because specs are applied in order", () => {
    expect(
      computeAll(
        [
          { key: "subtotal", op: "sum", args: ["items.amount"] },
          { key: "tax", op: "percent", args: ["subtotal"], rateKey: "tax_rate" },
          { key: "total", op: "add", args: ["subtotal", "tax"] },
        ],
        v({ items: '[{"amount":"1000.00"}]', tax_rate: "18" }),
        2,
      ),
    ).toEqual({ subtotal: "1000.00", tax: "180.00", total: "1180.00" });
  });

  it("sums a missing column as zero rather than NaN", () => {
    expect(
      computeAll(
        [{ key: "subtotal", op: "sum", args: ["items.amount"] }],
        v({ items: '[{"other":"5.00"}]' }),
        2,
      ),
    ).toEqual({ subtotal: "0.00" });
  });

  it("is exact where float arithmetic would drift", () => {
    expect(
      computeAll(
        [{ key: "subtotal", op: "sum", args: ["items.amount"] }],
        v({ items: '[{"amount":"0.10"},{"amount":"0.20"}]' }),
        2,
      ),
    ).toEqual({ subtotal: "0.30" });
  });

  it("brings a product back to one scale, because both factors carry one", () => {
    // 10.00 x 5.25 is 52.50, not 5250.00: multiplying two scaled counts leaves
    // the scale applied twice, so the product has to come down once.
    expect(
      computeAll([{ key: "line", op: "multiply", args: ["a", "b"] }], v({ a: "10.00", b: "5.25" }), 2),
    ).toEqual({ line: "52.50" });
  });

  it("reads a rate that names a value this pass already computed", () => {
    // `rateKey` resolves like an arg, so a package may chain a rate. Reading it
    // only from the supplied values silently gave 0 for a rate nothing supplied.
    expect(
      computeAll(
        [
          { key: "rate", op: "add", args: ["pct"] },
          { key: "tax", op: "percent", args: ["subtotal"], rateKey: "rate" },
        ],
        v({ subtotal: "200.00", pct: "18" }),
        2,
      ),
    ).toEqual({ rate: "18.00", tax: "36.00" });
  });

  it("survives a repeat key and a result key that collide with Object.prototype", () => {
    // The row cache and the two maps were plain object literals, so a repeat key
    // named `constructor` returned an inherited function and iterating it threw,
    // and a result key of `__proto__` was swallowed by the inherited setter.
    expect(
      computeAll(
        [{ key: "subtotal", op: "sum", args: ["constructor.amount"] }],
        v({ constructor: '[{"amount":"7.00"}]' }),
        2,
      ),
    ).toEqual({ subtotal: "7.00" });

    const out = computeAll([{ key: "__proto__", op: "add", args: ["a"] }], v({ a: "5.00" }), 2);
    expect(Object.keys(out)).toEqual(["__proto__"]);
    expect(out["__proto__"]).toBe("5.00");
  });

  it("prefers a dotted key whole over reading it as a path", () => {
    // A field key may contain a dot, and the validator resolves a dotted arg as
    // a whole name first. Splitting first read this as repeat `x`, column `y`.
    expect(
      computeAll(
        [{ key: "subtotal", op: "sum", args: ["x.y"] }],
        v({ "x.y": "100.00", x: '[{"y":"5.00"},{"y":"6.00"}]' }),
        2,
      ),
    ).toEqual({ subtotal: "100.00" });
  });

  it("prefers a dotted key whole in a product as well", () => {
    expect(
      computeAll(
        [{ key: "total", op: "sum-times", args: ["x.y", "z"] }],
        v({ "x.y": "3.00", z: "4.00" }),
        2,
      ),
    ).toEqual({ total: "12.00" });
  });

  it("still reads a dotted arg as a path when no whole key matches", () => {
    expect(
      computeAll(
        [{ key: "subtotal", op: "sum", args: ["items.amount"] }],
        v({ "items.amount": "999.00", items: '[{"amount":"5.00"},{"amount":"6.00"}]' }),
        2,
      ),
    ).toEqual({ subtotal: "999.00" });
    expect(
      computeAll(
        [{ key: "subtotal", op: "sum", args: ["items.amount"] }],
        v({ items: '[{"amount":"5.00"},{"amount":"6.00"}]' }),
        2,
      ),
    ).toEqual({ subtotal: "11.00" });
  });

  it("subtracts", () => {
    // Only `add` reached this branch's sibling, so flipping the `-=` to `+=`
    // left every test green.
    expect(
      computeAll([{ key: "k", op: "subtract", args: ["a", "b"] }], v({ a: "10.00", b: "5.25" }), 2),
    ).toEqual({ k: "4.75" });
    expect(
      computeAll([{ key: "k", op: "subtract", args: ["a", "b", "c"] }], v({ a: "10.00", b: "4.00", c: "1.25" }), 2),
    ).toEqual({ k: "4.75" });
  });

  it("reads a numeric cell and the same cell as text alike", () => {
    // `itemsOf` hands back `JSON.parse` output, so an unquoted 1.005 in a host's
    // rows arrives as a number and used to price a paisa below its text twin.
    const rows = (cell: unknown) => JSON.stringify([{ amount: cell }]);
    const sumOne = (cell: unknown) =>
      computeAll([{ key: "subtotal", op: "sum", args: ["items.amount"] }], v({ items: rows(cell) }), 2);
    expect(sumOne(1.005)).toEqual({ subtotal: "1.01" });
    expect(sumOne("1.005")).toEqual({ subtotal: "1.01" });
    expect(sumOne(0.145)).toEqual({ subtotal: "0.15" });
    expect(sumOne("0.145")).toEqual({ subtotal: "0.15" });
    expect(sumOne(1.015)).toEqual({ subtotal: "1.02" });
  });

  it("carries a scale other than two through every op", () => {
    // Everything else passed scale 2, so the scale plumbing was untested.
    expect(
      computeAll([{ key: "k", op: "sum", args: ["items.amount"] }], v({ items: '[{"amount":"42"}]' }), 0),
    ).toEqual({ k: "42" });
    expect(
      computeAll([{ key: "k", op: "add", args: ["a", "b"] }], v({ a: "1.500", b: "0.250" }), 3),
    ).toEqual({ k: "1.750" });
    expect(
      computeAll(
        [{ key: "k", op: "percent", args: ["a"], rateKey: "r" }],
        v({ a: "100.000", r: "18" }),
        3,
      ),
    ).toEqual({ k: "18.000" });
    expect(
      computeAll(
        [{ key: "k", op: "sum-times", args: ["items.qty", "items.rate"] }],
        v({ items: '[{"qty":"1.500","rate":"2.000"}]' }),
        3,
      ),
    ).toEqual({ k: "3.000" });
  });

  it("refuses a product too large to hold exactly, which reads as zero", () => {
    const big = "9007199254.740991"; // 2^53 - 1, in minor units at scale 6
    expect(parseMinorUnits(big, 6)).toBe(9007199254740991);
    expect(
      computeAll([{ key: "k", op: "multiply", args: ["a", "b"] }], v({ a: big, b: big }), 6),
    ).toEqual({ k: "0.000000" });
  });

  it("pairs a product by row and reads a missing row as zero", () => {
    // Unequal row counts are a decision, not a derivation: this pins the current
    // pairing so a change to it has to be deliberate.
    expect(
      computeAll(
        [{ key: "k", op: "sum-times", args: ["x.qty", "y.rate"] }],
        v({ x: '[{"qty":"2"},{"qty":"3"}]', y: '[{"rate":"5.00"}]' }),
        2,
      ),
    ).toEqual({ k: "10.00" });
  });
});
