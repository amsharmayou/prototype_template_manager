/**
 * Expand a table's repeat band into real rows, one set per item.
 *
 * This runs as a pre-pass over the object list, before `renderObject` sees
 * anything. That is deliberate: the renderer learns nothing about repeating
 * bands, so its purity guarantee and its byte-for-byte goldens are untouched by
 * this feature.
 *
 * Resolution inside a band prefers the item over the flat values, so a token
 * written into the band reads the current item's own entry first and reaches
 * for the flat value only when the item has no such entry. Band content is
 * cloned, never drawn as it stands.
 */

import { DEFAULT_REPEAT_MAX_ITEMS } from "@/lib/template/types";
import type { TableCell, TableObject, TemplateObject } from "@/lib/template/types";

import { itemsOf } from "./computed";
import type { Values } from "./values";

/** Same grammar as `TOKEN_SOURCE` in `lib/render/values`. A fresh regex per use. */
const TOKEN_SOURCE = "\\{\\{\\s*([a-zA-Z0-9_.-]+)\\s*\\}\\}";

const tokenRegex = (): RegExp => new RegExp(TOKEN_SOURCE, "g");

export function resolveScoped(
  text: string,
  item: Record<string, unknown>,
  values: Values,
): string {
  return text.replace(tokenRegex(), (token, key: string) => {
    const local = item[key];
    if (typeof local === "string") return local;
    if (typeof local === "number" && Number.isFinite(local)) return String(local);
    const global = values[key];
    return typeof global === "string" ? global : token;
  });
}

interface Band {
  startRow: number;
  endRow: number;
  key: string;
  maxItems: number;
}

/**
 * The band, or null when the table has none or the one it has cannot apply.
 * Rejecting rather than repairing is deliberate: a band that does not fit its
 * table would otherwise be silently ignored, and the author would never learn
 * why their rows did not repeat.
 *
 * The checks are runtime rather than typed because a template arrives as parsed
 * JSON from whatever host opened the package, so each field is read as unknown
 * and proved before it is used as a row index.
 */
function bandOf(o: TableObject): { band: Band; why: string | null } | null {
  const r = o.repeat;
  if (!r || typeof r !== "object") return null;

  const startRow: unknown = r.startRow;
  const endRow: unknown = r.endRow;
  const key: unknown = r.key;
  const rows = typeof o.rows === "number" && Number.isInteger(o.rows) ? o.rows : 0;
  const problem = (why: string): { band: Band; why: string } => ({
    band: { startRow: 0, endRow: 0, key: "", maxItems: DEFAULT_REPEAT_MAX_ITEMS },
    why,
  });

  if (typeof startRow !== "number" || !Number.isInteger(startRow) || startRow < 0) {
    return problem("first row is not a row index");
  }
  if (typeof endRow !== "number" || !Number.isInteger(endRow) || endRow < startRow) {
    return problem("last row comes before the first");
  }
  if (rows <= 0 || endRow >= rows) return problem("last row is past the end of the table");
  if (typeof key !== "string" || key.trim().length === 0) return problem("no items key");

  const cap: unknown = r.maxItems;
  const maxItems =
    typeof cap === "number" && Number.isInteger(cap) && cap > 0 ? cap : DEFAULT_REPEAT_MAX_ITEMS;
  return {
    band: { startRow, endRow, key: key.trim(), maxItems },
    why: null,
  };
}

/**
 * Whether `raw` is a JSON array at all, an empty one included.
 *
 * `itemsOf` answers an empty list both for "the host sent no rows" and for "the host
 * sent something unreadable", and only this module still holds the raw text, so the
 * distinction is made here instead of by widening `itemsOf`'s contract. Zero rows is
 * an ordinary bill, not a defect, so only a value that is not an array at all -- a
 * parse failure, or a JSON scalar or object -- earns a warning.
 */
function isJsonArray(raw: string): boolean {
  try {
    return Array.isArray(JSON.parse(raw));
  } catch {
    return false;
  }
}

function expandTable(
  o: TableObject,
  values: Values,
  pageHeight: number,
): { table: TemplateObject; warnings: string[] } {
  const found = bandOf(o);
  if (!found) return { table: o, warnings: [] };
  const { band, why } = found;

  const warnings: string[] = [];
  if (why) {
    warnings.push(`table "${o.name}" has a repeat band that was ignored: ${why}`);
    return { table: o, warnings };
  }

  const columns = typeof o.columns === "number" && o.columns > 0 ? o.columns : 1;
  const raw = values[band.key];
  const items = itemsOf(values, band.key);

  if (typeof raw === "string" && raw.length > 0 && !isJsonArray(raw)) {
    warnings.push(
      `table "${o.name}" could not read any items from ${band.key}; the repeating rows were dropped`,
    );
  }

  let used = items;
  if (items.length > band.maxItems) {
    warnings.push(
      `table "${o.name}" received ${items.length} items but ${band.key} is capped at ${band.maxItems}; the extra rows were not drawn`,
    );
    used = items.slice(0, band.maxItems);
  }

  const cells = Array.isArray(o.cells) ? o.cells : [];
  const heights = Array.isArray(o.rowHeights) ? o.rowHeights : [];
  const rows = typeof o.rows === "number" ? o.rows : 0;
  const at = (r: number, c: number): TableCell =>
    cells[r * columns + c] ?? { text: "", textAlign: "left", fontSize: 10, fontWeight: "normal" };

  const newCells: TableCell[] = [];
  const newHeights: number[] = [];

  for (let r = 0; r < band.startRow; r += 1) {
    for (let c = 0; c < columns; c += 1) newCells.push(at(r, c));
    newHeights.push(heights[r] ?? 0);
  }
  for (const item of used) {
    for (let r = band.startRow; r <= band.endRow; r += 1) {
      for (let c = 0; c < columns; c += 1) {
        const src = at(r, c);
        newCells.push({ ...src, text: resolveScoped(src.text ?? "", item, values) });
      }
      newHeights.push(heights[r] ?? 0);
    }
  }
  for (let r = band.endRow + 1; r < rows; r += 1) {
    for (let c = 0; c < columns; c += 1) newCells.push(at(r, c));
    newHeights.push(heights[r] ?? 0);
  }

  const height = newHeights.reduce((a, b) => a + b, 0);
  const top = typeof o.y === "number" && Number.isFinite(o.y) ? o.y : 0;
  if (Number.isFinite(pageHeight) && pageHeight > 0 && top + height > pageHeight) {
    warnings.push(
      `table "${o.name}" ends at ${Math.round(top + height)} but the page is ${Math.round(pageHeight)} tall; the last rows will print off the page`,
    );
  }

  return {
    table: {
      ...o,
      rows: newHeights.length,
      rowHeights: newHeights,
      cells: newCells,
      height,
      repeat: undefined,
    } as TableObject,
    warnings,
  };
}

/**
 * Expand every repeating band in `objects`.
 *
 * Warnings are returned rather than thrown: a bill with more items than the page
 * can hold is something the caller can show and fix, not a crash. Silently
 * clipping it is the failure this exists to prevent.
 */
export function expandRepeats(
  objects: readonly TemplateObject[],
  values: Values,
  pageHeight: number,
): { objects: TemplateObject[]; warnings: string[] } {
  const warnings: string[] = [];
  const out = objects.map((o) => {
    if (o.type !== "table") return o;
    const { table, warnings: w } = expandTable(o, values, pageHeight);
    warnings.push(...w);
    return table;
  });
  return { objects: out, warnings };
}
