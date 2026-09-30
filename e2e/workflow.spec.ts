import { expect, test, type Page } from "@playwright/test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const FIXTURE = join(process.cwd(), "e2e", "fixtures", "test-bill.png");
const LONG_FIXTURE = join(process.cwd(), "e2e", "fixtures", "long-bill.png");

interface TemplateObject {
  type: string;
  name: string;
  role: string | null;
  x: number;
  y: number;
  width: number;
  height: number;
  x2?: number;
  y2?: number;
  rows?: number;
  columns?: number;
  colWidths?: number[];
  rowHeights?: number[];
  cells?: Array<{ text: string }>;
  text?: string;
  roleKind?: string;
}

interface Template {
  templateVersion: number;
  document: { width: number; height: number };
  meta: { name: string };
  objects: TemplateObject[];
}

/** Exposed on `window` in development; see hooks/useEditorController. */
interface EditorWindow extends Window {
  __btm: {
    getTemplate(): Template;
    getCanvas(): {
      getObjects(): Array<Record<string, unknown>>;
      getZoom(): number;
      remove(o: unknown): void;
    } | null;
    setZoom(z: number): void;
    loadTemplate(t: Template): void;
    fit(): void;
    getViewportSize(): { width: number; height: number };
    getTable(): {
      left: number;
      top: number;
      width: number;
      height: number;
      scaleX: number;
      scaleY: number;
      rows: number;
      columns: number;
      colWidths: number[];
      rowHeights: number[];
      setColumnWidth(index: number, value: number): void;
      setRowHeight(index: number, value: number): void;
      getBoundingRect(): {
        left: number;
        top: number;
        width: number;
        height: number;
      };
    } | null;
    updateTable(
      mutate: (t: NonNullable<ReturnType<EditorWindow["__btm"]["getTable"]>>) => void,
      label?: string,
    ): void;
  };
}

declare global {
  interface Window {
    __btm: EditorWindow["__btm"];
  }
}

const A4_W = 794;
const A4_H = 1123;

async function openEditorWithBill(page: Page): Promise<void> {
  await page.goto("/");
  await page
    .locator('input[type="file"][accept*="image/png"]')
    .first()
    .setInputFiles(FIXTURE);

  // The editor replaces the upload screen once the canvas is mounted.
  await page.locator("canvas.upper-canvas").waitFor({ state: "attached" });
  await page.waitForFunction(() => Boolean(window.__btm?.getCanvas()));
  // Zoom out so the whole page is reachable by the mouse.
  await page.evaluate(() => window.__btm.setZoom(0.5));
  await page.waitForTimeout(250);
}

/** Convert document coordinates into page coordinates. */
async function docToPage(page: Page): Promise<
  (x: number, y: number) => { x: number; y: number }
> {
  const box = await page.evaluate(() => {
    const cs = Array.from(document.querySelectorAll("canvas"));
    const r = cs[cs.length - 1]!.getBoundingClientRect();
    return { left: r.left, top: r.top, width: r.width, height: r.height };
  });
  const zoom = box.width / A4_W;
  return (x, y) => ({ x: box.left + x * zoom, y: box.top + y * zoom });
}

async function draw(page: Page, P: (x: number, y: number) => { x: number; y: number }, x1: number, y1: number, x2: number, y2: number): Promise<void> {
  const a = P(x1, y1);
  const b = P(x2, y2);
  await page.mouse.move(a.x, a.y);
  await page.mouse.down();
  await page.mouse.move((a.x + b.x) / 2, (a.y + b.y) / 2, { steps: 3 });
  await page.mouse.move(b.x, b.y, { steps: 3 });
  await page.mouse.up();
  await page.waitForTimeout(120);
}

async function pickTool(page: Page, name: string): Promise<void> {
  await page.getByTitle(new RegExp(`^${name}`, "i")).click();
  await page.waitForTimeout(80);
}

test.describe("Bill template tracing workflow", () => {
  test.beforeEach(async ({ page }) => {
    page.on("dialog", (d) => void d.accept());
    page.on("console", (m) => {
      if (m.type() === "error" && !m.text().includes("_next/hmr")) {
        console.log("PAGE CONSOLE ERROR:", m.text().slice(0, 800));
      }
    });
    page.on("pageerror", (e) => console.log("PAGEERROR:", String(e).slice(0, 800)));
  });

  test("traces a bill and exports a reference-free template", async ({
    page,
  }) => {
    // 1-3. Open, upload a local bill, it becomes the locked reference.
    await openEditorWithBill(page);

    const ref = await page.evaluate(() => {
      const s = window.__btm.getCanvas()!.getObjects();
      const images = s.filter((o) => o.type === "image");
      return {
        imageCount: images.length,
        opacity: images[0]?.opacity,
        selectable: images[0]?.selectable,
      };
    });
    expect(ref.imageCount).toBe(1);
    expect(ref.opacity).toBeCloseTo(0.25, 2);
    expect(ref.selectable).toBe(false);

    // 4. Document keeps the image's natural size.
    const doc = await page.evaluate(
      () => window.__btm.getTemplate().document,
    );
    expect(doc).toEqual({ width: A4_W, height: A4_H });

    const P = await docToPage(page);

    // 5-7. Draw the structural rules of the bill.
    await pickTool(page, "Rectangle");
    await draw(page, P, 30, 30, 764, 1093);
    await pickTool(page, "Horizontal Rule");
    await draw(page, P, 30, 200, 764, 200);
    await draw(page, P, 30, 300, 430, 300);
    await pickTool(page, "Vertical Rule");
    await draw(page, P, 430, 200, 430, 420);

    // 8. Add a title as static text.
    await pickTool(page, "Text");
    const titleAt = P(320, 90);
    await page.mouse.click(titleAt.x, titleAt.y);
    await page.waitForTimeout(200);

    // 9. Create the items table.
    await pickTool(page, "Table");
    await draw(page, P, 30, 420, 764, 560);
    await expect(page.getByText("Create table")).toBeVisible();
    await page.locator("input[type=number]").nth(0).fill("4");
    await page.locator("input[type=number]").nth(1).fill("4");
    await page.getByRole("button", { name: "Create" }).click();
    await page.waitForTimeout(300);

    // 10. Add a placeholder text box.
    await pickTool(page, "Text");
    const custAt = P(60, 230);
    await page.mouse.click(custAt.x, custAt.y);
    await page.waitForTimeout(200);

    // The template must contain what was traced.
    const template = await page.evaluate(() => window.__btm.getTemplate());
    expect(template.templateVersion).toBe(1);
    expect(template.document).toEqual({ width: A4_W, height: A4_H });

    const types = template.objects.map((o) => o.type);
    expect(types).toContain("rect");
    expect(types).toContain("hr");
    expect(types).toContain("vr");
    expect(types).toContain("text");
    expect(types).toContain("table");

    // The reference image is never part of the template.
    expect(template.objects.every((o) => o.type !== "image")).toBe(true);

    // 11. Table geometry is exact.
    const table = template.objects.find((o) => o.type === "table")!;
    expect(table.rows).toBe(4);
    expect(table.columns).toBe(4);
    expect(table.colWidths!.reduce((a, b) => a + b, 0)).toBe(
      Math.round(table.width),
    );
    expect(table.rowHeights!.reduce((a, b) => a + b, 0)).toBe(
      Math.round(table.height),
    );
    expect(table.cells).toHaveLength(16);
    expect(table.role).toBe("items");

    // 12. Table cell hit testing resolves to the correct grid slot.
    const hits = await page.evaluate((t) => {
      const live = window.__btm
        .getCanvas()!
        .getObjects()
        .find((o) => o.appType === "table") as unknown as {
        cellAtCanvasPoint(x: number, y: number): { row: number; column: number } | null;
      } | undefined;
      if (!live) return [];
      const probes: Array<[number, number]> = [
        [0, 0],
        [0, 3],
        [1, 1],
        [2, 0],
        [3, 3],
      ];
      return probes.map(([r, c]) => {
        const x =
          t.x +
          t.colWidths!.slice(0, c).reduce((a, b) => a + b, 0) +
          t.colWidths![c]! / 2;
        const y =
          t.y +
          t.rowHeights!.slice(0, r).reduce((a, b) => a + b, 0) +
          t.rowHeights![r]! / 2;
        const hit = live.cellAtCanvasPoint(x, y);
        return { want: `${r},${c}`, got: hit ? `${hit.row},${hit.column}` : null };
      });
    }, table);
    expect(hits).toHaveLength(5);
    for (const h of hits) expect(h.got).toBe(h.want);

    // 13. Zoom does not change document coordinates.
    const beforeZoom = await page.evaluate(
      () => JSON.stringify(window.__btm.getTemplate().objects.map((o) => [o.x, o.y, o.width, o.height])),
    );
    await page.evaluate(() => window.__btm.setZoom(1.5));
    await page.waitForTimeout(200);
    const afterZoom = await page.evaluate(
      () => JSON.stringify(window.__btm.getTemplate().objects.map((o) => [o.x, o.y, o.width, o.height])),
    );
    await page.evaluate(() => window.__btm.setZoom(0.5));
    await page.waitForTimeout(200);
    expect(afterZoom).toBe(beforeZoom);

    // 14. Preview hides the reference image.
    await page.getByRole("button", { name: "Preview" }).click();
    await page.waitForTimeout(400);
    const refVisible = await page.evaluate(() => {
      const img = window.__btm
        .getCanvas()!
        .getObjects()
        .find((o) => o.type === "image");
      return img?.visible;
    });
    expect(refVisible).toBe(false);
    await page.getByRole("button", { name: "Back to Editor" }).click();
    await page.waitForTimeout(400);
    const refVisibleAgain = await page.evaluate(() => {
      const img = window.__btm
        .getCanvas()!
        .getObjects()
        .find((o) => o.type === "image");
      return img?.visible;
    });
    expect(refVisibleAgain).toBe(true);

    // 15. Undo removes the last traced object.
    const beforeUndo = (await page.evaluate(() => window.__btm.getTemplate())).objects.length;
    await page.keyboard.press("Control+z");
    await page.waitForTimeout(300);
    const afterUndo = (await page.evaluate(() => window.__btm.getTemplate())).objects.length;
    expect(afterUndo).toBeLessThan(beforeUndo);
    await page.keyboard.press("Control+Shift+z");
    await page.waitForTimeout(300);
    const afterRedo = (await page.evaluate(() => window.__btm.getTemplate())).objects.length;
    expect(afterRedo).toBe(beforeUndo);

    const saved = await page.evaluate(() => window.__btm.getTemplate());

    // 16. Reloading the template restores the same structure.
    await page.evaluate((t) => {
      const canvas = window.__btm.getCanvas()!;
      canvas.getObjects().forEach((o) => {
        if (o.type !== "image") canvas.remove(o);
      });
      window.__btm.loadTemplate(t);
    }, saved);
    await page.waitForTimeout(400);
    const reloaded = await page.evaluate(() => window.__btm.getTemplate());
    expect(reloaded.objects.length).toBe(saved.objects.length);
    expect(reloaded.objects.map((o) => o.type).sort()).toEqual(
      saved.objects.map((o) => o.type).sort(),
    );
    const reloadedTable = reloaded.objects.find((o) => o.type === "table")!;
    expect(reloadedTable.colWidths).toEqual(table.colWidths);
    expect(reloadedTable.rowHeights).toEqual(table.rowHeights);

    // 17. Exports are produced from the template and exclude the reference.
    const grab = async (
      item: string,
    ): Promise<{ name: string; read: () => Buffer }> => {
      await page.getByRole("button", { name: /Export/ }).click();
      const [download] = await Promise.all([
        page.waitForEvent("download", { timeout: 20_000 }),
        page.getByRole("button", { name: new RegExp(item) }).click(),
      ]).catch(async (e) => {
        const err = await page
          .locator("span.border-red-200")
          .first()
          .textContent()
          .catch(() => null);
        throw new Error(
          `export "${item}" produced no download. UI error: ${err ?? "none"}. ${String(e).slice(0, 200)}`,
        );
      });
      const filePath = await download.path();
      if (!filePath) throw new Error("download produced no file");
      return { name: download.suggestedFilename(), read: () => readFileSync(filePath) };
    };

    // JSON template
    const jsonFile = await grab("JSON Template");
    expect(jsonFile.name).toMatch(/\.json$/);
    const json = JSON.parse(jsonFile.read().toString("utf8")) as Template;
    expect(json.templateVersion).toBe(1);
    expect(json.document).toEqual({ width: A4_W, height: A4_H });
    expect(json.objects.length).toBe(saved.objects.length);
    expect(json.objects.every((o) => o.type !== "image")).toBe(true);
    expect(json.objects.some((o) => o.type === "table")).toBe(true);

    // SVG keeps the structure and drops the reference bitmap.
    const svg = (await grab("SVG")).read().toString("utf8");
    expect(svg).toContain("<svg");
    expect(svg).not.toMatch(/<image\b/);
    expect(svg).not.toMatch(/data:image\/png/);
    expect(svg).toMatch(/<rect/);
    expect(svg).toMatch(/<line|<text/);
    expect(svg).toContain(`width="${A4_W}"`);
    expect(svg).toContain(`height="${A4_H}"`);

    // PDF is a real single page document.
    const pdf = (await grab("PDF")).read();
    expect(pdf.subarray(0, 4).toString("latin1")).toBe("%PDF");
    expect(pdf.length).toBeGreaterThan(1000);

    // DOCX is a real OOXML package.
    const docx = (await grab("DOCX")).read();
    expect(docx.subarray(0, 2).toString("latin1")).toBe("PK");
    expect(docx.length).toBeGreaterThan(1000);

    // PNG preview.
    const png = (await grab("Preview PNG")).read();
    expect([...png.subarray(0, 4)]).toEqual([0x89, 0x50, 0x4e, 0x47]);
  });
});


/**
 * Dispatch a wheel event on the canvas.
 *
 * Playwright's `mouse.wheel()` does not deliver a DOM wheel event to the page
 * in this headless setup, so wheel behaviour is exercised synthetically. The
 * handler is the same either way: it only calls `preventDefault` when a
 * modifier is held, so a real wheel still scrolls natively.
 */
async function wheel(
  page: Page,
  deltaY: number,
  opts: { ctrl?: boolean } = {},
): Promise<{ defaultPrevented: boolean; zoom: number; zoomBefore: number }> {
  return page.evaluate(
    ({ deltaY, ctrl }) => {
      const upper = document.querySelector(
        "canvas.upper-canvas",
      ) as HTMLCanvasElement;
      const zoomBefore = window.__btm.getCanvas()!.getZoom();
      const ev = new WheelEvent("wheel", {
        deltaY,
        ctrlKey: ctrl,
        bubbles: true,
        cancelable: true,
        clientX: window.innerWidth / 2,
        clientY: window.innerHeight / 2,
      });
      upper.dispatchEvent(ev);
      return {
        defaultPrevented: ev.defaultPrevented,
        zoom: window.__btm.getCanvas()!.getZoom(),
        zoomBefore,
      };
    },
    { deltaY, ctrl: opts.ctrl ?? false },
  );
}

/** Geometry of the scrollable stage and the page drawn inside it. */
interface StageMetrics {
  zoom: number;
  viewport: { width: number; height: number };
  stage: { clientW: number; clientH: number; scrollH: number; scrollTop: number };
  canvas: { w: number; h: number; top: number; bottom: number };
}

async function readMetrics(page: Page): Promise<StageMetrics> {
  return page.evaluate(() => {
    const upper = document.querySelector(
      "canvas.upper-canvas",
    ) as HTMLCanvasElement;
    const stage = upper.closest('[data-btm-stage="canvas"]') as HTMLElement;
    const box = upper.getBoundingClientRect();
    return {
      zoom: window.__btm.getCanvas()!.getZoom(),
      viewport: window.__btm.getViewportSize(),
      stage: {
        clientW: stage.clientWidth,
        clientH: stage.clientHeight,
        scrollH: stage.scrollHeight,
        scrollTop: stage.scrollTop,
      },
      canvas: {
        w: Math.round(box.width),
        h: Math.round(box.height),
        top: Math.round(box.top),
        bottom: Math.round(box.bottom),
      },
    };
  });
}

async function stageBox(page: Page): Promise<{
  x: number;
  y: number;
  width: number;
  height: number;
}> {
  const box = await page.locator('[data-btm-stage="canvas"]').boundingBox();
  if (!box) throw new Error("no stage box");
  return box;
}

/** Open the editor with a bill and return a document -> page mapper. */
async function openWith(
  page: Page,
  file: string,
): Promise<(x: number, y: number) => Promise<{ x: number; y: number }>> {
  await page.goto("/");
  await page
    .locator('input[type="file"][accept*="image/png"]')
    .first()
    .setInputFiles(file);
  await page.locator("canvas.upper-canvas").waitFor({ state: "attached" });
  await page.waitForFunction(() => Boolean(window.__btm?.getCanvas()));
  // Let the flex layout settle so the measured pane size is final.
  await page.waitForTimeout(800);
  const box = await page.evaluate(() => {
    const r = document
      .querySelector("canvas.upper-canvas")!
      .getBoundingClientRect();
    return { left: r.left, top: r.top, zoom: r.width / 794 };
  });
  return async (x: number, y: number) => ({
    x: box.left + x * box.zoom,
    y: box.top + y * box.zoom,
  });
}

/** Draw a table with the real tool and confirm it in the dialog. */
async function drawTable(
  page: Page,
  P: (x: number, y: number) => Promise<{ x: number; y: number }>,
  from: [number, number],
  to: [number, number],
  rows?: number,
  cols?: number,
): Promise<void> {
  await page.getByTitle(/^Table/i).click();
  await page.waitForTimeout(150);
  const a = await P(from[0], from[1]);
  const b = await P(to[0], to[1]);
  await page.mouse.move(a.x, a.y);
  await page.mouse.down();
  await page.mouse.move(b.x, b.y, { steps: 5 });
  await page.mouse.up();
  await page.waitForTimeout(400);

  const dialog = page.getByRole("dialog");
  await expect(dialog).toBeVisible();
  if (rows !== undefined) {
    const input = dialog.locator('input[type="number"]').first();
    await input.click();
    await input.press("Control+a");
    await input.type(String(rows));
  }
  if (cols !== undefined) {
    const input = dialog.locator('input[type="number"]').nth(1);
    await input.click();
    await input.press("Control+a");
    await input.type(String(cols));
  }
  await page.getByRole("button", { name: "Create" }).click();
  await page.waitForTimeout(400);
}

interface TableState {
  left: number;
  top: number;
  width: number;
  height: number;
  scaleX: number;
  scaleY: number;
  colSum: number;
  rowSum: number;
  rows: number;
  columns: number;
}

async function tableState(page: Page): Promise<TableState> {
  return page.evaluate(() => {
    const t = window.__btm.getTable();
    return {
      left: Math.round(t!.left),
      top: Math.round(t!.top),
      width: Math.round(t!.width),
      height: Math.round(t!.height),
      scaleX: t!.scaleX,
      scaleY: t!.scaleY,
      colSum: t!.colWidths.reduce((x, y) => x + y, 0),
      rowSum: t!.rowHeights.reduce((x, y) => x + y, 0),
      rows: t!.rows,
      columns: t!.columns,
    };
  });
}

test.describe("Pane navigation", () => {
  test.beforeEach(async ({ page }) => {
    page.on("dialog", (d) => void d.accept());
  });

  test("fits an uploaded bill inside the pane", async ({ page }) => {
    await openWith(page, FIXTURE);
    const m = await readMetrics(page);

    expect(m.canvas.w).toBeLessThanOrEqual(m.stage.clientW);
    expect(m.canvas.h).toBeLessThanOrEqual(m.stage.clientH);

    // The fit is maximal: a portrait page fills the height, not the width, so
    // compare the zoom against the computed fit rather than against width.
    const expected = Math.min(
      (m.viewport.width - 24) / 794,
      (m.viewport.height - 24) / 1123,
    );
    expect(m.zoom).toBeCloseTo(expected, 2);

    const doc = await page.evaluate(() => window.__btm.getTemplate().document);
    expect(doc).toEqual({ width: 794, height: 1123 });
  });

  test("a fitted long page is entirely visible without scrolling", async ({
    page,
  }) => {
    await openWith(page, LONG_FIXTURE);
    const m = await readMetrics(page);
    expect(m.canvas.h).toBeLessThanOrEqual(m.stage.clientH);
    expect(m.canvas.w).toBeLessThanOrEqual(m.stage.clientW);
    expect(m.stage.scrollH).toBeLessThanOrEqual(m.stage.clientH + 2);
  });

  test("zooming in makes the stage scrollable to the bottom of the page", async ({
    page,
  }) => {
    await openWith(page, LONG_FIXTURE);
    await page.evaluate(() => {
      const c = window.__btm;
      c.setZoom(c.getCanvas()!.getZoom() * 3);
    });
    await page.waitForTimeout(300);

    const zoomed = await readMetrics(page);
    expect(zoomed.canvas.h).toBeGreaterThan(zoomed.stage.clientH);
    expect(zoomed.stage.scrollH).toBeGreaterThan(zoomed.stage.clientH);

    const stage = page.locator('[data-btm-stage="canvas"]');
    await stage.evaluate((el) => {
      el.scrollTop = el.scrollHeight;
    });
    await page.waitForTimeout(200);

    const atBottom = await page.evaluate(() => {
      const upper = document.querySelector(
        "canvas.upper-canvas",
      ) as HTMLElement;
      const el = upper.closest('[data-btm-stage="canvas"]') as HTMLElement;
      const box = upper.getBoundingClientRect();
      const stageBox = el.getBoundingClientRect();
      return {
        scrollTop: el.scrollTop,
        maxScroll: el.scrollHeight - el.clientHeight,
        gapToStageBottom: Math.round(stageBox.bottom - box.bottom),
      };
    });
    expect(atBottom.scrollTop).toBeGreaterThan(0);
    expect(atBottom.scrollTop).toBeCloseTo(atBottom.maxScroll, -1);
    expect(atBottom.gapToStageBottom).toBeGreaterThanOrEqual(0);
    expect(atBottom.gapToStageBottom).toBeLessThanOrEqual(26);
  });

  test("scrolling never goes past the image boundary", async ({ page }) => {
    await openWith(page, LONG_FIXTURE);
    await page.evaluate(() => window.__btm.setZoom(1.5));
    await page.waitForTimeout(300);

    // Zoomed in, the page is larger than the pane, so the scrollable content
    // must be exactly the page: no dead space beyond either image edge.
    const stage = page.locator('[data-btm-stage="canvas"]');
    const edges = async () =>
      page.evaluate(() => {
        const upper = document.querySelector(
          "canvas.upper-canvas",
        ) as HTMLElement;
        const el = upper.closest('[data-btm-stage="canvas"]') as HTMLElement;
        const box = upper.getBoundingClientRect();
        const stageBox = el.getBoundingClientRect();
        return {
          gapTop: Math.round(box.top - stageBox.top),
          gapBottom: Math.round(stageBox.bottom - box.bottom),
          scrollTopTop: el.scrollTop,
        };
      });

    // At the top of the scroll range the page's top edge is flush.
    await stage.evaluate((el) => {
      el.scrollTop = 0;
    });
    await page.waitForTimeout(150);
    const atTop = await edges();
    expect(Math.abs(atTop.gapTop)).toBeLessThanOrEqual(2);

    // And at the bottom the page's bottom edge is flush, so there is nothing
    // to scroll into beyond the image.
    await stage.evaluate((el) => {
      el.scrollTop = 99999;
    });
    await page.waitForTimeout(150);
    const atBottom = await edges();
    expect(atBottom.scrollTopTop).toBeGreaterThan(0);
    expect(Math.abs(atBottom.gapBottom)).toBeLessThanOrEqual(2);
  });

  test("the wheel scrolls instead of zooming, and Ctrl+wheel zooms", async ({
    page,
  }) => {
    await openWith(page, LONG_FIXTURE);
    const fitted = await readMetrics(page);

    const plain = await wheel(page, 400, { ctrl: false });
    expect(plain.defaultPrevented).toBe(false);
    expect(plain.zoom).toBeCloseTo(plain.zoomBefore, 6);
    expect(plain.zoom).toBeCloseTo(fitted.zoom, 5);

    const zoomIn = await wheel(page, -400, { ctrl: true });
    expect(zoomIn.defaultPrevented).toBe(true);
    expect(zoomIn.zoom).toBeGreaterThan(fitted.zoom);

    const zoomOut = await wheel(page, 400, { ctrl: true });
    expect(zoomOut.zoom).toBeLessThan(zoomIn.zoom);

    await page.getByRole("button", { name: "Fit" }).click();
    await page.waitForTimeout(300);
    const refitted = await readMetrics(page);
    expect(refitted.zoom).toBeCloseTo(fitted.zoom, 2);
    expect(refitted.canvas.h).toBeLessThanOrEqual(refitted.stage.clientH);
  });

  test("space + drag pans the view by scrolling the stage", async ({ page }) => {
    await openWith(page, LONG_FIXTURE);
    await page.evaluate(() => {
      const c = window.__btm;
      c.setZoom(c.getCanvas()!.getZoom() * 3);
    });
    await page.waitForTimeout(300);

    const stage = page.locator('[data-btm-stage="canvas"]');
    expect(await stage.evaluate((el) => el.scrollTop)).toBe(0);

    const box = await stageBox(page);
    const cx = box.x + box.width / 2;
    const cy = box.y + box.height / 2;

    // Grabbing the page and pulling it up reveals what is below.
    await page.keyboard.down(" ");
    await page.mouse.move(cx, cy);
    await page.mouse.down();
    await page.mouse.move(cx, cy - 250, { steps: 8 });
    await page.mouse.up();
    await page.keyboard.up(" ");
    await page.waitForTimeout(300);
    const after = await stage.evaluate((el) => el.scrollTop);
    expect(after).toBeGreaterThan(0);

    // And pulling back down scrolls the other way.
    await page.keyboard.down(" ");
    await page.mouse.move(cx, cy);
    await page.mouse.down();
    await page.mouse.move(cx, cy + 150, { steps: 8 });
    await page.mouse.up();
    await page.keyboard.up(" ");
    await page.waitForTimeout(300);
    expect(await stage.evaluate((el) => el.scrollTop)).toBeLessThan(after);

    // Panning must not leave the page offset inside the canvas element.
    const panOffset = await page.evaluate(() => {
      const c = window.__btm.getCanvas()!;
      const vpt = (c as unknown as { viewportTransform: number[] })
        .viewportTransform;
      return [vpt[4], vpt[5]];
    });
    expect(panOffset[0]).toBe(0);
    expect(panOffset[1]).toBe(0);
  });

  test("does not fight a deliberate zoom when the pane is resized", async ({
    page,
  }) => {
    await openWith(page, FIXTURE);
    await page.evaluate(() => window.__btm.setZoom(1.5));
    await page.waitForTimeout(200);
    const chosen = await readMetrics(page);

    await page.setViewportSize({ width: 1300, height: 760 });
    await page.waitForTimeout(400);
    expect((await readMetrics(page)).zoom).toBeCloseTo(chosen.zoom, 5);
  });

  test("refits automatically when the pane grows, before the user zooms", async ({
    page,
  }) => {
    await openWith(page, LONG_FIXTURE);
    const before = await readMetrics(page);

    await page.setViewportSize({ width: 1500, height: 1250 });
    await page.waitForTimeout(500);
    const after = await readMetrics(page);

    expect(after.viewport.height).toBeGreaterThan(before.viewport.height);
    expect(after.zoom).toBeGreaterThan(before.zoom);
    expect(after.canvas.h).toBeLessThanOrEqual(after.stage.clientH);
  });
});

test.describe("The page and the reference image stay bound", () => {
  test.beforeEach(async ({ page }) => {
    page.on("dialog", (d) => void d.accept());
  });

  test("the page adopts the image's exact shape", async ({ page }) => {
    await openWith(page, LONG_FIXTURE);

    const info = await page.evaluate(() => {
      const c = window.__btm;
      const img = c
        .getCanvas()!
        .getObjects()
        .find((o) => o.type === "image") as unknown as {
        left: number;
        top: number;
        width: number;
        height: number;
        scaleX: number;
        scaleY: number;
      };
      return {
        doc: c.getTemplate().document,
        left: img.left,
        top: img.top,
        scaledW: img.width * img.scaleX,
        scaledH: img.height * img.scaleY,
      };
    });

    // The page is the image's natural size, and the image covers it exactly.
    expect(info.doc).toEqual({ width: 794, height: 2600 });
    expect(info.left).toBe(0);
    expect(info.top).toBe(0);
    expect(info.scaledW).toBeCloseTo(info.doc.width, 1);
    expect(info.scaledH).toBeCloseTo(info.doc.height, 1);
  });

  test("loading a template re-binds the image instead of detaching it", async ({
    page,
  }) => {
    await openWith(page, FIXTURE);

    await page.evaluate(`(() => {
      window.__btm.loadTemplate({
        templateVersion: 1,
        document: { width: 600, height: 900 },
        meta: { name: 'other', modifiedAt: new Date().toISOString() },
        objects: [],
      });
    })()`);
    await page.waitForTimeout(600);

    const info = await page.evaluate(() => {
      const c = window.__btm;
      const img = c
        .getCanvas()!
        .getObjects()
        .find((o) => o.type === "image") as unknown as {
        left: number;
        top: number;
        width: number;
        height: number;
        scaleX: number;
        scaleY: number;
      };
      return {
        doc: c.getTemplate().document,
        left: img.left,
        top: img.top,
        scaledW: img.width * img.scaleX,
        scaledH: img.height * img.scaleY,
      };
    });

    expect(info.doc).toEqual({ width: 600, height: 900 });
    expect(info.left).toBe(0);
    expect(info.top).toBe(0);
    expect(info.scaledW).toBeCloseTo(600, 1);
    expect(info.scaledH).toBeCloseTo(900, 1);
  });
});

test.describe("Dialogs and table editing", () => {
  test.beforeEach(async ({ page }) => {
    page.on("dialog", (d) => void d.accept());
  });

  test("table dialog values can be cleared and retyped", async ({ page }) => {
    const P = await openWith(page, FIXTURE);
    await page.getByTitle(/^Table/i).click();
    await page.waitForTimeout(150);
    const a = await P(100, 200);
    const b = await P(500, 400);
    await page.mouse.move(a.x, a.y);
    await page.mouse.down();
    await page.mouse.move(b.x, b.y, { steps: 5 });
    await page.mouse.up();
    await page.waitForTimeout(400);

    const dialog = page.getByRole("dialog");
    await expect(dialog).toBeVisible();
    const rows = dialog.locator('input[type="number"]').first();
    const cols = dialog.locator('input[type="number"]').nth(1);

    expect(await rows.inputValue()).toBe("3");
    // The field must be emptiable. A controlled number input that rejects
    // empty input snaps the old value back, so typing 12 after 3 gives 312.
    await rows.click();
    await rows.press("Control+a");
    await rows.press("Backspace");
    expect(await rows.inputValue()).toBe("");
    await rows.type("12", { delay: 40 });
    expect(await rows.inputValue()).toBe("12");

    await cols.click();
    await cols.press("Control+a");
    await cols.press("Backspace");
    await cols.type("7", { delay: 40 });
    expect(await cols.inputValue()).toBe("7");

    await page.getByRole("button", { name: "Create" }).click();
    await page.waitForTimeout(400);

    const t = await tableState(page);
    expect(t.rows).toBe(12);
    expect(t.columns).toBe(7);
    expect(t.colSum).toBe(t.width);
    expect(t.rowSum).toBe(t.height);
  });

  test("grid settings dialog accepts a retyped size", async ({ page }) => {
    await openWith(page, FIXTURE);
    await page.getByRole("button", { name: /Grid Settings/ }).click();
    const dialog = page.getByRole("dialog");
    await expect(dialog).toBeVisible();

    const size = dialog.locator('input[type="number"]').first();
    await size.click();
    await size.press("Control+a");
    await size.press("Backspace");
    await size.type("25", { delay: 40 });
    expect(await size.inputValue()).toBe("25");

    await page.getByRole("button", { name: "Done" }).click();
    await page.waitForTimeout(200);
    expect(await page.evaluate("(() => window.__btm.getSnapshot().gridSize)()")).toBe(25);
  });

  test("column width and row height changes never move the table's top-left", async ({
    page,
  }) => {
    const P = await openWith(page, FIXTURE);
    await drawTable(page, P, [100, 200], [500, 400]);
    const before = await tableState(page);

    await page.evaluate(`(() => {
      window.__btm.updateTable((t) => t.setColumnWidth(0, t.colWidths[0] + 120), 'x');
    })()`);
    await page.waitForTimeout(200);
    const afterCol = await tableState(page);
    expect(afterCol.left).toBe(before.left);
    expect(afterCol.top).toBe(before.top);
    expect(afterCol.width).toBeGreaterThan(before.width);
    expect(afterCol.colSum).toBe(afterCol.width);

    await page.evaluate(`(() => {
      window.__btm.updateTable((t) => t.setRowHeight(0, t.rowHeights[0] + 60), 'x');
    })()`);
    await page.waitForTimeout(200);
    const afterRow = await tableState(page);
    expect(afterRow.left).toBe(before.left);
    expect(afterRow.top).toBe(before.top);
    expect(afterRow.height).toBeGreaterThan(afterCol.height);
    expect(afterRow.rowSum).toBe(afterRow.height);
  });

  test("a table resizes from its corner handles, growing right and down only", async ({
    page,
  }) => {
    const P = await openWith(page, FIXTURE);
    await drawTable(page, P, [150, 250], [550, 450]);
    const before = await tableState(page);

    const corner = await P(
      before.left + before.width,
      before.top + before.height,
    );
    await page.mouse.move(corner.x, corner.y);
    await page.waitForTimeout(150);
    await page.mouse.down();
    await page.waitForTimeout(120);
    await page.mouse.move(corner.x + 100, corner.y + 60, { steps: 12 });
    await page.waitForTimeout(120);
    await page.mouse.up();
    await page.waitForTimeout(400);

    const after = await tableState(page);
    // The top-left corner is pinned; the table only grows outward.
    expect(after.left).toBe(before.left);
    expect(after.top).toBe(before.top);
    expect(after.width).toBeGreaterThan(before.width);
    expect(after.height).toBeGreaterThan(before.height);
    // Scaling is converted into real grid geometry, never left on the object.
    expect(after.scaleX).toBe(1);
    expect(after.scaleY).toBe(1);
    expect(after.colSum).toBe(after.width);
    expect(after.rowSum).toBe(after.height);
  });

  test("dragging the bottom-left corner still keeps the top-left pinned", async ({
    page,
  }) => {
    const P = await openWith(page, FIXTURE);
    await drawTable(page, P, [150, 250], [550, 450]);
    const before = await tableState(page);

    const corner = await P(before.left, before.top + before.height);
    await page.mouse.move(corner.x, corner.y);
    await page.waitForTimeout(150);
    await page.mouse.down();
    await page.waitForTimeout(120);
    await page.mouse.move(corner.x - 80, corner.y, { steps: 12 });
    await page.waitForTimeout(120);
    await page.mouse.up();
    await page.waitForTimeout(400);

    const after = await tableState(page);
    // Pulling a left handle outward must not drag the whole table left.
    expect(after.left).toBe(before.left);
    expect(after.top).toBe(before.top);
    expect(after.width).toBeGreaterThan(before.width);
    expect(after.scaleX).toBe(1);
  });

  test("a table's content is painted from its centre, matching Fabric's origin", async ({
    page,
  }) => {
    const P = await openWith(page, FIXTURE);
    await drawTable(page, P, [200, 300], [500, 500], 3, 3);
    await page.evaluate("window.__btm.removeReference()");
    await page.waitForTimeout(300);

    // Fabric renders custom content with the local origin at the object's
    // centre. Painting from (0, 0) drew the table half its size down and right
    // of where Fabric reported it, so the grid and the selection handles
    // disagreed. Assert the paint origin directly rather than scanning pixels.
    const check = (await page.evaluate(`(() => {
      const t = window.__btm.getTable();
      const w = t.width, h = t.height;
      const svg = t._toSVG().join('');
      // The first cell's top-left in the emitted SVG, in local coordinates.
      const m = /<rect x="(-?[\\d.]+)" y="(-?[\\d.]+)" width="([\\d.]+)"/.exec(svg);
      const svgFirst = m ? [parseFloat(m[1]), parseFloat(m[2]), parseFloat(m[3])] : null;
      return {
        w, h,
        svgFirst,
        // The table's own geometry, for reference.
        colWidths: t.colWidths,
        rowHeights: t.rowHeights,
      };
    })()`)) as {
      w: number;
      h: number;
      svgFirst: [number, number, number] | null;
      colWidths: number[];
      rowHeights: number[];
    };

    expect(check.svgFirst).not.toBeNull();
    // The first cell must start at the top-left corner of the local box, which
    // is (-w/2, -h/2) in the centred origin.
    expect(check.svgFirst![0]).toBeCloseTo(-check.w / 2, 3);
    expect(check.svgFirst![1]).toBeCloseTo(-check.h / 2, 3);
    expect(check.svgFirst![2]).toBeCloseTo(check.colWidths[0]!, 3);
  });

});
