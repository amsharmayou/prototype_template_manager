import { describe, expect, it } from "vitest";

import { expandRepeats, resolveScoped } from "@/lib/render/repeat";
import type { TableCell, TableObject } from "@/lib/template/types";

const cell = (text: string): TableCell => ({
  text,
  textAlign: "left",
  fontSize: 10,
  fontWeight: "normal",
});

function table(over: Partial<TableObject> = {}): TableObject {
  return {
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
    cells: [
      cell("Item"),
      cell("Amount"),
      cell("{{description}}"),
      cell("{{amount}}"),
      cell("Total"),
      cell("{{total}}"),
    ],
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
    ...over,
  } as TableObject;
}

const v = (o: Record<string, unknown>) => o as Record<string, string>;
const texts = (o: TableObject) => o.cells.map((c) => c.text);

describe("resolveScoped", () => {
  it("prefers the item over the flat values", () => {
    expect(resolveScoped("{{amount}}", { amount: "9.99" }, v({ amount: "1.00" }))).toBe("9.99");
  });

  it("falls back to the flat values", () => {
    expect(resolveScoped("{{total}}", { amount: "1" }, v({ total: "12.00" }))).toBe("12.00");
  });

  it("stringifies a numeric item value", () => {
    expect(resolveScoped("{{qty}}", { qty: 3 }, v({}))).toBe("3");
  });

  it("leaves an unknown token literally in place", () => {
    expect(resolveScoped("{{nope}}", {}, v({}))).toBe("{{nope}}");
  });
});

describe("expandRepeats", () => {
  const twoItems = v({
    items: '[{"description":"A","amount":"1.00"},{"description":"B","amount":"2.00"}]',
  });

  it("clones the band once per item", () => {
    const { objects } = expandRepeats([table()], twoItems, 1123);
    const t = objects[0] as TableObject;
    expect(t.rows).toBe(4);
    expect(texts(t)).toEqual([
      "Item", "Amount",
      "A", "1.00",
      "B", "2.00",
      "Total", "{{total}}",
    ]);
  });

  it("grows the row heights by the band template height per item", () => {
    const { objects } = expandRepeats([table()], twoItems, 1123);
    const t = objects[0] as TableObject;
    expect(t.rowHeights).toEqual([20, 20, 20, 20]);
    expect(t.height).toBe(80);
  });

  it("collapses the band to nothing for an empty item list", () => {
    const { objects } = expandRepeats([table()], v({ items: "[]" }), 1123);
    const t = objects[0] as TableObject;
    expect(t.rows).toBe(2);
    expect(texts(t)).toEqual(["Item", "Amount", "Total", "{{total}}"]);
  });

  it("collapses the band and warns for unparseable items", () => {
    const { objects, warnings } = expandRepeats([table()], v({ items: "not json" }), 1123);
    expect((objects[0] as TableObject).rows).toBe(2);
    expect(warnings.join(" ")).toMatch(/items/);
  });

  it("clamps to maxItems and says so", () => {
    const many = JSON.stringify(
      Array.from({ length: 10 }, (_, i) => ({ description: `d${i}`, amount: "1.00" })),
    );
    const { objects, warnings } = expandRepeats(
      [table({ repeat: { startRow: 1, endRow: 1, key: "items", maxItems: 3 } })],
      v({ items: many }),
      1123,
    );
    expect((objects[0] as TableObject).rows).toBe(5);
    expect(warnings.join(" ")).toMatch(/3/);
  });

  it("warns when the grown table would run off the page", () => {
    const many = Array.from({ length: 20 }, () => ({ amount: "1.00" }));
    const { warnings } = expandRepeats([table({ y: 1100 })], v({ items: JSON.stringify(many) }), 1123);
    expect(warnings.join(" ")).toMatch(/off the page/i);
  });

  it("supports a band spanning more than one row", () => {
    const tall = table({
      rows: 4,
      rowHeights: [20, 20, 20, 20],
      cells: [
        cell("H1"), cell("H2"),
        cell("{{description}}"), cell("A"),
        cell("{{description}}"), cell("B"),
        cell("Total"), cell("{{total}}"),
      ],
      repeat: { startRow: 1, endRow: 2, key: "items", maxItems: 100 },
    });
    const { objects } = expandRepeats([tall], v({ items: '[{"description":"A"}]' }), 1123);
    const t = objects[0] as TableObject;
    expect(t.rows).toBe(4);
    expect(texts(t)).toEqual(["H1", "H2", "A", "A", "A", "B", "Total", "{{total}}"]);
  });

  it("leaves a table with no repeat band exactly as it was", () => {
    const original = table({ repeat: undefined });
    const { objects, warnings } = expandRepeats([original], v({ items: "[{}]" }), 1123);
    expect(objects[0]).toBe(original);
    expect(warnings).toEqual([]);
  });

  it("ignores a band whose rows are out of range", () => {
    const bad = table({ repeat: { startRow: 2, endRow: 9, key: "items", maxItems: 10 } });
    const { objects, warnings } = expandRepeats([bad], v({ items: "[{}]" }), 1123);
    expect(objects[0]).toBe(bad);
    expect(warnings.length).toBeGreaterThan(0);
  });

  it("leaves non-table objects alone", () => {
    const line = { id: "l1", type: "line", x: 0, y: 0, height: 0 } as never;
    expect(expandRepeats([line], v({ items: "[{}]" }), 1123).objects[0]).toBe(line);
  });
});
