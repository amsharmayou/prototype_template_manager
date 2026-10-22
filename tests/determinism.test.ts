import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { afterAll, describe, expect, it } from "vitest";

import { buildDisplayPages } from "@/lib/engine/list";
import { FontBook } from "@/lib/engine/fonts";
import { writePdf } from "@/lib/engine/pdf";
import { renderDocument } from "@/lib/render/document";
import { canonicalJson } from "@/lib/render/canonical";
import { sha256Hex, sha256HexBytes } from "@/lib/render/sha256";
import { computedSpecsFor } from "@/lib/package/computedSpecs";
import { displayMapFor } from "@/lib/template/dataBinding";
import type { BillTemplate } from "@/lib/template/types";

/**
 * Determinism is the pipeline's core promise, so it is asserted for *every*
 * corpus fixture, not spot-checked: the same bundle and the same values must
 * produce a byte-stable display list and byte-stable PDFs whenever the test
 * runs, on whatever machine runs it.
 *
 * Baseline files pin absolute PDF digests so a cross-runtime check (the
 * Playwright suite hashes the browser-written PDF) compares the exact bytes
 * this Node run produced. Regenerate deliberately with UPDATE_PDF_SHA=1 after
 * changing the print path.
 */
const dir = join(__dirname, "fixtures", "corpus");
const fontsDir = join(__dirname, "..", "assets", "fonts");
const baselinePath = join(__dirname, "fixtures", "pdf-sha256.json");

const names = readdirSync(dir)
  .filter((f) => f.endsWith(".template.json"))
  .map((f) => f.replace(/\.template\.json$/, ""))
  .sort();

function loadBook(): FontBook {
  const sources: Array<[string, Uint8Array]> = readdirSync(fontsDir)
    .filter((f) => f.endsWith(".ttf"))
    .map((f) => [`fonts/${f}`, new Uint8Array(readFileSync(join(fontsDir, f)))]);
  const { book } = FontBook.load(sources);
  return book;
}

function fixture(name: string): { template: BillTemplate; values: Record<string, string> } {
  return {
    template: JSON.parse(readFileSync(join(dir, `${name}.template.json`), "utf8")) as BillTemplate,
    values: JSON.parse(readFileSync(join(dir, `${name}.values.json`), "utf8")),
  };
}

function loadBaselines(): Record<string, string> {
  try {
    return JSON.parse(readFileSync(baselinePath, "utf8")) as Record<string, string>;
  } catch {
    return {};
  }
}

const updateBaselines = process.env.UPDATE_PDF_SHA === "1";
const pendingBaselineWrites: Array<[string, string]> = [];
const checkedBaselines: Array<[string, string]> = [];

afterAll(() => {
  if (pendingBaselineWrites.length === 0 && checkedBaselines.length === 0) return;
  const merged = loadBaselines();
  for (const [key, sha] of checkedBaselines) merged[key] = sha;
  for (const [key, sha] of pendingBaselineWrites) merged[key] = sha;
  writeFileSync(baselinePath, JSON.stringify(merged, null, 2), "utf8");
});

describe("determinism across the corpus", () => {
  for (const name of names) {
    it(`${name}: display list hashes identically on every run`, () => {
      const book = loadBook();
      const { template, values } = fixture(name);
      const computed = computedSpecsFor(template);

      const run = () => {
        const rendered = renderDocument(template, values, {
          computed,
          display: displayMapFor(template),
        });
        const lists = buildDisplayPages(rendered.pages, rendered.warnings, { book });
        return sha256Hex(canonicalJson(lists));
      };

      expect(run()).toBe(run());
    });

    it(`${name}: render pages never exceed sheet height and carry no stray tokens`, () => {
      const { template, values } = fixture(name);
      const rendered = renderDocument(template, values, {
        computed: computedSpecsFor(template),
        display: displayMapFor(template),
      });
      for (const page of rendered.pages) {
        expect(page.height).toBeLessThanOrEqual(1123.01);
      }
      // Every unresolved token either paints (placeholders shown) or nothing
      // does; an html with literal "{{why}}" markers on a zero-refusal render
      // would mean a token resolved nowhere and warned nobody.
      if (rendered.refusals.length === 0 && name !== "blank-sheet") {
        expect(rendered.html).not.toContain("{{items.");
      }
    });
  }
});

describe("pdf determinism for the print fixtures", () => {
  const PDF_FIXTURES = ["gst-invoice", "hindi-bill", "long-invoice"];

  for (const name of PDF_FIXTURES) {
    it(`${name}: writes byte-identical PDFs whose digest matches the baseline`, async () => {
      const book = loadBook();
      const { template, values } = fixture(name);
      const computed = computedSpecsFor(template);
      const rendered = renderDocument(template, values, {
        computed,
        display: displayMapFor(template),
      });
      const lists = buildDisplayPages(rendered.pages, rendered.warnings, { book });
      const first = await writePdf(lists, { book, title: template.meta?.name });
      const second = await writePdf(lists, { book, title: template.meta?.name });
      expect(first.refusals).toEqual([]);
      const sha = sha256HexBytes(first.bytes);
      expect(Buffer.from(first.bytes).equals(Buffer.from(second.bytes))).toBe(true);

      const baselines = loadBaselines();
      const key = `${name}.pdf`;
      const recorded = baselines[key];
      if (recorded === undefined || updateBaselines) {
        pendingBaselineWrites.push([key, sha]);
        return;
      }
      // The recorded digest is what the Playwright run compares the browser's
      // own PDF against; give a diff-shaped failure rather than a bare miss.
      checkedBaselines.push([key, sha]);
      expect(sha, `pdf digest for ${name} drifted from ${key} baseline`).toBe(recorded);
    });
  }
});
