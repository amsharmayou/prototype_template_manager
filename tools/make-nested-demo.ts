/**
 * Generates the New_Expandable §17 worked example as a runnable package.
 *
 * An outer rectangle contains an inner panel; the panel holds a growing
 * address field and a bottom-anchored label below it. Fill the address with a
 * long value and the field, the inner panel and the outer frame all grow
 * together, with the label keeping its bottom inset — or run the same
 * template through calculateLayout/renderHtml in a unit test.
 */
import { writeFileSync } from "node:fs";

import { buildPackage, writePackage } from "../lib/package/build";
import { validateLayout } from "../lib/package/layout";

const template = {
  templateVersion: 2 as const,
  meta: {
    name: "NESTED DEMO",
    notes: "New_Expandable §17: nested containers with a bottom-anchored sibling",
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
      id: "outer",
      type: "rect",
      name: "Outer frame",
      role: null,
      x: 40, y: 40, width: 500, height: 120,
      rotation: 0, opacity: 1, visible: true, locked: false, zIndex: 0, parentId: null,
      stroke: "#333333", strokeWidth: 2, fill: "transparent",
      cornerRadius: 0,
      container: {
        enabled: true,
        growthX: "fixed",
        growthY: "content",
        padding: { top: 10, right: 10, bottom: 10, left: 10 },
      },
    },
    {
      id: "inner",
      type: "rect",
      name: "Details panel",
      role: null,
      x: 50, y: 50, width: 480, height: 80,
      rotation: 0, opacity: 1, visible: true, locked: false, zIndex: 1, parentId: null,
      layoutParentId: "outer",
      stroke: "#888888", strokeWidth: 1, fill: "transparent",
      cornerRadius: 0,
      container: {
        enabled: true,
        growthX: "fixed",
        growthY: "content",
        padding: { top: 8, right: 8, bottom: 8, left: 8 },
      },
    },
    {
      id: "f_address",
      type: "field",
      name: "Address",
      role: "customer_address",
      key: "customer_address",
      fieldType: "text",
      x: 58, y: 58, width: 300, height: 20,
      rotation: 0, opacity: 1, visible: true, locked: false, zIndex: 2, parentId: null,
      layoutParentId: "inner",
      stroke: "transparent", strokeWidth: 0, fill: "#000000",
      text: "{{customer_address}}",
      fontFamily: "Arial", fontSize: 12, fontWeight: "normal", fontStyle: "normal",
      textAlign: "left", lineHeight: 1.16, charSpacing: 0,
      roleKind: "variable", textVerticalAlign: "top",
      expansion: {
        x: { mode: "fixed" },
        y: { mode: "unbounded", strategy: "wrap" },
      },
    },
    {
      id: "t_footer",
      type: "text",
      name: "Panel footer",
      role: null,
      x: 58, y: 102, width: 300, height: 18,
      rotation: 0, opacity: 1, visible: true, locked: false, zIndex: 3, parentId: null,
      layoutParentId: "inner",
      anchor: { vertical: "end" },
      stroke: "transparent", strokeWidth: 0, fill: "#000000",
      text: "Deliver to the address above.",
      fontFamily: "Arial", fontSize: 10, fontWeight: "normal", fontStyle: "normal",
      textAlign: "left", lineHeight: 1.16, charSpacing: 0,
      roleKind: "static", textVerticalAlign: "top",
    },
    {
      id: "t_below",
      type: "text",
      name: "Section below",
      role: null,
      x: 40, y: 180, width: 300, height: 18,
      rotation: 0, opacity: 1, visible: true, locked: false, zIndex: 4, parentId: null,
      stroke: "transparent", strokeWidth: 0, fill: "#000000",
      text: "Totals follow on the next section.",
      fontFamily: "Arial", fontSize: 10, fontWeight: "normal", fontStyle: "normal",
      textAlign: "left", lineHeight: 1.16, charSpacing: 0,
      roleKind: "static", textVerticalAlign: "top",
    },
  ],
  layout: {
    mode: "variable" as const,
    document: { growthX: "fixed" as const, growthY: "expand" as const, maxHeight: 4000 },
    guides: [{ id: "after-outer", orientation: "horizontal" as const, position: 170 }],
    attachments: [
      {
        id: "att_below",
        objectId: "t_below",
        edge: "top" as const,
        guideId: "after-outer",
        behavior: "move" as const,
      },
    ],
  },
};

const issues = validateLayout(template as never);
const errors = issues.filter((i) => i.severity === "error");
if (errors.length > 0) {
  console.error("layout is invalid:", errors.map((e) => `${e.path}: ${e.message}`));
  process.exit(1);
}

const bytes = writePackage(buildPackage(template as never, { computed: [] as never }));
const out = process.argv[2] ?? "nested-demo.btpkg";
writeFileSync(out, bytes);
console.log(`wrote ${out} (${bytes.length} bytes)`);

const bare = out.replace(/\.btpkg$/i, "") + ".template.json";
writeFileSync(bare, JSON.stringify(template, null, 2), "utf8");
console.log(`wrote ${bare}`);
const warnings = issues.filter((i) => i.severity !== "error");
console.log(`warnings: ${warnings.length ? warnings.map((w) => w.message).join("; ") : "none"}`);
console.log("fill customer_address with a long value: f_address, inner and outer grow;");
console.log("t_footer keeps its bottom inset; t_below follows the after-outer guide.");
