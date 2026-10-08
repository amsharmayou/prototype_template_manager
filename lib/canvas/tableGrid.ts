import {
  columnLines,
  rowLines,
  sum,
  totalHeight,
  totalWidth,
} from "@/lib/template/geometry";

/**
 * A grid line segment in table-local coordinates.
 *
 * `vertical` segments run down a column edge; `horizontal` segments run across
 * a row edge. `at` is the offset of the edge from the table's own left/top, and
 * `length` is how far it runs.
 */
export interface GridSegment {
  vertical: boolean;
  at: number;
  length: number;
  /** False for the outermost edges, which form the frame. */
  interior: boolean;
}

/**
 * Every line of a table's grid, each listed **exactly once**.
 *
 * The grid used to be painted by stroking a full rectangle per cell. An
 * interior edge is shared by two neighbouring cells, so it was stroked twice —
 * once from each side — while the outer boundary was stroked once. Two strokes
 * of the same colour over the same pixels darken the line and widen it through
 * anti-aliasing, which is why the inside of a table looked heavier than its
 * frame. Listing the edges here instead means the painter draws each line once
 * and every line is identical.
 *
 * The frame is reported as four segments rather than one rectangle so both the
 * canvas and the SVG painter consume the same list and cannot drift apart.
 */
export function gridSegments(
  colWidths: readonly number[],
  rowHeights: readonly number[],
): GridSegment[] {
  const xs = columnLines(colWidths);
  const ys = rowLines(rowHeights);
  const w = totalWidth(colWidths);
  const h = totalHeight(rowHeights);
  const out: GridSegment[] = [];
  const lastCol = xs.length - 1;
  const lastRow = ys.length - 1;

  // Column edges: the first and last are the frame's sides, the rest are the
  // interior dividers.
  for (let i = 0; i < xs.length; i += 1) {
    out.push({
      vertical: true,
      at: xs[i]!,
      length: h,
      interior: i > 0 && i < lastCol,
    });
  }
  // Row edges: same, for the frame's top and bottom and the interior dividers.
  for (let i = 0; i < ys.length; i += 1) {
    out.push({
      vertical: false,
      at: ys[i]!,
      length: w,
      interior: i > 0 && i < lastRow,
    });
  }
  return out;
}

/** The table's own width, so a painter need not recompute it. */
export function gridWidth(colWidths: readonly number[]): number {
  return sum(colWidths);
}

/** The table's own height. */
export function gridHeight(rowHeights: readonly number[]): number {
  return sum(rowHeights);
}

/**
 * A table's interior grid edges, in scene coordinates, as snap levels.
 *
 * The table's outer box already contributes levels through its bounding box, so
 * only the dividers between cells are added. A table's column edges are
 * vertical guides (`x`) and its row edges horizontal ones (`y`).
 *
 * A `BillTable` is never scaled — the controller forces `scaleX`/`scaleY` back
 * to 1 and resizes by rewriting `colWidths`/`rowHeights` — so a local offset
 * maps to the scene by simple addition. That assumption is what lets this stay
 * a pure function with no Fabric object in it.
 */
export function interiorGridLevels(
  colWidths: readonly number[],
  rowHeights: readonly number[],
  origin: { x: number; y: number },
): { x: number[]; y: number[] } {
  const x = new Set<number>();
  const y = new Set<number>();
  for (const seg of gridSegments(colWidths, rowHeights)) {
    if (!seg.interior) continue;
    // A zero-width column puts two dividers on the same spot, so the levels are
    // collected in sets: a duplicate is harmless to the snap maths but only
    // widens the candidate list for every object on the canvas.
    if (seg.vertical) x.add(origin.x + seg.at);
    else y.add(origin.y + seg.at);
  }
  return { x: [...x], y: [...y] };
}