import { describe, expect, it } from "vitest";

import { hydrateTemplate } from "@/lib/template/hydrate";
import { serialiseObject } from "@/lib/template/serialize";
import type { BillTemplate } from "@/lib/template/types";

const repeat = { startRow: 1, endRow: 2, key: "items", repeatHeader: true, maxItems: 40 };

function fake(over: Record<string, unknown> = {}) {
  return {
    id: "t1",
    appType: "table",
    type: "BillTable",
    name: "Items",
    role: null,
    left: 0,
    top: 0,
    width: 400,
    height: 80,
    angle: 0,
    opacity: 1,
    visible: true,
    locked: false,
    stroke: "#000",
    strokeWidth: 1,
    fill: "",
    zIndex: 0,
    rows: 4,
    columns: 2,
    colWidths: [200, 200],
    rowHeights: [20, 20, 20, 20],
    cells: [],
    borderColor: "#000",
    borderWidth: 1,
    cellFill: "",
    headerRow: true,
    headerFill: "",
    headerTextColor: "",
    cellTextColor: "",
    padding: 2,
    fontFamily: "Arial",
    repeat,
    ...over,
  } as never;
}

describe("serialising a repeat band", () => {
  it("carries the band onto the template object", () => {
    expect((serialiseObject(fake(), 0) as unknown as Record<string, unknown>).repeat).toEqual(repeat);
  });

  it("omits repeat entirely when the table has none", () => {
    const out = serialiseObject(fake({ repeat: undefined }), 0) as unknown as Record<string, unknown>;
    expect("repeat" in out).toBe(false);
  });

  it("drops a band with an unusable key rather than writing a broken one", () => {
    const out = serialiseObject(fake({ repeat: { startRow: 1, endRow: 1, key: "" } }), 0) as unknown as Record<string, unknown>;
    expect("repeat" in out).toBe(false);
  });

  it("drops a band whose rows are inverted", () => {
    const out = serialiseObject(fake({ repeat: { startRow: 3, endRow: 1, key: "items" } }), 0) as unknown as Record<string, unknown>;
    expect("repeat" in out).toBe(false);
  });

  it("defaults maxItems when the author left it blank", () => {
    const out = serialiseObject(
      fake({ repeat: { startRow: 1, endRow: 1, key: "items" } }),
      0,
    ) as unknown as { repeat?: { maxItems?: number } };
    expect(out.repeat?.maxItems).toBe(200);
  });
});

describe("hydrating a repeat band", () => {
  it("restores the band when a template is loaded", () => {
    const tpl = {
      templateVersion: 2,
      document: { width: 794, height: 1123 },
      meta: { name: "T", modifiedAt: "2026-10-08T00:00:00.000Z" },
      objects: [
        {
          id: "t1",
          type: "table",
          name: "Items",
          role: null,
          x: 0,
          y: 0,
          width: 400,
          height: 80,
          rotation: 0,
          opacity: 1,
          visible: true,
          locked: false,
          zIndex: 0,
          parentId: null,
          stroke: "",
          strokeWidth: 0,
          fill: "",
          rows: 4,
          columns: 2,
          colWidths: [200, 200],
          rowHeights: [20, 20, 20, 20],
          cells: [],
          borderColor: "#000",
          borderWidth: 1,
          cellFill: "",
          headerRow: true,
          headerFill: "",
          headerTextColor: "",
          cellTextColor: "",
          padding: 2,
          fontFamily: "Arial",
          repeat,
        },
      ],
    };
    const objects = hydrateTemplate(tpl as unknown as BillTemplate);
    expect((objects[0] as { repeat?: unknown }).repeat).toEqual(repeat);
  });
});
