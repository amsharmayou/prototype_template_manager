import { describe, expect, it } from "vitest";

import { BillTable } from "@/lib/canvas/objects/BillTable";
import { MIN_COL_WIDTH, MIN_ROW_HEIGHT, sum } from "@/lib/template/geometry";

function makeTable(colWidths: number[] = [300, 40, 40], rowHeights: number[] = [30, 30]) {
  return new BillTable({ colWidths, rowHeights, headerRow: false });
}

describe("BillTable cell re-indexing on shape change", () => {
  it("preserves absolute cell positions in a non-square grid", () => {
    const t = makeTable([100, 100, 100, 100, 100], [30, 30, 30]);
    // Place distinctive text per absolute cell.
    for (let r = 0; r < 3; r++) {
      for (let c = 0; c < 5; c++) {
        t.setCellText(r, c, `${r},${c}`);
      }
    }
    t.addRow(1, 30);

    expect(t.rows).toBe(4);
    expect(t.columns).toBe(5);
    // Original cells keep their (row, column) mapping through the insert.
    expect(t.getCell(0, 0)?.text).toBe("0,0");
    expect(t.getCell(0, 4)?.text).toBe("0,4");
    expect(t.getCell(2, 0)?.text).toBe("1,0");
    expect(t.getCell(3, 4)?.text).toBe("2,4");

    t.removeColumn(0);
    expect(t.getCell(0, 0)?.text).toBe("0,1");
    expect(t.getCell(0, 3)?.text).toBe("0,4");
  });
});

describe("BillTable resize gesture", () => {
  it("scales every column by the same factor", () => {
    const t = makeTable();
    t.set({ left: 10, top: 20 });
    // Pointer starts in the right half of the table, then moves +180 in x.
    t.beginResizeGesture({ x: 500, y: 60 });
    t.resizeColumnsTo(sum(t.colWidths) + 180);

    expect(sum(t.colWidths)).toBe(560);
    expect(t.colWidths[0]).toBeGreaterThan(440);
    expect(t.colWidths[1]!).toBeGreaterThanOrEqual(50);
    expect(t.colWidths[1]!).toBeLessThan(60);
  });

  it("never lets one column absorb the whole expansion", () => {
    const t = makeTable();
    t.beginResizeGesture({ x: 500, y: 60 });
    const before = [...t.colWidths];
    t.resizeColumnsTo(sum(before) * 2);
    for (let i = 0; i < t.columns; i++) {
      const ratio = t.colWidths[i]! / before[i]!;
      // Every column must be within 1px-of-total of the same scale factor.
      expect(Math.abs(ratio - 2)).toBeLessThan(0.05);
    }
  });

  it("resolves from the snapshot, so a drag that clamps cannot skew the ratios", () => {
    const t = makeTable();
    t.beginResizeGesture({ x: 500, y: 60 });

    // A clamp is the only thing that makes the snapshot differ from live
    // state: it destroys the column ratios irreversibly in the live grid.
    // Re-applying one absolute target proves nothing, because reaching it
    // twice is a no-op either way.
    t.resizeColumnsTo(3 * MIN_COL_WIDTH);
    expect(t.colWidths).toEqual([MIN_COL_WIDTH, MIN_COL_WIDTH, MIN_COL_WIDTH]);

    // Asking for the original 380 back must restore the original ratios:
    // from the snapshot -> [300, 40, 40]; from the collapsed live grid ->
    // [127, 127, 126], which is permanently skewed.
    t.resizeColumnsTo(380);
    expect(t.colWidths).toEqual([300, 40, 40]);
  });

  it("clamps at the minimum total instead of collapsing a column", () => {
    const t = makeTable([100, 100, 100, 100]);
    t.beginResizeGesture({ x: 500, y: 60 });
    t.resizeColumnsTo(1);
    expect(sum(t.colWidths)).toBe(MIN_COL_WIDTH * 4);
    expect(t.colWidths.every((n) => n >= MIN_COL_WIDTH)).toBe(true);
  });

  it("signs the delta from the handle side the pointer started on", () => {
    // The brief wrote `makeTable(2, 2, [200, 200])`, which passes the number
    // 2 as `colWidths` and drops the third argument entirely, so the
    // constructor threw before any resize call. The comment below already
    // specifies the intended grid: two 200px columns spanning 0..400.
    const t = makeTable([200, 200]);
    t.set({ left: 0, top: 0 });
    const startTotal = sum(t.colWidths);

    // Pointer starts in the LEFT half (table spans 0..400, so 100 is left).
    t.beginResizeGesture({ x: 100, y: 30 });
    expect(t.resizeGesture?.signX).toBe(-1);
    // Moving further left grows the table, exactly as a right-side handle
    // would when the pointer moves right.
    t.resizeColumnsTo(startTotal + 100);
    expect(sum(t.colWidths)).toBe(startTotal + 100);
  });

  it("moves both axes from one gesture and never changes left/top", () => {
    const t = makeTable();
    t.set({ left: 40, top: 15 });
    t.beginResizeGesture({ x: 500, y: 60 });
    const w = sum(t.colWidths);
    const h = sum(t.rowHeights);
    t.resizeColumnsTo(w + 100);
    t.resizeRowsTo(h + 40);
    expect(sum(t.colWidths)).toBe(w + 100);
    expect(sum(t.rowHeights)).toBe(h + 40);
    expect(t.left).toBe(40);
    expect(t.top).toBe(15);
  });

  it("falls back to live sizes when no gesture is active", () => {
    const t = makeTable();
    // This is what the properties panel calls; it must not need a gesture.
    t.resizeColumnsTo(200);
    expect(sum(t.colWidths)).toBe(200);
  });

  it("clamps the minimum total when no gesture is active", () => {
    const t = makeTable();
    t.resizeRowsTo(1);
    expect(sum(t.rowHeights)).toBe(MIN_ROW_HEIGHT * t.rows);
  });

  it("ends the gesture so the next resize starts fresh", () => {
    const t = makeTable();
    t.beginResizeGesture({ x: 500, y: 60 });
    t.resizeColumnsTo(500);
    t.endResizeGesture();

    // A pure resize cannot tell the two states apart: once the gesture is
    // gone the live grid is just the snapshot rescaled, so the ratios agree.
    // Collapsing is what separates them, because it rewrites the live grid
    // while the stale snapshot keeps the original ratios.
    t.resizeColumnsTo(3 * MIN_COL_WIDTH);
    t.resizeColumnsTo(500);

    // Gesture correctly ended: the base is the collapsed live grid, so the
    // first column lands near 500 / 3. If endResizeGesture were a no-op the
    // base would be the stale snapshot [300, 40, 40] and it would be 395.
    expect(t.colWidths[0]).toBeGreaterThan(150);
    expect(t.colWidths[0]).toBeLessThan(190);
  });

  it("round-trips the resized grid through the serialiser", async () => {
    // The resized grid is what a save writes, so a resize must survive
    // serialisation exactly: every column width the drag produced comes back
    // unchanged, and `width` is re-derived from them on load.
    const t = makeTable();
    t.beginResizeGesture({ x: 500, y: 60 });
    t.resizeColumnsTo(512);
    t.resizeRowsTo(71);

    const restored = await BillTable.fromObject(t.toObject());
    expect(restored.colWidths).toEqual(t.colWidths);
    expect(restored.rowHeights).toEqual(t.rowHeights);
    expect(restored.width).toBe(t.width);
    expect(restored.height).toBe(t.height);
  });

  it("never serialises a pending gesture", () => {
    const t = makeTable();
    t.beginResizeGesture({ x: 500, y: 60 });
    t.resizeColumnsTo(500);

    // A snapshot only means something inside one drag, so it must not be
    // saved: without the explicit null this key is absent, not null.
    expect(t.toObject().resizeGesture).toBeNull();
  });

  it("never restores a gesture, even from a payload that carries one", async () => {
    // `fromObject` passes everything it does not destructure straight into
    // `set`, so a stale or hand-edited payload could otherwise install a live
    // gesture that silently overrides every later resize.
    const payload = {
      ...makeTable().toObject(),
      resizeGesture: {
        colWidths: [1, 1, 1],
        rowHeights: [1, 1],
        width: 3,
        height: 2,
        startX: 0,
        startY: 0,
        signX: 1,
        signY: 1,
      },
    };

    const restored = await BillTable.fromObject(payload);
    expect(restored.resizeGesture).toBeNull();
  });
});
