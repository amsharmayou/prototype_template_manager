import { describe, expect, it } from "vitest";

import { preflightTemplate, sampleValuesForTemplate } from "@/lib/template/preflight";
import { emptyTemplate, type TableObject, type TextObject } from "@/lib/template/types";

const textObject = (overrides: Partial<TextObject> = {}): TextObject => ({
  id: "customer-name",
  type: "text",
  name: "Customer name",
  role: null,
  x: 20,
  y: 30,
  width: 100,
  height: 20,
  rotation: 0,
  opacity: 1,
  visible: true,
  locked: false,
  zIndex: 0,
  parentId: null,
  stroke: "#000000",
  strokeWidth: 1,
  fill: "transparent",
  text: "{{customer_name}}",
  fontFamily: "Arial",
  fontSize: 12,
  fontWeight: "normal",
  fontStyle: "normal",
  textAlign: "left",
  lineHeight: 1.16,
  charSpacing: 0,
  roleKind: "variable",
  textVerticalAlign: "top",
  expansion: { x: { mode: "fixed" }, y: { mode: "fixed" } },
  ...overrides,
});

describe("template sample preflight", () => {
  it("builds representative long text values from the field contract", () => {
    const template = emptyTemplate(300, 400);
    template.objects = [textObject()];
    template.layout = { mode: "variable" };
    template.meta.placeholders = [{ key: "customer_name", maxLength: 80 }];

    const values = sampleValuesForTemplate(template);

    expect(values.customer_name).toBe("W".repeat(80));
  });

  it("reports measured sample content that cannot fit a fixed field", () => {
    const template = emptyTemplate(300, 400);
    template.objects = [textObject()];
    template.layout = { mode: "variable" };

    const issues = preflightTemplate(template, {
      sampleValues: { customer_name: "A long customer name" },
      measurements: { "customer-name": { naturalWidth: 500, height: 20 } },
    });

    expect(issues).toContainEqual(expect.objectContaining({
      severity: "warning",
      objectId: "customer-name",
      message: expect.stringContaining("Sample values:"),
    }));
  });

  it("creates a bounded set of representative repeated rows", () => {
    const template = emptyTemplate(300, 400);
    const table = {
      id: "items-table",
      type: "table",
      name: "Items",
      role: null,
      x: 0,
      y: 0,
      width: 300,
      height: 60,
      rotation: 0,
      opacity: 1,
      visible: true,
      locked: false,
      zIndex: 0,
      parentId: null,
      stroke: "#000000",
      strokeWidth: 1,
      fill: "transparent",
      rows: 2,
      columns: 2,
      colWidths: [150, 150],
      rowHeights: [30, 30],
      cells: [
        { text: "{{description}}", textAlign: "left", fontSize: 12, fontWeight: "normal" },
        { text: "{{amount}}", textAlign: "right", fontSize: 12, fontWeight: "normal" },
        { text: "{{description}}", textAlign: "left", fontSize: 12, fontWeight: "normal" },
        { text: "{{amount}}", textAlign: "right", fontSize: 12, fontWeight: "normal" },
      ],
      borderColor: "#000000",
      borderWidth: 1,
      cellFill: "transparent",
      headerRow: false,
      headerFill: "transparent",
      headerTextColor: "#000000",
      cellTextColor: "#000000",
      padding: 4,
      fontFamily: "Arial",
      repeat: { key: "items", startRow: 0, endRow: 1, maxItems: 20 },
    } as unknown as TableObject;
    template.objects = [table];

    const rows = JSON.parse(sampleValuesForTemplate(template).items!) as Array<Record<string, string>>;

    expect(rows).toHaveLength(3);
    expect(rows[0]).toEqual(expect.objectContaining({
      description: expect.stringContaining("sample line 1"),
      amount: "9876543.21",
    }));
    expect(JSON.parse(sampleValuesForTemplate(template, { maxRepeatItems: true }).items!)).toHaveLength(20);
  });

  it("links unresolved token warnings to the object that contains the token", () => {
    const template = emptyTemplate(300, 400);
    template.objects = [textObject({ text: "{{customer_name}} / {{invoice_id}}" })];
    const unresolvedIssues = preflightTemplate(template).filter((issue) => issue.message.startsWith("Dynamic field"));
    expect(unresolvedIssues).toHaveLength(2);
    expect(unresolvedIssues.every((issue) => issue.objectId === "customer-name")).toBe(true);
  });

  it("blocks calculation rules that reference missing fields", () => {
    const template = emptyTemplate(300, 400);
    template.meta.computed = [{ key: "total", op: "add", args: ["missing_amount", "another_amount"] }];
    expect(preflightTemplate(template)).toEqual(expect.arrayContaining([
      expect.objectContaining({ severity: "error", message: expect.stringContaining("neither a declared field key") }),
    ]));
  });
});
