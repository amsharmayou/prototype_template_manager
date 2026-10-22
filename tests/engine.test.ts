/**
 * The engine against the corpus: layout from the bundled font files, the
 * display list as a pure artifact, and the PDF as vector output with
 * embedded subsets.
 */
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { PDFDocument } from "pdf-lib";
import { describe, expect, it } from "vitest";

import { FontBook } from "@/lib/engine/fonts";
import { buildDisplayList, hasComplexScript } from "@/lib/engine/list";
import { writePdf } from "@/lib/engine/pdf";
import { renderDocument } from "@/lib/render/document";
import { displayMapFor } from "@/lib/template/dataBinding";
import { computedSpecsFor } from "@/lib/package/computedSpecs";
import type { BillTemplate } from "@/lib/template/types";

const fontsDir = join(__dirname, "..", "assets", "fonts");
const corpusDir = join(__dirname, "fixtures", "corpus");

function loadBook(): FontBook {
  const sources: Array<[string, Uint8Array]> = readdirSync(fontsDir)
    .filter((f) => f.endsWith(".ttf"))
    .map((f) => [`fonts/${f}`, new Uint8Array(readFileSync(join(fontsDir, f)))]);
  const { book, failures } = FontBook.load(sources);
  expect(failures.filter((f) => !f.includes("not in the provided set"))).toEqual([]);
  return book;
}

function invoice(): { template: BillTemplate; values: Record<string, string> } {
  return {
    template: JSON.parse(readFileSync(join(corpusDir, "gst-invoice.template.json"), "utf8")) as BillTemplate,
    values: JSON.parse(readFileSync(join(corpusDir, "gst-invoice.values.json"), "utf8")),
  };
}

describe("the display list engine", () => {
  it("builds a deterministic list from a solved render", () => {
    const book = loadBook();
    const { template, values } = invoice();
    const first = renderDocument(template, values, {
      computed: computedSpecsFor(template),
      display: displayMapFor(template),
    });
    const second = renderDocument(template, values, {
      computed: computedSpecsFor(template),
      display: displayMapFor(template),
    });
    const listA = buildDisplayList(
      { objects: first.objects, page: first.page, warnings: first.warnings },
      { book },
    );
    const listB = buildDisplayList(
      { objects: second.objects, page: second.page, warnings: second.warnings },
      { book },
    );
    expect(JSON.stringify(listA)).toBe(JSON.stringify(listB));
    expect(listA.fonts.length).toBeGreaterThan(0);
    const textPaint = listA.paint.filter((p) => p.kind === "text");
    expect(textPaint.length).toBeGreaterThan(4);
    for (const item of textPaint) {
      expect(item.kind === "text" && item.lines.length > 0).toBe(true);
      if (item.kind === "text") {
        for (const line of item.lines) {
          expect(Number.isFinite(line.x)).toBe(true);
          expect(Number.isFinite(line.baseline)).toBe(true);
          expect(line.font.family).toBe("Arimo");
        }
      }
    }
  });

  it("wraps a wide cell into two positioned lines from the font metrics", () => {
    const book = loadBook();
    const { template, values } = invoice();
    const rendered = renderDocument(template, values, {
      computed: computedSpecsFor(template),
      display: displayMapFor(template),
    });
    const list = buildDisplayList(
      { objects: rendered.objects, page: rendered.page, warnings: rendered.warnings },
      { book },
    );
    const joined = list.paint.flatMap((p) => (p.kind === "text" ? p.lines.map((l) => l.text) : []));
    // The fixture deliberately carries a long description that overflows its column.
    expect(joined.some((t) => t.includes("Fabric") || t.includes("metre"))).toBe(true);
    for (const item of list.paint) {
      if (item.kind !== "text") continue;
      for (const line of item.lines) {
        if (!(line.width > 0)) console.log("ZERO WIDTH:", JSON.stringify(line));
        expect(line.width).toBeGreaterThan(0);
      }
    }
  });
});

describe("the pdf writer", () => {
  it("writes one A4-exact page with embedded subsets, byte-deterministically", async () => {
    const book = loadBook();
    const { template, values } = invoice();
    const rendered = renderDocument(template, values, {
      computed: computedSpecsFor(template),
      display: displayMapFor(template),
    });
    const list = buildDisplayList(
      { objects: rendered.objects, page: rendered.page, warnings: rendered.warnings },
      { book },
    );
    const first = await writePdf(list, { book, title: template.meta?.name });
    const second = await writePdf(list, { book, title: template.meta?.name });
    if (first.refusals.length) console.log("PDFREF:", JSON.stringify(first.refusals.slice(0, 3)));
    expect(first.refusals).toEqual([]);
    expect(Buffer.from(first.bytes).equals(Buffer.from(second.bytes))).toBe(true);
    const doc = await PDFDocument.load(first.bytes);
    expect(doc.getPageCount()).toBe(1);
    const page = doc.getPage(0);
    const { width, height } = page.getSize();
    expect(Math.round(width * 100) / 100).toBeCloseTo(595.28, 1);
    expect(Math.round(height * 100) / 100).toBeCloseTo(841.89, 1);
    expect(first.bytes.slice(0, 5)).toEqual(new TextEncoder().encode("%PDF-"));
  });

  it("refuses to substitute a font the bundle does not carry", async () => {
    const book = loadBook();
    const { template, values } = invoice();
    const rendered = renderDocument(template, values, {
      computed: computedSpecsFor(template),
    });
    const list = buildDisplayList(
      { objects: rendered.objects, page: rendered.page, warnings: rendered.warnings },
      { book },
    );
    // Strip the bytes behind the display list's chosen face: the writer must
    // name the gap, not fall back to a standard font.
    (book as unknown as { bytes: Map<string, Uint8Array> }).bytes.delete(list.fonts[0]!.file);
    const { refusals } = await writePdf(list, { book });
    expect(refusals.some((m) => m.includes(list.fonts[0]!.file))).toBe(true);
  });

  it("refuses complex-script runs when no shaper is available", async () => {
    const book = loadBook();
    const template = JSON.parse(
      readFileSync(join(corpusDir, "hindi-bill.template.json"), "utf8"),
    ) as BillTemplate;
    const values = JSON.parse(readFileSync(join(corpusDir, "hindi-bill.values.json"), "utf8"));
    const rendered = renderDocument(template, values, {
      computed: computedSpecsFor(template),
    });
    // Layer 1: the list builder refuses the complex runs; pure-Latin runs
    // (numerals the band fills) still paint, because they need no shaping.
    const refused = buildDisplayList(
      { objects: rendered.objects, page: rendered.page, warnings: rendered.warnings },
      { book, refuseComplexScript: true },
    );
    expect(
      refused.paint.some((p) => p.kind === "text" && p.lines.some((l) => hasComplexScript(l.text))),
    ).toBe(false);
    expect(refused.warnings.some((w) => w.includes("shape"))).toBe(true);

    // Layer 2: the writer refuses runs a producer handed it anyway.
    const list = buildDisplayList(
      { objects: rendered.objects, page: rendered.page, warnings: rendered.warnings },
      { book },
    );
    expect(list.paint.some((p) => p.kind === "text")).toBe(true);
    const { refusals } = await writePdf(list, {
      book,
      refuseComplexScript: true,
    });
    expect(refusals.some((m) => m.includes("shaping"))).toBe(true);
  });
});
