/**
 * The real bill, through a real browser.
 *
 * `outputs/Variable_Test.json` is the template the feature was built against,
 * so it is the one worth driving through the shipped runtime: the same bundle
 * the Android WebView loads, measuring with a real font engine rather than a
 * stated line box. Everything here asserts on the painted geometry, because
 * that is the only place "the rectangles did not expand" was ever visible.
 *
 * Run with:  npm run test:e2e
 */
import { expect, test } from "@playwright/test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const ROOT = resolve(__dirname, "..");
const BUNDLE = resolve(ROOT, "public", "billkit.js");
// The same fixture the unit suite drives, so the two agree on the bill.
const TEMPLATE = readFileSync(resolve(ROOT, "tests", "fixtures", "Variable_Test.json"), "utf8");

/**
 * Long enough to need more room than was traced for it.
 *
 * The field is 144.17px tall and one line of its own typography is 16.24px, so
 * anything past nine lines has to push the boundary below it.
 */
const ADDRESS = Array.from({ length: 12 }, (_, i) => `Line ${i + 1}`).join("\n");

/** One painted box, read back out of the sheet. */
interface Box {
  top: number;
  left: number;
  width: number;
  height: number;
}

/**
 * The sheet's objects, keyed by their traced z-order.
 *
 * The renderer anchors each object by its position in z-order, which is stable
 * for a given template - so `o3` is the frame drawn around the field, and `o0`
 * is the outer frame, in every render of this bill.
 */
function boxes(html: string): Box[] {
  return [...html.matchAll(/<div class="o" id="o(\d+)" style="([^"]*)"/g)].map((m) => {
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

/** Authored geometry, so a test can say what changed rather than by how much. */
const AUTHORED = {
  outerFrame: { top: 138.61, height: 531.44 },
  rowBelow: { top: 452.11, height: 152.56 },
  fieldFrame: { top: 193.93, height: 222.97 },
};

function render(page: import("@playwright/test").Page, values: Record<string, string>) {
  const bundle = readFileSync(BUNDLE, "utf8");
  const template = TEMPLATE;
  return page.evaluate(
    ({ bundle, template, values }) => {
      // The bundle is what the host loads, so this runs the shipped code.
      (window as unknown as { eval: (s: string) => void }).eval(bundle);
      const api = (window as unknown as {
        billkit: {
          measurePlan: (...a: string[]) => unknown[];
          measure: (plan: unknown[]) => Record<string, { naturalWidth: number; height: number }>;
          render: (...a: string[]) => { html: string; page: { width: number; height: number }; warnings: string[] };
        };
      }).billkit;
      const valuesJson = JSON.stringify(values);
      const plan = api.measurePlan(template, valuesJson);
      const measured = api.measure(plan);
      const rendered = api.render(template, valuesJson, "[]", JSON.stringify(measured));
      return { plan, measured, html: rendered.html, page: rendered.page, warnings: rendered.warnings };
    },
    { bundle, template, values },
  );
}

test.describe("the variable-layout bill, measured for real", () => {
  test("a long value grows the field, the boundary and the frames around it", async ({ page }) => {
    await page.goto("about:blank");
    const { measured, html, page: sheet, warnings } = await render(page, { field_1: ADDRESS });

    // The measurer really did run: twelve lines of Arial at 14px/1.16.
    expect(measured["field_eqgsmkr"]!.height).toBeGreaterThan(144.17);

    const painted = boxes(html);
    const [outerFrame, rowBelow, , fieldFrame] = painted;

    // The field's own frame grows around it, keeping its traced margin.
    expect(fieldFrame!.height).toBeGreaterThan(AUTHORED.fieldFrame.height);
    // The outer frame grows too, and keeps its top edge where it was drawn.
    expect(outerFrame!.height).toBeGreaterThan(AUTHORED.outerFrame.height);
    expect(outerFrame!.top).toBeCloseTo(AUTHORED.outerFrame.top, 1);

    // The row below the boundary is not attached to anything, so it stays put.
    expect(rowBelow!.top).toBeCloseTo(AUTHORED.rowBelow.top, 1);
    expect(rowBelow!.height).toBeCloseTo(AUTHORED.rowBelow.height, 1);

    // Nothing was silently dropped to make it fit.
    expect(warnings).toEqual([]);
    expect(sheet.width).toBe(1127);
  });

  test("a short value paints the traced bill", async ({ page }) => {
    await page.goto("about:blank");
    const { html, warnings } = await render(page, { field_1: "One line" });

    const painted = boxes(html);
    const [outerFrame, rowBelow, , fieldFrame] = painted;

    // Identical to the trace: a boundary that never moved must move nothing.
    expect(fieldFrame!.height).toBeCloseTo(AUTHORED.fieldFrame.height, 1);
    expect(outerFrame!.height).toBeCloseTo(AUTHORED.outerFrame.height, 1);
    expect(rowBelow!.top).toBeCloseTo(AUTHORED.rowBelow.top, 1);
    expect(warnings).toEqual([]);
  });
});
