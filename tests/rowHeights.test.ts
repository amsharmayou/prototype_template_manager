import { describe, expect, it } from "vitest";

import { applyRowHeights, cellKey, rowsWithIdentity } from "@/lib/render/rowHeights";
import type { ContentMeasurement } from "@/lib/render/measure";
import type { TableObject } from "@/lib/template/types";

/**
 * Variable-height repeat rows.
 *
 * A row has to be as tall as its tallest cell, and the whole band has to grow
 * around it. The trap is that row height is not an independent number per row:
 * the table's height is the sum, so getting one row wrong shifts every border
 * and the trailer below it.
 */

const CELL = { text: "", textAlign: "left", fontSize: 10, fontWeight: "normal" } as const;

function table(over: Partial<TableObject> = {}): TableObject {
  return {
    id: "t1",
    type: "table",
    name: "Items",
    role: null,
    x: 10,
    y: 100,
    width: 400,
    height: 60,
    zIndex: 0,
    visible: true,
    locked: false,
    rows: 2,
    columns: 2,
    colWidths: [200, 200],
    rowHeights: [30, 30],
    cells: [CELL, CELL, CELL, CELL],
    borderColor: "#000000",
    borderWidth: 1,
    cellFill: "#ffffff",
    headerRow: false,
    headerFill: "#eeeeee",
    headerTextColor: "#000000",
    cellTextColor: "#000000",
    padding: 4,
    fontFamily: "Arial",
    ...over,
  } as TableObject;
}

describe("a stable key for one rendered cell", () => {
  it("is the same for the same table, row and column", () => {
    expect(cellKey("t1", 2, 3)).toBe(cellKey("t1", 2, 3));
  });

  it("differs across rows and columns", () => {
    expect(cellKey("t1", 2, 3)).not.toBe(cellKey("t1", 3, 3));
    expect(cellKey("t1", 2, 3)).not.toBe(cellKey("t1", 2, 4));
  });

  it("does not collide between two tables", () => {
    // Two tables routinely have a cell at (0,0); if the keys collided, the
    // second table would silently inherit the first one's measured height.
    expect(cellKey("t1", 0, 0)).not.toBe(cellKey("t2", 0, 0));
  });

  it("is not confused by a separator that also appears in an id", () => {
    expect(cellKey("a:1", 2, 3)).not.toBe(cellKey("a", 1, 2));
  });
});

describe("row height is the tallest cell that can grow", () => {
  it("takes the tallest cell in the row", () => {
    const m: Record<string, ContentMeasurement> = {
      [cellKey("t1", 0, 0)]: { naturalWidth: 40, height: 12 },
      [cellKey("t1", 0, 1)]: { naturalWidth: 90, height: 44 },
      [cellKey("t1", 1, 0)]: { naturalWidth: 40, height: 60 },
      [cellKey("t1", 1, 1)]: { naturalWidth: 40, height: 20 },
    };
    // Row 0: tallest 44 + 2x4 padding. Row 1: tallest 60 + 8, over its
    // authored 30.
    const out = applyRowHeights(table(), m);

    expect(out.rowHeights).toEqual([52, 68]);
  });

  it("adds the cell padding once, not once per cell", () => {
    const t = table({ padding: 6 });
    const m: Record<string, ContentMeasurement> = {
      [cellKey("t1", 0, 0)]: { naturalWidth: 40, height: 20 },
      [cellKey("t1", 0, 1)]: { naturalWidth: 40, height: 20 },
    };
    const out = applyRowHeights(t, m);

    // Two identical cells must not produce a taller row than one, so the
    // padding is applied to the tallest only.
    expect(out.rowHeights[0]).toBe(32);
  });

  it("never shrinks a row below what the author traced", () => {
    const m: Record<string, ContentMeasurement> = {
      [cellKey("t1", 0, 0)]: { naturalWidth: 10, height: 4 },
    };
    const out = applyRowHeights(table({ rowHeights: [30, 30] }), m);

    expect(out.rowHeights[0]).toBe(30);
  });

  it("keeps the authored height when nothing was measured", () => {
    const out = applyRowHeights(table({ rowHeights: [30, 30] }), {});

    expect(out.rowHeights).toEqual([30, 30]);
    expect(out.height).toBe(60);
  });

  it("ignores a measurement that is not a usable size", () => {
    // A record with a broken width is malformed as a whole; honouring its
    // height alone would let half a bad measurement resize the row.
    const m: Record<string, ContentMeasurement> = {
      [cellKey("t1", 0, 0)]: { naturalWidth: Number.NaN, height: 999 },
    };
    const out = applyRowHeights(table(), m);

    expect(out.rowHeights[0]).toBe(30);
  });

  it("ignores a measurement with no usable height", () => {
    const m: Record<string, ContentMeasurement> = {
      [cellKey("t1", 0, 0)]: { naturalWidth: 40, height: Number.NaN },
    };
    const out = applyRowHeights(table(), m);

    expect(out.rowHeights[0]).toBe(30);
  });

  it("stops a row at its declared growth limit", () => {
    const m: Record<string, ContentMeasurement> = {
      [cellKey("t1", 0, 0)]: { naturalWidth: 40, height: 500 },
    };
    const out = applyRowHeights(table({ rowHeights: [30, 30] }), m, { maxGrowth: 100 });

    expect(out.rowHeights[0]).toBe(130);
  });
});

describe("the table grows around its rows", () => {
  it("sets height to the sum of the new row heights", () => {
    const m: Record<string, ContentMeasurement> = {
      [cellKey("t1", 0, 0)]: { naturalWidth: 40, height: 50 },
      [cellKey("t1", 1, 0)]: { naturalWidth: 40, height: 70 },
    };
    const out = applyRowHeights(table(), m);

    // 58 + 78: each row's tallest cell plus top and bottom padding.
    expect(out.height).toBe(136);
  });

  it("moves nothing itself - the layout pass owns position", () => {
    const m: Record<string, ContentMeasurement> = {
      [cellKey("t1", 0, 0)]: { naturalWidth: 40, height: 50 },
    };
    const out = applyRowHeights(table(), m);

    // A taller table must not drag its own top edge up or down: it grows
    // downwards and whatever sits below it is moved by a guide.
    expect(out.y).toBe(100);
    expect(out.x).toBe(10);
  });
});

describe("rendered row identity", () => {
  it("is unique per rendered row and stable for a render", () => {
    const ids = rowsWithIdentity(table());

    expect(ids).toEqual([0, 1]);
    expect(new Set(ids).size).toBe(2);
    expect(rowsWithIdentity(table())).toEqual(ids);
  });

  it("spans the whole expanded table, not the original template", () => {
    // After expansion the table already carries its final row count, so every
    // rendered row gets an identity - including the repeats and the trailer.
    expect(rowsWithIdentity(table({ rows: 5 }))).toEqual([0, 1, 2, 3, 4]);
  });

  it("is empty when the table has no rows", () => {
    expect(rowsWithIdentity(table({ rows: 0 }))).toEqual([]);
  });
});