/**
 * Builds a standalone share file from a template so it can be opened and driven
 * like a real recipient would. Kept as a script for the same reason as the
 * bill fixture: reproducible, reviewable, no hidden state.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { buildShareDocument } from "../lib/share/document";
import { emptyTemplate, type BillTemplate, type TemplateObject } from "../lib/template/types";

const kit = readFileSync(join(process.cwd(), "public", "sharekit.js"), "utf8");

function text(id: string, name: string, x: number, y: number, body: string, over: Record<string, unknown> = {}): TemplateObject {
  return {
    id,
    name,
    role: null,
    x,
    y,
    width: 320,
    height: 26,
    rotation: 0,
    opacity: 1,
    visible: true,
    locked: false,
    zIndex: 0,
    parentId: null,
    stroke: "transparent",
    strokeWidth: 0,
    fill: "#111111",
    type: "text",
    text: body,
    fontFamily: "Arial",
    fontSize: 16,
    fontWeight: "normal",
    fontStyle: "normal",
    textAlign: "left",
    lineHeight: 1.16,
    charSpacing: 0,
    roleKind: "static",
    textVerticalAlign: "top",
    ...over,
  } as unknown as TemplateObject;
}

const template = emptyTemplate(794, 1123, "Shared tax invoice");
template.meta.placeholders = [
  { key: "company", label: "Your company name", fontFamily: "Georgia", fontWeight: "bold", fontSize: 24 },
  { key: "invoice_ref", label: "Invoice number", maxLength: 12 },
  { key: "total", type: "currency", fontWeight: "bold" },
];
const logoSlot = {
  id: "ph1", name: "Logo", role: "logo", x: 60, y: 240, width: 160, height: 80,
  rotation: 0, opacity: 1, visible: true, locked: false, zIndex: 1,
  parentId: null, stroke: "#000000", strokeWidth: 1, fill: "transparent",
  type: "image-placeholder", placeholderRole: "logo", label: "LOGO",
} as unknown as TemplateObject;

/**
 * A slot placed with the field tool. `fieldType` is the author's choice, and
 * the form has to honour it: a tickmark asked for on the canvas has to arrive
 * as a tickmark in the generated form rather than a free-text box.
 */
function field(
  id: string,
  key: string,
  fieldType: "text" | "tickmark" | "checkbox" | "currency",
  x: number,
  y: number,
  over: Record<string, unknown> = {},
): TemplateObject {
  return {
    id,
    name: `Field ${id}`,
    role: null,
    x,
    y,
    width: 150,
    height: 28,
    rotation: 0,
    opacity: 1,
    visible: true,
    locked: false,
    zIndex: 2,
    parentId: null,
    stroke: "#2563eb",
    strokeWidth: 1,
    // A template field's `fill` is the value's ink, not the editor tint.
    fill: "#000000",
    type: "field",
    key,
    fieldType,
    text: `{{${key}}}`,
    fontFamily: "Arial",
    fontSize: 16,
    fontWeight: "normal",
    fontStyle: "normal",
    textAlign: "left",
    lineHeight: 1.16,
    charSpacing: 0,
    roleKind: "variable",
    textVerticalAlign: "top",
    ...over,
  } as unknown as TemplateObject;
}

template.objects = [
  text("t1", "Company", 60, 80, "{{company}}"),
  text("t2", "Invoice number", 60, 130, "Invoice {{invoice_ref}}"),
  text("t3", "Total", 60, 190, "Total: {{total}}", { fill: "#b91c1c" }),
  text("t4", "Footer", 60, 1040, "Static footer text", { fill: "#b91c1c" }),
  // Placed with the field tool, so these are `source: "field"`. The share page
  // used to have no group for that source and dropped them entirely.
  field("f1", "paid", "tickmark", 60, 340),
  field("f2", "gift_wrap", "checkbox", 60, 390),
  // Alignment and font have to reach the printed page, as they do for a text box.
  field("f3", "terms_note", "text", 60, 440, {
    textAlign: "right",
    fontFamily: "Georgia",
    fontWeight: "bold",
    fontSize: 20,
  }),
  logoSlot,
];

const out = join(process.cwd(), "e2e", "fixtures", "shared-template.html");
writeFileSync(out, buildShareDocument(template as BillTemplate, kit), "utf8");
console.log(`wrote ${out}`);