import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

import { describe, expect, it } from "vitest";

import { renderHtml } from "@/lib/render";
import { emptyTemplate, type BillTemplate, type TemplateObject } from "@/lib/template/types";

const DIR = join(__dirname, "renderGolden");

const base = {
  id: "o", name: "o", role: null, x: 0, y: 0, width: 100, height: 40,
  rotation: 0, opacity: 1, visible: true, locked: false, zIndex: 0,
  parentId: null, stroke: "#000000", strokeWidth: 1, fill: "transparent",
};

const cases: Array<{ name: string; doc: { w: number; h: number }; objects: TemplateObject[] }> = [
  { name: "empty", doc: { w: 1240, h: 1754 }, objects: [] },
  { name: "single-text", doc: { w: 800, h: 1000 }, objects: [
    { ...base, id: "t1", type: "text", x: 40, y: 60, width: 300, height: 24,
      text: "ACME TRADING CO.", fontFamily: "Arial", fontSize: 18,
      fontWeight: "bold", fontStyle: "normal", textAlign: "left",
      lineHeight: 1.16, charSpacing: 0, roleKind: "static", textVerticalAlign: "top" } as TemplateObject,
  ] },
  { name: "a4-table", doc: { w: 794, h: 1123 }, objects: [
    { ...base, id: "tb", type: "table", x: 40, y: 200, width: 714, height: 90,
      rows: 3, columns: 3, colWidths: [300, 200, 214], rowHeights: [30, 30, 30],
      cells: Array.from({ length: 9 }, (_, i) => ({
        text: i === 0 ? "Item" : i === 1 ? "Qty" : i === 2 ? "Amount"
          : i === 3 ? "Widget" : i === 4 ? "2" : i === 5 ? "100.00"
          : i === 6 ? "Gadget" : i === 7 ? "1" : "50.00",
        textAlign: i === 2 || i === 5 || i === 8 ? "right" : "left",
        fontSize: 11, fontWeight: i < 3 ? "bold" : "normal",
      })),
      borderColor: "#000000", borderWidth: 1, cellFill: "transparent",
      headerRow: true, headerFill: "#f0f0f0", headerTextColor: "#000000",
      cellTextColor: "#000000", padding: 4, fontFamily: "Arial" } as TemplateObject,
  ] },
  { name: "every-primitive", doc: { w: 1000, h: 1400 }, objects: [
    { ...base, id: "r1", type: "rect", x: 20, y: 20, width: 200, height: 80, cornerRadius: 0, fill: "transparent" } as TemplateObject,
    { ...base, id: "r2", type: "rounded-rect", x: 20, y: 120, width: 200, height: 80, cornerRadius: 8, fill: "#eeeeee" } as TemplateObject,
    { ...base, id: "e1", type: "ellipse", x: 20, y: 220, width: 120, height: 120, cornerRadius: 0, fill: "transparent" } as TemplateObject,
    { ...base, id: "l1", type: "hr", x: 20, y: 360, width: 400, height: 0, x2: 420, y2: 360 } as TemplateObject,
    { ...base, id: "v1", type: "vr", x: 440, y: 360, width: 0, height: 200, x2: 440, y2: 560 } as TemplateObject,
    { ...base, id: "p1", type: "polygon", x: 460, y: 360, width: 100, height: 80, points: [[0,0],[100,20],[60,80]] } as TemplateObject,
    { ...base, id: "f1", type: "freehand", x: 580, y: 360, width: 120, height: 90, path: "M 0 0 L 60 40 L 120 10" } as TemplateObject,
    { ...base, id: "ph1", type: "image-placeholder", x: 580, y: 480, width: 160, height: 100, placeholderRole: "logo", label: "LOGO" } as TemplateObject,
    { ...base, id: "tx1", type: "text", x: 20, y: 600, width: 400, height: 24, text: "Total {{ total }}", fontFamily: "Arial", fontSize: 14, fontWeight: "bold", fontStyle: "normal", textAlign: "right", lineHeight: 1.16, charSpacing: 0, roleKind: "variable", textVerticalAlign: "top" } as TemplateObject,
  ] },
  { name: "non-a4", doc: { w: 2480, h: 3508 }, objects: [] },
];

const build = (c: (typeof cases)[number]): BillTemplate => {
  const t = emptyTemplate(c.doc.w, c.doc.h, "Golden");
  t.objects = c.objects;
  return t;
};

// Set UPDATE_GOLDEN=1 to rewrite the expected files, review the diff, and unset.
const UPDATE = process.env.UPDATE_GOLDEN === "1";

describe("golden render output", () => {
  for (const c of cases) {
    it(`matches ${c.name}.html`, () => {
      const { html } = renderHtml(build(c), c.name === "every-primitive" ? { total: "3,510.00" } : {});
      const file = join(DIR, `${c.name}.html`);
      if (UPDATE) {
        mkdirSync(dirname(file), { recursive: true });
        writeFileSync(file, html, "utf8");
      }
      expect(existsSync(file)).toBe(true);
      const expected = readFileSync(file, "utf8");
      if (expected !== html) {
        const e = expected.split("\n");
        const a = html.split("\n");
        const i = a.findIndex((line, n) => line !== e[n]);
        throw new Error(
          `golden mismatch at line ${i + 1}\n  expected: ${e[i] ?? "<eof>"}\n  actual:   ${a[i] ?? "<eof>"}\n` +
            (UPDATE ? "goldens were rewritten; review the diff" : "set UPDATE_GOLDEN=1 to regenerate"),
        );
      }
    });
  }
});

describe("golden properties that must hold for every case", () => {
  for (const c of cases) {
    it(`${c.name}.html carries no script and no remote reference`, () => {
      const { html } = renderHtml(build(c), c.name === "every-primitive" ? { total: "3,510.00" } : {});
      expect(html.startsWith("<!DOCTYPE html>")).toBe(true);
      expect(html).not.toContain("<script");
      expect(html).not.toContain("<link");
      expect(html).not.toContain("@import");
      expect(html).not.toContain("xmlns");
      expect(html).toMatch(/data-template-hash="[0-9a-f]{64}"/);
    });

    it(`${c.name}.html declares @page at the document's own size`, () => {
      const { html } = renderHtml(build(c), c.name === "every-primitive" ? { total: "3,510.00" } : {});
      // A4 is declared by paper name: 794x1123px is a fraction wider than the
      // real sheet, and the reconciliation is the printer's, which is exactly
      // the drift a print pipeline cannot afford. Every other size keeps px.
      const isA4 = c.doc.w === 794 && c.doc.h === 1123;
      const expectedRule = isA4
        ? "@page { size: A4; margin: 0; }"
        : `@page { size: ${c.doc.w}px ${c.doc.h}px; margin: 0; }`;
      expect(html).toContain(expectedRule);
    });
  }
});

/**
 * A bill's own text may legitimately contain a URL, so "no http:// anywhere"
 * is a property of an empty document and not of a populated one. Asserting it
 * on a populated document would be asserting that the renderer deletes content,
 * and the fix would be to mangle the bill rather than the test.
 */
describe("the no-http:// property is scoped to a document with no content of its own", () => {
  it("holds for an empty document", () => {
    const { html } = renderHtml(build(cases[0]!));
    expect(html).not.toContain("http://");
  });

  it("keeps a URL that the bill itself contains, escaped as text", () => {
    const t = build(cases[1]!);
    t.objects = [{ ...(cases[1]!.objects[0] as object), text: "See http://example.com/pay" } as TemplateObject];
    const { html } = renderHtml(t);
    expect(html).toContain("See http://example.com/pay");
    expect(html).not.toContain("href=");
  });
});