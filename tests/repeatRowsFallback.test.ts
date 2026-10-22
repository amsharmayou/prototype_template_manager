import { describe, expect, it } from "vitest";

import { expandRepeats } from "@/lib/render/repeat";
import type { TableObject } from "@/lib/template/types";

/**
 * A table that omits `rows`.
 *
 * Every template this project writes carries `rows`, so nothing in the editor
 * or the serialiser produces one of these. But the renderer reads templates
 * written by other tools, and before this was handled a band on such a table
 * was refused with "last row is past the end of the table" — every repeating
 * row silently dropped, leaving only a warning nobody would see on a bill.
 */

const CELL = { text: "", textAlign: "left", fontSize: 10, fontWeight: "normal" } as const;

function table(over: Partial<TableObject> = {}): TableObject {
  return {
    id: "t1",
    type: "table",
    name: "Items",
    role: null,
    x: 0,
    y: 0,
    width: 400,
    height: 90,
    zIndex: 0,
    visible: true,
    locked: false,
    columns: 2,
    colWidths: [200, 200],
    rowHeights: [20, 30, 40],
    cells: [
      { ...CELL, text: "Desc" },
      { ...CELL, text: "Amt" },
      { ...CELL, text: "{{d}}" },
      { ...CELL, text: "{{a}}" },
      { ...CELL, text: "Total" },
      { ...CELL, text: "T" },
    ],
    borderColor: "#000000",
    borderWidth: 1,
    cellFill: "#ffffff",
    headerRow: true,
    headerFill: "#eeeeee",
    headerTextColor: "#000000",
    cellTextColor: "#000000",
    padding: 4,
    fontFamily: "Arial",
    repeat: { startRow: 1, endRow: 1, key: "items" },
    ...over,
  } as TableObject;
}

const ITEMS = JSON.stringify([
  { d: "one", a: "1" },
  { d: "two", a: "2" },
]);

describe("a table with no rows field", () => {
  it("still expands its band", () => {
    const out = expandRepeats([table()], { items: ITEMS }, 1123);
    const t = out.objects[0] as TableObject;

    // 1 header + 2 items + 1 trailer.
    expect(t.rows).toBe(4);
    expect(t.cells).toHaveLength(8);
  });

  it("says nothing went wrong", () => {
    // The refusal that used to fire here was a warning, so the band looked
    // like it had been dropped for a reason rather than by a bug.
    expect(expandRepeats([table()], { items: ITEMS }, 1123).warnings).toEqual([]);
  });

  it("fills the items' own values into the cells", () => {
    const t = expandRepeats([table()], { items: ITEMS }, 1123).objects[0] as TableObject;

    expect(t.cells.map((c) => c.text)).toEqual(["Desc", "Amt", "one", "1", "two", "2", "Total", "T"]);
  });

  it("expands even when the cell array is missing entirely", () => {
    // `rowHeights` alone is enough to know where the band may sit, so the rows
    // it cannot fill come back empty rather than the band being refused.
    const t = table({ cells: [] });
    const out = expandRepeats([t], { items: ITEMS }, 1123);
    const r = out.objects[0] as TableObject;

    expect(out.warnings).toEqual([]);
    expect(r.rows).toBe(4);
    expect(r.cells.every((c) => c.text === "")).toBe(true);
  });

  it("still refuses a genuinely empty table", () => {
    // The fallback must not turn a refusal into a silent success.
    const empty = table({ cells: [], rowHeights: [] });
    const out = expandRepeats([empty], { items: ITEMS }, 1123);

    expect(out.warnings.join(" ")).toContain("past the end");
  });

  it("trusts an explicit rows field when one is present", () => {
    const explicit = table({ rows: 3 });
    const t = expandRepeats([explicit], { items: ITEMS }, 1123).objects[0] as TableObject;

    expect(t.rows).toBe(4);
  });

  it("does not change a table that already worked", () => {
    const t = expandRepeats([table({ rows: 3 })], { items: ITEMS }, 1123).objects[0] as TableObject;

    expect(t.rows).toBe(4);
    expect(t.rowHeights).toEqual([20, 30, 30, 40]);
  });
});