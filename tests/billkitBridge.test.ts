import { describe, expect, it } from "vitest";

import { deriveFormBridge, renderBridge } from "@/lib/billkit/bridge";
import { PACKAGE_VERSION } from "@/lib/package/format";
import type { PackageManifest } from "@/lib/package/format";
import type { BillTemplate, TableCell, TableObject } from "@/lib/template/types";

const manifest = (over: Partial<PackageManifest> = {}): PackageManifest => ({
  packageVersion: PACKAGE_VERSION,
  templateVersion: 2,
  name: "Lorry Receipt",
  document: { width: 1127, height: 871, unit: "px", dpi: 96, paper: "custom", currencyScale: 2 },
  template: "template.json",
  assets: [],
  fonts: [],
  fields: [
    { key: "Number", label: "Number", type: "number", source: "field", objectName: "Number" },
    { key: "value", label: "Value", type: "currency", source: "field", objectName: "Value" },
  ],
  computed: [],
  checksums: {},
  ...over,
});

const cell = (text: string): TableCell => ({
  text,
  textAlign: "left",
  fontSize: 10,
  fontWeight: "normal",
});

function bandedTemplate(): BillTemplate {
  return {
    templateVersion: 2,
    document: { width: 1127, height: 871 },
    meta: { name: "Lorry Receipt", modifiedAt: "2026-10-09T00:00:00.000Z" },
    objects: [
      {
        id: "t1",
        type: "table",
        name: "Table 1",
        role: null,
        x: 697,
        y: 596,
        width: 196,
        height: 96,
        rotation: 0,
        opacity: 1,
        visible: true,
        locked: false,
        zIndex: 0,
        parentId: null,
        stroke: "",
        strokeWidth: 0,
        fill: "",
        rows: 5,
        columns: 4,
        colWidths: [70, 33, 59, 34],
        rowHeights: [20, 19, 19, 19, 19],
        cells: [
          cell("Description"),
          cell("Pkgs"),
          cell("Weight"),
          cell("Amount"),
          cell("{{description}}"),
          cell("{{packages}}"),
          cell("{{weight}}"),
          cell("{{amount}}"),
          cell("{{description}}"),
          cell("{{packages}}"),
          cell("{{weight}}"),
          cell("{{amount}}"),
          cell("{{description}}"),
          cell("{{packages}}"),
          cell("{{weight}}"),
          cell("{{amount}}"),
          cell(""),
          cell(""),
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
        repeat: { startRow: 1, endRow: 3, key: "items", maxItems: 20 },
      } as unknown as TableObject,
    ],
  };
}

const items = (rows: Array<Record<string, string>>) => JSON.stringify(rows);

const totals = [
  { key: "subtotal", op: "sum" as const, args: ["items.amount"] },
  { key: "total", op: "add" as const, args: ["subtotal"] },
];

describe("deriveFormBridge", () => {
  it("returns the manifest's fields as a form schema", () => {
    const schema = deriveFormBridge(JSON.stringify(manifest()));
    expect(schema.fields.map((f) => f.key)).toEqual(["Number", "value"]);
    expect(schema.groups.length).toBeGreaterThan(0);
  });

  it("discovers the repeating band and its columns from the template", () => {
    const schema = deriveFormBridge(
      JSON.stringify(manifest()),
      JSON.stringify(bandedTemplate()),
    );
    expect(schema.repeats).toEqual([
      {
        key: "items",
        objectName: "Table 1",
        columns: ["description", "packages", "weight", "amount"],
        maxItems: 20,
      },
    ]);
  });

  it("adds a repeating field of its own so a host that ignores repeats still shows them", () => {
    const schema = deriveFormBridge(
      JSON.stringify(manifest()),
      JSON.stringify(bandedTemplate()),
    );
    expect(schema.fields.find((f) => f.key === "items")).toMatchObject({
      type: "repeating",
      source: "table",
    });
  });

  it("works without a template, for a host that only has the manifest", () => {
    expect(() => deriveFormBridge(JSON.stringify(manifest()))).not.toThrow();
  });
});

describe("renderBridge", () => {
  const tpl = () => JSON.stringify(bandedTemplate());

  it("draws one row per item", () => {
    const out = renderBridge(
      tpl(),
      JSON.stringify({ items: items([{ description: "Wheat flour", amount: "100.00" }]) }),
    );
    expect(out.html).toContain("Wheat flour");
    expect(out.html).toContain("100.00");
    // The band is expanded, so the template rows are not drawn as they stand.
    expect(out.html).not.toContain("{{description}}");
  });

  it("computes the total when the host supplies the specs", () => {
    const out = renderBridge(
      tpl(),
      JSON.stringify({
        items: items([
          { description: "Wheat flour", amount: "100.00" },
          { description: "Rice", amount: "250.50" },
        ]),
      }),
      JSON.stringify(totals),
    );
    expect(out.html).toContain("Wheat flour");
    expect(out.html).toContain("Rice");
    expect(out.html).toContain("250.50");
    expect(out.html).toContain("350.50");
  });

  it("reports the template variables the values did not cover", () => {
    const out = renderBridge(tpl(), JSON.stringify({ items: items([]) }));
    expect(out.variables).toContain("description");
    expect(out.variables).toContain("amount");
    expect(out.variables).toContain("total");
  });

  it("leaves an empty item list as a bill with no line items, silently", () => {
    const out = renderBridge(tpl(), JSON.stringify({ items: items([]) }));
    expect(out.warnings).toEqual([]);
    expect(out.html).not.toContain("Wheat");
  });

  it("refuses an unreadable items value rather than drawing nothing quietly", () => {
    const out = renderBridge(tpl(), JSON.stringify({ items: "not json" }));
    expect(out.warnings.join(" ")).toMatch(/items/);
  });

  it("caps the rows at maxItems and says so", () => {
    const many = Array.from({ length: 25 }, (_, i) => ({
      description: `d${i}`,
      amount: "1.00",
    }));
    const out = renderBridge(tpl(), JSON.stringify({ items: items(many) }));
    expect(out.warnings.join(" ")).toMatch(/20/);
  });

  it("returns refusals rather than throwing on a hostile value", () => {
    const t = bandedTemplate();
    (t.objects[0] as unknown as TableObject).borderColor = "\u0000not-a-colour";
    const out = renderBridge(JSON.stringify(t), JSON.stringify({ items: items([]) }));
    expect(out.refusals.length).toBeGreaterThan(0);
  });
});
