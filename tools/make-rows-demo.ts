/**
 * Generates a package that proves variable repeat rows end to end.
 *
 * A 2x2 items table whose description column grows, with a guide under the band
 * and the totals attached to it. Fill it with the sample, render, and the rows
 * should be as tall as their longest description with the totals following below.
 */
import { writeFileSync } from "node:fs";

import { buildPackage, writePackage } from "../lib/package/build";
import { validateLayout } from "../lib/package/layout";

const TABLE_ID = "t_items";
const GUIDE = "guide-1";

const template = {
  templateVersion: 2 as const,
  meta: {
    name: "ROWS DEMO",
    notes: "variable repeat rows",
    placeholders: [],
  },
  document: {
    width: 794,
    height: 1123,
    background: "#ffffff",
    margin: 24,
    currency: "GBP",
    locale: "en-GB",
  },
  objects: [
    {
      id: "h_title",
      type: "text",
      name: "Title",
      role: "title",
      x: 24,
      y: 24,
      width: 400,
      height: 28,
      text: "Variable Rows Demo",
      fontFamily: "Arial",
      fontSize: 20,
      fontWeight: "bold",
      fontStyle: "normal",
      textAlign: "left",
      lineHeight: 1.2,
      charSpacing: 0,
      wrap: false,
      fill: "#000000",
    },
    {
      id: TABLE_ID,
      type: "table",
      name: "Items",
      role: "items",
      x: 24,
      y: 80,
      width: 746,
      height: 120,
      columns: 2,
      colWidths: [546, 200],
      // Header, the repeating band, and a trailer below it.
      rowHeights: [24, 26, 24],
      cells: [
        { text: "Description", textAlign: "left", fontSize: 10, fontWeight: "bold" },
        { text: "Amount", textAlign: "right", fontSize: 10, fontWeight: "bold" },
        { text: "{{desc}}", textAlign: "left", fontSize: 10, fontWeight: "normal" },
        { text: "{{amount}}", textAlign: "right", fontSize: 10, fontWeight: "normal" },
        { text: "Total", textAlign: "left", fontSize: 10, fontWeight: "bold" },
        { text: "{{total}}", textAlign: "right", fontSize: 10, fontWeight: "bold" },
      ],
      borderColor: "#333333",
      borderWidth: 1,
      cellFill: "#ffffff",
      headerRow: true,
      headerFill: "#f0f0f0",
      headerTextColor: "#000000",
      cellTextColor: "#000000",
      padding: 4,
      fontFamily: "Arial",
      // The row axis is what makes this band variable: a row becomes as tall as
      // its tallest cell.
      expansion: { x: { mode: "fixed" }, y: { mode: "unbounded" } },
      repeat: { startRow: 1, endRow: 1, key: "items", maxItems: 40 },
    },
    {
      id: "r_rule",
      type: "rect",
      name: "Rule under the band",
      role: null,
      x: 24,
      y: 220,
      width: 746,
      height: 2,
      fill: "#333333",
      stroke: null,
      strokeWidth: 0,
      radius: 0,
    },
  ],
  layout: {
    mode: "variable" as const,
    document: { growthX: "fixed" as const, growthY: "expand" as const },
    // Sits just under the traced band; content growth pushes it down.
    guides: [{ id: GUIDE, orientation: "horizontal" as const, position: 222 }],
    attachments: [
      {
        id: "att_rule_top",
        objectId: "r_rule",
        edge: "top" as const,
        guideId: GUIDE,
        behavior: "move" as const,
      },
    ],
  },
};

// `op`, not `type`, and `args` carries the dotted column path - this is the
// shape `computeAll` reads, and getting it wrong renders a silent 0.00.
const computed = [{ key: "total", op: "sum", args: ["items.amount"] }];

const issues = validateLayout(template as never);
const errors = issues.filter((i) => i.severity === "error");
if (errors.length > 0) {
  console.error("layout is invalid:", errors.map((e) => e.message));
  process.exit(1);
}

const bytes = writePackage(buildPackage(template as never, { computed: computed as never }));
const out = process.argv[2] ?? "rows-demo.btpkg";
writeFileSync(out, bytes);
console.log(`wrote ${out} (${bytes.length} bytes)`);

// The bare template alongside it: the web editor's "fill and render" path
// takes template JSON, not a package, and the demo is far quicker to try there
// than through a server round trip.
const bare = out.replace(/\.btpkg$/i, "") + ".template.json";
writeFileSync(bare, JSON.stringify(template, null, 2), "utf8");
console.log(`wrote ${bare}`);
const warnings = issues.filter((i) => i.severity !== "error");
console.log(`warnings: ${warnings.length ? warnings.map((w) => w.message).join("; ") : "none"}`);