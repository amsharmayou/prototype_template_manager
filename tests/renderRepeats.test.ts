import { describe, expect, it } from "vitest";

import { renderHtml } from "@/lib/render";
import type { BillTemplate, TableCell, TableObject } from "@/lib/template/types";

function banded(): BillTemplate {
  const cells: TableCell[] = [];
  const push = (a: string, b: string) => {
    cells.push({ text: a, textAlign: "left", fontSize: 10, fontWeight: "normal" });
    cells.push({ text: b, textAlign: "left", fontSize: 10, fontWeight: "normal" });
  };
  push("Item", "Amount");
  push("{{description}}", "{{amount}}");
  push("Total", "{{total}}");

  return {
    templateVersion: 2,
    document: { width: 794, height: 1123 },
    meta: { name: "Invoice", modifiedAt: "2026-10-08T00:00:00.000Z" },
    objects: [
      {
        id: "t1",
        type: "table",
        name: "Items",
        role: null,
        x: 10,
        y: 100,
        width: 400,
        height: 60,
        rotation: 0,
        opacity: 1,
        visible: true,
        locked: false,
        zIndex: 0,
        parentId: null,
        stroke: "",
        strokeWidth: 0,
        fill: "",
        rows: 3,
        columns: 2,
        colWidths: [200, 200],
        rowHeights: [20, 20, 20],
        cells,
        borderColor: "#000",
        borderWidth: 1,
        cellFill: "",
        headerRow: true,
        headerFill: "",
        headerTextColor: "",
        cellTextColor: "",
        padding: 2,
        fontFamily: "Arial",
        repeat: { startRow: 1, endRow: 1, key: "items", maxItems: 100 },
      } as unknown as TableObject,
    ],
  };
}

const values = (items: Record<string, string>[]) => ({ items: JSON.stringify(items) });
const twoItems = values([
  { description: "Wheat", amount: "100.00" },
  { description: "Rice", amount: "250.50" },
]);

describe("renderHtml with repeat bands", () => {
  it("draws one row per item", () => {
    const { html } = renderHtml(banded(), twoItems);
    expect(html).toContain("Wheat");
    expect(html).toContain("Rice");
    expect(html).toContain("250.50");
  });

  it("computes a total from the items when asked", () => {
    const { html } = renderHtml(banded(), twoItems, {
      computed: [
        { key: "subtotal", op: "sum", args: ["items.amount"] },
        { key: "total", op: "add", args: ["subtotal"] },
      ],
    });
    expect(html).toContain("350.50");
  });

  it("reports an overflow as a warning rather than clipping silently", () => {
    const many = Array.from({ length: 60 }, (_, i) => ({
      description: `d${i}`,
      amount: "1.00",
    }));
    const tpl = banded();
    (tpl.objects[0] as unknown as TableObject).y = 1000;
    expect(renderHtml(tpl, values(many)).warnings.join(" ")).toMatch(/off the page/i);
  });

  it("produces no warnings for a short bill", () => {
    expect(renderHtml(banded(), values([{ description: "A", amount: "1.00" }])).warnings).toEqual(
      [],
    );
  });

  it("leaves the fingerprint describing the template, not the data", () => {
    const hash = (h: string) => /data-template-hash="([^"]+)"/.exec(h)?.[1];
    const a = renderHtml(banded(), values([{ description: "A", amount: "1.00" }]));
    const b = renderHtml(banded(), values([{ description: "B", amount: "9.00" }]));
    expect(hash(a.html)).toBe(hash(b.html));
  });

  it("still reports the band's columns as variables the template needs", () => {
    const { variables } = renderHtml(banded(), values([{ description: "A", amount: "1.00" }]));
    expect(variables).toContain("description");
    expect(variables).toContain("amount");
  });
});
