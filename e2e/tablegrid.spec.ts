import { expect, test } from "@playwright/test";
import { join } from "node:path";

const FIXTURE = join(process.cwd(), "e2e", "fixtures", "test-bill.png");

/**
 * A table's frame and its interior grid lines must carry the same weight.
 *
 * The grid used to be painted one `strokeRect` per cell, so every interior
 * edge was stroked twice while the frame was stroked once — the inside looked
 * darker and heavier than the border. This measures the ink on a vertical
 * frame line against the ink on a vertical interior line and requires them to
 * match, which is what a per-cell painter cannot do.
 */
test("a table's grid lines are all the same weight", async ({ page }) => {
  await page.goto("/");
  await page
    .locator('input[type="file"][accept*="image/png"]')
    .first()
    .setInputFiles(FIXTURE);
  await page.locator("canvas.upper-canvas").waitFor({ state: "attached" });
  await page.waitForFunction(() => Boolean(window.__btm?.getCanvas()));
  await page.waitForTimeout(600);
  // The reference is only an authoring aid; hiding it leaves just the table.
  await page.getByLabel("Show reference").uncheck();
  await page.waitForTimeout(200);
  await page.evaluate(() => window.__btm.setZoom(1));
  await page.waitForTimeout(300);

  // Draw a 3x2 table with the real tool.
  await page.getByTitle(/^Table/i).click();
  await page.waitForTimeout(150);
  const box = await page.evaluate(() => {
    const canvas = window.__btm.getCanvas()!;
    const r = canvas.upperCanvasEl.getBoundingClientRect();
    const s = window.__btm.getSnapshot();
    return {
      ax: r.left + s.tx + 200,
      ay: r.top + s.ty + 200,
      bx: r.left + s.tx + 500,
      by: r.top + s.ty + 380,
    };
  });
  await page.mouse.move(box.ax, box.ay);
  await page.mouse.down();
  await page.mouse.move(box.bx, box.by, { steps: 6 });
  await page.mouse.up();
  await page.waitForTimeout(400);
  const dialog = page.getByRole("dialog");
  await expect(dialog).toBeVisible();
  const rowsInput = dialog.locator('input[type="number"]').first();
  await rowsInput.click();
  await rowsInput.press("Control+a");
  await rowsInput.type("2");
  const colsInput = dialog.locator('input[type="number"]').nth(1);
  await colsInput.click();
  await colsInput.press("Control+a");
  await colsInput.type("3");
  await page.getByRole("button", { name: "Create" }).click();
  await page.waitForTimeout(600);

  // Deselect so no selection outline is measured as a table line.
  await page.evaluate(() => {
    (window.__btm.getCanvas() as unknown as {
      discardActiveObject: () => void;
      requestRenderAll: () => void;
    }).discardActiveObject();
  });
  await page.waitForTimeout(300);

  /**
   * Ink profile across a horizontal scanline through the table's middle, as
   * run-lengths of dark pixels. Each grid line shows up as one run, so the
   * frame and the interior lines can be compared directly.
   */
  const profile = await page.evaluate(() => {
    const canvas = window.__btm.getCanvas() as unknown as {
      lowerCanvasEl: HTMLCanvasElement;
      renderAll: () => void;
    };
    canvas.renderAll();
    const table = canvas.lowerCanvasEl;
    const ctx = table.getContext("2d")!;
    const d = ctx.getImageData(0, 0, table.width, table.height).data;

    // The table's box, mapped into canvas pixels. `getBoundingRect` reports
    // scene coordinates, while the canvas element's pixels are scene scaled by
    // the zoom and offset by the pan.
    const obj = (
      window.__btm.getCanvas() as unknown as {
        getZoom: () => number;
        getObjects: () => Array<{
          getBoundingRect: () => {
            left: number;
            top: number;
            width: number;
            height: number;
          };
        }>;
      }
    )
      .getObjects()
      .find((o) => (o as unknown as { appType?: string }).appType === "table");
    if (!obj) return null;
    const canvasZoom = (
      window.__btm.getCanvas() as unknown as { getZoom: () => number }
    ).getZoom();
    const view = window.__btm.getSnapshot();
    const b = obj.getBoundingRect();
    const top = b.top * canvasZoom + view.ty;
    // A quarter of the way down, which is inside the first row and clear of the
    // horizontal divider at the midpoint. Scanning the midpoint instead would
    // sit on a row edge and report the whole row as one dark run.
    const y = Math.round(top + (b.height * canvasZoom) / 4);

    const runs: Array<{ start: number; len: number; ink: number }> = [];
    let start = -1;
    let peak = 0;
    for (let x = 0; x < table.width; x += 1) {
      const i = (y * table.width + x) * 4;
      const lum = (d[i]! + d[i + 1]! + d[i + 2]!) / 3;
      if (lum < 128) {
        if (start < 0) {
          start = x;
          peak = 0;
        }
        // Accumulated darkness is the honest measure: a line stroked twice
        // paints darker even where its width is unchanged.
        peak += 255 - lum;
      } else if (start >= 0) {
        runs.push({ start, len: x - start, ink: peak });
        start = -1;
      }
    }
    if (start >= 0) runs.push({ start, len: table.width - start, ink: peak });
    return { runs, box: b };
  });

  expect(profile).not.toBeNull();
  const runs = profile!.runs;
  // Four vertical grid lines: two frame edges and two interior dividers.
  expect(runs.length).toBe(4);

  const ink = runs.map((r) => r.ink);
  const widths = runs.map((r) => r.len);
  const maxInk = Math.max(...ink);
  const minInk = Math.min(...ink);
  console.log(
    "TABLE PROFILE runs: " +
      JSON.stringify(runs.map((r) => ({ len: r.len, ink: r.ink }))),
  );

  // No line is painted heavier than another. Measured against a deliberately
  // re-introduced per-cell double stroke, the interior lines carried about 15%
  // more ink than the frame (450 against 390 here), so the bound is set well
  // below that to leave room for rasterisation noise.
  for (const v of ink) expect(v).toBeGreaterThan(minInk * 0.95);
  expect(maxInk / minInk).toBeLessThan(1.08);
  // And they are all the same width on screen.
  for (const w of widths) expect(w).toBeCloseTo(widths[0]!, 0);
});

test("a table's default border width matches the other outline tools", async ({
  page,
}) => {
  await page.goto("/");
  await page
    .locator('input[type="file"][accept*="image/png"]')
    .first()
    .setInputFiles(FIXTURE);
  await page.locator("canvas.upper-canvas").waitFor({ state: "attached" });
  await page.waitForFunction(() => Boolean(window.__btm?.getCanvas()));
  await page.waitForTimeout(600);

  await page.getByTitle(/^Table/i).click();
  await page.waitForTimeout(150);
  const box = await page.evaluate(() => {
    const canvas = window.__btm.getCanvas()!;
    const r = canvas.upperCanvasEl.getBoundingClientRect();
    const s = window.__btm.getSnapshot();
    return {
      ax: r.left + s.tx + 200,
      ay: r.top + s.ty + 200,
      bx: r.left + s.tx + 400,
      by: r.top + s.ty + 300,
    };
  });
  await page.mouse.move(box.ax, box.ay);
  await page.mouse.down();
  await page.mouse.move(box.bx, box.by, { steps: 5 });
  await page.mouse.up();
  await page.waitForTimeout(400);
  await page.getByRole("button", { name: "Create" }).click();
  await page.waitForTimeout(500);

  // Draw a rectangle with the real tool for comparison.
  await page.getByTitle(/^Rectangle/i).click();
  await page.waitForTimeout(120);
  const P = await page.evaluate(() => {
    const canvas = window.__btm.getCanvas()!;
    const r = canvas.upperCanvasEl.getBoundingClientRect();
    const s = window.__btm.getSnapshot();
    return {
      ax: r.left + s.tx + 450,
      ay: r.top + s.ty + 200,
      bx: r.left + s.tx + 600,
      by: r.top + s.ty + 300,
    };
  });
  await page.mouse.move(P.ax, P.ay);
  await page.mouse.down();
  await page.mouse.move(P.bx, P.by, { steps: 5 });
  await page.mouse.up();
  await page.waitForTimeout(400);

  const widths = await page.evaluate(() => {
    const out: Record<string, number> = {};
    for (const o of window.__btm.getTemplate().objects) {
      if (o.type === "table") out.table = (o as unknown as { borderWidth: number }).borderWidth;
      if (o.type === "rect") out.rect = (o as unknown as { strokeWidth: number }).strokeWidth;
    }
    return out;
  });
  expect(widths.table).toBeDefined();
  expect(widths.rect).toBeDefined();
  // One width across the app's drawn elements.
  expect(widths.table).toBe(widths.rect);
});

test("an exported table's grid lines are not doubled", async ({ page }) => {
  await page.goto("/");
  await page
    .locator('input[type="file"][accept*="image/png"]')
    .first()
    .setInputFiles(FIXTURE);
  await page.locator("canvas.upper-canvas").waitFor({ state: "attached" });
  await page.waitForFunction(() => Boolean(window.__btm?.getCanvas()));
  await page.waitForTimeout(600);

  await page.getByTitle(/^Table/i).click();
  await page.waitForTimeout(150);
  const box = await page.evaluate(() => {
    const canvas = window.__btm.getCanvas()!;
    const r = canvas.upperCanvasEl.getBoundingClientRect();
    const s = window.__btm.getSnapshot();
    return {
      ax: r.left + s.tx + 200,
      ay: r.top + s.ty + 200,
      bx: r.left + s.tx + 460,
      by: r.top + s.ty + 320,
    };
  });
  await page.mouse.move(box.ax, box.ay);
  await page.mouse.down();
  await page.mouse.move(box.bx, box.by, { steps: 5 });
  await page.mouse.up();
  await page.waitForTimeout(400);
  const dialog = page.getByRole("dialog");
  const rowsInput = dialog.locator('input[type="number"]').first();
  await rowsInput.click();
  await rowsInput.press("Control+a");
  await rowsInput.type("2");
  const colsInput = dialog.locator('input[type="number"]').nth(1);
  await colsInput.click();
  await colsInput.press("Control+a");
  await colsInput.type("2");
  await page.getByRole("button", { name: "Create" }).click();
  await page.waitForTimeout(500);

  // The SVG export carries the grid as <line> elements, not one stroked <rect>
  // per cell, so an interior edge cannot be drawn twice.
  const [download] = await Promise.all([
    page.waitForEvent("download", { timeout: 20_000 }),
    (async () => {
      await page.getByRole("button", { name: /Export/ }).click();
      await page.getByRole("button", { name: "SVG" }).click();
    })(),
  ]);
  const path = await download.path();
  expect(path).not.toBeNull();
  const { readFileSync } = await import("node:fs");
  const svg = readFileSync(path!, "utf8");

  // 2x2 table: 3 column edges + 3 row edges = 6 lines.
  expect(svg.match(/<line /g)?.length ?? 0).toBe(6);
  // No per-cell stroked rectangles left behind.
  expect(svg).not.toMatch(/<rect[^>]*fill="none"[^>]*stroke=/);
});