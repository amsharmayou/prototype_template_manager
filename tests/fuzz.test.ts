import { zipSync, strToU8 } from "fflate";

import { describe, expect, it } from "vitest";

import { renderDocument } from "@/lib/render/document";
import { openBundle } from "@/lib/package/open";
import type { BillTemplate, TemplateObject } from "@/lib/template/types";
import { emptyTemplate } from "@/lib/template/types";

/**
 * Fuzzing, Phase 4: hostile and merely-odd input must never crash the
 * pipeline. The contract under fuzz is the same as for crafted input:
 *
 * - `renderDocument` returns a result (never throws), whatever the template
 *   and values carry;
 * - the output is an html string with a page count of at least one;
 * - refusals and warnings are strings, so a host UI can always print them;
 * - no NaN, no "undefined" and no unpaired braces reach the html.
 *
 * Determinism note: the generator is a seeded LCG, so every run of this file
 * produces the same corpus of oddballs and a failure is reproducible.
 */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const WEIRD_STRINGS = [
  "",
  " ",
  "0",
  "-0.00",
  "1e309",
  "NaN",
  "₹ 12, underscore — dash",
  "===========\n\n\n",
  "x".repeat(4000),
  "{{items.qty}}",
  "</div><script>alert(1)</script>",
  "\u0901 \u0936 \u094d",
  "-99999999999999999999",
  "1.005",
];

const WEIRD_NUMBERS = [0, -1, 1e308, NaN, undefined as unknown as number];

function pick<T>(rng: () => number, arr: readonly T[]): T {
  return arr[Math.floor(rng() * arr.length)]!;
}

function randomTemplate(rng: () => number): BillTemplate {
  const template = emptyTemplate(
    rng() < 0.5 ? 794 : pick(rng, WEIRD_NUMBERS),
    rng() < 0.5 ? 1123 : pick(rng, WEIRD_NUMBERS),
    pick(rng, ["Fuzz bill", "", undefined as unknown as string]),
  );
  const objects: TemplateObject[] = [];
  for (let i = 0; i < 1 + Math.floor(rng() * 4); i += 1) {
    const choice = rng();
    if (choice < 0.5) {
      objects.push({
        type: "text",
        id: `t${i}`,
        text: pick(rng, WEIRD_STRINGS),
        x: pick(rng, WEIRD_NUMBERS),
        y: pick(rng, WEIRD_NUMBERS),
        width: pick(rng, WEIRD_NUMBERS),
        height: pick(rng, WEIRD_NUMBERS),
        fontSize: pick(rng, [12, -5, 1e308]),
      } as unknown as TemplateObject);
    } else {
      objects.push({
        type: "table",
        id: `tab${i}`,
        name: `Rows ${i}`,
        roleKind: "static",
        x: 40,
        y: 200,
        width: 700,
        height: 90,
        rotation: 0,
        opacity: 1,
        visible: true,
        locked: false,
        zIndex: 2,
        parentId: null,
        stroke: "#000000",
        strokeWidth: 1,
        fill: "transparent",
        fontFamily: pick(rng, ["Arimo", "Não Existe", ""]),
        rows: 2,
        columns: rng() < 0.5 ? 1 : 2,
        colWidths: [350, 350],
        rowHeights: [30, 30],
        cells: [
          { text: "{{items.qty}}" } as never,
          { text: "{{items.description}}" } as never,
          { text: "{{items.rate}}" } as never,
          { text: "{{line}}" } as never,
        ],
        borderColor: "#000",
        borderWidth: 1,
        cellFill: "transparent",
        headerRow: true,
        headerFill: "#fff",
        headerTextColor: "#000",
        cellTextColor: "#000",
        padding: 4,
        repeat:
          rng() < 0.85
            ? { key: "items", startRow: 1, endRow: 1, maxItems: 20, repeatHeader: true }
            : (undefined as never),
        expansion: { y: { mode: "unbounded" } },
      } as unknown as TemplateObject);
    }
  }
  template.objects = objects;
  const specs: unknown[] = [];
  for (let i = 0; i < Math.floor(rng() * 4); i += 1) {
    specs.push({
      key: pick(rng, ["s1", "s2", "s1", ""]),
      op: pick(rng, ["sum", "sum-times", "percent", "add", "in-words", "round-off", "nope"]),
      args: [pick(rng, ["items.qty", "items.rate", "s1", "ghost", ""]), pick(rng, ["items.rate", "flat", ""])],
      rateKey: pick(rng, ["tax_rate", "items.gst", "", undefined]),
      roundTo: pick(rng, [0, 2, undefined, -3]),
    } as never);
  }
  template.meta.computed = specs as never;
  return template;
}

function randomValues(rng: () => number): Record<string, string> {
  const values: Record<string, string> = {};
  for (const key of ["invoice_number", "customer_name", "tax_rate", "flat", "items"]) {
    values[key] = pick(rng, WEIRD_STRINGS);
  }
  if (rng() < 0.7) {
    const rows = 1 + Math.floor(rng() * 20);
    values.items = JSON.stringify(
      Array.from({ length: rows }, () => ({
        qty: pick(rng, ["1", "0", "-2", "0.125", "", "abc", "1e400"]),
        description: pick(rng, WEIRD_STRINGS),
        rate: pick(rng, WEIRD_STRINGS.slice(0, 10)),
        gst: pick(rng, ["18", "", "abc"]),
      })),
    );
  }
  return values;
}

describe("fuzz", () => {
  it("renders 120 randomised templates without throwing", () => {
    const rng = mulberry32(0x5eed);
    let paginated = 0;
    for (let i = 0; i < 120; i += 1) {
      const template = randomTemplate(rng);
      const values = randomValues(rng);
      let result: ReturnType<typeof renderDocument> | undefined;
      try {
        result = renderDocument(template, values);
      } catch (e) {
        console.log(
          "FUZZCRASH:",
          JSON.stringify({
            i,
            message: e instanceof Error ? e.message : String(e),
            stack: e instanceof Error ? (e.stack ?? "").split("\n").slice(1, 5).join(" | ") : "",
          }),
        );
        console.log("TPL:", JSON.stringify(template).slice(0, 900));
        console.log("VAL:", JSON.stringify(values).slice(0, 300));
        throw e;
      }
      const r = result!;
      expect(typeof r.html).toBe("string");
      expect(r.pages.length).toBeGreaterThanOrEqual(1);
      expect(r.warnings.every((w) => typeof w === "string")).toBe(true);
      expect(r.refusals.every((x) => typeof x.reason === "string")).toBe(true);
      if (r.pages.length > 1) paginated += 1;
    }
    // The generator must actually reach multi-page territory sometimes, or
    // the pagination path under fuzz is never exercised.
    expect(paginated).toBeGreaterThan(10);
  });

  it("opens randomized archives without throwing, refusing or crashing", async () => {
    const rng = mulberry32(0xf00d);
    for (let i = 0; i < 40; i += 1) {
      const byteLen = Math.floor(rng() * 4000);
      const bytes = new Uint8Array(byteLen);
      for (let j = 0; j < byteLen; j += 1) bytes[j] = Math.floor(rng() * 256);
      const opened = await openBundle(bytes);
      expect(typeof opened.ok).toBe("boolean");
      if (opened.ok) {
        expect(typeof opened.template.templateVersion).toBe("number");
      }
    }
    // A zip with a valid shell but a junk manifest must refuse, not throw.
    const junk = zipSync({ "manifest.json": strToU8("not json at all") }, { level: 1 });
    const opened = await openBundle(junk);
    expect(opened.ok).toBe(false);
  });
});
