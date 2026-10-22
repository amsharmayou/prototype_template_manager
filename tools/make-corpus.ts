/**
 * Body corpus: reusable templates with sample values, written to
 * tests/fixtures/corpus/. Authored programmatically so the corpus is
 * reproducible; each carries the computed rules a real bill of its kind needs.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import type { ComputedSpec } from "../lib/package/format";
import type { BillTemplate, TableCell, TableObject, TemplateObject } from "../lib/template/types";
import { emptyTemplate } from "../lib/template/types";

interface Fixture {
  name: string;
  template: BillTemplate;
  values: Record<string, string>;
}

let uid = 0;
const nid = (p: string): string => `${p}_${(uid += 1)}`;

function text(o: { text: string; y: number } & Record<string, unknown>): TemplateObject {
  return {
    type: "text", id: nid("t"), name: o.text.slice(0, 24),
    roleKind: o.text.includes("{{") ? "variable" : "static",
    x: 40, width: 700, height: 22, rotation: 0, opacity: 1, visible: true,
    locked: false, zIndex: 1, parentId: null, stroke: "#000000", strokeWidth: 0,
    fill: "#101010", fontFamily: "Arimo", fontSize: 12, fontWeight: "normal",
    fontStyle: "normal", textAlign: "left", lineHeight: 1.16, charSpacing: 0,
    textVerticalAlign: "top", scaleX: 1, scaleY: 1,
    ...o,
  } as TemplateObject;
}

function cell(t: string, over: Partial<TableCell> = {}): TableCell {
  return { text: t, textAlign: "left", fontSize: 11, fontWeight: "normal", ...over };
}

function bandTable(
  head: string[],
  repeatKey: string,
  over: Record<string, unknown> = {},
  maxItems = 60,
): TableObject {
  const colWidths = head.length === 4 ? [60, 380, 130, 144] : [240, 480, 130, 144];
  const width = colWidths.reduce((a, b) => a + b, 0);
  const cells: TableCell[] = [
    cell(head[0] ?? "", { fontWeight: "bold", textAlign: "center" }),
    cell(head[1] ?? "", { fontWeight: "bold" }),
    cell(head[2] ?? "", { fontWeight: "bold", textAlign: "right" }),
    cell(head[3] ?? "", { fontWeight: "bold", textAlign: "right" }),
    cell(`{{${repeatKey}.qty}}`, { textAlign: "center" }),
    cell(`{{${repeatKey}.description}}`),
    cell(`{{${repeatKey}.rate}}`, { textAlign: "right" }),
    cell("{{line}}", { textAlign: "right" }),
    cell(""), cell(""), cell(""), cell(""),
  ];
  return {
    type: "table", id: nid("tab"), name: "Item rows", roleKind: "static",
    x: 40, y: 420, width, height: 90, rotation: 0, opacity: 1, visible: true,
    locked: false, zIndex: 2, parentId: null, stroke: "#000000", strokeWidth: 1,
    fill: "transparent", fontFamily: "Arimo", rows: 3, columns: head.length,
    colWidths, rowHeights: [30, 30, 30], cells, borderColor: "#3a3a3a",
    borderWidth: 1, cellFill: "transparent", headerRow: true, headerFill: "#f2efe8",
    headerTextColor: "#101010", cellTextColor: "#101010", padding: 4,
    repeat: { key: repeatKey, startRow: 1, endRow: 1, maxItems, repeatHeader: true },
    expansion: { y: { mode: "unbounded" } },
    ...over,
  } as unknown as TableObject;
}

const headerBlocks = (title: string): TemplateObject[] => [
  text({ text: "ACME TRADING CO.", y: 40, fontSize: 20, fontWeight: "bold" }),
  text({ text: "23 Ring Road, Mumbai 400001 · GSTIN: 27ABCDE1234F1Z5", y: 66, fontSize: 10 }),
  text({ text: title, y: 100, fontSize: 16, fontWeight: "bold" }),
  text({ text: "No. {{invoice_number}}", y: 130 }),
  text({ text: "Dated: {{invoice_date}}", x: 480, y: 130 }),
  text({ text: "Bill to: {{customer_name}}", y: 160 }),
  text({ text: "{{customer_address}}", y: 182, fontSize: 10 }),
];

const LINE: ComputedSpec = { key: "line", op: "sum-times", args: ["items.qty", "items.rate"] };
const SUBTOTAL: ComputedSpec = { key: "subtotal", op: "sum", args: ["items.line"] };

const itemRows = (rows: Array<[string, string, string]>): string =>
  JSON.stringify(rows.map(([qty, description, rate]) => ({ qty, description, rate })));

const fixtures: Fixture[] = [];
const baseValues = {
  invoice_number: "INV-2026-1042",
  invoice_date: "2026-10-03",
  customer_name: "Sharma & Sons",
  customer_address: "14 Mall Road, Pune 411001",
};

// 1. GST invoice: band with per-line figures, percentage tax, grand figure.
{
  const template = emptyTemplate(794, 1123, "GST invoice");
  template.objects = [
    ...headerBlocks("TAX INVOICE"),
    bandTable(["Qty", "Description", "Rate", "Line"], "items"),
    text({ text: "Subtotal {{subtotal}}", x: 470, y: 640, width: 280, textAlign: "right" }),
    text({ text: "GST {{tax_amount}} at {{tax_rate}} percent", x: 470, y: 666, width: 280, textAlign: "right" }),
    text({ text: "TOTAL {{grand_total}}", x: 470, y: 692, width: 280, textAlign: "right", fontWeight: "bold" }),
  ];
  template.meta.computed = [
    LINE,
    SUBTOTAL,
    { key: "tax_amount", op: "percent", args: ["subtotal"], rateKey: "tax_rate" },
    { key: "grand_total", op: "add", args: ["subtotal", "tax_amount"] },
  ];
  fixtures.push({
    name: "gst-invoice", template,
    values: {
      ...baseValues, tax_rate: "18",
      items: itemRows([["2", "A4 notebook, 200 pages", "120.00"], ["0.125", "Fabric per metre", "550.25"], ["10", "Gel pen, blue", "35"]]),
    },
  });
}

// 2. Retail receipt: narrow custom sheet, fractional counts.
{
  const template = emptyTemplate(384, 700, "Retail receipt");
  template.objects = [
    text({ text: "SHARMA GENERAL STORE", y: 20, fontSize: 14, fontWeight: "bold", x: 24, width: 336 }),
    text({ text: "{{invoice_number}} - {{invoice_date}}", x: 24, y: 44, fontSize: 10, width: 336 }),
    text({ text: "{{customer_name}}", y: 64, fontSize: 11, x: 24, width: 336 }),
    { ...(() => { const t = bandTable(["Qty", "Item", "Rate", "Line"], "items"); t.x = 24; t.y = 90; t.width = 336; t.colWidths = [40, 156, 70, 70]; t.cells.forEach((c) => (c.fontSize = 9)); return t; })() },
    text({ text: "TOTAL {{grand_total}}", x: 24, y: 420, width: 336, textAlign: "right", fontWeight: "bold", fontSize: 14 }),
    text({ text: "Cash: {{cash_tendered}}", x: 24, y: 450, width: 336, textAlign: "right" }),
    text({ text: "Change: {{change_due}}", x: 24, y: 470, width: 336, textAlign: "right" }),
  ];
  template.meta.computed = [
    { key: "line", op: "sum-times", args: ["items.qty", "items.rate"] },
    { key: "subtotal", op: "sum", args: ["items.line"] },
    { key: "grand_total", op: "add", args: ["subtotal"] },
    { key: "change_due", op: "subtract", args: ["cash_tendered", "grand_total"] },
  ];
  fixtures.push({
    name: "retail-receipt", template,
    values: {
      invoice_number: "R-5567", invoice_date: "2026-10-17",
      customer_name: "Walk-in",
      cash_tendered: "700",
      items: itemRows([["2", "Milk 1L", "58.50"], ["0.5", "Rice kg", "62"], ["1", "Matchbox", "2"]]),
    },
  });
}

// 3. Hindi bill: Devanagari labels through the same engine contracts.
{
  const template = emptyTemplate(794, 1123, "Hindi bill");
  template.objects = [
    text({ text: "शर्मा ट्रेडिंग कंपनी", y: 40, fontSize: 20, fontWeight: "bold" }),
    text({ text: "बिल संख्या: {{invoice_number}}", y: 100, fontSize: 14 }),
    text({ text: "दिनांक: {{invoice_date}}", x: 480, y: 100, fontSize: 14 }),
    text({ text: "ग्राहक: {{customer_name}}", y: 130, fontSize: 14 }),
    bandTable(["मात्रा", "विवरण", "दर", "राशि"], "items"),
    text({ text: "कुल {{grand_total}}", x: 470, y: 660, width: 280, textAlign: "right", fontSize: 14 }),
  ];
  template.meta.computed = [
    { key: "line", op: "sum-times", args: ["items.qty", "items.rate"] },
    { key: "subtotal", op: "sum", args: ["items.line"] },
    { key: "grand_total", op: "add", args: ["subtotal"] },
  ];
  fixtures.push({
    name: "hindi-bill", template,
    values: { ...baseValues, items: itemRows([["2", "A4 नोटबुक 200 पेज", "120.00"], ["1", "ज्यामिति बॉक्स", "95"]]) },
  });
}

// 4. Salary slip: flat fields, one rate band, no tax.
{
  const template = emptyTemplate(794, 1123, "Salary slip");
  template.objects = [
    ...headerBlocks("SALARY SLIP"),
    text({ text: "Employee: {{employee_name}} ({{employee_id}})", y: 210 }),
    text({ text: "Month: {{pay_month}}", y: 232 }),
    bandTable(["Days", "Component", "Rate", "Line"], "entries"),
    text({ text: "Net pay {{net_pay}}", x: 470, y: 645, width: 280, textAlign: "right", fontWeight: "bold" }),
  ];
  template.meta.computed = [
    { key: "line", op: "sum-times", args: ["entries.qty", "entries.rate"] },
    { key: "net_pay", op: "sum", args: ["entries.line"] },
  ];
  fixtures.push({
    name: "salary-slip", template,
    values: {
      ...baseValues,
      customer_name: "Acme Trading Co.", customer_address: "23 Ring Road, Mumbai",
      employee_name: "P. Deshpande", employee_id: "EMP-014", pay_month: "September 2026",
      items: itemRows([["22", "Basic", "1200"], ["6", "Overtime hours", "210.75"]]),
    },
  });
}

// 5. Quotation: validity window, rounded estimate.
{
  const template = emptyTemplate(794, 1123, "Quotation");
  template.objects = [
    ...headerBlocks("QUOTATION"),
    text({ text: "Valid until {{valid_until}}", y: 210 }),
    bandTable(["Qty", "Item", "Rate", "Line"], "items"),
    text({ text: "Estimate {{subtotal}}", x: 470, y: 645, width: 280, textAlign: "right" }),
  ];
  template.meta.computed = [LINE, SUBTOTAL];
  fixtures.push({
    name: "quotation", template,
    values: {
      ...baseValues, valid_until: "2026-11-05",
      items: itemRows([["1", "Site survey", "15000"], ["3", "Commissioning visit", "4500.50"]]),
    },
  });
}

// 6. Credit note: negative quantity lines must mirror the positive side.
{
  const template = emptyTemplate(794, 1123, "Credit note");
  template.objects = [
    ...headerBlocks("CREDIT NOTE"),
    text({ text: "Against invoice {{against_invoice}}", y: 210 }),
    bandTable(["Qty", "Item", "Rate", "Line"], "items"),
    text({ text: "Returned {{subtotal}}", x: 470, y: 645, width: 280, textAlign: "right" }),
  ];
  template.meta.computed = [LINE, SUBTOTAL];
  fixtures.push({
    name: "credit-note", template,
    values: {
      ...baseValues, customer_name: "Sharma & Sons",
      against_invoice: "INV-2026-1042",
      items: itemRows([["-2", "A4 notebook, 200 pages", "120.00"]]),
    },
  });
}

// 7. Multi-tax bill: CGST and SGST as separate percentages of one base.
{
  const template = emptyTemplate(794, 1123, "Multi-tax bill");
  template.objects = [
    ...headerBlocks("TAX INVOICE"),
    bandTable(["Qty", "Description", "Rate", "Line"], "items"),
    text({ text: "Subtotal {{subtotal}}", x: 470, y: 620, width: 280, textAlign: "right" }),
    text({ text: "CGST {{cgst}} + SGST {{sgst}}", x: 470, y: 646, width: 280, textAlign: "right" }),
    text({ text: "TOTAL {{grand_total}}", x: 470, y: 672, width: 280, textAlign: "right", fontWeight: "bold" }),
  ];
  template.meta.computed = [
    LINE, SUBTOTAL,
    { key: "cgst", op: "percent", args: ["subtotal"], rateKey: "cgst_rate" },
    { key: "sgst", op: "percent", args: ["subtotal"], rateKey: "sgst_rate" },
    { key: "grand_total", op: "add", args: ["subtotal", "cgst", "sgst" ] },
  ];
  fixtures.push({
    name: "multi-tax", template,
    values: {
      ...baseValues, cgst_rate: "9", sgst_rate: "9",
      items: itemRows([["4", "Cotton fabric, per metre", "310.40"]]),
    },
  });
}

// 8. Landscape sheet.
{
  const template = emptyTemplate(1123, 794, "Landscape packing list");
  template.objects = [
    ...headerBlocks("PACKING LIST"),
    bandTable(["Qty", "Package", "", ""], "cartons"),
    text({ text: "Cartons: {{carton_total}}", x: 700, y: 600, width: 200, textAlign: "right" }),
  ];
  template.meta.computed = [{ key: "carton_total", op: "sum", args: ["cartons.qty"] }];
  fixtures.push({
    name: "packing-list", template,
    values: {
      ...baseValues,
      items: itemRows([["12", "Carton A", ""], ["9", "Carton B", ""]]),
    },
  });
}

// 9. Restaurant bill: fractional plate counts and split taxes.
{
  const template = emptyTemplate(794, 1123, "Restaurant bill");
  template.objects = [
    text({ text: "RAVI'S KITCHEN", y: 40, fontSize: 20, fontWeight: "bold" }),
    text({ text: "Table {{table_no}} - Steward {{steward}}", y: 70, fontSize: 10 }),
    text({ text: "Bill {{invoice_number}} - {{invoice_date}}", y: 90, fontSize: 10 }),
    bandTable(["Qty", "Item", "Rate", "Line"], "orders"),
    text({ text: "Food {{food_total}}", x: 470, y: 620, width: 280, textAlign: "right" }),
    text({ text: "CGST {{cgst}} - SGST {{sgst}}", x: 470, y: 646, width: 280, textAlign: "right" }),
    text({ text: "TOTAL {{grand_total}}", x: 470, y: 672, width: 280, textAlign: "right", fontWeight: "bold" }),
  ];
  template.meta.computed = [
    { key: "line", op: "sum-times", args: ["orders.qty", "orders.rate"] },
    { key: "food_total", op: "sum", args: ["orders.line"] },
    { key: "cgst", op: "percent", args: ["food_total"], rateKey: "gst_rate" },
    { key: "sgst", op: "percent", args: ["food_total"], rateKey: "gst_rate" },
    { key: "grand_total", op: "add", args: ["food_total", "cgst", "sgst"] },
  ];
  fixtures.push({
    name: "restaurant-bill", template,
    values: {
      invoice_number: "RB-881", invoice_date: "2026-10-16",
      customer_name: "Table 12", customer_address: "Dine-in",
      table_no: "12", steward: "Ravi", gst_rate: "2.5",
      items: itemRows([["2", "Paneer tikka", "260"], ["3", "Butter naan", "60"], ["1.5", "Dal, half litre", "180"]]),
    },
  });
}

// 10. Minimal blank: valid, nothing dynamic.
{
  const template = emptyTemplate(794, 1123, "Blank sheet");
  template.objects = [text({ text: "ACME TRADING CO.", y: 40, fontSize: 20, fontWeight: "bold" })];
  template.meta.computed = [];
  fixtures.push({ name: "blank-sheet", template, values: {} });
}

// 11. Delivery challan: no money column, text-only band cells.
{
  const template = emptyTemplate(794, 1123, "Delivery challan");
  template.objects = [
    ...headerBlocks("DELIVERY CHALLAN"),
    bandTable(["Qty", "Goods", "", ""], "boxes"),
    text({ text: "Vehicle: {{vehicle_no}}", y: 660 }),
  ];
  template.meta.computed = [];
  fixtures.push({
    name: "delivery-challan", template,
    values: {
      ...baseValues, vehicle_no: "MH 12 AB 3456",
      items: itemRows([["6", "Carton, stationery", ""], ["11", "Carton, labels", ""]]),
    },
  });
}

// 12. metre-heavy trade bill: count scale under real trade sizes.
{
  const template = emptyTemplate(794, 1123, "Trade bill");
  template.objects = [
    ...headerBlocks("TAX INVOICE"),
    bandTable(["Qty", "Description", "Rate", "Line"], "items"),
    text({ text: "TOTAL {{grand_total}}", x: 470, y: 660, width: 280, textAlign: "right", fontWeight: "bold" }),
  ];
  template.meta.computed = [
    LINE, SUBTOTAL,
    { key: "grand_total", op: "add", args: ["subtotal"] },
  ];
  fixtures.push({
    name: "trade-bill", template,
    values: {
      ...baseValues,
      items: itemRows([
        ["12.375", "Fabric A, per metre", "425.55"],
        ["0.0625", "Fabric B, per metre", "1250"],
        ["7", "Lining, per metre", "99.99"],
      ]),
    },
  });
}

const dir = join(import.meta.dirname, "..", "tests", "fixtures", "corpus");
mkdirSync(dir, { recursive: true });
for (const f of fixtures) {
  writeFileSync(join(dir, `${f.name}.template.json`), JSON.stringify(f.template, null, 2), "utf8");
  writeFileSync(join(dir, `${f.name}.values.json`), JSON.stringify(f.values, null, 2), "utf8");
}
console.log(`corpus written: ${fixtures.length} templates in ${dir}`);

// 13. Long invoice: 80 band rows on A4 - the pagination exit fixture.
// The band starts at y=420 with 30px rows: page 1 holds the traced header plus
// 22 data rows, every later page holds 36 more under a repeated header, so the
// rows flow across three sheets and the summary lands under the final chunk.
{
  const template = emptyTemplate(794, 1123, "Long invoice");
  const band = bandTable(["Qty", "Description", "Rate", "Line"], "items", {}, 200);
  template.objects = [
    ...headerBlocks("TAX INVOICE"),
    band,
    text({ text: "Subtotal {{subtotal}}", x: 470, y: 620, width: 280, textAlign: "right" }),
    text({ text: "GENERAL SALES TAX {{tax_amount}}", x: 470, y: 646, width: 280, textAlign: "right" }),
    text({ text: "TOTAL {{grand_total}}", x: 470, y: 672, width: 280, textAlign: "right", fontWeight: "bold" }),
  ];
  template.meta.computed = [
    LINE, SUBTOTAL,
    { key: "tax_amount", op: "percent", args: ["subtotal"], rateKey: "tax_rate" },
    { key: "grand_total", op: "add", args: ["subtotal", "tax_amount"] },
  ];
  fixtures.push({
    name: "long-invoice",
    template,
    values: {
      ...baseValues, tax_rate: "12",
      items: itemRows(
        Array.from({ length: 80 }, (_, i) => [
          String(i % 7 === 0 ? 2 : 1),
          `Catalogue item number ${i + 1}, unit-packed`,
          String(40 + (i % 13) * 7) + (i % 5 === 0 ? ".50" : ""),
        ]),
      ),
    },
  });
}

// (Writer second pass: appended fixtures above must reach disk too.)
{
  const dir = join(import.meta.dirname, "..", "tests", "fixtures", "corpus");
  mkdirSync(dir, { recursive: true });
  for (const f of fixtures) {
    writeFileSync(join(dir, `${f.name}.template.json`), JSON.stringify(f.template, null, 2), "utf8");
    writeFileSync(join(dir, `${f.name}.values.json`), JSON.stringify(f.values, null, 2), "utf8");
  }
  console.log(`corpus second pass: ${fixtures.length} templates in ${dir}`);
}
