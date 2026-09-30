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
  if (maxTotal !== undefined) {
    let total = sum(list);
    // Shrink from the last column backwards so the left-hand columns keep
    // their measured widths, which is what users expect when dragging.
    while (total > maxTotal && list.length > 1) {
      const i = list.length - 1;
      const excess = total - maxTotal;
      const reducible = list[i]! - min;
      const take = Math.min(reducible, excess);
      list[i]! -= take;
      total -= take;
      if (take === 0) break;
    }
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

/** Resize columns to a new total width, preserving their relative ratios. */
export function scaleColWidths(
  colWidths: readonly number[],
  newTotal: number,
  min = MIN_COL_WIDTH,
): number[] {
  const current = totalWidth(colWidths);
  if (current <= 0) return [...colWidths];
  const raw = colWidths.map((w) => (w / current) * newTotal);
  const floored = raw.map((w) => Math.max(min, Math.round(w)));
  // Give any rounding remainder to the widest column.
  const diff = Math.round(newTotal) - sum(floored);
  if (diff !== 0) {
    let widest = 0;
    for (let i = 1; i < floored.length; i++) {
      if (floored[i]! > floored[widest]!) widest = i;
    }
    floored[widest] = Math.max(min, floored[widest]! + diff);
  }
  return floored;
}

export function scaleRowHeights(
  rowHeights: readonly number[],
  newTotal: number,
  min = MIN_ROW_HEIGHT,
): number[] {
  const current = totalHeight(rowHeights);
  if (current <= 0) return [...rowHeights];
  const raw = rowHeights.map((h) => (h / current) * newTotal);
  const floored = raw.map((h) => Math.max(min, Math.round(h)));
  const diff = Math.round(newTotal) - sum(floored);
  if (diff !== 0) {
    let tallest = 0;
    for (let i = 1; i < floored.length; i++) {
      if (floored[i]! > floored[tallest]!) tallest = i;
    }
    floored[tallest] = Math.max(min, floored[tallest]! + diff);
  }
  return floored;
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
