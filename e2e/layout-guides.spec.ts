/**
 * A vertical guide, end to end.
 *
 * The plan makes the vertical guide part of the feature rather than a later
 * phase, and every pre-existing end-to-end path draws horizontal ones only - so
 * nothing would notice if the X half were quietly broken. This drives the
 * shipped `billkit.js`, the same bundle the Android WebView runs, through
 * `measurePlan -> measure -> render` with a real font engine.
 *
 * Built here rather than committed so the two orientations cannot drift apart
 * unnoticed behind a stale fixture.
 *
 * Run with:  npm run test:e2e
 */
import { expect, test } from "@playwright/test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const ROOT = resolve(__dirname, "..");
const BUNDLE = readFileSync(resolve(ROOT, "public", "billkit.js"), "utf8");

const PAGE = { width: 560, height: 600 };
/** Where the marking line is drawn, well inside the sheet. */
const GUIDE_AT = 300;
/** The box the guide carries, drawn clear of the line by this much. */
const BOX_AT = 400;

/** Long enough that the field has to widen well past its traced box. */
const COMPANY = "A company name far too long to sit on one line of the width traced for it";

const TEMPLATE = JSON.stringify({
  templateVersion: 2,
  document: PAGE,
  meta: { name: "x-axis", modifiedAt: "" },
  objects: [
    {
      // A frame that grows around its child: the container half of the feature,
      // on the horizontal axis.
      id: "frame", type: "rect", name: "frame", role: null,
      // 218 = the field's right edge (50 + 200) plus 8px of padding, measured
      // from the frame's own left edge (40). Authoring it this way makes the
      // traced bill self-consistent: the container already fits its child, so
      // nothing grows until a value does.
      x: 40, y: 40, width: 218, height: 120,
      rotation: 0, opacity: 1, visible: true, locked: false, zIndex: 0, parentId: null,
      stroke: "#000000", strokeWidth: 1, fill: "transparent", cornerRadius: 0,
      container: {
        enabled: true,
        growthX: "content",
        growthY: "fixed",
        padding: { top: 8, right: 8, bottom: 8, left: 8 },
      },
    },
    {
      // A box to the right of the guide, which the guide carries.
      id: "row", type: "rect", name: "row", role: null,
      x: BOX_AT, y: 40, width: 120, height: 60,
      rotation: 0, opacity: 1, visible: true, locked: false, zIndex: 1, parentId: null,
      stroke: "#000000", strokeWidth: 1, fill: "transparent", cornerRadius: 0,
    },
    {
      id: "t1", type: "text", name: "company", role: null,
      x: 50, y: 60, width: 200, height: 20,
      rotation: 0, opacity: 1, visible: true, locked: false, zIndex: 2, parentId: null,
      stroke: "", strokeWidth: 0, fill: "#000000", text: "{{company}}", fontFamily: "Arial", fontSize: 14,
      fontWeight: "normal", fontStyle: "normal", textAlign: "left", lineHeight: 1.16, charSpacing: 0,
      roleKind: "variable", textVerticalAlign: "top", layoutParentId: "frame",
      expansion: { x: { mode: "unbounded", growthGuideId: "right-edge" }, y: { mode: "fixed" } },
    },
  ],
  layout: {
    mode: "variable",
    document: { growthX: "expand", growthY: "fixed" },
    guides: [{ id: "right-edge", orientation: "vertical", position: GUIDE_AT }],
    attachments: [
      { id: "att-row", objectId: "row", edge: "left", guideId: "right-edge", behavior: "move" },
    ],
  },
});

interface Run {
  measured: Record<string, { naturalWidth: number; height: number }>;
  html: string;
  page: { width: number; height: number };
  warnings: string[];
}

function runBundle(page: import("@playwright/test").Page, company: string): Promise<Run> {
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
    { bundle: BUNDLE, template: TEMPLATE, values: { company } },
  );
}

/**
 * One painted box, read back out of the sheet.
 *
 * The renderer anchors each object by its position in z-order rather than by its
 * template id, so the index is the handle - and it is stable for this template:
 * frame (z0) is `o0`, row (z1) is `o1`, field (z2) is `o2`.
 */
function styleOf(html: string, id: "frame" | "row" | "t1"): string {
  const index = { frame: 0, row: 1, t1: 2 }[id];
  return new RegExp(`<div class="o" id="o${index}" style="([^"]*)"`).exec(html)?.[1] ?? "";
}

function px(style: string, prop: string): number {
  return Number(new RegExp(`${prop}: (-?[\\d.]+)px`).exec(style)?.[1] ?? Number.NaN);
}

test.describe("the vertical guide, measured in a real browser", () => {
  test("a wide value pushes the vertical guide, carries its row and widens the page", async ({ page }) => {
    await page.goto("about:blank");
    const out = await runBundle(page, COMPANY);

    // The measurer really ran, and the value really was too wide for its box.
    expect(out.measured["t1"]!.naturalWidth).toBeGreaterThan(200);

    // The boundary is where the field's content ends: the measured width, not
    // the painted box, because a wrapped field paints with `height: auto`.
    const boundary = 50 + out.measured["t1"]!.naturalWidth;

    // The frame grew around its child on the X axis, keeping its 8px padding.
    expect(px(styleOf(out.html, "frame"), "width")).toBeCloseTo(boundary - 40 + 8, 1);
    // ...and its height was never asked to change.
    expect(px(styleOf(out.html, "frame"), "height")).toBe(120);

    // The row followed the boundary, keeping its size and the margin it was
    // drawn with: it shifts by the travel rather than snapping onto the line.
    const row = styleOf(out.html, "row");
    expect(px(row, "width")).toBe(120);
    expect(px(row, "left")).toBeCloseTo(BOX_AT + (boundary - GUIDE_AT), 1);
    expect(px(row, "left")).toBeGreaterThan(BOX_AT);

    // The page widened, because its own policy says so and the content now runs
    // past the traced sheet - the case `growthX: "expand"` exists for.
    expect(out.page.width).toBeGreaterThan(PAGE.width);
    expect(out.warnings).toEqual([]);
  });

  test("a short value leaves the traced bill exactly as it was", async ({ page }) => {
    await page.goto("about:blank");
    const out = await runBundle(page, "Acme");

    // Nothing outgrew the boundary, so nothing moved: the row keeps its traced
    // position and size, the frame keeps its traced size, the page keeps its
    // width, and no diagnostic is raised.
    const row = styleOf(out.html, "row");
    expect(px(row, "left")).toBe(BOX_AT);
    expect(px(row, "width")).toBe(120);
    expect(px(styleOf(out.html, "frame"), "width")).toBe(218);
    expect(out.page.width).toBe(PAGE.width);
    expect(out.warnings).toEqual([]);
  });
});