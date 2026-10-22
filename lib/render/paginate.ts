/**
 * Pagination: slice one solved, opened-up page space into printable pages.
 *
 * Layout already produced the truth - a bill whose item band grew into a tall
 * continuous coordinate space. Pagination cuts that space at paper boundaries
 * with three rules that make the cut read like a human laid it out:
 *
 *  1. A repeating band flows. Its rows are assigned page by page, a row is
 *     never split in half, and its traced header row returns at the top of
 *     every later page.
 *  2. Furniture repeats. Everything fully above the band on the traced sheet
 *     (company header, bill number, address block) reprints at the same spot
 *     on every page.
 *  3. Everything at or below the band follows its end. The summary block lands
 *     under the final row on the last page, not mid-page-two where a naive
 *     window cut would leave it.
 *
 * Pure: the same placed objects always slice to the same pages. When
 * everything fits one sheet the input is returned untouched, so single-page
 * output stays byte-identical to what the goldens expect.
 */

import type { TableObject, TemplateObject } from "@/lib/template/types";

export interface PageSlice {
  /** Objects with y already translated into this page's coordinates. */
  objects: TemplateObject[];
  /** This page's first row in the continuous space, in px. */
  top: number;
}

export interface PaginationResult {
  pages: PageSlice[];
  warnings: string[];
}

const bottomOf = (o: TemplateObject): number =>
  (typeof o.y === "number" ? o.y : 0) + (typeof o.height === "number" ? o.height : 0);

const topOf = (o: TemplateObject): number => (typeof o.y === "number" ? o.y : 0);

/**
 * The one band table that flows across pages.
 *
 * A bill carries at most one repeating band - its item rows. If a traced sheet
 * somehow grew several, the tallest expanded one flows and the others are left
 * whole on their page: splitting two bands at once is a layout puzzle this
 * pass deliberately does not solve, and a warning names the situation instead
 * of silently mis-drawing it.
 */
function flowingTable(objects: readonly TemplateObject[]): TableObject | null {
  let flow: TableObject | null = null;
  for (const o of objects) {
    if (o.type !== "table" || !o.repeat) continue;
    if (!flow || bottomOf(o) > bottomOf(flow)) flow = o;
  }
  return flow;
}

interface TableChunk {
  rows: number;
  rowHeights: number[];
  cells: TableObject["cells"];
  height: number;
  id: string;
  top: number;
}

/**
 * Cut a table's rows at window boundaries.
 *
 * The traced header row returns above the rows it introduces on every later
 * page, so a reader on page 3 still knows what the numbers in each column are.
 * A single row taller than a whole page cannot be split; it stays whole and
 * the sheet clips it, exactly as a single-page render did - with a warning
 * that names the row.
 */
function chunkTable(
  table: TableObject,
  firstCapacity: number,
  pageHeight: number,
  headerRepeat: boolean,
): { chunks: TableChunk[]; warnings: string[] } {
  const warnings: string[] = [];
  const rowHeights = Array.isArray(table.rowHeights) ? table.rowHeights : [];
  const cols = typeof table.columns === "number" && table.columns > 0 ? table.columns : 1;
  const tracedCells = Array.isArray(table.cells) ? table.cells : [];
  const band = table.repeat;
  const firstRow = band?.startRow ?? 0;
  const tracedHeaderHeight =
    firstRow > 0 ? rowHeights.slice(0, firstRow).reduce((a, b) => a + b, 0) : 0;

  const rowCells = (r: number): TableObject["cells"] =>
    tracedCells.slice(r * cols, r * cols + cols) as TableObject["cells"];
  const heightOf = (r: number) => rowHeights[r] ?? 0;

  const remaining: number[] = [];
  for (let r = 0; r < table.rows; r += 1) remaining.push(r);

  const chunks: TableChunk[] = [];
  let chunkIndex = 0;
  let warnedTall = false;
  while (remaining.length > 0 && chunkIndex < 500) {
    const headerH = chunkIndex > 0 && headerRepeat ? tracedHeaderHeight : 0;
    // Page 1's capacity starts below the traced table top; later pages start
    // at the very top of the sheet.
    const capacity =
      chunkIndex === 0 ? Math.max(0, firstCapacity) : Math.max(0, pageHeight - headerH);
    const rows: number[] = [];
    let used = 0;
    while (remaining.length > 0) {
      const candidate = remaining[0]!;
      const h = heightOf(candidate);
      if (used + h > capacity && rows.length > 0) break;
      if (used + h > capacity && rows.length === 0 && !warnedTall && h > pageHeight) {
        warnings.push(
          `a row of table ${String(table.name)} is taller than one page and will be clipped; shorten the row or widen the page`,
        );
        warnedTall = true;
      }
      rows.push(remaining.shift()!);
      used += h;
    }
    if (rows.length === 0) break;
    const cellsOut: TableObject["cells"] = [];
    const heightsOut: number[] = [];
    if (headerH > 0) {
      for (let r = 0; r < firstRow; r += 1) {
        cellsOut.push(...rowCells(r));
        heightsOut.push(heightOf(r));
      }
    }
    for (const r of rows) {
      cellsOut.push(...rowCells(r));
      heightsOut.push(heightOf(r));
    }
    chunks.push({
      rows: heightsOut.length,
      rowHeights: heightsOut,
      cells: cellsOut,
      height: heightsOut.reduce((a, b) => a + b, 0),
      id: chunkIndex === 0 ? table.id : `${table.id}__cont${chunkIndex}`,
      top: chunkIndex === 0 ? topOf(table) : chunkIndex * pageHeight,
    });
    chunkIndex += 1;
  }
  if (remaining.length > 0) {
    warnings.push(
      `table ${String(table.name)} did not converge to a page count; pagination stopped and remaining rows are not printed`,
    );
  }
  return { chunks, warnings };
}

/**
 * Slice the placed geometry into pages.
 *
 * Nothing here re-measures or re-solves: heights are final, coordinates are
 * final, and the band has already been expanded into concrete rows.
 * Pagination only decides which page each piece is painted on.
 */
export function paginate(
  placed: readonly TemplateObject[],
  pageHeight: number,
): PaginationResult {
  if (!Number.isFinite(pageHeight) || pageHeight <= 0) {
    return { pages: [{ objects: [...placed], top: 0 }], warnings: [] };
  }

  const maxBottom = placed.reduce((a, o) => Math.max(a, bottomOf(o)), 0);
  if (maxBottom <= pageHeight) {
    return { pages: [{ objects: [...placed], top: 0 }], warnings: [] };
  }

  const warnings: string[] = [];
  const flow = flowingTable(placed);
  if (!flow) {
    warnings.push(
      "the content is taller than one page but nothing repeats, so it flows without a repeating header; add a repeating band over bill rows",
    );
  }

  let flowChunks: TableChunk[] = [];
  if (flow) {
    const cut = chunkTable(
      flow,
      pageHeight - topOf(flow),
      pageHeight,
      flow.headerRow === true && flow.repeat?.repeatHeader === true,
    );
    flowChunks = cut.chunks;
    warnings.push(...cut.warnings);
  }

  // Below-band content rides the band's end. The anchor is the band's TRACED
  // bottom - the footprint the author drew before expansion - because on the
  // traced sheet the summary sat a fixed distance under the last traced row.
  // The band's final chunk reaches `flowGrowth` past that footprint, and the
  // summary keeps its authored distance from wherever the rows really end.
  const tracedRowsCount =
    flow === null ? 0 : (flow.repeat?.endRow ?? flow.rows - 1) + 1;
  const tracedBandBottom =
    flow === null
      ? 0
      : topOf(flow) +
        (Array.isArray(flow.rowHeights) ? flow.rowHeights : [])
          .slice(0, Math.min(tracedRowsCount, (Array.isArray(flow.rowHeights) ? flow.rowHeights : []).length))
          .reduce((a: number, b: number) => a + b, 0);
  let flowFinalBottom = flow ? bottomOf(flow) : maxBottom;
  if (flow && flowChunks.length > 0) {
    const last = flowChunks[flowChunks.length - 1]!;
    flowFinalBottom = last.top + last.height;
  }
  const flowGrowth = flow === null ? 0 : Math.max(0, flowFinalBottom - tracedBandBottom);
  const shifted = placed.map((o) =>
    o !== flow && flow !== null && topOf(o) >= topOf(flow)
      ? ({ ...o, y: topOf(o) + flowGrowth } as TemplateObject)
      : o,
  );
  const shiftedBottom = shifted.reduce((a, o) => Math.max(a, bottomOf(o)), 0);

  const flowPages = flowChunks.length;
  // A pathological template (heights at 1e308, say) must not be sliced into an
  // astronomic number of sheets - the cap doubles as the chunk cap in
  // `chunkTable`, past which rows are clipped with a warning each.
  const windowCount = Math.min(
    500,
    Math.max(flowPages, Math.ceil(shiftedBottom / pageHeight)),
  );
  if (windowCount === 500 && shiftedBottom > 500 * pageHeight) {
    warnings.push(
      `the content is far taller than ${500} pages; pagination is capped and content past the cap is clipped`,
    );
  }

  const pages: Array<{ objects: TemplateObject[]; top: number }> = [];
  for (let p = 0; p < windowCount; p += 1) {
    pages.push({ objects: [], top: p * pageHeight });
  }
  if (pages.length === 0) pages.push({ objects: [], top: 0 });

  for (let ci = 0; ci < flowChunks.length; ci += 1) {
    const chunk = flowChunks[ci]!;
    const page = pages[Math.min(ci, pages.length - 1)]!;
    page.objects.push({
      ...(flow as unknown as TemplateObject),
      id: chunk.id,
      y: chunk.top - page.top,
      height: chunk.height,
      rows: chunk.rows,
      rowHeights: chunk.rowHeights,
      cells: chunk.cells,
      // Continuation chunks carry concrete rows: their band has already been
      // expanded and bound, so no render pass re-expands them.
      repeat: ci === 0 ? flow!.repeat : undefined,
    } as unknown as TemplateObject);
  }

  for (const o of shifted) {
    if (flow !== null && o === flow) continue;
    // Furniture: wholly above the band's traced top reprints on every page at
    // its authored spot - the authored y is already the page-local y, because
    // the traced sheet's top is every page's top.
    if (flow !== null && bottomOf(o) <= topOf(flow)) {
      for (let p = 0; p < pages.length; p += 1) {
        pages[p]!.objects.push({
          ...(o as unknown as TemplateObject),
          y: topOf(o),
        } as unknown as TemplateObject);
      }
      continue;
    }
    const half = typeof o.height === "number" && Number.isFinite(o.height) ? o.height / 2 : 0;
    const centreRaw = topOf(o) + half;
    // NaN coordinates from a hostile template default to page 0, where the
    // painter's own finite-box refusal will drop them with a named refusal.
    let page = Number.isFinite(centreRaw)
      ? Math.min(pages.length - 1, Math.max(0, Math.floor(centreRaw / pageHeight)))
      : 0;
    // Content that follows the flowing band cannot land before the band ends.
    if (flow !== null && topOf(o) >= topOf(flow)) {
      page = Math.max(page, Math.min(flowPages - 1, pages.length - 1));
    }
    const target = pages[page]!;
    target.objects.push({
      ...(o as unknown as TemplateObject),
      y: topOf(o) - target.top,
    } as unknown as TemplateObject);
  }

  return { pages, warnings };
}
