/**
 * The authored bill, driven through the shipped runtime.
 *
 * `outputs/Variable_Test.json` is the template the feature was built against, and
 * it is the one with the two bottom rows *attached* to the boundary the field
 * pushes. Two behaviours matter and are easy to regress in opposite directions:
 *
 *  - the attached rows must be **carried** by the boundary - translated by its
 *    travel so the distance the author drew from the line survives - rather than
 *    being yanked up onto it the moment the line moves a sub-pixel;
 *  - the frame drawn around the field must keep its gap to the field while its
 *    edge is bound to that same boundary, instead of freezing at its traced
 *    height until the field arrives.
 *
 * Both are asserted on the painted geometry out of `public/billkit.js`, the same
 * bundle the Android WebView runs, with measurement done by a real font engine.
 *
 * Run with:  npm run test:e2e
 */
import { expect, test } from "@playwright/test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const ROOT = resolve(__dirname, "..");
const BUNDLE = readFileSync(resolve(ROOT, "public", "billkit.js"), "utf8");
// The authored bill, not a copy of it: whatever it says today is what is tested.
const TEMPLATE = readFileSync(resolve(ROOT, "..", "outputs", "Variable_Test.json"), "utf8");
const parsed = JSON.parse(TEMPLATE) as {
  objects: Array<{ id: string; zIndex: number }>;
  layout?: { guides?: Array<{ id: string; position: number }> };
};
/** z-index order is the paint order, and the renderer ids its boxes `o0..oN` by it. */
const ORDER = parsed.objects.slice().sort((a, b) => a.zIndex - b.zIndex).map((o) => o.id);
const GUIDE = parsed.layout!.guides![0]!.position;

interface Box {
  top: number;
  left: number;
  width: number;
  height: number;
}

function boxes(html: string): Box[] {
  return [...html.matchAll(/<div class="o[^"]*" id="o(\d+)" style="([^"]*)"/g)].map((m) => {
    const decl = m[2]!;
    const num = (prop: string) =>
      Number(new RegExp(`${prop}: (-?[\\d.]+)px`).exec(decl)?.[1] ?? Number.NaN);
    return {
      top: num("top"),
      left: num("left"),
      width: num("width"),
      height: num("height"),
    };
  });
}

/** A painted box by its template id, so a re-order cannot silently rename it. */
function byId(html: string, id: string): Box {
  const box = boxes(html)[ORDER.indexOf(id)]!;
  if (box === undefined) throw new Error(`no object ${id}`);
  return box;
}

interface Run {
  measured: Record<string, { naturalWidth: number; height: number }>;
  html: string;
  page: { width: number; height: number };
  warnings: string[];
}

function run(page: import("@playwright/test").Page, company: string): Promise<Run> {
  return page.evaluate(
    ({ bundle, template, values }) => {
      (window as unknown as { eval: (s: string) => void }).eval(bundle);
      const api = (window as unknown as {
        billkit: {
          measurePlan: (...a: string[]) => Array<{ id: string }>;
          measure: (plan: unknown[]) => Record<string, { naturalWidth: number; height: number }>;
          render: (
            ...a: string[]
          ) => { html: string; page: { width: number; height: number }; warnings: string[] };
        };
      }).billkit;
      const valuesJson = JSON.stringify(values);
      const plan = api.measurePlan(template, valuesJson);
      const measured = api.measure(plan);
      const rendered = api.render(template, valuesJson, "[]", JSON.stringify(measured));
      return { measured, html: rendered.html, page: rendered.page, warnings: rendered.warnings };
    },
    { bundle: BUNDLE, template: TEMPLATE, values: { field_1: company } },
  );
}

/** Long enough that the field pushes the boundary well past where it started. */
const ADDRESS = Array.from({ length: 14 }, (_, i) => `Line ${i + 1}`).join("\n");

test.describe("the authored bill behaves like its authoring", () => {
  test("a short value paints the bill as it was traced", async ({ page }) => {
    await page.goto("about:blank");
    const { html, warnings } = await run(page, "One short line");

    // Nothing outgrew the boundary, so nothing moved: the attached rows stay
    // where they were drawn and the frame keeps its traced height.
    const row = byId(html, "rect_97e4jyr");
    const other = byId(html, "rect_apph1si");
    const frame = byId(html, "rect_b5s870i");
    const field = byId(html, "field_eqgsmkr");

    expect(row.top).toBeCloseTo(452.11, 1);
    expect(other.top).toBeCloseTo(453.78, 1);
    expect(frame.height).toBeCloseTo(222.97, 1);
    // The authored gap between the field's bottom and the frame's bottom.
    expect(frame.top + frame.height - (field.top + field.height)).toBeCloseTo(59.18, 1);
    expect(warnings).toEqual([]);
  });

  test("a long value carries the attached rows and keeps the frame's gap", async ({ page }) => {
    await page.goto("about:blank");
    const { html, warnings } = await run(page, ADDRESS);

    const field = byId(html, "field_eqgsmkr");
    const row = byId(html, "rect_97e4jyr");
    const other = byId(html, "rect_apph1si");
    const frame = byId(html, "rect_b5s870i");

    // The measurer really ran, and the field really outgrew the boundary.
    expect(field.top + field.height).toBeGreaterThan(GUIDE);
    const travel = field.top + field.height - GUIDE;
    expect(travel).toBeGreaterThan(1);

    // The rows are carried by the boundary's travel, keeping the distance the
    // author drew from it - 78.62 and 80.29px - rather than snapped onto it.
    expect(row.top).toBeCloseTo(452.11 + travel, 1);
    expect(other.top).toBeCloseTo(453.78 + travel, 1);
    expect(row.height).toBeCloseTo(152.56, 1);
    expect(other.height).toBeCloseTo(142.5, 1);

    // The frame keeps its gap to the field while its edge follows the boundary,
    // growing from the first pixel the field needs it to.
    expect(frame.top + frame.height).toBeCloseTo(field.top + field.height + 59.18, 1);
    expect(frame.height).toBeGreaterThan(222.97);

    expect(warnings).toEqual([]);
  });
});
