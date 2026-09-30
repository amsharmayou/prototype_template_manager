import { describe, expect, it } from "vitest";

import {
  MIN_COL_WIDTH,
  allCellRects,
  cellIndex,
  cellRect,
  columnLines,
  evenSizes,
  fromCellIndex,
  hitTestCell,
  normaliseSizes,
  offsets,
  rowLines,
  scaleColWidths,
  scaleRowHeights,
  scaleSizesProportionally,
  sum,
  totalHeight,
  totalWidth,
} from "@/lib/template/geometry";

const COLS = [80, 120, 60];
const ROWS = [30, 30, 30, 30];

describe("offsets / sum", () => {
  it("produces inclusive prefix sums", () => {
    expect(offsets([10, 20, 30])).toEqual([0, 10, 30]);
    expect(sum([10, 20, 30])).toBe(60);
  });

  it("handles an empty list", () => {
    expect(offsets([])).toEqual([]);
    expect(sum([])).toBe(0);
  });
});

describe("cellRect", () => {
  it("places every cell on its grid slot", () => {
    // Row 1, column 1 starts after col 0 (80) and row 0 (30).
    expect(cellRect(COLS, ROWS, 1, 1)).toEqual({
      x: 80,
      y: 30,
      width: 120,
      height: 30,
      row: 1,
      column: 1,
    });
  });

  it("gives the first cell the origin", () => {
    expect(cellRect(COLS, ROWS, 0, 0)).toMatchObject({ x: 0, y: 0 });
  });

  it("tiles the table exactly with no gaps or overlap", () => {
    const rects = allCellRects(COLS, ROWS);
    expect(rects).toHaveLength(12);
    // Every cell's right edge equals the next cell's left edge in a row.
    for (let r = 0; r < ROWS.length; r++) {
      for (let c = 0; c < COLS.length - 1; c++) {
        const a = cellRect(COLS, ROWS, r, c);
        const b = cellRect(COLS, ROWS, r, c + 1);
        expect(a.x + a.width).toBeCloseTo(b.x, 10);
      }
    }
    // The last cell's corner equals the table's corner.
    const last = rects[rects.length - 1]!;
    expect(last.x + last.width).toBe(totalWidth(COLS));
    expect(last.y + last.height).toBe(totalHeight(ROWS));
  });
});

describe("hitTestCell", () => {
  it.each([
    [0, 0],
    [0, 1],
    [0, 2],
    [1, 0],
    [1, 1],
    [1, 2],
    [2, 0],
    [2, 1],
    [3, 2],
  ])("resolves the centre of cell r%i c%i", (row, column) => {
    const rect = cellRect(COLS, ROWS, row, column);
    const hit = hitTestCell(
      COLS,
      ROWS,
      rect.x + rect.width / 2,
      rect.y + rect.height / 2,
    );
    expect(hit).not.toBeNull();
    expect(hit!.row).toBe(row);
    expect(hit!.column).toBe(column);
  });

  it("returns null outside the grid", () => {
    expect(hitTestCell(COLS, ROWS, -1, 0)).toBeNull();
    expect(hitTestCell(COLS, ROWS, 0, -1)).toBeNull();
    expect(hitTestCell(COLS, ROWS, totalWidth(COLS) + 1, 0)).toBeNull();
    expect(hitTestCell(COLS, ROWS, 0, totalHeight(ROWS) + 1)).toBeNull();
  });

  it("assigns the shared edge to the lower/right cell", () => {
    // x exactly on the boundary between column 0 and 1.
    const hit = hitTestCell(COLS, ROWS, 80, 0);
    expect(hit!.column).toBe(1);
  });

  it("covers every cell with a dense sweep", () => {
    const seen = new Set<string>();
    for (let y = 0; y < totalHeight(ROWS); y += 5) {
      for (let x = 0; x < totalWidth(COLS); x += 5) {
        const hit = hitTestCell(COLS, ROWS, x, y);
        if (hit) seen.add(`${hit.row},${hit.column}`);
      }
    }
    expect(seen.size).toBe(12);
  });
});

describe("cell index mapping", () => {
  it("round-trips between index and grid coordinates", () => {
    for (let r = 0; r < ROWS.length; r++) {
      for (let c = 0; c < COLS.length; c++) {
        const idx = cellIndex(COLS, ROWS, r, c);
        expect(fromCellIndex(COLS, ROWS, idx)).toEqual({ row: r, column: c });
      }
    }
  });

  it("returns null for out of range indices", () => {
    expect(fromCellIndex(COLS, ROWS, -1)).toBeNull();
    expect(fromCellIndex(COLS, ROWS, 12)).toBeNull();
  });
});

describe("normaliseSizes", () => {
  it("drops non-finite and non-positive values", () => {
    expect(normaliseSizes([10, NaN, 0, -5, 20], 8)).toEqual([10, 20]);
  });

  it("falls back to the minimum when everything is invalid", () => {
    expect(normaliseSizes([NaN, 0], 8)).toEqual([8]);
  });

  it("clamps values below the minimum", () => {
    expect(normaliseSizes([1, 2, 100], 8)).toEqual([8, 8, 100]);
  });

  it("respects an optional maximum total", () => {
    const out = normaliseSizes([200, 200], 8, 250);
    expect(sum(out)).toBeLessThanOrEqual(250);
    expect(out.every((n) => n >= 8)).toBe(true);
  });
});

describe("evenSizes", () => {
  it("splits evenly and absorbs the rounding remainder", () => {
    const out = evenSizes(4, 100, 8);
    expect(sum(out)).toBe(100);
  });

  it("honours the minimum when the total is too small", () => {
    const out = evenSizes(4, 10, 8);
    expect(out.every((n) => n >= 8)).toBe(true);
  });

  it("always produces at least one entry", () => {
    expect(evenSizes(0, 100, 8)).toHaveLength(1);
  });
});

describe("scaleColWidths / scaleRowHeights", () => {
  it("preserves the total exactly", () => {
    expect(sum(scaleColWidths(COLS, 500))).toBe(500);
    expect(sum(scaleRowHeights(ROWS, 250))).toBe(250);
  });

  it("preserves relative proportions", () => {
    const out = scaleColWidths([100, 100], 400);
    expect(out[0]).toBe(out[1]);
    expect(out[0]).toBe(200);
  });

  it("never produces a column below the minimum", () => {
    const out = scaleColWidths([1000, 1, 1], 40);
    expect(out.every((n) => n >= MIN_COL_WIDTH)).toBe(true);
  });
});

describe("scaleSizesProportionally", () => {
  it("keeps the total exact", () => {
    expect(sum(scaleSizesProportionally([10, 10, 10], 100, 2))).toBe(100);
    expect(sum(scaleSizesProportionally([7, 11, 13], 47, 2))).toBe(47);
  });

  it("preserves ratios rather than equalising", () => {
    // 300:40:40 must stay 7.89:1:1, not collapse to 1:1:1.
    const out = scaleSizesProportionally([300, 40, 40], 380, 2);
    expect(out[0]).toBeGreaterThan(280);
    expect(out[1]).toBeLessThan(50);
    expect(sum(out)).toBe(380);
  });

  it("spreads the remainder across columns, not all onto the widest", () => {
    // 1/3 each of 100 cannot divide evenly, so exactly one column must
    // carry the extra pixel. The old implementation always picked index 0.
    const out = scaleSizesProportionally([1, 1, 1], 100, 2);
    const bumped = out.filter((n) => n === 34).length;
    expect(sum(out)).toBe(100);
    expect(bumped).toBe(1);
  });

  it("honours the minimum without losing the total", () => {
    const out = scaleSizesProportionally([1, 1000], 20, 8);
    expect(out[0]).toBe(8);
    expect(out[1]).toBe(12);
    expect(sum(out)).toBe(20);
  });

  it("is idempotent: same target twice gives the same result", () => {
    const once = scaleSizesProportionally([120, 30, 30], 500, 2);
    const twice = scaleSizesProportionally(once, 500, 2);
    expect(twice).toEqual(once);
  });

  it("returns a copy for a zero total instead of dividing by zero", () => {
    expect(scaleSizesProportionally([10, 20], 0, 2)).toEqual([10, 20]);
  });
});

describe("normaliseSizes maxTotal clamps upward as well as downward", () => {
  it("raises entries that sum below maxTotal", () => {
    // The old code only ever shrank, so a too-small total was ignored.
    const out = normaliseSizes([5, 5, 5], 2, 60);
    expect(sum(out)).toBe(60);
  });

  it("keeps ratios when clamping upward", () => {
    const out = normaliseSizes([10, 30], 2, 80);
    expect(sum(out)).toBe(80);
    expect(out[0]).toBeLessThan(out[1]!);
    expect(out[0]! / out[1]!).toBeGreaterThan(0.2);
    expect(out[0]! / out[1]!).toBeLessThan(0.45);
  });

  it("still shrinks an oversized total from the last column backwards", () => {
    const out = normaliseSizes([40, 40, 40], 2, 100);
    expect(sum(out)).toBe(100);
    expect(out[0]).toBe(40);
  });

  it("does not loop forever when even the minimums exceed maxTotal", () => {
    const out = normaliseSizes([40, 40, 40], 40, 10);
    expect(out.every((n) => n >= 40)).toBe(true);
  });
});

describe("gridlines", () => {
  it("emits n+1 edges for n columns", () => {
    const lines = columnLines(COLS);
    expect(lines).toHaveLength(COLS.length + 1);
    expect(lines[0]).toBe(0);
    expect(lines[lines.length - 1]).toBe(totalWidth(COLS));
  });

  it("emits n+1 edges for n rows", () => {
    const lines = rowLines(ROWS);
    expect(lines).toHaveLength(ROWS.length + 1);
    expect(lines[lines.length - 1]).toBe(totalHeight(ROWS));
  });
});
