import { describe, expect, it } from "vitest";

import { cellRequests, rowsWorthMeasuring } from "@/lib/render/rowHeights";
import { renderHtml } from "@/lib/render";
import { cellKey } from "@/lib/render/rowHeights";
import type { BillTemplate, TableObject } from "@/lib/template/types";

/**
 * The seam between "decide what to measure" and "measure it".
 *
 * The hard part is that cell keys must line up on both sides of the host
 * boundary. The host measures whatever the plan lists and hands back a map; the
 * renderer looks up that map by key. If the plan numbers rows against the
 * *template* while the renderer numbers them against the *expanded* table, every
 * key after the first repeat points at the wrong cell and rows silently keep
 * their authored heights. That is why both sides run the same expansion.
 */

const CELL = { text: "", textAlign: "left", fontSize: 10, fontWeight: "normal" } as const;

/**
 * A variable-row table: the header and trailer are fixed rows, the middle band
 * repeats per item. `expansion.y` is what marks the rows as growable, so every
 * test that measures has to carry it.
 */
function tableWithBand(over: Partial<TableObject> = {}): TableObject {
  return {
    id: "t1",
    type: "table",
    name: "Items",
    role: null,
    x: 10,
    y: 100,
    width: 400,
    height: 90,
    zIndex: 0,
    visible: true,
    locked: false,
    rows: 3,
    columns: 2,
    colWidths: [200, 200],
    rowHeights: [20, 30, 40],
    cells: [
      { ...CELL, text: "Description" },
      { ...CELL, text: "Amount" },
      { ...CELL, text: "{{desc}}" },
      { ...CELL, text: "{{amount}}" },
      { ...CELL, text: "Total" },
      { ...CELL, text: "{{total}}" },
    ],
    borderColor: "#000000",
    borderWidth: 1,
    cellFill: "#ffffff",
    headerRow: true,
    headerFill: "#eeeeee",
    headerTextColor: "#000000",
    cellTextColor: "#000000",
    padding: 4,
    fontFamily: "Arial",
    repeat: { startRow: 1, endRow: 1, key: "items" },
    ...over,
  } as TableObject;
}

function template(over: Partial<BillTemplate> = {}): BillTemplate {
  return {
    templateVersion: 2,
    meta: { name: "T" },
    document: { width: 794, height: 1123 },
    objects: [
      tableWithBand({
        expansion: { x: { mode: "fixed" }, y: { mode: "unbounded" } },
      }),
    ],
    layout: { mode: "variable", guides: [] },
    ...over,
  } as BillTemplate;
}

const ITEMS = JSON.stringify([
  { desc: "Short", amount: "1" },
  { desc: "A much longer description that will wrap", amount: "2" },
]);

describe("which tables are worth measuring", () => {
  it("is one whose rows are allowed to grow", () => {
    const t = tableWithBand({ expansion: { x: { mode: "fixed" }, y: { mode: "unbounded" } } });
    expect(rowsWorthMeasuring(t)).toEqual({ mode: "unbounded" });
  });

  it("keeps the row limit it was given", () => {
    const t = tableWithBand({
      expansion: { x: { mode: "fixed" }, y: { mode: "bounded", maxGrowth: 40 } },
    });
    expect(rowsWorthMeasuring(t)).toEqual({ mode: "bounded", maxGrowth: 40 });
  });

  it("is not one with no policy at all", () => {
    expect(rowsWorthMeasuring(tableWithBand())).toBe(false as never);
  });

  it("is not one whose rows are pinned", () => {
    const t = tableWithBand({ expansion: { x: { mode: "fixed" }, y: { mode: "fixed" } } });
    expect(rowsWorthMeasuring(t as TableObject)).toBe(false);
  });
});

describe("the measurement plan numbers rows after expansion", () => {
  it("asks about every cell of every rendered row", () => {
    const reqs = cellRequests(template(), { items: ITEMS }, []);

    // 1 header + 2 item rows + 1 trailer = 4 rows of 2 cells.
    expect(reqs).toHaveLength(8);
  });

  it("keys by the expanded row, not the template row", () => {
    const reqs = cellRequests(template(), { items: ITEMS }, []);
    const ids = reqs.map((r) => r.id);

    // The second item's description must be row 2, even though it came from
    // template row 1.
    expect(ids).toContain(cellKey("t1", 2, 0));
    expect(ids).not.toContain(cellKey("t1", 1, 0) + ":second");
  });

  it("carries the item's own text, not the token", () => {
    const reqs = cellRequests(template(), { items: ITEMS }, []);

    expect(reqs.find((r) => r.id === cellKey("t1", 1, 0))?.text).toBe("Short");
    expect(reqs.find((r) => r.id === cellKey("t1", 2, 0))?.text).toBe(
      "A much longer description that will wrap",
    );
  });

  it("measures at the final column width, not the table width", () => {
    const reqs = cellRequests(template(), { items: ITEMS }, []);

    // A cell may only wrap inside its own column; giving it the whole table
    // width would report one line for text that really needs four. Padding is
    // excluded here and added back to the measured height.
    expect(reqs.find((r) => r.id === cellKey("t1", 1, 0))?.width).toBe(192);
  });

  it("narrows the measured width further as padding grows", () => {
    const t = template();
    (t.objects[0] as TableObject).padding = 10;
    const reqs = cellRequests(t, { items: ITEMS }, []);

    expect(reqs.find((r) => r.id === cellKey("t1", 1, 0))?.width).toBe(180);
  });

  it("marks cells as wrapping", () => {
    const reqs = cellRequests(template(), { items: ITEMS }, []);

    expect(reqs.find((r) => r.id === cellKey("t1", 1, 0))?.wrap).toBe(true);
  });

  it("asks about nothing for a table with fixed rows", () => {
    const t = template();
    delete (t.objects[0] as { expansion?: unknown }).expansion;

    expect(cellRequests(t, { items: ITEMS }, [])).toEqual([]);
  });

  it("honours maxItems, because the plan must match what will be drawn", () => {
    const t = template();
    (t.objects[0] as TableObject).expansion = { x: { mode: "fixed" }, y: { mode: "unbounded" } };
    (t.objects[0] as TableObject).repeat = {
      startRow: 1,
      endRow: 1,
      key: "items",
      maxItems: 1,
    } as TableObject["repeat"];

    const reqs = cellRequests(t, { items: ITEMS }, []);

    // 1 header + 1 capped item + 1 trailer.
    expect(reqs).toHaveLength(6);
  });
});

describe("rendering honours the measurements", () => {
  /**
   * Row heights as the browser will read them, straight out of the rendered
   * markup.
   *
   * The render result deliberately exposes no geometry - asserting on the
   * public shape would test nothing. The CSS `height` on each row is the
   * contract with the browser, so that is what is read.
   */
  function rowHeightsFrom(html: string): number[] {
    return [...html.matchAll(/<tr style="height: ([\d.]+)px">/g)].map((m) => Number(m[1]));
  }

  const measurements = {
    [cellKey("t1", 1, 0)]: { naturalWidth: 180, height: 14 },
    [cellKey("t1", 2, 0)]: { naturalWidth: 180, height: 60 },
  };

  it("grows the row that needed it and leaves the others at their traced size", () => {
    const rows = rowHeightsFrom(renderHtml(template(), { items: ITEMS }, { measurements }).html);

    // 14 + 8 padding = 22, but the author traced 30, so it stays. The long
    // description needs 60 + 8 = 68, which is more than the traced 30.
    expect(rows[0]).toBe(20);
    expect(rows[1]).toBe(30);
    expect(rows[2]).toBe(68);
  });

  it("moves the trailer below the grown band", () => {
    const rows = rowHeightsFrom(renderHtml(template(), { items: ITEMS }, { measurements }).html);

    // 20 header + 30 + 68 grown row + 40 trailer.
    expect(rows).toEqual([20, 30, 68, 40]);
    expect(rows.reduce((a, b) => a + b, 0)).toBe(158);
  });

  it("keeps every row at least as tall as the author traced", () => {
    const rows = rowHeightsFrom(
      renderHtml(template(), { items: ITEMS }, {
        measurements: {
          [cellKey("t1", 1, 0)]: { naturalWidth: 10, height: 2 },
          [cellKey("t1", 2, 0)]: { naturalWidth: 10, height: 2 },
        },
      }).html,
    );

    // Both item rows report a tiny measurement and must keep their traced 30.
    expect(rows).toEqual([20, 30, 30, 40]);
  });

  it("renders at authored heights when the host measured nothing", () => {
    const rows = rowHeightsFrom(renderHtml(template(), { items: ITEMS }).html);

    expect(rows).toEqual([20, 30, 30, 40]);
  });

  it("grows the table itself by the amount its rows gained", () => {
    const plain = rowHeightsFrom(renderHtml(template(), { items: ITEMS }).html);
    const grown = rowHeightsFrom(renderHtml(template(), { items: ITEMS }, { measurements }).html);
    const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0);

    // Row 2 gained 38px (68 - 30), and the table is the sum of its rows.
    expect(sum(grown) - sum(plain)).toBe(38);
  });

  it("does not let row height change the totals", () => {
    const computed = [{ key: "total", type: "sum", of: ["amount"], source: "items" }] as never;
    const a = renderHtml(template(), { items: ITEMS }, { computed, measurements });
    const b = renderHtml(template(), { items: ITEMS }, { computed });

    // The same sum must appear regardless of how tall the rows were drawn, so
    // the two documents differ only in geometry.
    const strip = (h: string) => h.replace(/height:\s*[\d.]+px/g, "H").replace(/top:\s*[\d.]+px/g, "T");
    expect(strip(a.html)).toBe(strip(b.html));
  });

  it("still expands the band correctly with a single item", () => {
    const one = renderHtml(template(), { items: JSON.stringify([{ desc: "Only", amount: "9" }]) }, {
      measurements,
    });
    const rows = rowHeightsFrom(one.html);

    // 1 header + 1 item + 1 trailer.
    expect(rows).toHaveLength(3);
    expect(rows[1]).toBe(30);
  });
});