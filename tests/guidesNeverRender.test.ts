import { describe, expect, it } from "vitest";

import { renderBridge } from "@/lib/billkit/bridge";
import { renderHtml } from "@/lib/render";
import type { BillTemplate, TableObject } from "@/lib/template/types";

/**
 * Guides are editor furniture.
 *
 * A marking line lives in the template because the layout solver needs it, and
 * it exists on the canvas because the author drags it. Neither of those is a
 * reason to paint it: a guide drawn across a customer's invoice is the single
 * most visible way this feature could embarrass its users, and nothing in the
 * renderer currently has to look at `layout.guides` to avoid it — they are only
 * read to move things.
 *
 * These tests pin that down from the output side, so a future change to the
 * drawing code cannot quietly start rendering them.
 */

const CELL = { text: "", textAlign: "left", fontSize: 10, fontWeight: "normal" } as const;

function table(): TableObject {
  return {
    id: "t1",
    type: "table",
    name: "Items",
    role: null,
    x: 24,
    y: 80,
    width: 400,
    height: 90,
    zIndex: 0,
    visible: true,
    locked: false,
    rows: 3,
    columns: 2,
    colWidths: [200, 200],
    rowHeights: [20, 30, 24],
    cells: [
      { ...CELL, text: "Desc" },
      { ...CELL, text: "Amt" },
      { ...CELL, text: "{{d}}" },
      { ...CELL, text: "{{a}}" },
      { ...CELL, text: "Total" },
      { ...CELL, text: "T" },
    ],
    borderColor: "#333333",
    borderWidth: 1,
    cellFill: "#ffffff",
    headerRow: true,
    headerFill: "#f0f0f0",
    headerTextColor: "#000000",
    cellTextColor: "#000000",
    padding: 4,
    fontFamily: "Arial",
    expansion: { x: { mode: "fixed" }, y: { mode: "unbounded" } },
    repeat: { startRow: 1, endRow: 1, key: "items" },
  } as TableObject;
}

function variableTemplate(): BillTemplate {
  return {
    templateVersion: 2,
    meta: { name: "Guides" },
    document: { width: 794, height: 1123 },
    objects: [table()],
    layout: {
      mode: "variable",
      document: { growthX: "fixed", growthY: "expand" },
      guides: [
        { id: "guide-1", orientation: "horizontal", position: 200 },
        { id: "guide-2", orientation: "vertical", position: 400 },
      ],
      attachments: [
        {
          id: "att-1",
          objectId: "t1",
          edge: "bottom",
          guideId: "guide-1",
          behavior: "move",
        },
      ],
    },
  } as BillTemplate;
}

const VALUES = { items: JSON.stringify([{ d: "one", a: "1" }, { d: "two", a: "2" }]) };

describe("guides are never drawn", () => {
  it("no guide id appears in the output", () => {
    const html = renderHtml(variableTemplate(), VALUES).html;

    expect(html).not.toContain("guide-1");
    expect(html).not.toContain("guide-2");
  });

  it("no editor-only chrome appears in the output", () => {
    const html = renderHtml(variableTemplate(), VALUES).html;

    // The guides are dashed #2563eb on the canvas. The colour is what pins
    // them down: `dashed` on its own is legitimate, because an unfilled image
    // placeholder is drawn with a dashed border and must keep it.
    expect(html.toLowerCase()).not.toContain("2563eb");
    expect(html.toLowerCase()).not.toContain("#1d4ed8");
  });

  it("no layout metadata is serialised into the page", () => {
    const html = renderHtml(variableTemplate(), VALUES).html;

    expect(html).not.toContain("maxDisplacement");
    expect(html).not.toContain("growthGuideId");
  });

  it("still lays out - the guides are doing their job invisibly", () => {
    // If the guides had been dropped rather than merely not drawn, the table
    // would not have moved and this would pass while the feature was broken.
    const html = renderHtml(variableTemplate(), VALUES).html;
    const heights = [...html.matchAll(/<tr style="height: ([\d.]+)px">/g)].map((m) => Number(m[1]));

    expect(heights).toHaveLength(4);
  });
});

describe("the host bridge renders no guides either", () => {
  it("the Android path produces guide-free HTML", () => {
    const tpl = JSON.stringify(variableTemplate());
    const out = renderBridge(tpl, JSON.stringify(VALUES));

    expect(out.html).not.toContain("guide-1");
    expect(out.html).not.toContain("2563eb");
  });
});

describe("the final page size is reported, not the traced one", () => {
  it("grows when the content outgrows the traced page", () => {
    // The whole chain in one assertion: a measured cell grows its row, the
    // row grows the table, the attachment asks for the guide to move, the
    // guide moves, and the page grows. Skipping any link leaves the page at
    // 1123 with the table hanging off the bottom.
    const items = JSON.stringify(Array.from({ length: 60 }, (_, i) => ({ d: `item ${i}`, a: `${i}` })));
    const measurements = { "t1|5|0": { naturalWidth: 400, height: 2000 } };

    const grown = renderHtml(variableTemplate(), { items }, { measurements });

    expect(grown.page.height).toBeGreaterThan(1123);
  });

  it("stays on the traced page while the content fits", () => {
    const plain = renderHtml(variableTemplate(), VALUES);

    expect(plain.page).toEqual({ width: 794, height: 1123 });
  });

  it("reports the traced size for a fixed-layout template", () => {
    const fixed = variableTemplate();
    delete (fixed as { layout?: unknown }).layout;
    const out = renderHtml(fixed, VALUES);

    expect(out.page).toEqual({ width: 794, height: 1123 });
  });

  it("is carried across the bridge for the print path", () => {
    const out = renderBridge(JSON.stringify(variableTemplate()), JSON.stringify(VALUES));

    // The bridge result is what Android turns into a print job, so the page
    // has to be on it or the print path falls back to the traced sheet.
    expect(out).toHaveProperty("page.width");
    expect(out).toHaveProperty("page.height");
  });
});