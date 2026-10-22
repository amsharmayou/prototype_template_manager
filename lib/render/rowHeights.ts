import type { ContentMeasurement } from "./measure";
import { expandRepeats } from "./repeat";
import { computeAll } from "./computed";
import type { Values } from "./values";
import type { ComputedSpec, RoundingMode } from "@/lib/package/format";
import type { AxisExpansion, BillTemplate, TableObject } from "../template/types";

/**
 * Variable-height repeat rows.
 *
 * A row is as tall as its tallest cell, and the table's height is the sum of
 * the rows - so getting one row wrong shifts every border below it and the
 * trailer with them. That is why the table's own position is left untouched
 * here: it grows downwards, and whatever sits under it is moved by a guide in
 * the layout pass, not by a second guess about geometry made here.
 *
 * Pure, like the rest of `render`: the host supplies the cell measurements and
 * this decides what they mean.
 */

/** Tolerance so floating-point noise does not manufacture a growth. */
const TOLERANCE = 0.01;

/**
 * A stable, collision-free key for one rendered cell.
 *
 * The separator is a character that cannot appear in an object id, so
 * `a:1`/row 2/col 3 cannot collide with `a`/row 1/col 2. Two tables routinely
 * each hold a cell at (0,0), and a shared key would let one silently inherit
 * the other's measured height.
 */
export function cellKey(tableId: string, row: number, col: number): string {
  return `${tableId}|${row}|${col}`;
}

/** Optional per-row ceiling, expressed as growth beyond the authored height. */
export interface RowHeightLimits {
  /** Most a single row may grow beyond the height the author traced. */
  maxGrowth?: number;
}

/**
 * The row index each rendered row occupies in the expanded cell array.
 *
 * `0..count-1`. Render-only: identity here is deliberately positional, because
 * after expansion there is no template row left to name - and a key that was
 * saved into the source template would go stale the moment the band was
 * re-rendered with a different number of items.
 */
export function rowsWithIdentity(table: TableObject): number[] {
  return Array.from({ length: Math.max(0, table.rows) }, (_, i) => i);
}

/**
 * Does this table's row axis grow at all?
 *
 * A table with no policy is not measured: the host would spend a measurement
 * round-trip on geometry nobody reads.
 */
export function rowsWorthMeasuring(t: unknown): AxisExpansion | false {
  const e = (t as { expansion?: unknown }).expansion;
  if (typeof e !== "object" || e === null) return false;
  const y = (e as { y?: unknown }).y;
  if (typeof y !== "object" || y === null) return false;
  const mode = (y as { mode?: unknown }).mode;
  if (mode !== "bounded" && mode !== "unbounded") return false;
  const rec = y as { mode: "bounded" | "unbounded"; maxGrowth?: unknown };
  const out: AxisExpansion = { mode: rec.mode };
  if (typeof rec.maxGrowth === "number" && Number.isFinite(rec.maxGrowth)) {
    out.maxGrowth = rec.maxGrowth;
  }
  return out;
}

/**
 * One cell the host has to measure.
 *
 * Built after repeat expansion so the row indices match the table that will
 * actually be drawn - see [cellRequests].
 */
export interface CellRequest {
  /** [cellKey] of this cell in the expanded table. */
  id: string;
  text: string;
  fontFamily: string;
  fontSize: number;
  fontWeight: "normal" | "bold";
  textAlign: "left" | "center" | "right";
  /** Usable text width: the column, less the cell's own padding. */
  width: number;
  wrap: boolean;
}

/**
 * Work out which cells need measuring.
 *
 * The expansion runs *here*, for the same one it runs during render. The host
 * and the renderer must agree on what row 2 is, or the measurement handed back
 * is read against the wrong cell and rows keep their authored heights with no
 * error to show for it.
 */
export function cellRequests(
  template: BillTemplate,
  values: Values,
  computed: readonly ComputedSpec[] = [],
  currencyScale = 2,
  rounding?: RoundingMode,
  qtyScale?: number,
): CellRequest[] {
  // The page height, read through a local. The purity guard bans the DOM
  // global by name, and the page geometry here is plain data that happens to
  // share the name; naming it once keeps that guard meaningful instead of
  // quietly widening it.
  const page: { height?: number } | undefined = template.document;
  const pageHeight = typeof page?.height === "number" ? page.height : 0;

  const { objects: expanded } = expandRepeats(
    Array.isArray(template.objects) ? template.objects : [],
    { ...values, ...computeAll(computed, values, currencyScale, { rounding, qtyScale }) },
    pageHeight,
    {
      specs: computed,
      scale: currencyScale,
      ...(rounding !== undefined ? { rounding } : {}),
      ...(qtyScale !== undefined ? { qtyScale } : {}),
    },
  );

  const out: CellRequest[] = [];
  for (const o of expanded) {
    if (o.type !== "table") continue;
    const policy = rowsWorthMeasuring(o);
    if (!policy) continue;

    const table = o as TableObject;
    const columns = table.columns > 0 ? table.columns : 1;
    const colWidths = Array.isArray(table.colWidths) ? table.colWidths : [];
    const cells = Array.isArray(table.cells) ? table.cells : [];
    // `rows` is derived from the cell array rather than trusted from the
    // template: a hand-edited or partially written table can carry a stale or
    // absent count, and believing it would silently measure the wrong cells.
    const rows = table.rows > 0 ? table.rows : Math.ceil(cells.length / columns);

    for (let r = 0; r < rows; r += 1) {
      for (let c = 0; c < columns; c += 1) {
        const cell = cells[r * columns + c];
        if (!cell) continue;
        const colW = typeof colWidths[c] === "number" && Number.isFinite(colWidths[c])
          ? colWidths[c]
          : table.width / columns;
        out.push({
          id: cellKey(table.id, r, c),
          text: typeof cell.text === "string" ? cell.text : "",
          fontFamily: table.fontFamily,
          fontSize: typeof cell.fontSize === "number" ? cell.fontSize : 10,
          fontWeight: cell.fontWeight === "bold" ? "bold" : "normal",
          textAlign: cell.textAlign ?? "left",
          width: Math.max(0, colW - table.padding * 2),
          wrap: true,
        });
      }
    }
  }
  return out;
}

/**
 * Recompute row heights from measured cells.
 *
 * Only ever grows. An authored height is a box the author traced around real
 * ink, so shrinking to a measurement would clip content that renders fine at
 * print time and only measures short in the host's font engine.
 */
export function applyRowHeights(
  table: TableObject,
  measurements: Readonly<Record<string, ContentMeasurement>>,
  limits: RowHeightLimits = {},
): TableObject {
  const columns = table.columns > 0 ? table.columns : 1;
  const rows = table.rows > 0 ? table.rows : 0;
  const authored = Array.isArray(table.rowHeights) ? table.rowHeights : [];
  const rowHeights = new Array<number>(rows);
  let changed = false;

  for (let r = 0; r < rows; r += 1) {
    const base = typeof authored[r] === "number" && Number.isFinite(authored[r])
      ? authored[r]
      : 0;

    let tallest = 0;
    for (let c = 0; c < columns; c += 1) {
      const m = measurements[cellKey(table.id, r, c)];
      if (!m) continue;
      const h = m.height;
      // Both halves must be usable. A measurement carrying a non-finite
      // `naturalWidth` is malformed as a whole, and honouring just its height
      // would let half a bad record resize a row.
      if (!Number.isFinite(h) || h < 0) continue;
      if (!Number.isFinite(m.naturalWidth)) continue;
      if (h > tallest) tallest = h;
    }

    if (tallest <= 0) {
      rowHeights[r] = base;
      continue;
    }

    // Padding is a property of the cell, so it is added to the tallest cell
    // once - summing per cell would make a row of wide text needlessly taller.
    const needed = tallest + table.padding * 2;
    let next = Math.max(base, needed);
    if (typeof limits.maxGrowth === "number" && Number.isFinite(limits.maxGrowth)) {
      next = Math.min(next, base + Math.max(0, limits.maxGrowth));
    }
    if (Math.abs(next - base) < TOLERANCE) next = base;
    rowHeights[r] = next;
    if (next !== base) changed = true;
  }

  if (!changed) return table;

  const height = rowHeights.reduce((a, b) => a + b, 0);
  return { ...table, rowHeights, height };
}