import { describe, expect, it } from "vitest";

import type { PackageManifest } from "@/lib/package/format";
import { PACKAGE_VERSION } from "@/lib/package/format";
import { deriveForm } from "@/lib/package/form";
import type { BillTemplate, TableCell } from "@/lib/template/types";

const base = (over: Partial<PackageManifest> = {}): PackageManifest => ({
  packageVersion: PACKAGE_VERSION,
  templateVersion: 2,
  name: "Invoice",
  document: { width: 794, height: 1123, unit: "px", dpi: 96, paper: "A4", currencyScale: 2 },
  template: "template.json",
  assets: [],
  fonts: [],
  fields: [
    { key: "customer_name", label: "Customer", type: "text", source: "text", objectName: "Header" },
    {
      key: "logo",
      label: "Logo",
      type: "image",
      source: "image-placeholder",
      objectName: "Logo",
    },
  ],
  computed: [{ key: "total", op: "sum", args: ["items.amount"] }],
  checksums: {},
  ...over,
});

const c = (text: string): TableCell => ({
  text,
  textAlign: "left",
  fontSize: 10,
  fontWeight: "normal",
});

const withBand = (): BillTemplate => ({
  templateVersion: 2,
  document: { width: 794, height: 1123 },
  meta: { name: "Invoice", modifiedAt: "2026-10-08T00:00:00.000Z" },
  objects: [
    {
      id: "t1",
      type: "table",
      name: "Items",
      role: null,
      x: 0,
      y: 0,
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
      cells: [c("Item"), c("Amount"), c("{{description}}"), c("{{amount}}"), c("Total"), c("{{total}}")],
      borderColor: "#000",
      borderWidth: 1,
      cellFill: "",
      headerRow: true,
      headerFill: "",
      headerTextColor: "",
      cellTextColor: "",
      padding: 2,
      fontFamily: "Arial",
      repeat: { startRow: 1, endRow: 1, key: "items", maxItems: 30 },
    },
  ],
});

describe("deriveForm", () => {
  it("returns the manifest fields in order", () => {
    expect(deriveForm(base()).fields.map((x) => x.key)).toEqual(["customer_name", "logo"]);
  });

  it("groups fields the way the existing forms do", () => {
    const f = deriveForm(base());
    expect(f.groups.find((g) => g.title === "Text fields")?.fields.map((x) => x.key)).toEqual([
      "customer_name",
    ]);
    expect(f.groups.some((g) => g.title === "Images & signatures")).toBe(true);
  });

  it("groups a field-source field with text, as DynamicForm does", () => {
    // `extractTemplateFields` can report source "field" for a slot placed with
    // the field tool. It belongs under "Text fields" with everything else, not
    // in a group of its own.
    const f = deriveForm(
      base({
        fields: [
          { key: "invoice_no", label: "Invoice no", type: "text", source: "field", objectName: "F" },
        ],
      }),
    );
    expect(f.groups.map((g) => g.title)).toEqual(["Text fields"]);
    expect(f.groups[0]?.fields.map((x) => x.key)).toEqual(["invoice_no"]);
  });

  it("carries validation rules through", () => {
    const f = deriveForm(
      base({
        fields: [
          {
            key: "gstin",
            label: "GSTIN",
            type: "text",
            source: "text",
            objectName: "Header",
            required: true,
            pattern: "^[0-9]{15}$",
            maxLength: 15,
          },
        ],
      }),
    );
    expect(f.fields[0]).toMatchObject({ required: true, pattern: "^[0-9]{15}$", maxLength: 15 });
  });

  it("carries defaults through to a host-generated form", () => {
    const form = deriveForm(base({
      fields: [{
        key: "invoice_no",
        label: "Invoice number",
        type: "text",
        source: "text",
        objectName: "Header",
        defaultValue: "INV-0001",
      }],
    }));

    expect(form.fields[0]?.defaultValue).toBe("INV-0001");
  });

  it("discovers a repeating group from the template's band", () => {
    expect(deriveForm(base(), withBand()).repeats).toEqual([
      { key: "items", objectName: "Items", columns: ["description", "amount"], maxItems: 30 },
    ]);
  });

  it("adds a field of its own for each band", () => {
    const f = deriveForm(base(), withBand());
    expect(f.fields.find((x) => x.key === "items")).toMatchObject({
      type: "repeating",
      source: "table",
    });
  });

  it("passes the computed specs through", () => {
    expect(deriveForm(base()).computed).toEqual([
      { key: "total", op: "sum", args: ["items.amount"] },
    ]);
  });

  it("does not duplicate a band the manifest already declares", () => {
    const f = deriveForm(
      base({
        fields: [
          {
            key: "items",
            label: "Items",
            type: "repeating",
            source: "table",
            objectName: "Items",
            columns: ["description", "amount"],
          },
        ],
      }),
      withBand(),
    );
    expect(f.fields.filter((x) => x.key === "items")).toHaveLength(1);
  });

  it("never throws on a garbage manifest", () => {
    expect(() => deriveForm(null as never)).not.toThrow();
    expect(deriveForm(null as never).fields).toEqual([]);
  });
});
