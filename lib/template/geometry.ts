/**
 * Pure table geometry.
 *
 * All of this is deliberately free of Fabric and of the DOM so it can be
 * unit tested directly. A table's layout is fully described by
 * `colWidths` + `rowHeights`; every cell rectangle is derived from those.
 */

export interface CellRect {
  x: number;
  y: number;
  width: number;
  height: number;
  row: number;
  column: number;
}

export const MIN_COL_WIDTH = 8;
export const MIN_ROW_HEIGHT = 8;

export function sum(values: readonly number[]): number {
  let total = 0;
  for (const v of values) total += v;
  return total;
}

/** Inclusive prefix offsets: `starts[i]` is the offset of element `i`. */
export function offsets(sizes: readonly number[]): number[] {
  const out: number[] = [];
  let acc = 0;
  for (const s of sizes) {
    out.push(acc);
    acc += s;
  }
  return out;
}

export function columnsCount(colWidths: readonly number[]): number {
  return colWidths.length;
}

export function rowsCount(rowHeights: readonly number[]): number {
  return rowHeights.length;
}

export function totalWidth(colWidths: readonly number[]): number {
  return sum(colWidths);
}

export function totalHeight(rowHeights: readonly number[]): number {
  return sum(rowHeights);
}

/**
 * Normalise arbitrary input into a valid width list: at least one column,
 * each at least `min`, total clamped to `maxTotal` when provided.
 */
export function normaliseSizes(
  sizes: readonly number[],
  min: number,
  maxTotal?: number,
): number[] {
  const filtered = sizes.filter((n) => Number.isFinite(n) && n > 0);
  const list = (filtered.length ? filtered : [min]).map((n) =>
    Math.max(min, Math.round(n)),
  );
  if (maxTotal === undefined || list.length === 0) return list;

  const floor = min * list.length;
  const target = Math.max(floor, Math.round(maxTotal));
  const total = sum(list);
  if (total === target) return list;
  if (total < target) {
    return scaleSizesProportionally(list, target, min);
  }

  // Shrink from the last column backwards so the left-hand columns keep
  // their measured widths, which is what users expect when dragging.
  let excess = total - target;
  for (let i = list.length - 1; i >= 0 && excess > 0; i--) {
    const take = Math.min(list[i]! - min, excess);
    list[i]! -= take;
    excess -= take;
  }
  return list;
}

/** Even split of `total` across `count` columns, remainder on the last. */
export function evenSizes(count: number, total: number, min: number): number[] {
  const n = Math.max(1, Math.floor(count));
  const base = Math.max(min, Math.floor(total / n));
  const out = new Array<number>(n).fill(base);
  let used = base * n;
  let i = 0;
  while (used < total && i < n * 4) {
    out[i % n]! += 1;
    used += 1;
    i += 1;
  }
  return out;
}

export function distribute(
  colWidths: readonly number[],
  rowHeights: readonly number[],
  width: number,
  height: number,
): { colWidths: number[]; rowHeights: number[] } {
  return {
    colWidths: evenSizes(
      colWidths.length,
      width,
      MIN_COL_WIDTH,
    ),
    rowHeights: evenSizes(rowHeights.length, height, MIN_ROW_HEIGHT),
  };
}

/** Rectangle for a cell, relative to the table's top-left corner. */
export function cellRect(
  colWidths: readonly number[],
  rowHeights: readonly number[],
  row: number,
  column: number,
): CellRect {
  const x = sum(colWidths.slice(0, column));
  const y = sum(rowHeights.slice(0, row));
  return {
    x,
    y,
    width: colWidths[column] ?? 0,
    height: rowHeights[row] ?? 0,
    row,
    column,
  };
}

/** Every cell rectangle, row-major. */
export function allCellRects(
  colWidths: readonly number[],
  rowHeights: readonly number[],
): CellRect[] {
  const out: CellRect[] = [];
  for (let r = 0; r < rowHeights.length; r++) {
    for (let c = 0; c < colWidths.length; c++) {
      out.push(cellRect(colWidths, rowHeights, r, c));
    }
  }
  return out;
}

/**
 * Which cell contains a point given relative to the table's top-left?
 * Returns null when the point falls outside the grid or inside a gutter.
 */
export function hitTestCell(
  colWidths: readonly number[],
  rowHeights: readonly number[],
  x: number,
  y: number,
  tolerance = 0,
): CellRect | null {
  const colStarts = offsets(colWidths);
  const rowStarts = offsets(rowHeights);

  const findIndex = (
    starts: readonly number[],
    sizes: readonly number[],
    v: number,
  ): number => {
    for (let i = 0; i < sizes.length; i++) {
      const start = starts[i]!;
      const end = start + sizes[i]!;
      if (v >= start - tolerance && v < end + tolerance) return i;
    }
    return -1;
  };

  const col = findIndex(colStarts, colWidths, x);
  const row = findIndex(rowStarts, rowHeights, y);
  if (col < 0 || row < 0) return null;
  return cellRect(colWidths, rowHeights, row, col);
}

export function cellIndex(
  colWidths: readonly number[],
  rowHeights: readonly number[],
  row: number,
  column: number,
): number {
  return row * colWidths.length + column;
}

/** Grid coordinate from a flat cell index, or null when out of range. */
export function fromCellIndex(
  colWidths: readonly number[],
  rowHeights: readonly number[],
  index: number,
): { row: number; column: number } | null {
  const cols = colWidths.length;
  if (index < 0 || index >= cols * rowHeights.length) return null;
  return { row: Math.floor(index / cols), column: index % cols };
}

/**
 * Distribute `total` across `sizes` while preserving their ratios.
 *
 * Every entry is floored first, then the leftover pixels are handed out one at
 * a time to whichever entries lost the most to rounding, largest fraction
 * first. This keeps the result as proportional as integers allow instead of
 * giving the whole remainder to one column.
 *
 * Enforcing `min` can push the floored sum past the target (a 1:100 pair scaled
 * to 20 floors to 8 + 19 = 27), so an overshoot is corrected by taking pixels
 * back from the entries with the smallest fractions first.
 */
export function scaleSizesProportionally(
  sizes: readonly number[],
  total: number,
  min: number,
): number[] {
  const n = sizes.length;
  if (n === 0) return [];
  const current = sum(sizes);
  if (current <= 0 || !Number.isFinite(total) || total <= 0) return [...sizes];

  const target = Math.max(min * n, Math.round(total));
  const exact = sizes.map((s) => (s / current) * target);
  const out = exact.map((v) => Math.max(min, Math.floor(v)));
  const fracs = exact.map((v) => v - Math.floor(v));
  const orderByFraction = (descending: boolean) =>
    exact
      .map((_, i) => i)
      .sort((a, b) => (descending ? fracs[b]! - fracs[a]! : fracs[a]! - fracs[b]!));

  // The minimums may have overshot the target; take the excess back, starting
  // with the entries that lost least to rounding.
  let excess = sum(out) - target;
  if (excess > 0) {
    const order = orderByFraction(false);
    do {
      for (const i of order) {
        if (excess <= 0) break;
        if (out[i]! > min) {
          out[i]! -= 1;
          excess -= 1;
        }
      }
      // Re-enter the loop only while some entry is still above its minimum.
    } while (excess > 0 && out.some((v) => v > min));
    return out;
  }

  // Hand the leftover pixels to the entries that lost the most to flooring.
  const order = orderByFraction(true);
  let remaining = target - sum(out);
  while (remaining > 0 && out.some((_, i) => out[i]! < Math.floor(exact[i]!) + 1)) {
    for (const i of order) {
      if (remaining <= 0) break;
      if (out[i]! < Math.floor(exact[i]!) + 1) {
        out[i]! += 1;
        remaining -= 1;
      }
    }
  }
  return out;
}

/** Resize columns to a new total width, preserving their relative ratios. */
export function scaleColWidths(
  colWidths: readonly number[],
  newTotal: number,
  min = MIN_COL_WIDTH,
): number[] {
  if (totalWidth(colWidths) <= 0) return [...colWidths];
  return scaleSizesProportionally(colWidths, newTotal, min);
}

export function scaleRowHeights(
  rowHeights: readonly number[],
  newTotal: number,
  min = MIN_ROW_HEIGHT,
): number[] {
  if (totalHeight(rowHeights) <= 0) return [...rowHeights];
  return scaleSizesProportionally(rowHeights, newTotal, min);
}

/** Gridline positions (column edges) in table-local coordinates. */
export function columnLines(colWidths: readonly number[]): number[] {
  const starts = offsets(colWidths);
  return [...starts, totalWidth(colWidths)];
}

export function rowLines(rowHeights: readonly number[]): number[] {
  const starts = offsets(rowHeights);
  return [...starts, totalHeight(rowHeights)];
}
