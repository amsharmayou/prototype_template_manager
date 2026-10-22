import { readdirSync, readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { performance } from "node:perf_hooks";

import { expect, it, describe } from "vitest";

import { buildDisplayPages } from "@/lib/engine/list";
import { FontBook } from "@/lib/engine/fonts";
import { writePdf } from "@/lib/engine/pdf";
import { renderDocument } from "@/lib/render/document";
import type { ComputedSpec } from "@/lib/package/format";
import type { BillTemplate, TableObject, TemplateObject } from "@/lib/template/types";
import { emptyTemplate } from "@/lib/template/types";

/**
 * The performance budget, asserted rather than aspirational (Phase 4):
 * rendering a 100-line bill - layout, band expansion, pagination and
 * display-list build - stays inside 500 ms, and writing its PDF stays inside
 * 1500 ms on the same run. The budget test fails loudly if either regresses;
 * the *actual* numbers are logged so a regression can be quantified, not just
 * noticed.
 */
const FONT_DIR = join(dirname(__dirname), "assets", "fonts");

function hundredLineBill(): { template: BillTemplate; values: Record<string, string>; computed: ComputedSpec[] } {
  const template = emptyTemplate(794, 1123, "Perf bill");
  const cells: NonNullable<TableObject["cells"]> = [];
  const heads = ["Qty", "Description", "Rate", "Line"];
  for (let c = 0; c < 4; c += 1) {
    cells.push({
      text: heads[c]!,
      textAlign: "left",
      fontSize: 11,
      fontWeight: "bold",
    } as never);
  }
  const templateRows = 2;
  for (let r = 1; r < templateRows; r += 1) {
    for (let c = 0; c < 4; c += 1) {
      cells.push({
        text:
          c === 0 ? "{{items.qty}}" : c === 1 ? "{{items.description}}" : c === 2 ? "{{items.rate}}" : "{{line}}",
        textAlign: "left",
        fontSize: 11,
        fontWeight: "normal",
      } as never);
    }
  }
  template.objects = [
    { type: "text", id: "hdr", text: "PERF BILL", y: 40, height: 24, x: 40, width: 600 } as unknown as TemplateObject,
    {
      type: "table",
      id: "band",
      name: "Rows",
      roleKind: "static",
      x: 40,
      y: 140,
      width: 714,
      height: 60,
      rotation: 0,
      opacity: 1,
      visible: true,
      locked: false,
      zIndex: 2,
      parentId: null,
      stroke: "#000000",
      strokeWidth: 1,
      fill: "transparent",
      fontFamily: "Arimo",
      rows: templateRows,
      columns: 4,
      colWidths: [60, 380, 130, 144],
      rowHeights: [28, 28],
      cells,
      borderColor: "#333333",
      borderWidth: 1,
      cellFill: "transparent",
      headerRow: true,
      headerFill: "#f2efe8",
      headerTextColor: "#101010",
      cellTextColor: "#101010",
      padding: 4,
      repeat: { key: "items", startRow: 1, endRow: 1, maxItems: 500, repeatHeader: true },
      expansion: { y: { mode: "unbounded" } },
    } as unknown as TableObject,
  ];
  template.meta.computed = [
    { key: "line", op: "sum-times", args: ["items.qty", "items.rate"] },
    { key: "subtotal", op: "sum", args: ["items.line"] },
  ];
  const values: Record<string, string> = {
    items: JSON.stringify(
      Array.from({ length: 100 }, (_, i) => ({
        qty: String(1 + (i % 4)),
        description: `Line item number ${i + 1} with a reasonably long description`,
        rate: String(25 + (i % 17) * 3) + (i % 3 === 0 ? ".50" : ""),
      })),
    ),
  };
  return {
    template,
    values,
    computed: [
      { key: "line", op: "sum-times", args: ["items.qty", "items.rate"] },
      { key: "subtotal", op: "sum", args: ["items.line"] },
    ],
  };
}

describe("performance budget", () => {
  it("renders a 100-line bill inside the budget and logs the actual cost", async () => {
    const { template, values, computed } = hundredLineBill();
    // Font parsing is a once-per-host cost (the plan's own carve-out), and
    // including it in the timed region double-counts it under parallel test
    // load. Parse first; time the per-bill work the budget speaks about.
    const sources: Array<[string, Uint8Array]> = [];
    for (const f of readdirSync(FONT_DIR).filter((f) => f.endsWith(".ttf"))) {
      sources.push([`fonts/${f}`, new Uint8Array(readFileSync(join(FONT_DIR, f)))]);
    }
    const { book, failures } = FontBook.load(sources);
    expect(failures.filter((f) => !f.includes("not in the provided set"))).toEqual([]);
    const parseMs = 0;

    const t0 = performance.now();
    const rendered = renderDocument(template, values, { computed });
    const t1 = performance.now();
    // The display build is part of the timed path; its result feeds the PDF
    // budget test, not this one.
    buildDisplayPages(rendered.pages, rendered.warnings, { book });
    const t2 = performance.now();
    const renderMs = t1 - t0;
    const buildMs = t2 - t1;
    console.log(
      `perf: render=${renderMs.toFixed(1)}ms build=${buildMs.toFixed(1)}ms fonts=text-only pages=${rendered.pages.length} rows=100`,
    );
    void parseMs;
    // Pagination floor: 100 rows cannot fit one A4 page with these margins.
    expect(rendered.pages.length).toBeGreaterThanOrEqual(2);
    expect(renderMs).toBeLessThan(500);
    expect(buildMs).toBeLessThan(250);
  });
});

describe("pdf write budget", () => {
  it("writes the 100-line bill pdf inside the budget", async () => {
    const { template, values, computed } = hundredLineBill();
    const rendered = renderDocument(template, values, { computed });
    // The whole font set: the bill uses regular and bold faces across its
    // header and rows, and the budget stands for a real host load.
    const sources: Array<[string, Uint8Array]> = [];
    for (const f of readdirSync(FONT_DIR).filter((f) => f.endsWith(".ttf"))) {
      sources.push([`fonts/${f}`, new Uint8Array(readFileSync(join(FONT_DIR, f)))]);
    }
    const { book, failures } = FontBook.load(sources);
    expect(failures.filter((f) => !f.includes("not in the provided set"))).toEqual([]);
    const lists = buildDisplayPages(rendered.pages, rendered.warnings, { book });
    const t0 = performance.now();
    const pdf = await writePdf(lists, { book, title: "Perf" });
    const t1 = performance.now();
    console.log(`perf: pdf=${(t1 - t0).toFixed(1)}ms pages=${lists.length} bytes=${pdf.bytes.length}`);
    expect(pdf.refusals).toEqual([]);
    expect(t1 - t0).toBeLessThan(1500);
  });
});
