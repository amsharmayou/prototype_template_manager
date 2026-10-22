import { describe, expect, it } from "vitest";

import { paginate } from "@/lib/render/paginate";
import type { TableObject, TemplateObject } from "@/lib/template/types";

function textObj(id: string, y: number, height: number): TemplateObject {
  return { type: "text", id, y, height, x: 40, width: 300 } as unknown as TemplateObject;
}

function bandTable(y: number, tracedRows: number, rowHeight: number): TableObject {
  const cells: TableObject["cells"] = [];
  for (let r = 0; r < tracedRows; r += 1) {
    for (let c = 0; c < 2; c += 1) {
      cells.push({
        text: r === 0 ? "Description" : `row ${r}`,
        textAlign: "left",
        fontSize: 11,
        fontWeight: "normal",
      } as never);
    }
  }
  const rowHeights = Array.from({ length: tracedRows }, () => rowHeight);
  return {
    type: "table",
    id: "band",
    name: "Rows",
    x: 40,
    y,
    width: 600,
    height: tracedRows * rowHeight,
    rows: tracedRows,
    columns: 2,
    colWidths: [300, 300],
    rowHeights,
    cells,
    headerRow: true,
    padding: 2,
    repeat: { key: "rows", startRow: 1, endRow: tracedRows - 1, maxItems: 500, repeatHeader: true },
  } as unknown as TableObject;
}

describe("paginate", () => {
  it("returns one untouched page when everything fits", () => {
    const placed = [textObj("a", 50, 20), bandTable(100, 3, 20)];
    const result = paginate(placed, 1123);
    expect(result.pages).toHaveLength(1);
    expect(result.warnings).toEqual([]);
    expect(result.pages[0]!.objects.map((o) => o.id)).toEqual(["a", "band"]);
    expect((result.pages[0]!.objects[0] as unknown as { y: number }).y).toBe(50);
  });

  it("splits a band at the page boundary and repeats its traced header", () => {
    // Band top 420; the traced table is 31 rows of 28px (869px) ending at
    // 1289 - past the 1123px sheet. Page 1 fits 25 data rows; the rest flow.
    const placed = [bandTable(420, 31, 28)];
    const { pages, warnings } = paginate(placed, 1123);
    expect(warnings).toEqual([]);
    expect(pages).toHaveLength(2);

    const page1 = pages[0]!.objects.find((o) => o.id === "band") as TableObject;
    const page2 = pages[1]!.objects.find((o) => o.id === "band__cont1") as TableObject;
    // Page 1 keeps the traced header plus as many data rows as the space held
    // (703px / 28px = 25 traced rows); page 2 re-opens with the traced header
    // again and the remaining rows.
    expect(page1.rows).toBe(25);
    expect((page1 as unknown as { y: number }).y).toBe(420);
    expect(page2.rows).toBe(7);
    expect((page2 as unknown as { y: number }).y).toBe(0);
    expect(pages[1]!.top).toBe(1123);
    // No data row is lost: every traced data row lands on exactly one page.
    // Two columns per row carry the same text, so each traced data row reads
    // exactly twice across the cut.
    const dataRows = [...page1.cells, ...page2.cells]
      .map((c) => (c as { text: string }).text)
      .filter((t) => t.startsWith("row "));
    expect(dataRows).toHaveLength(60);
  });

  it("reprints furniture above the band on every page", () => {
    const placed = [textObj("letterhead", 40, 90), bandTable(420, 31, 28)];
    const { pages } = paginate(placed, 1123);
    expect(pages.length).toBe(2);
    for (const page of pages) {
      const head = page.objects.find((o) => o.id === "letterhead");
      expect(head).toBeTruthy();
      expect((head as unknown as { y: number }).y).toBe(40);
    }
  });

  it("moves everything below the band under its final end", () => {
    // The summary sits 40px under the traced band bottom; after pagination it
    // must sit under the band's last chunk instead, on the last page.
    const placed = [bandTable(420, 31, 28), textObj("summary", 1329, 30)];
    const { pages } = paginate(placed, 1123);
    const summaryPage = pages.find((p) => p.objects.some((o) => o.id === "summary"))!;
    const bandChunk = summaryPage.objects.find((o) => o.id.startsWith("band")) as TableObject;
    const summary = summaryPage.objects.find((o) => o.id === "summary") as unknown as { y: number; height: number };
    expect(summaryPage.top).toBe(1123);
    expect(bandChunk).toBeTruthy();
    // Under the chunk, not colliding with it.
    expect(summary.y).toBeGreaterThanOrEqual(
      (bandChunk as unknown as { y: number }).y + bandChunk.height,
    );
  });

  it("warns when a row is taller than a page and still prints the rest", () => {
    const table = bandTable(420, 4, 28);
    // Row 2 becomes a 2000px monster: taller than any page.
    (table.rowHeights as unknown as number[])[2] = 2000;
    table.height = (table.rowHeights as unknown as number[]).reduce((a, b) => a + b, 0);
    const { pages, warnings } = paginate([table], 1123);
    expect(warnings.some((w) => w.includes("taller than one page"))).toBe(true);
    // No data row is lost, and the tall row keeps its whole height: its chunk
    // carries all 2000px rather than clipping the text mid-row.
    const pieces = pages
      .flatMap((p) => p.objects)
      .filter((o) => o.id.startsWith("band")) as unknown as TableObject[];
    const cells = pieces
      .flatMap((o) => o.cells)
      .map((c) => c.text);
    for (const n of [1, 2, 3]) {
      expect(cells.filter((t) => t === `row ${n}`)).toHaveLength(2);
    }
    const heights = pieces.flatMap((o) => o.rowHeights);
    expect(heights).toContain(2000);
  });
});
