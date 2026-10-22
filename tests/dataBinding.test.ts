import { describe, expect, it } from "vitest";

import {
  extractTemplateFields,
  fillTemplate,
  defaultValuesForTemplate,
  humanizeKey,
  validateTemplateValues,
} from "@/lib/template/dataBinding";
import { emptyTemplate, type BillTemplate, type TemplateObject } from "@/lib/template/types";

function templateWith(objects: TemplateObject[]): BillTemplate {
  const t = emptyTemplate(800, 1000, "t");
  t.objects = objects;
  return t;
}

describe("date field validation", () => {
  const dateField = [{ key: "date", label: "Date", type: "date" as const, source: "field" as const, objectName: "Date" }];

  it.each(["2024-02-29", "2000-02-29", "2026-10-17"])("accepts valid calendar date %s", (value) => {
    expect(validateTemplateValues(dateField, { date: value })).toEqual([]);
  });

  it.each(["2023-02-29", "1900-02-29", "2026-13-01", "2026-04-31", "2026-1-01"])("rejects invalid calendar date %s", (value) => {
    expect(validateTemplateValues(dateField, { date: value })).toHaveLength(1);
  });
});

const text = (over: Record<string, unknown>): TemplateObject =>
  ({
    id: "t1", name: "Label", role: null, x: 0, y: 0, width: 100, height: 20,
    rotation: 0, opacity: 1, visible: true, locked: false, zIndex: 0,
    parentId: null, stroke: "#000", strokeWidth: 1, fill: "transparent",
    type: "text", text: "", fontFamily: "Arial", fontSize: 12,
    fontWeight: "normal", fontStyle: "normal", textAlign: "left",
    lineHeight: 1.16, charSpacing: 0, roleKind: "static",
    textVerticalAlign: "top", ...over,
  }) as unknown as TemplateObject;

const cell_texts = ["{{item_name}}", "plain", "{{qty}}", "{{total}}"];

const table = {
  id: "tb", name: "Items", role: "items", x: 0, y: 0, width: 400, height: 60,
  rotation: 0, opacity: 1, visible: true, locked: false, zIndex: 1,
  parentId: null, stroke: "#000", strokeWidth: 1, fill: "transparent",
  type: "table", rows: 2, columns: 2, colWidths: [200, 200], rowHeights: [30, 30],
  cells: cell_texts.map((t) => ({ text: t, textAlign: "left", fontSize: 12, fontWeight: "normal" })),
  borderColor: "#000", borderWidth: 1, cellFill: "transparent",
  headerRow: false, headerFill: "transparent", headerTextColor: "#000",
  cellTextColor: "#000", padding: 4, fontFamily: "Arial",
} as unknown as TemplateObject;

const logo = {
  id: "ph1", name: "Logo", role: "logo", x: 0, y: 0, width: 80, height: 40,
  rotation: 0, opacity: 1, visible: true, locked: false, zIndex: 2,
  parentId: null, stroke: "#000", strokeWidth: 1, fill: "transparent",
  type: "image-placeholder", placeholderRole: "logo", label: "LOGO",
} as unknown as TemplateObject;

const signature = {
  ...logo, id: "ph2", name: "Signature", placeholderRole: "signature", label: "SIGNATURE",
} as unknown as TemplateObject;

const field = {
  id: "f1", name: "Field 1", role: null, x: 0, y: 0, width: 100, height: 20,
  rotation: 0, opacity: 1, visible: true, locked: false, zIndex: 3,
  parentId: null, stroke: "#2563eb", strokeWidth: 1, fill: "rgba(37,99,235,0.06)",
  type: "field", key: "invoice_date", fieldType: "date", text: "{{invoice_date}}",
  fontFamily: "Arial", fontSize: 12, fontWeight: "normal", fontStyle: "normal",
  textAlign: "left", lineHeight: 1.16, charSpacing: 0, roleKind: "variable",
  textVerticalAlign: "top",
} as unknown as TemplateObject;

describe("extractTemplateFields", () => {
  it("collects text tokens, table tokens and image slots in first-appearance order, deduped", () => {
    const t = templateWith([
      text({ text: "Invoice {{invoice_id}} for {{customer_name}}" }),
      table,
      logo,
      signature,
      text({ id: "t2", text: "Total: {{total}} ({{customer_name}} copy)" }),
    ]);
    const fields = extractTemplateFields(t);
    expect(fields.map((f) => f.key)).toEqual([
      "invoice_id",
      "customer_name",
      "item_name",
      "qty",
      "total",
      "logo",
      "signature",
    ]);
    expect(fields.map((f) => f.type)).toEqual([
      "text", // invoice_id has no date/currency/count marker -> text
      "text",
      "text",
      "number",
      "currency",
      "image",
      "image",
    ]);
    expect(fields[2]!.source).toBe("table");
    expect(fields[5]!.source).toBe("image-placeholder");
    expect(fields[5]!.label).toBe("Logo");
  });

  it("infers dates, currency and numbers from the key", () => {
    const t = templateWith([
      text({ text: "{{invoice_date}} {{due_date}} {{total}} {{tax}} {{qty}} {{quantity}} {{customer_name}}" }),
    ]);
    const fields = extractTemplateFields(t);
    const byKey = Object.fromEntries(fields.map((f) => [f.key, f.type]));
    expect(byKey).toEqual({
      invoice_date: "date",
      due_date: "date",
      total: "currency",
      tax: "currency",
      qty: "number",
      quantity: "number",
      customer_name: "text",
    });
  });

  it("returns no fields for a template with no placeholders", () => {
    const t = templateWith([text({ text: "INVOICE" })]);
    expect(extractTemplateFields(t)).toEqual([]);
  });

  it("lets a placeholder spec override the inferred label, type and length", () => {
    const t = templateWith([text({ text: "{{ref}} {{total}}" })]);
    t.meta.placeholders = [
      { key: "ref", label: "Your reference", type: "date", maxLength: 12 },
    ];
    const byKey = Object.fromEntries(
      extractTemplateFields(t).map((f) => [f.key, f]),
    );
    expect(byKey.ref!.label).toBe("Your reference");
    expect(byKey.ref!.type).toBe("date");
    expect(byKey.ref!.maxLength).toBe(12);
    // Unspecified keys keep inference.
    expect(byKey.total!.label).toBe("Total");
    expect(byKey.total!.type).toBe("currency");
    expect(byKey.total!.maxLength).toBeUndefined();
  });

  it("ignores a spec without a usable key", () => {
    const t = templateWith([text({ text: "{{ref}}" })]);
    t.meta.placeholders = [{ key: "" }, { key: "ref", label: "" }];
    const fields = extractTemplateFields(t);
    expect(fields).toHaveLength(1);
    expect(fields[0]!.label).toBe("Ref");
  });

  it("collects field objects as dynamic slots", () => {
    const t = templateWith([field, text({ text: "{{customer_name}}" })]);
    const fields = extractTemplateFields(t);
    const byKey = Object.fromEntries(fields.map((f) => [f.key, f]));
    expect(byKey.invoice_date).toBeDefined();
    expect(byKey.invoice_date!.source).toBe("field");
    expect(byKey.invoice_date!.type).toBe("date");
    expect(byKey.invoice_date!.label).toBe("Invoice Date");
    expect(byKey.customer_name).toBeDefined();
  });

  // These keys deliberately match none of the inference regexes. A key like
  // "invoice_date" would infer "date" anyway and hide the bug.
  it("uses a field's own type, which inference can never produce", () => {
    const t = templateWith([
      { ...field, key: "paid", fieldType: "tickmark" },
      { ...field, id: "f2", key: "gift_wrap", fieldType: "checkbox" },
    ] as unknown as TemplateObject[]);
    const byKey = Object.fromEntries(
      extractTemplateFields(t).map((f) => [f.key, f.type]),
    );
    expect(byKey.paid).toBe("tickmark");
    expect(byKey.gift_wrap).toBe("checkbox");
  });

  it("keeps a field's declared type even when a token appears first", () => {
    // Dedup is first-appearance-wins, so the text box claiming the key used to
    // win and the field's choice was discarded entirely.
    const t = templateWith([
      text({ text: "{{paid}}" }),
      { ...field, key: "paid", fieldType: "tickmark" },
    ] as unknown as TemplateObject[]);
    expect(extractTemplateFields(t).find((f) => f.key === "paid")!.type).toBe(
      "tickmark",
    );
  });

  it("lets an explicit placeholder spec override the field's own type", () => {
    const t = templateWith([
      { ...field, key: "paid", fieldType: "tickmark" },
    ] as unknown as TemplateObject[]);
    t.meta.placeholders = [{ key: "paid", type: "text" }];
    expect(extractTemplateFields(t).find((f) => f.key === "paid")!.type).toBe(
      "text",
    );
  });

  it("ignores a field type outside the union", () => {
    const t = templateWith([
      { ...field, key: "weird", fieldType: "hologram" },
    ] as unknown as TemplateObject[]);
    expect(extractTemplateFields(t).find((f) => f.key === "weird")!.type).toBe(
      "text",
    );
  });
});

describe("defaultValuesForTemplate", () => {
  it("uses configured defaults while skipping image and repeat-only fields", () => {
    const repeatingTable = {
      ...table,
      repeat: { key: "items", startRow: 0, endRow: 1, maxItems: 10 },
    } as unknown as TemplateObject;
    const t = templateWith([text({ text: "{{customer_name}}" }), repeatingTable, logo]);
    t.meta.placeholders = [
      { key: "customer_name", defaultValue: "Northwind" },
      { key: "item_name", defaultValue: "not-a-form-default" },
      { key: "logo", defaultValue: "not-an-image" },
    ];

    expect(defaultValuesForTemplate(t, ["total"])).toEqual({ customer_name: "Northwind" });
  });
});

describe("humanizeKey", () => {
  it("title-cases words and expands known acronyms", () => {
    expect(humanizeKey("customer_name")).toBe("Customer Name");
    expect(humanizeKey("company_gstin")).toBe("Company GSTIN");
    expect(humanizeKey("qr")).toBe("QR Code");
    expect(humanizeKey("invoice-no")).toBe("Invoice No.");
  });
});

describe("fillTemplate", () => {
  it("splices values into text and table cells without mutating the input", () => {
    const t = templateWith([
      text({ text: "Invoice {{invoice_number}}" }),
      table,
    ]);
    const before = JSON.parse(JSON.stringify(t)) as BillTemplate;

    const filled = fillTemplate(t, {
      invoice_number: "A-101",
      item_name: "Widget",
      qty: "3",
      total: "1,200.00",
    });

    expect((filled.objects[0] as { text: string }).text).toBe("Invoice A-101");
    const filledTable = filled.objects[1] as { cells: Array<{ text: string }> };
    expect(filledTable.cells.map((c) => c.text)).toEqual([
      "Widget",
      "plain",
      "3",
      "1,200.00",
    ]);
    // Input untouched.
    expect(t).toEqual(before);
    // Unknown tokens stay literal.
    const partial = fillTemplate(t, { item_name: "Widget" });
    expect((partial.objects[0] as { text: string }).text).toBe(
      "Invoice {{invoice_number}}",
    );
  });

  it("writes src onto image placeholders only when a value is given", () => {
    const t = templateWith([logo, signature]);
    const filled = fillTemplate(t, { logo: "data:image/png;base64,AAAA" });
    const [l, s] = filled.objects as Array<{ src?: string }>;
    expect(l!.src).toBe("data:image/png;base64,AAAA");
    expect(s!.src).toBeUndefined();
  });

  it("leaves tokens and src intact for an empty values map", () => {
    const t = templateWith([text({ text: "{{total}}" }), logo]);
    const filled = fillTemplate(t, {});
    expect((filled.objects[0] as { text: string }).text).toBe("{{total}}");
    expect((filled.objects[1] as { src?: string }).src).toBeUndefined();
  });

  it("applies a spec's style to a text box the placeholder fills alone", () => {
    const t = templateWith([text({ text: "{{company}}" })]);
    t.meta.placeholders = [
      {
        key: "company",
        fontFamily: "Georgia",
        fontSize: 22,
        fontWeight: "bold",
        fontStyle: "italic",
        color: "#112233",
      },
    ];
    const o = fillTemplate(t, { company: "Northwind Ltd" })
      .objects[0] as unknown as Record<string, unknown>;
    expect(o.text).toBe("Northwind Ltd");
    expect(o.fontFamily).toBe("Georgia");
    expect(o.fontSize).toBe(22);
    expect(o.fontWeight).toBe("bold");
    expect(o.fontStyle).toBe("italic");
    expect(o.fill).toBe("#112233");
  });

  it("leaves the host styling alone when a spec is absent or the token shares its line", () => {
    const t = templateWith([text({ text: "Total: {{total}}" }), text({ id: "t2", text: "{{tax}}" })]);
    t.meta.placeholders = [
      { key: "total", fontSize: 40, fontFamily: "Georgia" },
      { key: "tax", fontSize: 40, fontFamily: "Georgia" },
    ];
    const filled = fillTemplate(t, { total: "10", tax: "2" });
    const [inline, alone] = filled.objects as unknown as Array<Record<string, unknown>>;
    expect(inline.fontFamily).toBe("Arial");
    expect(inline.fontSize).toBe(12);
    expect(alone.fontFamily).toBe("Georgia");
    expect(alone.fontSize).toBe(40);
  });

  it("styles a table cell through the two properties a cell can carry", () => {
    const t = templateWith([table]);
    t.meta.placeholders = [
      { key: "qty", fontSize: 18, fontWeight: "bold", color: "#ff0000" },
    ];
    const filled = fillTemplate(t, { qty: "2", item_name: "Widget" }) as {
      objects: Array<{ cells: Array<{ text: string; fontSize: number; fontWeight: string; color?: string }> }>;
    };
    const cells = filled.objects[0]!.cells;
    expect(cells[2]!.text).toBe("2");
    expect(cells[2]!.fontSize).toBe(18);
    expect(cells[2]!.fontWeight).toBe("bold");
    expect(cells[2]!.color).toBe("#ff0000");
    // Sibling cells are untouched.
    expect(cells[0]!.fontSize).toBe(12);
    expect(cells[0]!.color).toBeUndefined();
  });

  it("fills a field object like a text token", () => {
    const t = templateWith([field]);
    const filled = fillTemplate(t, { invoice_date: "2026-10-04" });
    const o = filled.objects[0] as unknown as Record<string, unknown>;
    expect(o.text).toBe("2026-10-04");
    expect(o.type).toBe("field");
    expect(o.key).toBe("invoice_date");
  });

  it("keeps a field token literal when no value is given", () => {
    const t = templateWith([field]);
    const filled = fillTemplate(t, {});
    const o = filled.objects[0] as unknown as Record<string, unknown>;
    expect(o.text).toBe("{{invoice_date}}");
  });
});
