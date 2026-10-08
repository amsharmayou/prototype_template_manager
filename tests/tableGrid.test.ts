import { describe, expect, it } from "vitest";

import { gridSegments, interiorGridLevels } from "@/lib/canvas/tableGrid";

const COLS = [100, 100, 100];
const ROWS = [30, 30];

describe("gridSegments", () => {
  it("emits one segment per edge, never one per cell", () => {
    // 3 columns -> 4 column edges. 2 rows -> 3 row edges. Seven segments total,
    // against the 6 cells the old per-cell painter would have stroked.
    const segs = gridSegments(COLS, ROWS);
    expect(segs).toHaveLength(7);
  });

  it("keeps the segment count linear in the edges, not quadratic in the cells", () => {
    // 20x10 table: 21 column edges + 11 row edges = 32, versus 200 cells.
    const cols = Array.from({ length: 20 }, () => 40);
    const rows = Array.from({ length: 10 }, () => 20);
    expect(gridSegments(cols, rows)).toHaveLength(32);
  });

  it("emits no segment twice at the same position", () => {
    const segs = gridSegments(COLS, ROWS);
    const keys = segs.map((s) => `${s.vertical ? "v" : "h"}:${s.at}`);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it("marks only the outermost edges as frame", () => {
    const segs = gridSegments(COLS, ROWS);
    const verticals = segs.filter((s) => s.vertical);
    // First column edge (left) and last (right) are the frame.
    expect(verticals[0]!.interior).toBe(false);
    expect(verticals[verticals.length - 1]!.interior).toBe(false);
    // The middle one is a divider.
    expect(verticals[1]!.interior).toBe(true);

    const horizontals = segs.filter((s) => !s.vertical);
    expect(horizontals[0]!.interior).toBe(false);
    expect(horizontals[horizontals.length - 1]!.interior).toBe(false);
    expect(horizontals[1]!.interior).toBe(true);
  });

  it("places the edges at the cumulative offsets", () => {
    const segs = gridSegments(COLS, ROWS);
    const verticals = segs.filter((s) => s.vertical).map((s) => s.at);
    expect(verticals).toEqual([0, 100, 200, 300]);
    const horizontals = segs.filter((s) => !s.vertical).map((s) => s.at);
    expect(horizontals).toEqual([0, 30, 60]);
  });

  it("gives every vertical the full height and every horizontal the full width", () => {
    const segs = gridSegments(COLS, ROWS);
    for (const s of segs.filter((x) => x.vertical)) expect(s.length).toBe(60);
    for (const s of segs.filter((x) => !x.vertical)) expect(s.length).toBe(300);
  });

  it("handles a single column or row without inventing interior lines", () => {
    const oneCol = gridSegments([100], [30, 30]);
    expect(oneCol.filter((s) => s.vertical)).toHaveLength(2);
    expect(oneCol.filter((s) => s.vertical).every((s) => !s.interior)).toBe(true);
    expect(oneCol.filter((s) => !s.vertical)).toHaveLength(3);

    const oneRow = gridSegments([100, 100], [30]);
    expect(oneRow.filter((s) => !s.vertical)).toHaveLength(2);
    expect(oneRow.filter((s) => !s.vertical).every((s) => !s.interior)).toBe(true);
  });

  it("produces only the frame for a 1x1 table", () => {
    const segs = gridSegments([100], [30]);
    expect(segs).toHaveLength(4);
    expect(segs.every((s) => !s.interior)).toBe(true);
  });

  it("returns nothing usable for an empty table", () => {
    // Degenerate, but the painter must not throw on a half-built table.
    expect(gridSegments([], [])).toHaveLength(2);
    expect(gridSegments([], []).every((s) => !s.interior)).toBe(true);
  });
});

describe("interiorGridLevels", () => {
  it("offers the dividers but not the frame", () => {
    // A table's outer box already contributes levels through its bounding box,
    // so repeating them here would only add noise.
    const levels = interiorGridLevels(COLS, ROWS, { x: 0, y: 0 });
    // 3 columns -> 2 interior dividers; 2 rows -> 1 interior divider.
    expect(levels.x).toEqual([100, 200]);
    expect(levels.y).toEqual([30]);
  });

  it("offsets every level by the table's own position", () => {
    const levels = interiorGridLevels(COLS, ROWS, { x: 200, y: 500 });
    expect(levels.x).toEqual([300, 400]);
    expect(levels.y).toEqual([530]);
  });

  it("offers every divider of a larger table", () => {
    // 8 columns -> 7 dividers, 5 rows -> 4 dividers.
    const cols = Array.from({ length: 8 }, () => 50);
    const rows = Array.from({ length: 5 }, () => 20);
    const levels = interiorGridLevels(cols, rows, { x: 0, y: 0 });
    expect(levels.x).toHaveLength(7);
    expect(levels.y).toHaveLength(4);
    expect(levels.x).toEqual([50, 100, 150, 200, 250, 300, 350]);
    expect(levels.y).toEqual([20, 40, 60, 80]);
  });

  it("offers nothing for a single-column or single-row table", () => {
    expect(interiorGridLevels([100], [30, 30], { x: 0, y: 0 })).toEqual({
      x: [],
      y: [30],
    });
    expect(interiorGridLevels([100, 100], [30], { x: 0, y: 0 })).toEqual({
      x: [100],
      y: [],
    });
  });

  it("offers nothing for a 1x1 table", () => {
    expect(interiorGridLevels([100], [30], { x: 10, y: 10 })).toEqual({
      x: [],
      y: [],
    });
  });

  it("never repeats a level, even for zero-width columns", () => {
    // Degenerate geometry must not flood the candidate list with duplicates.
    const levels = interiorGridLevels([100, 0, 100], [30], { x: 0, y: 0 });
    expect(new Set(levels.x).size).toBe(levels.x.length);
  });
});