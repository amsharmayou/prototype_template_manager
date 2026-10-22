import { expect, it, describe } from "vitest";

import { computeAll, withRowsComputed } from "@/lib/render/computed";
import { expandRepeats } from "@/lib/render/repeat";
import { applyDisplayFormats } from "@/lib/render/formats";
import type { ComputedSpec } from "@/lib/package/format";

const rowsJson = (rows: Record<string, string>[]): string => JSON.stringify(rows);

const LINE: ComputedSpec = { key: "line", op: "sum-times", args: ["rows.qty", "rows.rate"] };
const SUM_LINE: ComputedSpec = { key: "grand", op: "sum", args: ["rows.line"] };

describe("count-scale products", () => {
  it("keeps a fractional count intact through a product", () => {
    const values = { rows: rowsJson([{ qty: "0.125", rate: "550.25" }]) };
    const out = computeAll([LINE], values, 2, { qtyScale: 6 });
    // 0.125 x 550.25 = 68.78125 -> 68.78; a count read at the currency scale
    // would have turned 0.125 into 0.13 and printed 71.53.
    expect(out.line).toBe("68.78");
  });

  it("handles whole-unit counts identically", () => {
    const values = { rows: rowsJson([{ qty: "2", rate: "12.50" }]) };
    expect(computeAll([LINE], values, 2).line).toBe("25.00");
  });
});

describe("negative rounding parity", () => {
  const percent: ComputedSpec = { key: "c", op: "percent", args: ["base"], rateKey: "rate" };

  it("rounds the same magnitude on both sides of zero", () => {
    // 0.10 at 5% lands on exactly half a paisa, the one figure where the two
    // candidate rules disagree. Half away from zero gives one paisa each way;
    // the old Math.round path pushed the negative side toward zero (to -0.00).
    const plus = computeAll([percent], { base: "0.10", rate: "5" }, 2).c;
    const minus = computeAll([percent], { base: "-0.10", rate: "5" }, 2).c;
    expect(plus).toBe("0.01");
    expect(minus).toBe("-0.01");
  });

  it("keeps non-half figures exact on both sides", () => {
    const plus = computeAll([percent], { base: "123.45", rate: "5" }, 2).c;
    const minus = computeAll([percent], { base: "-123.45", rate: "5" }, 2).c;
    expect(plus).toBe("6.17");
    expect(minus).toBe("-6.17");
  });
});

describe("withRowsComputed", () => {
  const template = {
    objects: [{ type: "table", repeat: { key: "rows" } }, { type: "text" }],
  };

  it("folds each band's per-row figures into its rows", () => {
    const values = { rows: rowsJson([{ qty: "0.125", rate: "550.25" }, { qty: "2", rate: "12.50" }]) };
    const augmented = withRowsComputed(template, [LINE], values, 2, { qtyScale: 6 });
    const rows = JSON.parse(augmented.rows) as Array<Record<string, string>>;
    expect(rows[0]?.line).toBe("68.78");
    expect(rows[1]?.line).toBe("25.00");
  });

  it("lets the grand sum read the engine's per-row figures", () => {
    const values = { rows: rowsJson([{ qty: "0.125", rate: "550.25" }, { qty: "2", rate: "12.50" }]) };
    const augmented = withRowsComputed(template, [LINE, SUM_LINE], values, 2, { qtyScale: 6 });
    const out = computeAll([SUM_LINE], augmented, 2);
    expect(out.grand).toBe("93.78");
  });

  it("makes a hand-typed line figure irrelevant to the sum", () => {
    const typed = { rows: rowsJson([{ qty: "2", rate: "12.50", line: "999.00" }]) };
    const augmented = withRowsComputed(template, [LINE, SUM_LINE], typed, 2);
    const out = computeAll([SUM_LINE], augmented, 2);
    expect(out.grand).toBe("25.00");
  });
});

describe("band rows inside expansion", () => {
  it("binds per-row computed columns into the drawn cells", () => {
    const table = {
      type: "table",
      name: "Rows",
      id: "t1",
      x: 0,
      y: 0,
      width: 200,
      height: 60,
      rows: 2,
      columns: 2,
      colWidths: [100, 100],
      rowHeights: [30, 30],
      cells: [
        { text: "{{qty}}", textAlign: "left", fontSize: 10, fontWeight: "normal" },
        { text: "{{line}}", textAlign: "left", fontSize: 10, fontWeight: "normal" },
        { text: "{{rate}}", textAlign: "left", fontSize: 10, fontWeight: "normal" },
        { text: "{{line}}", textAlign: "left", fontSize: 10, fontWeight: "normal" },
      ],
      padding: 0,
      fontFamily: "Arial",
      repeat: { key: "rows", startRow: 0, endRow: 1, maxItems: 50 },
    };
    const values = { rows: rowsJson([{ qty: "0.125", rate: "550.25" }]), ...{ line: "" } };
    const { objects } = expandRepeats([table as never], values, 2000, {
      specs: [LINE],
      scale: 2,
      qtyScale: 6,
    });
    const cells = (objects[0] as { cells: Array<{ text: string }> }).cells;
    expect(cells.map((c) => c.text)).toEqual(["0.125", "68.78", "550.25", "68.78"]);
  });
});

describe("display shaping", () => {
  it("groups Indian-style", () => {
    const out = applyDisplayFormats(
      { a: "1234567", b: "1000", c: "1234567.5" },
      { a: { grouping: "indian" }, b: { grouping: "indian" }, c: { grouping: "indian" } },
    );
    expect(out.a).toBe("12,34,567");
    expect(out.b).toBe("1,000");
    expect(out.c).toBe("12,34,567.5");
  });

  it("groups western-style and can switch grouping off", () => {
    const out = applyDisplayFormats(
      { a: "1234567", b: "1234567" },
      { a: { grouping: "western" }, b: { grouping: "off" } },
    );
    expect(out.a).toBe("1,234,567");
    expect(out.b).toBe("1234567");
  });

  it("shapes stored ISO calendar values by pattern", () => {
    const out = applyDisplayFormats(
      { d1: "2026-10-03", d2: "2026-10-03" },
      { d1: { date: "DD/MM/YYYY" }, d2: { date: "YYYY-MM-DD" } },
    );
    expect(out.d1).toBe("03/10/2026");
    expect(out.d2).toBe("2026-10-03");
  });

  it("leaves prose and unclear figures untouched", () => {
    const out = applyDisplayFormats(
      { a: "to be decided", b: "", c: "INV-1042" },
      { a: { grouping: "indian" }, b: { grouping: "indian" }, c: { grouping: "indian" } },
    );
    expect(out.a).toBe("to be decided");
    expect(out.b).toBe("");
    expect(out.c).toBe("INV-1042");
  });
});
