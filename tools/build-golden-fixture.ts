/**
 * Build the committed golden fixture: a compact invoice template that
 * exercises static text, variable tokens, a repeat band, a summary reference
 * to a derived computed value and the math-safe money column the engine sums
 * automatically (`computedSpecsFor`).
 *
 * Contract anchor per plan Phase 6: one committed fixture consumed by web
 * validation, the server's ingest and the Android reader. Rebuild with:
 *
 *      npm run fixture:build
 *
 * The template JSON is written pretty; the .btpkg bytes are deterministic
 * (ZIP epoch fixed in lib/package/build.ts), so the committed files can be
 * byte-compared everywhere the fixture travels.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { buildPackage, computedSpecsFor, writePackage } from "../lib/package";
import type {
  BillTemplate, TableObject, TemplateMeta, TemplateObject, TextObject,
} from "../lib/template/types";

const base = (
  id: string, name: string, x: number, y: number, width: number, height: number,
  zIndex: number,
): Omit<TemplateObject, "type"> => ({
  id, name, role: null,
  x, y, width, height,
  rotation: 0, opacity: 1, visible: true, locked: false,
  zIndex, parentId: null, layoutParentId: null,
  stroke: "transparent", strokeWidth: 0, fill: "transparent",
});

const text = (
  id: string, name: string, x: number, y: number, width: number, height: number,
  zIndex: number, content: string, fontSize: number, font: TextObject["fontWeight"],
): TextObject => ({
  type: "text",
  ...base(id, name, x, y, width, height, zIndex),
  text: content,
  fontFamily: "Helvetica",
  fontSize,
  fontWeight: font,
  fontStyle: "normal",
  textAlign: "left",
  lineHeight: 1.2,
  charSpacing: 0,
  roleKind: content.includes("{{") ? "variable" : "static",
  textVerticalAlign: "top",
});

const title = text("title", "Title", 40, 40, 300, 32, 0, "INVOICE", 20, "bold");
const ref = text("ref", "Invoice refs", 40, 80, 400, 24, 1, "No {{invoice_no}} - issued {{invoice_date}}", 11, "normal");
const customer = text("customer", "Customer name", 40, 110, 400, 24, 2, "{{customer_name}}", 12, "normal");

const table: TableObject = {
  type: "table",
  ...base("line-items", "Line items", 40, 160, 520, 120, 3),
  rows: 3, columns: 3,
  colWidths: [90, 300, 130],
  rowHeights: [36, 36, 48],
  cells: [
    { text: "Qty", textAlign: "left", fontSize: 10, fontWeight: "bold" },
    { text: "Description", textAlign: "left", fontSize: 10, fontWeight: "bold" },
    { text: "Amount", textAlign: "right", fontSize: 10, fontWeight: "bold" },
    { text: "{{qty}}", textAlign: "left", fontSize: 10, fontWeight: "normal" },
    { text: "{{description}}", textAlign: "left", fontSize: 10, fontWeight: "normal" },
    { text: "{{amount}}", textAlign: "right", fontSize: 10, fontWeight: "normal" },
    { text: "Total", textAlign: "left", fontSize: 10, fontWeight: "bold" },
    { text: "", textAlign: "left", fontSize: 10, fontWeight: "normal" },
    { text: "{{subtotal}}", textAlign: "right", fontSize: 10, fontWeight: "bold" },
  ],
  borderColor: "#d4d4d4", borderWidth: 1,
  cellFill: "#ffffff",
  headerRow: true, headerFill: "#f5f5f5", headerTextColor: "#171717", cellTextColor: "#171717",
  padding: 4, fontFamily: "Helvetica",
  expansion: { x: { mode: "fixed" }, y: { mode: "bounded", maxGrowth: 64 } },
  repeat: { startRow: 1, endRow: 1, key: "items", repeatHeader: true, maxItems: 25 },
};

const total = text("total", "Total line", 40, 300, 400, 24, 4, "Total: {{subtotal}} GBP", 12, "normal");

const meta: TemplateMeta = {
  name: "GOLDEN INVOICE",
  modifiedAt: "2026-10-19T00:00:00.000Z",
  placeholders: [
    { key: "invoice_no", type: "text" },
    { key: "invoice_date", type: "date" },
    { key: "customer_name", type: "text" },
    { key: "qty", type: "number" },
    { key: "amount", type: "currency" },
  ],
};

const template: BillTemplate = {
  templateVersion: 2,
  document: { width: 794, height: 1123 },
  meta,
  objects: [title, ref, customer, table, total],
};

const outDir = join(__dirname.replace(/tools$/, ""), "tests", "fixtures", "golden");
mkdirSync(outDir, { recursive: true });
writeFileSync(join(outDir, "invoice.template.json"), `${JSON.stringify(template, null, 2)}\n`, "utf8");
// The export pipeline passes the derivable computed specs explicitly
// (buildPackage never guesses), so the fixture mirrors that contract.
const bytes = writePackage(buildPackage(template, { computed: computedSpecsFor(template) }));
writeFileSync(join(outDir, "golden-invoice.btpkg"), bytes);
console.log(`golden fixture written: ${outDir} (template JSON + ${bytes.byteLength} bytes .btpkg)`);
