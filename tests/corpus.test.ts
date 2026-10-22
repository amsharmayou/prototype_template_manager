import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { renderDocument } from "@/lib/render/document";
import { computedSpecsFor } from "@/lib/package/computedSpecs";
import { displayMapFor } from "@/lib/template/dataBinding";
import type { BillTemplate } from "@/lib/template/types";

/**
 * Every corpus template renders with zero refusals and never produces NaN:
 * the full pipeline - computed rules, per-row figures, display shaping,
 * repeat expansion - must take each fixture from blank to a printable page.
 */
const dir = join(__dirname, "fixtures", "corpus");
const names = readdirSync(dir)
  .filter((f) => f.endsWith(".template.json"))
  .map((f) => f.replace(/\.template\.json$/, ""))
  .sort();

describe("body corpus", () => {
  it("has the corpus on disk", () => {
    expect(names.length).toBeGreaterThanOrEqual(12);
  });

  for (const name of names) {
    it(`${name} renders clean end to end`, () => {
      const template = JSON.parse(
        readFileSync(join(dir, `${name}.template.json`), "utf8"),
      ) as BillTemplate;
      const values = JSON.parse(
        readFileSync(join(dir, `${name}.values.json`), "utf8"),
      ) as Record<string, string>;
      const computed = computedSpecsFor(template);

      const pre = renderDocument(template, values, {
        computed,
        display: displayMapFor(template),
      });
      expect(pre.refusals).toEqual([]);
      expect(pre.html).not.toContain("NaN");
      expect(pre.html).not.toContain("undefined");
    });
  }

  it("the invoice family agrees row figures with the grand sum", () => {
    const template = JSON.parse(
      readFileSync(join(dir, "gst-invoice.template.json"), "utf8"),
    ) as BillTemplate;
    const values = JSON.parse(readFileSync(join(dir, "gst-invoice.values.json"), "utf8")) as Record<string, string>;
    const computed = computedSpecsFor(template);
    const { html } = renderDocument(template, values, {
      computed,
      display: displayMapFor(template),
    });
    // 2 x 120.00 + 0.125 x 550.25 + 10 x 35 = 658.78 subtotal;
    // 18 percent on top makes 777.36.
    expect(html).toContain("658.78");
    expect(html).toContain("118.58");
    expect(html).toContain("777.36");
  });

  it("the credit note prints the mirrored negative", () => {
    const template = JSON.parse(
      readFileSync(join(dir, "credit-note.template.json"), "utf8"),
    ) as BillTemplate;
    const values = JSON.parse(
      readFileSync(join(dir, "credit-note.values.json"), "utf8"),
    ) as Record<string, string>;
    const computed = computedSpecsFor(template);
    const { html } = renderDocument(template, values, {
      computed,
      display: displayMapFor(template),
    });
    expect(html).toContain("-240.00");
  });

  it("the trade bill keeps its fractional counts exact", () => {
    const template = JSON.parse(
      readFileSync(join(dir, "trade-bill.template.json"), "utf8"),
    ) as BillTemplate;
    const values = JSON.parse(
      readFileSync(join(dir, "trade-bill.values.json"), "utf8"),
    ) as Record<string, string>;
    const computed = computedSpecsFor(template);
    const { html } = renderDocument(template, values, {
      computed,
      display: displayMapFor(template),
    });
    // 12.375 x 425.55 = 5266.18125 -> 5266.18; 78.125 -> 78.13; 699.93.
    // The band's line key and the grand figure carry no grouping here because
    // this template declares no grouped output for them: grouping rides the
    // field's declared display, not a guess at what the digits mean.
    expect(html).toContain("5266.18");
    expect(html).toContain("78.13");
    expect(html).toContain("699.93");
    expect(html).toContain("6,044.24");
  });
});
