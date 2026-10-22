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
import type { ComputedSpec, RoundingMode } from "@/lib/package/format";
import type { TableCell, TableObject, TableRepeat, TemplateObject } from "@/lib/template/types";

import { bandRowValues, itemsOf } from "./computed";
import type { Values } from "./values";

/** Same grammar as `TOKEN_SOURCE` in `lib/render/values`. A fresh regex per use. */
const TOKEN_SOURCE = "\\{\\{\\s*([a-zA-Z0-9_.-]+)\\s*\\}\\}";

const tokenRegex = (): RegExp => new RegExp(TOKEN_SOURCE, "g");

/**
 * What one repeat band's rows are computed with.
 *
 * `specs` are the per-row rules (a line figure from count and rate); `scale`
 * is the currency scale they resolve to. When `specs` is empty a band costs
 * nothing extra and behaves exactly as it did before per-row computation.
 */
export interface RepeatContext {
  specs: readonly ComputedSpec[];
  scale: number;
  rounding?: RoundingMode;
  qtyScale?: number;
}

export function resolveScoped(
  text: string,
  item: Record<string, unknown>,
  values: Values,
): string {
  return text.replace(tokenRegex(), (token, key: string) => {
    // The dotted form resolves as a whole key first and as a column path
    // second - the same order `computeAll` applies to an arg - so a band cell
    // written `{{band.column}}` binds the row's column and a band whose key
    // field is itself dotted still reads whole.
    const dot = key.indexOf(".");
    const local =
      (typeof item[key] === "string" || typeof item[key] === "number")
        ? item[key]
        : dot > 0
        ? item[key.slice(dot + 1)]
        : undefined;
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
  /** The traced header row reprints at the top of later pages. */
  repeatHeader?: boolean;
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
  // The row count is taken from `rows`, then `rowHeights`, then the cell array.
  // A table that carries any of the latter two and omits the first is not
  // broken - it is just written by hand or by an older serialiser, and
  // rejecting its band would drop every repeating row with only a warning to
  // say so. The bounds check below still runs, so a genuinely empty table is
  // still refused.
  const heights = Array.isArray(o.rowHeights) ? o.rowHeights : [];
  const cells = Array.isArray(o.cells) ? o.cells : [];
  const columns =
    typeof o.columns === "number" && Number.isInteger(o.columns) && o.columns > 0 ? o.columns : 1;
  // The row count is taken from `rows`, then `rowHeights`, then the cell array.
  // A table carrying the latter two but not the first is not broken - it is
  // just written by hand or by a tool other than this one, and refusing its
  // band dropped every repeating row behind a warning nobody sees on a bill.
  const rows = Math.max(
    typeof o.rows === "number" && Number.isInteger(o.rows) && o.rows > 0 ? o.rows : 0,
    heights.length,
    Math.ceil(cells.length / columns),
  );
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
    // repeatHeader travels with the band: the paginator reads it later to know
    // that the traced header row belongs at the top of every continuation page.
    band: {
      startRow,
      endRow,
      key: key.trim(),
      maxItems,
      ...(r.repeatHeader === true ? { repeatHeader: true } : {}),
    },
    why: null,
  };
}

/**
 * Warnings about a band's shape, which are cheap to state and expensive to
 * discover otherwise.
 *
 * Both cases are configuration the author set and the renderer cannot honour.
 * They are reported rather than refused: a band that draws is still a band that
 * draws, and refusing would take a bill off the screen over a heading.
 */
function bandWarnings(o: TableObject, band: Band): string[] {
  const found: string[] = [];

  // `repeatHeader` means "draw the header again when the table splits across
  // pages". A single-page document has no page to split onto, so the flag does
  // nothing - and saying nothing leaves an author believing the column headings
  // will follow a long line-item table onto page two.
  if ((o.repeat as TableRepeat | undefined)?.repeatHeader === true) {
    found.push(
      `table "${o.name}" has repeatHeader on, which asks for the header row to be drawn again when the table splits across pages; a document is a single page here, so the heading is drawn once`,
    );
  }

  // A band that starts on the header row clones that row once per item, so the
  // column headings are repeated down the table instead of sitting above it.
  if (o.headerRow === true && band.startRow === 0) {
    found.push(
      `table "${o.name}" starts its repeating band on the header row, so the header is drawn once per item; start the band below it to keep one heading`,
    );
  }

  return found;
}

/**
 * How many entries `raw` holds when it is a JSON array, or null when it is not one at
 * all -- a parse failure, or a JSON scalar or object.
 *
 * `itemsOf` answers an empty list both for "the host sent no rows" and for "the host
 * sent something unreadable", and only this module still holds the raw text, so the
 * distinction is made here instead of by widening `itemsOf`'s contract. The count is
 * what separates the three states that matter: a genuinely empty bill, which is
 * ordinary and silent; a value that is not a list at all; and a list that carried
 * entries the renderer cannot use, which is silent data loss if it goes unreported.
 */
function jsonArrayLength(raw: string): number | null {
  try {
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.length : null;
  } catch {
    return null;
  }
}

function expandTable(
  o: TableObject,
  values: Values,
  pageHeight: number,
  ctx: RepeatContext | undefined,
): { table: TemplateObject; warnings: string[] } {
  const found = bandOf(o);
  if (!found) return { table: o, warnings: [] };
  const { band, why } = found;
  const bandCtx = ctx && ctx.specs.length > 0 ? ctx : undefined;

  const warnings: string[] = [];
  if (why) {
    warnings.push(`table "${o.name}" has a repeat band that was ignored: ${why}`);
    return { table: o, warnings };
  }
  // Configuration the author set that this renderer cannot honour, said out loud
  // rather than left to look like it worked.
  warnings.push(...bandWarnings(o, band));

  const columns = typeof o.columns === "number" && o.columns > 0 ? o.columns : 1;
  const raw = values[band.key];
  const items = itemsOf(values, band.key);

  // Three states, three outcomes: a list of no entries is an ordinary bill and says
  // nothing, a value that is not a list could not be read, and a list whose entries
  // are all unusable would otherwise drop rows without a word.
  if (typeof raw === "string" && raw.length > 0) {
    const entries = jsonArrayLength(raw);
    if (entries === null) {
      warnings.push(
        `table "${o.name}" could not read any items from ${band.key}; the repeating rows were dropped`,
      );
    } else if (entries > 0 && items.length === 0) {
      warnings.push(
        `table "${o.name}" read ${entries} entries from ${band.key} but none were usable rows; the repeating rows were dropped`,
      );
    }
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
  // `rows` is the authoritative count, but a hand-written or partially
  // serialised table can carry `rowHeights` without it. Falling back to the
  // heights is what lets such a band expand at all; believing a missing count
  // silently produced "last row is past the end of the table".
  // A table that omits `rows` still has a real row count, and [bandOf] resolved
  // it the same way - so the copy loop and the bounds check agree on what "row
  // 2" means.
  const rows = Math.max(
    typeof o.rows === "number" && o.rows > 0 ? o.rows : 0,
    heights.length,
    Math.ceil(cells.length / columns),
  );
  const at = (r: number, c: number): TableCell =>
    cells[r * columns + c] ?? { text: "", textAlign: "left", fontSize: 10, fontWeight: "normal" };

  const newCells: TableCell[] = [];
  const newHeights: number[] = [];

  for (let r = 0; r < band.startRow; r += 1) {
    for (let c = 0; c < columns; c += 1) newCells.push(at(r, c));
    newHeights.push(heights[r] ?? 0);
  }
  for (const item of used) {
    // The band's own computed columns are resolved before the row is bound:
    // a line figure that repeats `spec.key` tokens gets the engine's product
    // of this row's count and rate, and the summary row's sum then reads the
    // same figures the rows print.
    const row = bandCtx
      ? { ...item, ...bandRowValues(bandCtx.specs, band.key, item, values, bandCtx.scale, {
          rounding: bandCtx.rounding,
          qtyScale: bandCtx.qtyScale,
        }) }
      : item;
    for (let r = band.startRow; r <= band.endRow; r += 1) {
      for (let c = 0; c < columns; c += 1) {
        const src = at(r, c);
        newCells.push({ ...src, text: resolveScoped(src.text ?? "", row, values) });
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
      // The band stays on the expanded table, carrying its traced shape: the
      // expansion already happened, so nothing re-expands these rows, but the
      // paginator reads this to know which table flows, where its traced
      // header is and where the traced bottom sat under trailing blocks.
      repeat: band,
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
  ctx?: RepeatContext,
): { objects: TemplateObject[]; warnings: string[] } {
  const warnings: string[] = [];
  const out = objects.map((o) => {
    if (o.type !== "table") return o;
    const { table, warnings: w } = expandTable(o, values, pageHeight, ctx);
    warnings.push(...w);
    return table;
  });
  return { objects: out, warnings };
}
