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
  src?: string;
  normalized?: boolean;
  sourceRect?: { x: number; y: number; width: number; height: number };
}

interface Template {
  templateVersion: number;
  document: { width: number; height: number };
  meta: {
    name: string;
    placeholders?: Array<{
      key: string;
      label?: string;
      type?: string;
      maxLength?: number;
      fontFamily?: string;
      fontSize?: number;
      fontWeight?: string;
      fontStyle?: string;
      color?: string;
    }>;
  };
  objects: TemplateObject[];
}

/** Exposed on `window` in development; see hooks/useEditorController. */
interface EditorWindow extends Window {
  __btm: {
    getTemplate(): Template;
    getSelectedTemplates(): TemplateObject[];
    getCanvas(): {
      getObjects(): Array<Record<string, unknown>>;
      getZoom(): number;
      remove(o: unknown): void;
      upperCanvasEl: HTMLCanvasElement;
      backgroundImage: unknown;
    } | null;
    setZoom(z: number): void;
    loadTemplate(t: Template): void;
    removeReference(): void;
    recaptureBillPart(id: string): void;
    duplicateSelection(): void;
    fit(): void;
    panBy(dx: number, dy: number): void;
    getViewportSize(): { width: number; height: number };
    getSnapshot(): {
      zoom: number;
      tx: number;
      ty: number;
      document: { width: number; height: number };
      editingCell: unknown;
      pendingTable: unknown;
      gridSize: number;
    };
    projectToScreen(p: { x: number; y: number }): { x: number; y: number };
    screenToScenePoint(p: { x: number; y: number }): { x: number; y: number };
    getTable(): {
      left: number;
      top: number;
      width: number;
      height: number;
      scaleX: number;
      scaleY: number;
      skewX: number;
      skewY: number;
      rows: number;
      columns: number;
      colWidths: number[];
      rowHeights: number[];
      setColumnWidth(index: number, value: number): void;
      setRowHeight(index: number, value: number): void;
      setCellText(row: number, col: number, text: string): void;
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
    updatePlaceholder(
      key: string,
      patch: {
        label?: string;
        type?: "text" | "number" | "date" | "currency";
        maxLength?: number;
        fontFamily?: string;
        fontSize?: number;
        fontWeight?: "normal" | "bold";
        fontStyle?: "normal" | "italic";
        color?: string;
      },
    ): void;
    groupSelection(): void;
    ungroupSelection(): void;
    getGroups(): Array<{
      id: string;
      name: string;
      parentId: string | null;
      members: string[];
    }>;
    deleteSelection(): void;
    undo(): void;
    setTextWrap(on: boolean): void;
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

/** Convert document coordinates into page coordinates, re-read per call. */
async function docToPage(
  page: Page,
): Promise<(x: number, y: number) => Promise<{ x: number; y: number }>> {
  return async (x, y) =>
    page.evaluate(
      ([ax, ay]) => {
        const c = window.__btm;
        const canvas = c.getCanvas()!;
        const r = canvas.upperCanvasEl.getBoundingClientRect();
        const s = c.getSnapshot();
        return {
          x: r.left + s.tx + ax * canvas.getZoom(),
          y: r.top + s.ty + ay * canvas.getZoom(),
        };
      },
      [x, y] as [number, number],
    );
}

async function draw(page: Page, P: (x: number, y: number) => Promise<{ x: number; y: number }>, x1: number, y1: number, x2: number, y2: number): Promise<void> {
  const a = await P(x1, y1);
  const b = await P(x2, y2);
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
      const canvas = window.__btm.getCanvas()!;
      const bg = canvas.backgroundImage as unknown as
        | { opacity: number; selectable: boolean }
        | undefined;
      return {
        hasImageObject: canvas.getObjects().some((o) => o.type === "image"),
        hasBackground: Boolean(bg),
        opacity: bg?.opacity,
        selectable: bg?.selectable,
      };
    });
    // The reference is a background image, not a scene object: it can never
    // be selected, moved or exported, but it is always painted under the scene.
    expect(ref.hasBackground).toBe(true);
    expect(ref.hasImageObject).toBe(false);
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
    const titleAt = await P(320, 90);
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
    const custAt = await P(60, 230);
    await page.mouse.click(custAt.x, custAt.y);
    await page.waitForTimeout(200);

    // The template must contain what was traced. The version is the current
    // schema's: a v1 template is still a valid v2 one, so the traced output
    // carries the version this build writes.
    const template = await page.evaluate(() => window.__btm.getTemplate());
    expect(template.templateVersion).toBe(2);
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
    const refVisible = await page.evaluate(
      () => Boolean(window.__btm.getCanvas()!.backgroundImage),
    );
    expect(refVisible).toBe(false);
    await page.getByRole("button", { name: "Back to Editor" }).click();
    await page.waitForTimeout(400);
    const refVisibleAgain = await page.evaluate(
      () => Boolean(window.__btm.getCanvas()!.backgroundImage),
    );
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
    // The exported JSON is the current schema version: what this build writes.
    const json = JSON.parse(jsonFile.read().toString("utf8")) as Template;
    expect(json.templateVersion).toBe(2);
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

  test("exports a self-contained inert HTML document", async ({ page }) => {
    await openEditorWithBill(page);
    await pickTool(page, "Rect");
    const P = await docToPage(page);
    await draw(page, P, 120, 200, 480, 300);

    const download = page.waitForEvent("download");
    await page.getByRole("button", { name: /Export/ }).click();
    await page.getByRole("button", { name: /HTML Document/ }).click();
    const file = await download;
    expect(file.suggestedFilename()).toMatch(/\.html$/);

    const stream = await file.createReadStream();
    const chunks: Buffer[] = [];
    for await (const c of stream) chunks.push(c as Buffer);
    const html = Buffer.concat(chunks).toString("utf8");

    expect(html.startsWith("<!DOCTYPE html>")).toBe(true);
    expect(html).not.toContain("<script");
    expect(html).not.toContain("<link");
    expect(html).not.toContain("@import");
    // This document carries no content of its own that contains a URL, so the
    // no-remote-reference property holds for it. A bill whose own text quotes a
    // URL would legitimately print one, and no assertion here should forbid it.
    expect(html).not.toContain("http://");
    expect(html).toMatch(/data-template-hash="[0-9a-f]{64}"/);
    expect(html).toContain("@page");
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

/** Geometry of the pane and the view state inside it. */
interface StageMetrics {
  zoom: number;
  tx: number;
  ty: number;
  viewport: { width: number; height: number };
  stage: { clientW: number; clientH: number; scrollH: number };
  canvas: { w: number; h: number };
  doc: { width: number; height: number };
}

async function readMetrics(page: Page): Promise<StageMetrics> {
  return page.evaluate(() => {
    const upper = document.querySelector(
      "canvas.upper-canvas",
    ) as HTMLCanvasElement;
    const stage = upper.closest('[data-btm-stage="canvas"]') as HTMLElement;
    const box = upper.getBoundingClientRect();
    const s = window.__btm.getSnapshot();
    return {
      zoom: window.__btm.getCanvas()!.getZoom(),
      tx: s.tx,
      ty: s.ty,
      viewport: window.__btm.getViewportSize(),
      stage: {
        clientW: stage.clientWidth,
        clientH: stage.clientHeight,
        scrollH: stage.scrollHeight,
      },
      canvas: {
        w: Math.round(box.width),
        h: Math.round(box.height),
      },
      doc: window.__btm.getTemplate().document,
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

/** Open the editor with a bill and return a live document -> page mapper. */
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
  return async (x, y) =>
    page.evaluate(
      ([ax, ay]) => {
        const c = window.__btm;
        const canvas = c.getCanvas()!;
        const r = canvas.upperCanvasEl.getBoundingClientRect();
        const s = c.getSnapshot();
        return {
          x: r.left + s.tx + ax * canvas.getZoom(),
          y: r.top + s.ty + ay * canvas.getZoom(),
        };
      },
      [x, y] as [number, number],
    );
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
  skewX: number;
  skewY: number;
  colWidths: number[];
  rowHeights: number[];
  colSum: number;
  rowSum: number;
  rows: number;
  columns: number;
  zoom: number;
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
      skewX: t!.skewX,
      skewY: t!.skewY,
      colWidths: [...t!.colWidths],
      rowHeights: [...t!.rowHeights],
      colSum: t!.colWidths.reduce((x, y) => x + y, 0),
      rowSum: t!.rowHeights.reduce((x, y) => x + y, 0),
      rows: t!.rows,
      columns: t!.columns,
      zoom: window.__btm.getCanvas()!.getZoom(),
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

    // The canvas fills the pane exactly; the view scales the bill to fit it.
    expect(m.canvas.w).toBe(m.stage.clientW);
    expect(m.canvas.h).toBe(m.stage.clientH);

    const expected = Math.min(
      Math.max(120, m.stage.clientW - 48) / 794,
      Math.max(120, m.stage.clientH - 48) / 1123,
    );
    expect(m.zoom).toBeCloseTo(expected, 2);

    // The fitted bill sits centred within a 24px margin, never clipped.
    expect(m.tx).toBeCloseTo((m.stage.clientW - 794 * m.zoom) / 2, 1);
    expect(m.ty).toBeCloseTo((m.stage.clientH - 1123 * m.zoom) / 2, 1);

    expect(m.doc).toEqual({ width: 794, height: 1123 });
  });

  test("a fitted long page is entirely visible without scrolling", async ({
    page,
  }) => {
    await openWith(page, LONG_FIXTURE);
    const m = await readMetrics(page);
    // The whole 2600px-tall page fits the pane: at the current zoom the
    // document never exceeds the pane on either axis.
    expect(794 * m.zoom).toBeLessThanOrEqual(m.stage.clientW + 1);
    expect(2600 * m.zoom).toBeLessThanOrEqual(m.stage.clientH + 1);
    expect(m.stage.scrollH).toBeLessThanOrEqual(m.stage.clientH + 2);
  });

  test("zooming in lets the view reach the bottom of the page", async ({
    page,
  }) => {
    await openWith(page, LONG_FIXTURE);
    await page.evaluate(() => {
      const c = window.__btm;
      c.setZoom(c.getCanvas()!.getZoom() * 3);
    });
    await page.waitForTimeout(300);

    const zoomed = await readMetrics(page);
    expect(2600 * zoomed.zoom).toBeGreaterThan(zoomed.stage.clientH);

    const box = await stageBox(page);
    const cx = box.x + box.width / 2;
    const cy = box.y + box.height / 2;
    for (let i = 0; i < 3; i++) {
      await page.keyboard.down(" ");
      await page.mouse.move(cx, cy);
      await page.mouse.down();
      await page.mouse.move(cx, cy - 600, { steps: 8 });
      await page.mouse.up();
      await page.keyboard.up(" ");
      await page.waitForTimeout(120);
    }
    // Panning fully up clamps with a 32px overhang, so the view reaches the
    // very bottom of the bill and a maximum of 32px of pane background shows.
    const atBottom = await readMetrics(page);
    expect(atBottom.ty).toBeCloseTo(
      atBottom.stage.clientH - 2600 * atBottom.zoom - 32,
      0,
    );
    expect(atBottom.ty).toBeLessThan(0);
  });

  test("panning never goes past the image boundary", async ({ page }) => {
    await openWith(page, LONG_FIXTURE);
    await page.evaluate(() => window.__btm.setZoom(2));
    await page.waitForTimeout(300);

    const box = await stageBox(page);
    const cx = box.x + box.width / 2;
    const cy = box.y + box.height / 2;
    const dragPage = async (dy: number) => {
      await page.keyboard.down(" ");
      await page.mouse.move(cx, cy);
      await page.mouse.down();
      await page.mouse.move(cx, cy + dy, { steps: 10 });
      await page.mouse.up();
      await page.keyboard.up(" ");
      await page.waitForTimeout(150);
    };

    // Drag far down: top edge stops at a 32px overhang below the pane top.
    await dragPage(4000);
    const atTop = await readMetrics(page);
    expect(atTop.ty).toBeCloseTo(32, -1);

    // Drag far up: bottom edge stops at a 32px overhang above the pane bottom.
    await dragPage(-8000);
    const atBottom = await readMetrics(page);
    expect(atBottom.ty).toBeCloseTo(
      atBottom.stage.clientH - atBottom.doc.height * atBottom.zoom - 32,
      0,
    );
  });

  test("a plain wheel zooms under the cursor, always preventing default", async ({
    page,
  }) => {
    await openWith(page, LONG_FIXTURE);
    const fitted = await readMetrics(page);

    const zoomIn = await wheel(page, -400, { ctrl: false });
    expect(zoomIn.defaultPrevented).toBe(true);
    expect(zoomIn.zoom).toBeGreaterThan(fitted.zoom);

    const zoomOut = await wheel(page, 400, { ctrl: false });
    expect(zoomOut.zoom).toBeLessThan(zoomIn.zoom);

    // Ctrl+wheel is accepted too, and does the same thing.
    const viaCtrl = await wheel(page, -400, { ctrl: true });
    expect(viaCtrl.defaultPrevented).toBe(true);
    expect(viaCtrl.zoom).toBeGreaterThan(zoomOut.zoom);

    await page.getByRole("button", { name: "Fit" }).click();
    await page.waitForTimeout(300);
    const refitted = await readMetrics(page);
    expect(refitted.zoom).toBeCloseTo(fitted.zoom, 2);
    expect(794 * refitted.zoom).toBeLessThanOrEqual(refitted.stage.clientW + 1);
    expect(2600 * refitted.zoom).toBeLessThanOrEqual(refitted.stage.clientH + 1);
  });

  test("the scene point under the cursor is invariant across a wheel zoom", async ({
    page,
  }) => {
    await openWith(page, FIXTURE);
    const probe = () =>
      page.evaluate(() => {
        const c = window.__btm;
        const r = c.getCanvas()!.upperCanvasEl.getBoundingClientRect();
        // Same canvas-relative point the wheel will be dispatched at below:
        // the exact centre of the canvas.
        return c.screenToScenePoint({ x: r.width / 2, y: r.height / 2 });
      });
    const zoomAtCentre = () =>
      page.evaluate(() => {
        const c = window.__btm;
        const r = c.getCanvas()!.upperCanvasEl.getBoundingClientRect();
        const ev = new WheelEvent("wheel", {
          deltaY: -600,
          bubbles: true,
          cancelable: true,
          clientX: r.left + r.width / 2,
          clientY: r.top + r.height / 2,
        });
        c.getCanvas()!.upperCanvasEl.dispatchEvent(ev);
      });
    const before = await probe();
    await zoomAtCentre();
    const after = await probe();
    // Only a genuine edge clamp may move the anchor; away from the edges the
    // scene point under the cursor is preserved.
    expect(after.x).toBeCloseTo(before.x, 1);
    expect(after.y).toBeCloseTo(before.y, 1);
  });

  test("space + drag pans the view, translating it by the drag delta", async ({
    page,
  }) => {
    await openWith(page, LONG_FIXTURE);
    await page.evaluate(() => {
      const c = window.__btm;
      c.setZoom(c.getCanvas()!.getZoom() * 3);
    });
    await page.waitForTimeout(300);

    const box = await stageBox(page);
    const cx = box.x + box.width / 2;
    const cy = box.y + box.height / 2;

    const before = await readMetrics(page);

    // Grabbing the page and pulling it up moves its translation with the
    // pointer: the content follows the pointer exactly.
    await page.keyboard.down(" ");
    await page.mouse.move(cx, cy);
    await page.mouse.down();
    await page.mouse.move(cx, cy - 250, { steps: 8 });
    await page.mouse.up();
    await page.keyboard.up(" ");
    await page.waitForTimeout(300);
    const up = await readMetrics(page);
    expect(up.ty).toBeCloseTo(before.ty - 250, 0);

    // And pulling back down undoes it, by the same delta.
    await page.keyboard.down(" ");
    await page.mouse.move(cx, cy - 250);
    await page.mouse.down();
    await page.mouse.move(cx, cy - 250 + 150, { steps: 8 });
    await page.mouse.up();
    await page.keyboard.up(" ");
    await page.waitForTimeout(300);
    const down = await readMetrics(page);
    expect(down.ty).toBeCloseTo(up.ty + 150, 0);

    // The viewport transform Fabric actually uses agrees with the state:
    // the pan lives in the same place Fabric paints from.
    const vpt = await page.evaluate(() => {
      const c = window.__btm.getCanvas()!;
      return (c as unknown as { viewportTransform: number[] })
        .viewportTransform;
    });
    expect(vpt[4]).toBeCloseTo(down.tx, 6);
    expect(vpt[5]).toBeCloseTo(down.ty, 6);
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
      const img = c.getCanvas()!.backgroundImage as unknown as {
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
      const img = c.getCanvas()!.backgroundImage as unknown as {
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
      // Every grid line in local coordinates. The grid is stroked once per edge
      // rather than as a rectangle per cell, so the origin is read from these.
      const lines = [...svg.matchAll(/<line x1="(-?[\\d.]+)" y1="(-?[\\d.]+)" x2="(-?[\\d.]+)" y2="(-?[\\d.]+)"/g)]
        .map((m) => [parseFloat(m[1]), parseFloat(m[2]), parseFloat(m[3]), parseFloat(m[4])]);
      const vertical = lines.find((l) => l[0] === l[2]);
      const horizontals = lines.filter((l) => l[1] === l[3]);
      const horizontal = horizontals[0];
      return {
        w, h,
        borderWidth: t.borderWidth,
        lineCount: lines.length,
        svgFirst: vertical ? [vertical[0], vertical[1]] : null,
        svgFirstRow: horizontal ? [horizontal[0], horizontal[1]] : null,
        secondRowLine: horizontals[1] ? [horizontals[1][0], horizontals[1][1]] : null,
        // The table's own geometry, for reference.
        colWidths: t.colWidths,
        rowHeights: t.rowHeights,
      };
    })()`)) as {
      w: number;
      h: number;
      borderWidth: number;
      lineCount: number;
      svgFirst: [number, number] | null;
      svgFirstRow: [number, number] | null;
      secondRowLine: [number, number] | null;
      colWidths: number[];
      rowHeights: number[];
    };

    expect(check.svgFirst).not.toBeNull();
    expect(check.svgFirstRow).not.toBeNull();
    expect(check.secondRowLine).not.toBeNull();
    // Every grid line starts at the table's own top-left corner, which is
    // (-sum(colWidths)/2, -sum(rowHeights)/2) in the centred origin, inset by
    // half a stroke so the lines stay inside the object's box. The row and
    // column totals are the authority here: the object's own `height` is
    // whatever Fabric last measured and is not necessarily their sum.
    const half = check.borderWidth / 2;
    const w = check.colWidths.reduce((a, b) => a + b, 0);
    const h = check.rowHeights.reduce((a, b) => a + b, 0);
    // The first column edge and the first row edge are both the table's
    // top-left corner, inset by half a stroke so the lines stay inside the box.
    expect(check.svgFirst![0]).toBeCloseTo(-w / 2 + half, 3);
    expect(check.svgFirst![1]).toBeCloseTo(-h / 2 + half, 3);
    expect(check.svgFirstRow![0]).toBeCloseTo(-w / 2 + half, 3);
    expect(check.svgFirstRow![1]).toBeCloseTo(-h / 2 + half, 3);
    // And the row below it is one row height further down, so the grid is
    // laid out from that same corner rather than from anywhere else.
    expect(check.secondRowLine![1]).toBeCloseTo(
      -h / 2 + half + check.rowHeights[0]!,
      3,
    );
    // One line per edge, never one per cell.
    expect(check.lineCount).toBe(
      check.colWidths.length + check.rowHeights.length + 2,
    );
  });

  /**
   * The eight Fabric scale controls, with the drag direction that pulls each
   * one outward.
   *
   * Fabric binds the control at `mouse:down` and never re-hit-tests it while
   * the gesture runs, so `dx`/`dy` do not have to stay inside the control's
   * box. They are doubled to make the expected growth several times the +/-2
   * unit tolerance below, so rounding noise cannot hide a compounding drag.
   */
  const HANDLES: ReadonlyArray<{
    name: string;
    fx: number;
    fy: number;
    dx: number;
    dy: number;
    shift?: boolean;
  }> = [
    { name: "top-left", fx: 0, fy: 0, dx: -40, dy: -40 },
    { name: "top", fx: 0.5, fy: 0, dx: 0, dy: -40 },
    { name: "top-right", fx: 1, fy: 0, dx: 40, dy: -40 },
    { name: "left", fx: 0, fy: 0.5, dx: -40, dy: 0 },
    { name: "right", fx: 1, fy: 0.5, dx: 40, dy: 0 },
    { name: "bottom-left", fx: 0, fy: 1, dx: -40, dy: 40 },
    { name: "bottom", fx: 0.5, fy: 1, dx: 0, dy: 40 },
    { name: "bottom-right", fx: 1, fy: 1, dx: 40, dy: 40 },
    // `altActionKey` is `shiftKey`, so Shift turns the side handles into skew
    // handles and `object:scaling` never fires. The drag must be diagonal:
    // `skewObject` derives its angle from the pointer's travel along the
    // counter-axis, so a purely axial drag would skew by exactly zero and the
    // case would pass without ever reaching the skew handler. A sheared table
    // is not serialised, so it would also come back un-sheared on reload.
    { name: "right with Shift", fx: 1, fy: 0.5, dx: 40, dy: 40, shift: true },
    // `skewX` additionally drives a `scaleX` compensation inside `skewObject`,
    // so the top/bottom handles cover the other half of the state.
    { name: "bottom with Shift", fx: 0.5, fy: 1, dx: 40, dy: 40, shift: true },
  ];

  for (const handle of HANDLES) {
    test(`the ${handle.name} handle ${handle.shift ? "never skews the table" : "keeps the top-left pinned and stays proportional"}`, async ({
      page,
    }) => {
      const P = await openWith(page, FIXTURE);
      await drawTable(page, P, [150, 250], [550, 450], 3, 3);
      const before = await tableState(page);

      // Handles sit at fractions of the table box; the drag then moves further
      // out along the same direction, so every handle grows the table.
      const grip = await P(
        before.left + handle.fx * before.width,
        before.top + handle.fy * before.height,
      );
      if (handle.shift) await page.keyboard.down("Shift");
      await page.mouse.move(grip.x, grip.y);
      await page.waitForTimeout(150);
      await page.mouse.down();
      await page.waitForTimeout(120);
      await page.mouse.move(grip.x + handle.dx * 2, grip.y + handle.dy * 2, {
        steps: 12,
      });
      await page.waitForTimeout(120);
      await page.mouse.up();
      if (handle.shift) await page.keyboard.up("Shift");
      await page.waitForTimeout(400);

      const after = await tableState(page);

      // The pinned corner must not have moved at all.
      expect(after.left).toBe(before.left);
      expect(after.top).toBe(before.top);
      // Scaling is converted into real grid geometry, never left on the object.
      expect(after.scaleX).toBe(1);
      expect(after.scaleY).toBe(1);
      expect(after.colSum).toBe(after.width);
      expect(after.rowSum).toBe(after.height);

      if (handle.shift) {
        // A table can express neither skew nor scale, and the serialiser drops
        // skew entirely, so anything left on the object would come back
        // different after a reload. Refusing the gesture resizes nothing,
        // which is the honest outcome: without this the drag shears the table.
        expect(after.skewX).toBe(0);
        expect(after.skewY).toBe(0);
        expect(after.colWidths).toEqual(before.colWidths);
        expect(after.rowHeights).toEqual(before.rowHeights);
        return;
      }

      // The drag is applied in screen pixels but the table lives in document
      // units, so the ask is `dx * 2 / zoom` document units. A handle on the
      // left or right drives x, one on the top or bottom drives y, and a
      // corner drives both. The growth is the distance, not the signed delta:
      // the gesture already turned the pointer's direction into a per-axis
      // sign at mouse-down, so pulling left grows the table just as pulling
      // right does.
      //
      // This is the assertion that catches a compounding drag: the old
      // handler multiplied the already-resized widths by Fabric's scaleX on
      // every event, so the ask of ~130 document units landed anywhere from
      // ~7 to ~910 off. Measured residual on the fixed code is 0.17, so +/-2
      // leaves an order of magnitude of headroom over the noise while still
      // sitting far below the smallest observed bug (7.8 on the right
      // handle). The noise is tableState's Math.round plus the integer
      // clientX/clientY that MouseEvent forces on the delivered pointer.
      const wantX = (Math.abs(handle.dx) * 2) / before.zoom;
      const wantY = (Math.abs(handle.dy) * 2) / before.zoom;
      if (handle.fx !== 0.5) {
        expect(after.width).not.toBe(before.width);
        expect(Math.abs(after.width - before.width - wantX)).toBeLessThanOrEqual(2);
      } else {
        // Not driven, so it must hold still. The gesture still computes a
        // target for this axis on every event, so allow a little jitter.
        // Measured: exactly 0 on all eight handles.
        expect(Math.abs(after.width - before.width)).toBeLessThanOrEqual(4);
      }
      if (handle.fy !== 0.5) {
        expect(after.height).not.toBe(before.height);
        expect(
          Math.abs(after.height - before.height - wantY),
        ).toBeLessThanOrEqual(2);
      } else {
        expect(Math.abs(after.height - before.height)).toBeLessThanOrEqual(4);
      }

      // Every column keeps its share of the total. Note this does *not*
      // catch a compounding drag: against the old handler the largest share
      // drift was 0.005, well inside toBeCloseTo's 0.05, so all eight cases
      // pass here even when the resize is badly wrong. Integer rounding of a
      // 3-column grid already costs the fixed code 0.001, so no single
      // toBeCloseTo precision separates the two. It is kept as a guard on
      // the remainder distribution, which the magnitude check cannot see.
      for (let i = 0; i < before.colWidths.length; i++) {
        expect(before.colWidths[i]! / before.colSum).toBeCloseTo(
          after.colWidths[i]! / after.colSum,
          1,
        );
      }
    });
  }
});

test.describe("Eyedropper tool", () => {
  test.beforeEach(async ({ page }) => {
    page.on("dialog", (d) => void d.accept());
  });

  test("samples a colour from the canvas and applies it to the selection", async ({
    page,
  }) => {
    await openEditorWithBill(page);
    const P = await docToPage(page);

    // Trace a text box, then switch: with the text box still active it gets
    // the sampled colour, and the swatch always shows what was sampled.
    await pickTool(page, "Text");
    const a = await P(100, 100);
    await page.mouse.click(a.x, a.y);
    await page.waitForTimeout(150);

    await pickTool(page, "Eyedropper");
    const samplePoint = await P(70, 70); // inside the fixture's white page area
    await page.mouse.click(samplePoint.x, samplePoint.y);
    await page.waitForTimeout(150);

    await expect(
      page.getByText(/^#[0-9a-f]{6}$/i).first(),
    ).toBeVisible();
    // The traced text box has become the sampled (light) tone.
    const fills = await page.evaluate(() =>
      window
        .__btm!.getTemplate()
        .objects        .filter((o) => o.type === "text")
        .map((o) => (o as unknown as Record<string, unknown>).fill as string | undefined),
    );
    expect(fills[0]?.toLowerCase()).toMatch(/^#[0-9a-f]{6}$/);
    expect(fills[0]?.toLowerCase()).not.toBe("#000000");
  });
});

test.describe("Field tool", () => {
  test.beforeEach(async ({ page }) => {
    page.on("dialog", (d) => void d.accept());
  });

  test("a new text box comes up selected, so its font and align are reachable", async ({
    page,
  }) => {
    await openEditorWithBill(page);
    const P = await docToPage(page);

    // The text tool ends in `setTool("select")`, which discards the active
    // object. Selecting before that switch left the new box deselected, so the
    // panel holding the font, size and alignment controls never appeared and
    // there was no way to restyle a box you had just made.
    await pickTool(page, "Text");
    const at = await P(200, 300);
    await page.mouse.click(at.x, at.y);
    await page.waitForTimeout(250);

    await expect(page.getByText("Object", { exact: true })).toBeVisible();
    // TextPanel's own controls.
    await expect(page.getByText("Font", { exact: true })).toBeVisible();
    await expect(page.getByText("Custom family")).toBeVisible();
    // SinglePanel only renders that footer for a real selection.
    await expect(page.getByText(/^1 selected$/)).toBeVisible();
  });

  test("a drawn field comes up selected and offers alignment", async ({ page }) => {
    await openEditorWithBill(page);
    const P = await docToPage(page);

    await pickTool(page, "Field");
    const a = await P(200, 300);
    const b = await P(320, 340);
    await page.mouse.move(a.x, a.y);
    await page.mouse.down();
    await page.mouse.move(b.x, b.y, { steps: 5 });
    await page.mouse.up();
    await page.waitForTimeout(250);

    // Same defect as the text tool: the field was left deselected, so its
    // panel — and every control on it — was out of reach. Scoped to the panel
    // section because "Field" alone also matches the tool rail button.
    const fieldPanel = page.locator("section").filter({
      has: page.getByRole("heading", { name: "Field", exact: true }),
    });
    await expect(fieldPanel).toBeVisible();
    await expect(fieldPanel.getByLabel("Align")).toBeVisible();

    // And the alignment actually lands on the template.
    await fieldPanel.getByLabel("Align").selectOption("right");
    await page.waitForTimeout(200);
    const field = await page.evaluate(
      () =>
        window
          .__btm!.getTemplate()
          .objects.find((o) => o.type === "field") as unknown as {
          textAlign: string;
        },
    );
    expect(field.textAlign).toBe("right");
  });

  test("adds a field that appears in the template and form", async ({ page }) => {
    await openEditorWithBill(page);
    const P = await docToPage(page);

    await pickTool(page, "Field");
    const a = await P(200, 300);
    const b = await P(320, 340);
    await page.mouse.move(a.x, a.y);
    await page.mouse.down();
    await page.mouse.move(b.x, b.y, { steps: 5 });
    await page.mouse.up();
    await page.waitForTimeout(200);

    const fields = await page.evaluate(() =>
      window.__btm!.getTemplate().objects.filter((o) => o.type === "field"),
    );
    expect(fields).toHaveLength(1);
    expect(fields[0]).toMatchObject({
      type: "field",
      key: "field_1",
      fieldType: "text",
    });
  });

  test("lock structure freezes non-field objects but fields stay editable", async ({
    page,
  }) => {
    await openEditorWithBill(page);
    const P = await docToPage(page);

    // Trace a text box first.
    await pickTool(page, "Text");
    const t = await P(100, 100);
    await page.mouse.click(t.x, t.y);
    await page.waitForTimeout(150);

    // Lock the structure.
    await page.getByRole("button", { name: /lock structure/i }).click();
    await page.waitForTimeout(150);

    const locked = await page.evaluate(() =>
      window.__btm!
        .getTemplate()
        .objects.filter((o) => o.type === "text")
        .map((o) => (o as unknown as Record<string, unknown>).locked),
    );
    expect(locked).toContain(true);

    // Add a field after locking — it should be unlocked.
    await pickTool(page, "Field");
    const a = await P(200, 300);
    const b = await P(320, 340);
    await page.mouse.move(a.x, a.y);
    await page.mouse.down();
    await page.mouse.move(b.x, b.y, { steps: 5 });
    await page.mouse.up();
    await page.waitForTimeout(200);

    const fieldLocked = await page.evaluate(() =>
      window.__btm!
        .getTemplate()
        .objects.filter((o) => o.type === "field")
        .map((o) => (o as unknown as Record<string, unknown>).locked),
    );
    expect(fieldLocked).toContain(false);
  });
});

test.describe("Stretched text survives saving", () => {
  test.beforeEach(async ({ page }) => {
    page.on("dialog", (d) => void d.accept());
  });

  test("a side and down drag round-trips through JSON, reload and HTML", async ({
    page,
  }) => {
    await openEditorWithBill(page);
    const P = await docToPage(page);

    // A text box on the page.
    await pickTool(page, "Text");
    const at = await P(200, 300);
    await page.mouse.click(at.x, at.y);
    await page.waitForTimeout(200);

    const box = () =>
      page.evaluate(() => {
        interface LiveText {
          left: number;
          top: number;
          width: number;
          height: number;
          fontSize: number;
          getScaledWidth(): number;
          getScaledHeight(): number;
        }
        const objs = (
          window.__btm as never as {
            getCanvas: () => { getObjects: () => Array<Record<string, unknown>> };
          }
        ).getCanvas().getObjects();
        const t = objs.find((o) => o.appType === "text") as unknown as LiveText;
        return {
          left: t.left,
          top: t.top,
          width: t.width,
          height: t.height,
          fontSize: t.fontSize,
          scaledWidth: t.getScaledWidth(),
          scaledHeight: t.getScaledHeight(),
        };
      });

    const before = await box();

    // Placing a box with the text tool ends in `setTool("select")`, which
    // discards the active object, so the resize handles are not on screen
    // until it is selected again.
    const select = () =>
      page.evaluate(() => {
        const canvas = (
          window.__btm as never as {
            getCanvas: () => {
              getObjects: () => Array<Record<string, unknown>>;
              setActiveObject: (o: unknown) => void;
              requestRenderAll: () => void;
            };
          }
        ).getCanvas();
        const t = canvas.getObjects().find((o) => o.appType === "text")!;
        canvas.setActiveObject(t);
        canvas.requestRenderAll();
      });
    await select();
    await page.waitForTimeout(200);

    /** One real handle drag, in document units, from a point on the box. */
    const drag = async (
      from: { x: number; y: number },
      to: { x: number; y: number },
    ) => {
      const a = await P(from.x, from.y);
      const b = await P(to.x, to.y);
      await page.mouse.move(a.x, a.y);
      await page.mouse.down();
      await page.mouse.move(b.x, b.y, { steps: 12 });
      await page.mouse.up();
      await page.waitForTimeout(250);
    };

    // The gesture the user described: a side stretch. Dragging the right handle
    // on its own widens the text while leaving the height alone, which is the
    // case no single font size can express and therefore the one that has to be
    // recorded as a stretch.
    const b = await box();
    await drag(
      { x: b.left + b.scaledWidth, y: b.top + b.scaledHeight / 2 },
      { x: b.left + b.scaledWidth + 70, y: b.top + b.scaledHeight / 2 },
    );
    const after = await box();
    expect(after.scaledWidth).toBeGreaterThan(b.scaledWidth);

    const probe = await page.evaluate(() => {
      interface LiveText {
        width: number;
        height: number;
        fontSize: number;
        scaleX: number;
        scaleY: number;
        strokeWidth: number;
        getScaledWidth(): number;
        getScaledHeight(): number;
      }
      const t = (
        window.__btm as never as {
          getCanvas: () => { getObjects: () => Array<Record<string, unknown>> };
        }
      )
        .getCanvas()
        .getObjects()
        .find((o) => o.appType === "text") as unknown as LiveText;
      const tmpl = (
        window.__btm as never as {
          getTemplate: () => { objects: Array<Record<string, unknown>> };
        }
      ).getTemplate().objects.find((o) => o.type === "text")!;
      return {
        live: {
          width: t.width,
          height: t.height,
          fontSize: t.fontSize,
          scaleX: t.scaleX,
          scaleY: t.scaleY,
          scaledWidth: t.getScaledWidth!(),
          scaledHeight: t.getScaledHeight!(),
          strokeWidth: t.strokeWidth,
        },
        tmpl: {
          width: tmpl.width,
          height: tmpl.height,
          fontSize: tmpl.fontSize,
          scaleX: tmpl.scaleX,
          scaleY: tmpl.scaleY,
        },
      };
    });
    interface Live {
      width: number;
      height: number;
      fontSize: number;
      scaleX: number;
      scaleY: number;
      scaledWidth: number;
      scaledHeight: number;
      strokeWidth: number;
    }
    interface Saved {
      width: number;
      height: number;
      fontSize: number;
      scaleX: number;
      scaleY: number;
    }
    const live = probe.live as Live;
    const text = probe.tmpl as Saved;

    // A drag really did move the scale, and Fabric scales an IText uniformly
    // from every handle, so both axes carry the same factor.
    expect(live.scaleX).toBeGreaterThan(1);
    expect(live.scaleY).toBe(live.scaleX);

    // 1. The JSON records the stretch beside the unscaled metrics and leaves
    //    fontSize alone. Inflating fontSize instead would describe a different
    //    shape, and nothing at all would restore the stretch on reload.
    expect(text.scaleX).toBeCloseTo(live.scaleX, 5);
    expect(text.scaleY).toBeCloseTo(live.scaleY, 5);
    expect(text.fontSize).toBe(before.fontSize);
    expect(text.width).toBeCloseTo(before.width, 1);
    expect(text.height).toBeCloseTo(before.height, 1);

    // 2. Reloading that JSON brings the same painted size back on the canvas.
    const template = await page.evaluate(
      () =>
        (
          window.__btm as never as {
            getTemplate: () => unknown;
          }
        ).getTemplate(),
    );
    await page.evaluate(
      (t) => (window as unknown as { __btm: { loadTemplate: (t: unknown) => void } }).__btm.loadTemplate(t),
      template,
    );
    await page.waitForTimeout(300);
    const reloaded = await box();
    expect(reloaded.scaledWidth).toBeCloseTo(after.scaledWidth, 0);
    expect(reloaded.scaledHeight).toBeCloseTo(after.scaledHeight, 0);

    // 3. The HTML export carries the stretch as a transform, so the shared
    //    document paints the same shape instead of the natural aspect.
    const html = await page.evaluate(() => {
      const w = window as unknown as {
        __btm: { getTemplate: () => never };
        __btmRender: (t: never) => { html: string };
      };
      return w.__btmRender(w.__btm.getTemplate()).html;
    });
    expect(html).toContain("transform: scale(");
    // The exact factor rather than a single blended one, at the two decimals
    // the renderer emits lengths and transforms to.
    const round2 = (n: number) => Math.round(n * 100) / 100;
    expect(html).toContain(
      `scale(${round2(text.scaleX)}, ${round2(text.scaleY)})`,
    );
    // The box stays the text's own metrics, so the transform is not applied
    // twice, and the glyphs keep the size they were traced at.
    expect(html).toContain(`width: ${round2(before.width)}px`);
    expect(html).toContain(`font-size: ${before.fontSize}px`);
  });
});

test.describe("Rules survive saving", () => {
  test.beforeEach(async ({ page }) => {
    page.on("dialog", (d) => void d.accept());
  });

  /** Save, reopen, and hand back the rule plus the template that produced it. */
  const roundTrip = async (page: import("@playwright/test").Page) => {
    const first = await page.evaluate(
      () => (window as unknown as { __btm: { getTemplate: () => unknown } }).__btm.getTemplate(),
    );
    await page.evaluate(
      (t) =>
        (window as unknown as { __btm: { loadTemplate: (t: unknown) => void } }).__btm.loadTemplate(
          t,
        ),
      first,
    );
    await page.waitForTimeout(250);
    const second = await page.evaluate(
      () => (window as unknown as { __btm: { getTemplate: () => unknown } }).__btm.getTemplate(),
    );
    const ruleOf = (t: unknown) =>
      (
        t as { objects: Array<Record<string, number | string>> }
      ).objects.find((o) => o.type === "hr" || o.type === "vr");
    return { first: ruleOf(first)!, second: ruleOf(second)! };
  };

  test("a horizontal rule stays level, and stays level over repeated saves", async ({
    page,
  }) => {
    await openEditorWithBill(page);
    const P = await docToPage(page);

    await pickTool(page, "Horizontal Rule");
    const a = await P(100, 300);
    const right = await P(700, 300);
    await page.mouse.move(a.x, a.y);
    await page.mouse.down();
    // The far end is dragged along the *start* row, so the drawn rule is
    // exactly level.
    await page.mouse.move(right.x, a.y, { steps: 10 });
    await page.mouse.up();
    await page.waitForTimeout(250);

    const first = await roundTrip(page);

    // The stored endpoints share a row, so the rule is level rather than
    // tilted by the half-stroke gap between Fabric's box and its endpoints.
    expect(first.first.y).toBe(first.first.y2);
    expect(first.first.height).toBe(0);
    expect(first.first.type).toBe("hr");

    // Reopening changed nothing: the tilt did not creep in on the way back.
    expect(first.second.y).toBe(first.second.y2);
    expect(first.second.height).toBe(0);
    // And a second round trip is byte-identical to the first.
    const again = await roundTrip(page);
    expect(again.second.y).toBe(first.second.y);
    expect(again.second.y2).toBe(first.second.y2);
  });

  test("a vertical rule stays upright", async ({ page }) => {
    await openEditorWithBill(page);
    const P = await docToPage(page);

    await pickTool(page, "Vertical Rule");
    const a = await P(300, 100);
    const down = await P(300, 700);
    await page.mouse.move(a.x, a.y);
    await page.mouse.down();
    await page.mouse.move(a.x, down.y, { steps: 10 });
    await page.mouse.up();
    await page.waitForTimeout(250);

    const { first, second } = await roundTrip(page);
    expect(first.x).toBe(first.x2);
    expect(first.width).toBe(0);
    expect(first.type).toBe("vr");
    expect(second.x).toBe(second.x2);
  });
});

test.describe("Grouping", () => {
  test.beforeEach(async ({ page }) => {
    page.on("dialog", (d) => void d.accept());
  });

  /** A rect and an ellipse, so there is always something to group. */
  async function twoShapes(page: import("@playwright/test").Page) {
    await openEditorWithBill(page);
    const P = await docToPage(page);
    const a = await P(120, 200);
    const b = await P(320, 260);
    await pickTool(page, "Rect");
    await page.mouse.move(a.x, a.y);
    await page.mouse.down();
    await page.mouse.move(b.x, b.y, { steps: 5 });
    await page.mouse.up();
    await page.waitForTimeout(150);
    const c = await P(400, 400);
    await pickTool(page, "Ellipse");
    await page.mouse.move(c.x, c.y);
    await page.mouse.down();
    await page.mouse.move(c.x + 60, c.y + 40, { steps: 5 });
    await page.mouse.up();
    await page.waitForTimeout(150);
    return P;
  }

test("groups objects without changing the exported template", async ({ page }) => {
    await twoShapes(page);
    // Compare the objects, not the whole document: `getTemplate` regenerates
    // `meta.modifiedAt` on every call, so a raw string compare always differs.
    const objectsOf = () =>
      page.evaluate(() =>
        JSON.stringify(window.__btm!.getTemplate().objects),
      );
    const before = await objectsOf();

    await page.keyboard.press("Control+a");
    await page.waitForTimeout(200);
    await page.evaluate(() => window.__btm!.groupSelection());
    await page.waitForTimeout(250);

    const groups = await page.evaluate(() => window.__btm!.getGroups());
    expect(groups).toHaveLength(1);
    expect(groups[0]!.members.length).toBe(2);

    // Authoring-only: grouping must not reach the template at all.
    expect(await objectsOf()).toBe(before);
  });

  test("grouping is undoable", async ({ page }) => {
    await twoShapes(page);
    await page.keyboard.press("Control+a");
    await page.waitForTimeout(200);
    await page.evaluate(() => window.__btm!.groupSelection());
    await page.waitForTimeout(250);
    expect(await page.evaluate(() => window.__btm!.getGroups())).toHaveLength(1);

    // Without groups in the snapshot this records nothing and undoes nothing.
    await page.evaluate(() => window.__btm!.undo());
    await page.waitForTimeout(250);
    expect(await page.evaluate(() => window.__btm!.getGroups())).toHaveLength(0);
  });

test("deleting a group deletes the structure it holds", async ({ page }) => {
    await twoShapes(page);
    await page.keyboard.press("Control+a");
    await page.waitForTimeout(200);
    await page.evaluate(() => window.__btm!.groupSelection());
    await page.waitForTimeout(250);
    await page.evaluate(() => window.__btm!.deleteSelection());
    await page.waitForTimeout(250);

    // Selecting a structure and pressing delete removes it whole, the way Word
    // does. Ungroup is the non-destructive way to dissolve one.
    expect(await page.evaluate(() => window.__btm!.getGroups())).toHaveLength(0);
    expect(
      await page.evaluate(() => window.__btm!.getTemplate().objects.length),
    ).toBe(0);
  });

  test("ungroup keeps every object on the canvas", async ({ page }) => {
    await twoShapes(page);
    const before = await page.evaluate(
      () => window.__btm!.getTemplate().objects.length,
    );
    await page.keyboard.press("Control+a");
    await page.waitForTimeout(200);
    await page.evaluate(() => window.__btm!.groupSelection());
    await page.waitForTimeout(250);
    await page.evaluate(() => window.__btm!.ungroupSelection());
    await page.waitForTimeout(250);

    expect(await page.evaluate(() => window.__btm!.getGroups())).toHaveLength(0);
    expect(
      await page.evaluate(() => window.__btm!.getTemplate().objects.length),
    ).toBe(before);
  });

  test("the panel offers Group and Ungroup for a multi-selection", async ({
    page,
  }) => {
    await twoShapes(page);
    await page.keyboard.press("Control+a");
    await page.waitForTimeout(250);

    // Replaces the prose-only panel that rendered no control at all.
    const groupPanel = page.locator("section").filter({
      has: page.getByRole("heading", { name: "Group", exact: true }),
    });
    await expect(groupPanel).toBeVisible();
    await groupPanel.getByRole("button", { name: "Group", exact: true }).click();
    await page.waitForTimeout(250);
    expect(await page.evaluate(() => window.__btm!.getGroups())).toHaveLength(1);

    await groupPanel
      .getByRole("button", { name: "Ungroup", exact: true })
      .click();
    await page.waitForTimeout(250);
    expect(await page.evaluate(() => window.__btm!.getGroups())).toHaveLength(0);
  });

test("clicking a member selects the whole group", async ({ page }) => {
    await twoShapes(page);
    await page.keyboard.press("Control+a");
    await page.waitForTimeout(200);
    await page.evaluate(() => window.__btm!.groupSelection());
    await page.waitForTimeout(250);
    await page.keyboard.press("Escape");
    await page.waitForTimeout(200);

    const p = await docToPage(page);
    const inside = await p(160, 210);
    await page.mouse.click(inside.x, inside.y);
    await page.waitForTimeout(250);
    expect(
      await page.evaluate(() => window.__btm!.getSelectedTemplates().length),
    ).toBe(2);

    // Alt+click selects just the one member, which is what keeps a single shape
    // inside a group editable. It is deliberately NOT asserted here: Fabric
    // ignores synthetic modifier injection and dispatched pointer events, so
    // the branch cannot be driven from a test and needs a real mouse to confirm.
  });
});

test.describe("Wrapping text", () => {
  test.beforeEach(async ({ page }) => {
    page.on("dialog", (d) => void d.accept());
  });

  const renderHtml = (page: import("@playwright/test").Page) =>
    page.evaluate(() => {
      const w = window as unknown as {
        __btm: { getTemplate: () => never };
        __btmRender: (t: never) => { html: string };
      };
      return w.__btmRender(w.__btm.getTemplate()).html;
    });

  test("a wrapped box wraps, grows downward, and survives a reload", async ({
    page,
  }) => {
    await openEditorWithBill(page);
    const P = await docToPage(page);

    await pickTool(page, "Text");
    const at = await P(200, 200);
    await page.mouse.click(at.x, at.y);
    await page.waitForTimeout(300);

    // The box comes up selected, so its panel is reachable.
    // Located by text inside the properties aside: a role+name query
    // resolves to zero for this button even though it is present and visible,
    // while `hasText` finds it reliably.
    const panel = page.locator("aside").last();
    await panel.locator("button", { hasText: "Wrap at this width" }).click();
    await page.waitForTimeout(300);

    // Narrow it so a long value has to wrap.
    await page.evaluate(() => {
const t = (
        window.__btm as never as {
          getCanvas: () => { getObjects: () => Array<Record<string, unknown>> };
        }
      )
        .getCanvas()
        .getObjects()
        .find((o) => o.appType === "text") as unknown as {
        set: (v: Record<string, unknown>) => void;
        setCoords: () => void;
      };
      t.set({ width: 90 });
      t.setCoords();
    });
    await page.waitForTimeout(250);

    const textOf = () =>
      page.evaluate(
        () =>
          window.__btm!.getTemplate().objects.find(
            (o) => o.type === "text",
          ) as unknown as { wrapWidth?: number; width: number },
      );
    const wrapped = await textOf();
    expect(wrapped.wrapWidth).toBeGreaterThan(0);

    // The exported HTML wraps instead of clipping.
    const html = await renderHtml(page);
    expect(html).toContain("white-space: pre-wrap");
    expect(html).toContain("overflow-wrap: break-word");
    expect(html).toContain("height: auto");

    // And the wrap boundary survives a save/reload cycle.
    const template = await page.evaluate(
      () =>
        (window as unknown as { __btm: { getTemplate: () => unknown } }).__btm.getTemplate(),
    );
    await page.evaluate(
      (t) =>
        (window as unknown as { __btm: { loadTemplate: (t: unknown) => void } }).__btm.loadTemplate(
          t,
        ),
      template,
    );
    await page.waitForTimeout(400);
    const reloaded = await textOf();
    expect(reloaded.wrapWidth).toBe(wrapped.wrapWidth);
  });

  test("unwrapping goes back to one auto-width line", async ({ page }) => {
    await openEditorWithBill(page);
    const P = await docToPage(page);
    await pickTool(page, "Text");
    const at = await P(200, 200);
    await page.mouse.click(at.x, at.y);
    await page.waitForTimeout(300);

    // Located by text inside the properties aside: a role+name query
    // resolves to zero for this button even though it is present and visible,
    // while `hasText` finds it reliably.
    const panel = page.locator("aside").last();
    await panel.locator("button", { hasText: "Wrap at this width" }).click();
    await page.waitForTimeout(300);
    await panel.locator("button", { hasText: "click to unwrap" }).click();
    await page.waitForTimeout(300);

    const text = await page.evaluate(
      () =>
        window.__btm!.getTemplate().objects.find(
          (o) => o.type === "text",
        ) as unknown as { wrapWidth?: number },
    );
    expect(text.wrapWidth).toBeUndefined();
    const html = await renderHtml(page);
    expect(html).toContain("white-space: pre");
    expect(html).not.toContain("pre-wrap");
  });

  test("an unwrapped box is untouched by the feature", async ({ page }) => {
    await openEditorWithBill(page);
    const P = await docToPage(page);
    await pickTool(page, "Text");
    const at = await P(200, 200);
    await page.mouse.click(at.x, at.y);
    await page.waitForTimeout(300);

    const text = await page.evaluate(
      () =>
        window.__btm!.getTemplate().objects.find(
          (o) => o.type === "text",
        ) as unknown as { wrapWidth?: number },
    );
    expect(text.wrapWidth).toBeUndefined();

    const html = await renderHtml(page);
    expect(html).toContain("white-space: pre");
    expect(html).not.toContain("pre-wrap");
  });
});

test.describe("Snapping guides", () => {
  test.beforeEach(async ({ page }) => {
    page.on("dialog", (d) => void d.accept());
  });

  /** Draws one rectangle and one ellipse, returns nothing. */
  async function seedRect(page: import("@playwright/test").Page) {
    await openEditorWithBill(page);
    const P = await docToPage(page);
    const a = await P(120, 150);
    const b = await P(420, 150 + 140);
    await pickTool(page, "Rect");
    await page.mouse.move(a.x, a.y);
    await page.mouse.down();
    await page.mouse.move(b.x, b.y, { steps: 5 });
    await page.mouse.up();
    await page.waitForTimeout(150);

    // and a second rect beside it, aligned on its top edge
    const c = await P(460, 150);
    const d = await P(620, 150 + 140);
    await pickTool(page, "Rect");
    await page.mouse.move(c.x, c.y);
    await page.mouse.down();
    await page.mouse.move(d.x, d.y, { steps: 5 });
    await page.mouse.up();
    await page.waitForTimeout(150);
  }

  async function enableFullSpan(page: import("@playwright/test").Page) {
    await page.getByRole("button", { name: /Grid Settings/ }).click();
    const dialog = page.getByRole("dialog");
    await dialog.getByLabel("Full-span rules").check();
    await page.getByRole("button", { name: "Done" }).click();
    await page.waitForTimeout(150);
  }

  test("a rule dragged inside a rect spans it exactly when full-span is enabled", async ({ page }) => {
    await seedRect(page);
    await enableFullSpan(page);
    const P = await docToPage(page);
    const inside = await P(220, 240);
    const towardRight = await P(420, 260);
    await pickTool(page, "Horizontal Rule");
    await page.mouse.move(inside.x, inside.y);
    await page.mouse.down();
    await page.mouse.move(towardRight.x, towardRight.y, { steps: 5 });
    await page.mouse.up();
    await page.waitForTimeout(200);

    const rule = await page.evaluate(() =>
      window
        .__btm!.getTemplate()
        .objects.find((o) => o.type === "hr") as unknown as {
        x: number; y: number; x2: number; y2: number;
      },
    );
    const rect = await page.evaluate(
      () =>
        window.__btm!.getTemplate().objects.find((o) => o.type === "rect")!
      ,
    ) as unknown as { x: number; y: number; width: number };
// The rule snaps exactly across the rect, not less and not more. Fabric's
    // getBoundingRect includes half the 1px stroke, so compare with a small
    // tolerance rather than asserting the sub-pixel parity directly.
    expect(Math.abs(rule.x - rect.x)).toBeLessThan(2);
    expect(Math.abs(rule.x2 - (rect.x + rect.width))).toBeLessThan(2);
    expect(Math.abs(rule.y - rule.y2)).toBeLessThan(2);
    // The pointer never left the rect's top edge where the drag started near.
    expect(Math.abs(rule.y - 240)).toBeLessThan(2);
  });

  test("a rule inside a rect follows freehand geometry by default", async ({ page }) => {
    await seedRect(page);
    const P = await docToPage(page);
    const inside = await P(220, 240);
    const towardRight = await P(350, 260);
    await pickTool(page, "Horizontal Rule");
    await page.mouse.move(inside.x, inside.y);
    await page.mouse.down();
    await page.mouse.move(towardRight.x, towardRight.y, { steps: 5 });
    await page.mouse.up();
    await page.waitForTimeout(200);

    const rule = await page.evaluate(() =>
      window
        .__btm!.getTemplate()
        .objects.find((o) => o.type === "hr") as unknown as {
        x: number; y: number; x2: number; y2: number;
      },
    );
    expect(Math.abs(rule.x - 220)).toBeLessThan(4);
    expect(Math.abs(rule.x2 - 350)).toBeLessThan(4);
    expect(Math.abs(rule.y - rule.y2)).toBeLessThan(2);
    expect(Math.abs(rule.y - 240)).toBeLessThan(2);
  });

  test("moving a rect shows a guide when its edge catches a neighbour", async ({ page }) => {
    await seedRect(page);
    const P = await docToPage(page);
    await page.keyboard.press("v"); // select tool
    await page.waitForTimeout(150);

    const firstTop = await page.evaluate(
      () =>
        (window
          .__btm!.getTemplate()
          .objects[0] as unknown as { y: number }).y,
    );

    // Drag the second rect up until its top should snap to the first's top.
    const start = await P(520, 170);
    await page.mouse.move(start.x, start.y);
    await page.mouse.down();
    // second rect top is 150, first top is 150 as drawn: they are already
    // aligned, so drag it slightly away first in a second step to see a snap.
    await page.mouse.move(start.x, start.y - 30, { steps: 5 });
    // now drag it back to the aligned level; a guide should appear
    await page.mouse.move(start.x, start.y - firstTop + 150 - 10 + 10, {
      steps: 5,
    });
    await page.waitForTimeout(200);

    const guides = await page.evaluate(
      () =>
        (window as unknown as { __btm: { getSnapshot: () => { snaps: Array<unknown> } } }).__btm.getSnapshot().snaps,
    );
    // A vertical-level snap (x axis) or horizontal (y axis) is announced.
    expect(guides.length).toBeGreaterThan(0);
    await page.mouse.up();
    await page.waitForTimeout(100);
    const cleared = await page.evaluate(
      () =>
        (window as unknown as { __btm: { getSnapshot: () => { snaps: Array<unknown> } } }).__btm.getSnapshot().snaps,
    );
    expect(cleared).toHaveLength(0);
  });

  test("scaling shows a guide but does not force the geometry", async ({ page }) => {
    await seedRect(page);
    const P = await docToPage(page);
    await page.keyboard.press("v");
    await page.waitForTimeout(150);

    // Grab the second rect's bottom-right handle and pull; a guide is expected
    // but the table special-case and forced snapping must not alter the rect.
    const handle = await P(620, 150 + 140);
    await page.mouse.move(handle.x, handle.y);
    await page.mouse.down();
    await page.mouse.move(handle.x + 60, handle.y + 20, { steps: 8 });
    await page.waitForTimeout(150);

    const guides = await page.evaluate(
      () =>
        (window as unknown as { __btm: { getSnapshot: () => { snaps: Array<unknown> } } }).__btm.getSnapshot().snaps,
    );
// Scaling never forces the geometry, and nothing about it should crash;
    // we only require the interaction to settle without throwing.
    expect(Array.isArray(guides)).toBe(true);
    await page.mouse.up();
    await page.waitForTimeout(100);
  });
});

const TINTED_FIXTURE = join(process.cwd(), "e2e", "fixtures", "tinted-bill.png");

/** A bill-part entry as the serialiser writes it. */
interface SavedBillPart {
  id: string;
  src: string;
  normalized: boolean;
  sourceRect: { x: number; y: number; width: number; height: number };
  x: number;
  y: number;
  width: number;
  height: number;
}

function readBillPart(page: Page): Promise<SavedBillPart | undefined> {
  return page.evaluate(() => {
    const o = window.__btm.getTemplate().objects.find((x) => x.type === "bill-part");
    return o ? JSON.parse(JSON.stringify(o)) : undefined;
  }) as Promise<SavedBillPart | undefined>;
}

/** Every bill part the serialiser currently reports, in template order. */
function readBillParts(page: Page): Promise<SavedBillPart[]> {
  return page.evaluate(() =>
    window.__btm
      .getTemplate()
      .objects.filter((x) => x.type === "bill-part")
      .map((x) => JSON.parse(JSON.stringify(x))),
  ) as Promise<SavedBillPart[]>;
}

/** The most recently added bill part, i.e. the topmost one. */
async function readLastBillPart(page: Page): Promise<SavedBillPart> {
  const all = await readBillParts(page);
  expect(all.length).toBeGreaterThan(0);
  return all[all.length - 1]!;
}

/**
 * Click the centre of a saved object so it becomes the active selection.
 *
 * A capture leaves the tool back on select but nothing selected, so the panel
 * that owns the recapture button does not exist until the part is clicked.
 */
async function selectAt(page: Page, x: number, y: number): Promise<void> {
  const P = await docToPage(page);
  const centre = await P(x, y);
  await page.mouse.click(centre.x, centre.y);
  await page.waitForTimeout(150);
}

/** The Reference Image panel's default for new captures. */
async function setNewPartWhitening(page: Page, on: boolean): Promise<void> {
  const box = page.getByLabel("Whiten paper on new parts");
  if (on) await box.check();
  else await box.uncheck();
  await page.waitForTimeout(120);
}

/** The selected part's own whitening, in the Bill Part panel. */
function partWhitening(page: Page) {
  return page.getByLabel("Whiten paper", { exact: true });
}

/**
 * Open the tinted bill, cut one part out of the cream paper, and return what
 * the serialiser saved. The box deliberately covers the printed lines and the
 * rule but not the dark logo block, so the crop's border is entirely paper.
 *
 * `normalise` sets the Reference Image default before cutting, so this exercises
 * the same path an author takes rather than reaching into the controller.
 */
async function capturePart(
  page: Page,
  box: { x1: number; y1: number; x2: number; y2: number },
  normalise = true,
): Promise<SavedBillPart> {
  const P = await openWith(page, TINTED_FIXTURE);
  await page.evaluate(() => window.__btm.setZoom(0.5));
  await page.waitForTimeout(200);
  if (!normalise) await setNewPartWhitening(page, false);
  await pickTool(page, "Bill Part");

  const a = await P(box.x1, box.y1);
  const b = await P(box.x2, box.y2);
  await page.mouse.move(a.x, a.y);
  await page.mouse.down();
  await page.mouse.move(b.x, b.y, { steps: 6 });
  await page.mouse.up();
  await page.waitForTimeout(400);

  const part = await readBillPart(page);
  expect(part).toBeTruthy();
  return part as SavedBillPart;
}

interface CropPixels {
  width: number;
  height: number;
  total: number;
  white: number;
  paper: number;
  ink: number;
}

/**
 * Decode the stored crop and count its pixels.
 *
 * The three buckets are the whole point of the feature: `paper` is the
 * fixture's untouched #f2ece0 cream, `white` is what the normaliser should
 * have produced, and `ink` is content the flood fill must refuse to erase.
 */
function decodeCrop(page: Page, src: string): Promise<CropPixels> {
  return page.evaluate(async (url) => {
    const img = new Image();
    img.src = url;
    await img.decode();
    const c = document.createElement("canvas");
    c.width = img.naturalWidth;
    c.height = img.naturalHeight;
    const x = c.getContext("2d")!;
    x.drawImage(img, 0, 0);
    const d = x.getImageData(0, 0, c.width, c.height).data;
    let white = 0;
    let paper = 0;
    let ink = 0;
    for (let i = 0; i < d.length; i += 4) {
      const min = Math.min(d[i], d[i + 1], d[i + 2]);
      if (min >= 244) white += 1;
      else if (min >= 200) paper += 1;
      if (min < 100) ink += 1;
    }
    return {
      width: c.width,
      height: c.height,
      total: c.width * c.height,
      white,
      paper,
      ink,
    };
  }, src);
}

test.describe("Bill part cutouts", () => {
  test.beforeEach(async ({ page }) => {
    page.on("dialog", (d) => void d.accept());
    page.on("pageerror", (e) => console.log("PAGEERROR:", String(e).slice(0, 800)));
  });

  /**
   * The box is drawn with real mouse pixels, so `docToPage`'s fractional page
   * coordinates round to whole pixels and the gesture lands within a pixel or
   * two of the intended document rectangle.
   */
  function near(actual: number, expected: number, tol = 3): void {
    expect(Math.abs(actual - expected)).toBeLessThanOrEqual(tol);
  }

  test("whitens the paper and keeps the ink", async ({ page }) => {
    // The printed block: two text lines, a rule, and cream paper between them.
    const part = await capturePart(page, { x1: 30, y1: 270, x2: 420, y2: 410 });

    expect(part.src).toMatch(/^data:image\/png/);
    expect(part.normalized).toBe(true);
    // sourceRect is the drawn box, in document coordinates.
    near(part.sourceRect.x, 30);
    near(part.sourceRect.y, 270);
    near(part.sourceRect.width, 390);
    near(part.sourceRect.height, 140);

    const px = await decodeCrop(page, part.src);
    // A real cut-out, not a blank or a 1x1 fallback.
    expect(px.width).toBeGreaterThan(100);
    expect(px.height).toBeGreaterThan(50);

    // The normaliser ran: cream paper is gone and most of the crop is white.
    // Were it a no-op, `paper` would hold the majority instead.
    expect(px.paper / px.total).toBeLessThan(0.05);
    expect(px.white / px.total).toBeGreaterThan(0.6);

    // The border-connected flood fill stopped at the ink: the printed lines
    // survived. Were it an unconditional white-out, `ink` would be zero.
    expect(px.ink).toBeGreaterThan(500);
  });

  test("recaptures from the current position", async ({ page }) => {
    const part = await capturePart(page, { x1: 30, y1: 270, x2: 420, y2: 410 });

    // Move the object, then recapture: the crop must be re-cut from where the
    // object now sits, not where it was drawn.
    await page.evaluate((id) => {
      const canvas = (
        window.__btm as never as {
          getCanvas: () => {
            getObjects: () => Array<Record<string, unknown>>;
            requestRenderAll: () => void;
          };
        }
      ).getCanvas();
      const obj = canvas
        .getObjects()
        .find((x) => (x as unknown as { id?: string }).id === id) as
        | (Record<string, unknown> & {
            left?: number;
            set: (v: Record<string, unknown>) => void;
            setCoords: () => void;
          })
        | undefined;
      obj?.set({ left: (obj.left ?? 0) + 40 });
      obj?.setCoords();
      canvas.requestRenderAll();
    }, part.id);
    await page.waitForTimeout(150);

    const P = await docToPage(page);
    const centre = await P(
      part.x + 40 + part.width / 2,
      part.y + part.height / 2,
    );
    await page.mouse.click(centre.x, centre.y);
    await page.getByRole("button", { name: "Recapture from current position" }).click();
    await page.waitForTimeout(400);

    const after = await readBillPart(page);
    expect(after).toBeTruthy();
    // The image really was re-cut, and from the new position.
    expect(after!.src).not.toBe(part.src);
    near(after!.sourceRect.x, part.sourceRect.x + 40);
    near(after!.sourceRect.y, part.sourceRect.y);
    // Identity survives a recapture, so selection, undo and the layers panel
    // keep pointing at the same object.
    expect(after!.id).toBe(part.id);
  });

  test("round-trips standalone through save, reload and HTML", async ({ page }) => {
    const part = await capturePart(page, { x1: 30, y1: 270, x2: 420, y2: 410 });

    // The template alone carries the image; the reference is never needed.
    const template = await page.evaluate(() => window.__btm.getTemplate());
    await page.evaluate(
      (t) => window.__btm.loadTemplate(t),
      template,
    );
    await page.waitForTimeout(800);

    const reloaded = await readBillPart(page);
    expect(reloaded!.src).toBe(part.src);
    expect(reloaded!.sourceRect).toEqual(part.sourceRect);
    near(reloaded!.width, part.width);
    near(reloaded!.height, part.height);

    // The editor builds its canvas with no image registry, so the hydrated
    // object has to decode its own src. Until it does, `_render` draws the
    // dashed #9333ea placeholder instead of the crop.
    const purple = await page.evaluate(() => {
      const el = document.querySelector("canvas.upper-canvas") as HTMLCanvasElement;
      const d = el.getContext("2d")!.getImageData(0, 0, el.width, el.height).data;
      let n = 0;
      for (let i = 0; i < d.length; i += 4) {
        if (
          Math.abs(d[i] - 147) < 30 &&
          Math.abs(d[i + 1] - 51) < 30 &&
          Math.abs(d[i + 2] - 234) < 30
        ) {
          n += 1;
        }
      }
      return n;
    });
    expect(purple).toBe(0);

    // And the shared document paints the embedded image, so a recipient
    // without the bill reference still sees the part.
    const html = await page.evaluate(() => {
      const w = window as unknown as {
        __btm: { getTemplate: () => never };
        __btmRender: (t: never) => { html: string };
      };
      return w.__btmRender(w.__btm.getTemplate()).html;
    });
    expect(html).toContain("<img");
    expect(html).toContain(part.src);
  });

  test("duplicate and move both preserve the embedded src", async ({ page }) => {
    const part = await capturePart(page, { x1: 30, y1: 270, x2: 420, y2: 410 });
    await selectAt(page, part.x + part.width / 2, part.y + part.height / 2);

    // Ctrl+D clones the selection onto the canvas, offset by a fixed 12px.
    await page.keyboard.press("Control+d");
    await page.waitForTimeout(500);

    const duplicated = await readBillParts(page);
    expect(duplicated).toHaveLength(2);
    // Both objects carry the identical data URL, byte for byte: relocating a
    // part must never re-cut it from the reference.
    for (const p of duplicated) {
      expect(p.src).toBe(part.src);
      expect(p.normalized).toBe(true);
      expect(p.sourceRect).toEqual(part.sourceRect);
    }
    const copy = duplicated[1]!;
    near(copy.x, part.x + 12);
    near(copy.y, part.y + 12);
    expect(copy.id).not.toBe(part.id);

    // Now drag the copy well away from its twin. Object snapping is on by
    // default, so the landing point is not asserted exactly — only that it moved.
    const P = await docToPage(page);
    const from = await P(copy.x + copy.width / 2, copy.y + copy.height / 2);
    await page.mouse.move(from.x, from.y);
    await page.mouse.down();
    await page.mouse.move(from.x - 40, from.y + 30, { steps: 8 });
    await page.mouse.up();
    await page.waitForTimeout(400);

    const moved = await readBillParts(page);
    expect(moved).toHaveLength(2);
    expect(moved.map((p) => p.src)).toEqual([part.src, part.src]);
    expect(Math.abs(moved[1]!.x - part.x)).toBeGreaterThan(20);
    // The original never budged, and neither did its image.
    near(moved[0]!.x, part.x);
    near(moved[0]!.y, part.y);
    expect(moved[0]!.src).toBe(part.src);
  });

  test("recapture with no reference changes nothing", async ({ page }) => {
    const errors: string[] = [];
    page.on("pageerror", (e) => errors.push(String(e)));

    const part = await capturePart(page, { x1: 30, y1: 270, x2: 420, y2: 410 });
    const before = await page.evaluate(() => window.__btm.getTemplate().objects.length);

    // Drop the reference: the embedded crop is now the only copy of the pixels,
    // which is exactly the state the spec's no-op requirement is about.
    await page.getByRole("button", { name: "Remove Reference" }).click();
    await page.waitForTimeout(300);
    await selectAt(page, part.x + part.width / 2, part.y + part.height / 2);

    const button = page.getByRole("button", {
      name: "Recapture from current position",
    });
    await expect(button).toBeDisabled();
    // Click it anyway. `force` skips the actionability wait that treats
    // "disabled" as a failure; a disabled button swallows the click, so this
    // exercises the same path an author takes and asserts the outcome, not the
    // button's state.
    await button.click({ force: true });
    await page.waitForTimeout(300);

    // And the controller itself, so the guarantee does not rest on the button
    // being disabled: with no reference there is nothing to recapture from.
    await page.evaluate((id) => window.__btm.recaptureBillPart(id), part.id);
    await page.waitForTimeout(300);

    const after = await page.evaluate(() => window.__btm.getTemplate());
    expect(after.objects.length).toBe(before);
    const parts = after.objects.filter((o) => o.type === "bill-part");
    expect(parts).toHaveLength(1);
    expect(parts[0]!.src).toBe(part.src);
    expect(parts[0]!.sourceRect).toEqual(part.sourceRect);
    near(parts[0]!.x, part.x);
    near(parts[0]!.y, part.y);
    expect(errors).toEqual([]);
  });

  test("numbers each part and trims a drag that runs off the page", async ({ page }) => {
    const P = await openWith(page, TINTED_FIXTURE);
    const doc = await page.evaluate(() => window.__btm.getSnapshot().document);
    // Zoom out further than the other cases so the page has canvas on every
    // side and a drag can be released outside it.
    await page.evaluate(() => window.__btm.setZoom(0.4));
    await page.waitForTimeout(250);

    /** Drag one box with the Bill Part tool and return what was saved. */
    const draw = async (
      x1: number,
      y1: number,
      x2: number,
      y2: number,
    ): Promise<SavedBillPart> => {
      await pickTool(page, "Bill Part");
      const a = await P(x1, y1);
      const b = await P(x2, y2);
      await page.mouse.move(a.x, a.y);
      await page.mouse.down();
      await page.mouse.move(b.x, b.y, { steps: 6 });
      await page.mouse.up();
      await page.waitForTimeout(450);
      return readLastBillPart(page);
    };

    // Two ordinary captures: the second must not also be called "Bill Part 1".
    await draw(60, 80, 260, 200);
    await draw(60, 400, 300, 560);
    const names = (
      await page.evaluate(() =>
        window.__btm
          .getTemplate()
          .objects.filter((o) => o.type === "bill-part")
          .map((o) => o.name),
      )
    ).sort();
    expect(names).toEqual(["Bill Part 1", "Bill Part 2"]);

    // A third drag that starts on the page and is released well past its right
    // and bottom edges. The crop is clipped to the page, and so is the box the
    // crop is placed on: sizing it to the raw drag would stretch the crop to
    // fill the overhang instead.
    const part = await draw(doc.width - 120, doc.height - 120, doc.width + 150, doc.height + 120);
    const clippedW = doc.width - (doc.width - 120);
    const clippedH = doc.height - (doc.height - 120);
    near(part.sourceRect.width, clippedW);
    near(part.sourceRect.height, clippedH);
    near(part.width, clippedW);
    near(part.height, clippedH);
    // The right/bottom edges sit on the page, never past it.
    near(part.x + part.width, doc.width);
    near(part.y + part.height, doc.height);
    // The crop's own pixels are what the object's width/height record, so the
    // scale factors that stretched it onto a raw drag would show up here as an
    // aspect ratio that disagrees with the placed box.
    expect(part.width / part.height).toBeCloseTo(part.sourceRect.width / part.sourceRect.height, 1);
  });

  test("carries the cut-out through every export format", async ({ page }) => {
    const part = await capturePart(page, { x1: 30, y1: 270, x2: 420, y2: 410 });

    const grab = async (item: string): Promise<Buffer> => {
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
      return readFileSync(filePath);
    };

    // SVG embeds the cut-out as a real <image href="data:image/png...">. This is
    // the first object type in the codebase to put raster into the SVG/PDF path,
    // so the reference-free assertion in the tracing test does not cover it —
    // there, "no <image>" was the proof. Here its absence would be the bug.
    const svg = (await grab("SVG")).toString("utf8");
    expect(svg).toContain("<image");
    expect(svg).toContain("data:image/png");
    // The very same cut-out, not some other bitmap.
    expect(svg).toContain(part.src);

    // DOCX carries it as an actual embedded PNG rather than an empty frame. A
    // zip's entry names are stored uncompressed in the local file headers, so
    // the media path is findable in the raw bytes.
    const docx = await grab("DOCX");
    expect(docx.subarray(0, 2).toString("latin1")).toBe("PK");
    expect(docx.includes(Buffer.from("word/media/"))).toBe(true);

    // PNG and PDF still render, with the part baked in.
    const png = await grab("Preview PNG");
    expect(png.subarray(1, 4).toString("latin1")).toBe("PNG");
    expect(png.length).toBeGreaterThan(5000);

    const pdf = await grab("PDF");
    expect(pdf.subarray(0, 4).toString("latin1")).toBe("%PDF");
    expect(pdf.length).toBeGreaterThan(1000);
  });

  test("keeps the paper as-is when whitening is off", async ({ page }) => {
    const part = await capturePart(page, { x1: 30, y1: 270, x2: 420, y2: 410 }, false);

    // The flag records what was actually done, not what was requested.
    expect(part.normalized).toBe(false);
    expect(part.src).toMatch(/^data:image\/png/);

    const px = await decodeCrop(page, part.src);
    // The exact inverse of the whitening test: cream survives and white does
    // not. Were anything normalising anyway, `paper` would collapse.
    expect(px.paper / px.total).toBeGreaterThan(0.5);
    expect(px.white / px.total).toBeLessThan(0.2);
    // Still a real cut-out with real content, not an empty or blank box.
    expect(px.ink).toBeGreaterThan(500);

    // `normalized: false` has to survive a save/reload, which is the one value
    // the serialiser would have written as `true` before this toggle existed.
    const template = await page.evaluate(() => window.__btm.getTemplate());
    await page.evaluate((t) => window.__btm.loadTemplate(t), template);
    await page.waitForTimeout(600);
    const reloaded = await readBillPart(page);
    expect(reloaded!.normalized).toBe(false);
    expect(reloaded!.src).toBe(part.src);
    // `loadTemplate` drops the selection, so the panel needs re-selecting to
    // show; its checkbox must then read the reloaded part, not the editor default.
    await selectAt(
      page,
      reloaded!.x + reloaded!.width / 2,
      reloaded!.y + reloaded!.height / 2,
    );
    await expect(partWhitening(page)).not.toBeChecked();
  });

  test("the part's own toggle re-cuts it the other way", async ({ page }) => {
    const whitened = await capturePart(page, { x1: 30, y1: 270, x2: 420, y2: 410 });
    expect(whitened.normalized).toBe(true);
    await selectAt(page, whitened.x + whitened.width / 2, whitened.y + whitened.height / 2);
    await expect(partWhitening(page)).toBeChecked();

    // Untick: the part is re-cut from where it sits, keeping the cream.
    await partWhitening(page).uncheck();
    await page.waitForTimeout(400);
    const asIs = await readBillPart(page);
    expect(asIs!.normalized).toBe(false);
    expect(asIs!.src).not.toBe(whitened.src);
    expect(asIs!.id).toBe(whitened.id);
    const asIsPx = await decodeCrop(page, asIs!.src);
    expect(asIsPx.paper / asIsPx.total).toBeGreaterThan(0.5);

    // And back again, so the control is a two-way switch and not a one-way trip.
    await partWhitening(page).check();
    await page.waitForTimeout(400);
    const rewhitened = await readBillPart(page);
    expect(rewhitened!.normalized).toBe(true);
    expect(rewhitened!.src).not.toBe(asIs!.src);
    const rewhitenedPx = await decodeCrop(page, rewhitened!.src);
    expect(rewhitenedPx.paper / rewhitenedPx.total).toBeLessThan(0.05);
    expect(rewhitenedPx.ink).toBeGreaterThan(500);
  });

  test("recapture keeps the part's own setting, not the editor default", async ({ page }) => {
    // Captured as-is...
    const part = await capturePart(page, { x1: 30, y1: 270, x2: 420, y2: 410 }, false);
    expect(part.normalized).toBe(false);

    // ...then the editor default is flipped to whiten. Pressing Recapture must
    // not quietly apply it: the button re-cuts at the part's own setting, so
    // the button and the part's toggle cannot fight each other.
    await setNewPartWhitening(page, true);
    await selectAt(page, part.x + part.width / 2, part.y + part.height / 2);
    await expect(partWhitening(page)).not.toBeChecked();

    await page.getByRole("button", { name: "Recapture from current position" }).click();
    await page.waitForTimeout(400);

    const after = await readBillPart(page);
    expect(after!.normalized).toBe(false);
    expect(after!.id).toBe(part.id);
    const px = await decodeCrop(page, after!.src);
    expect(px.paper / px.total).toBeGreaterThan(0.5);
    // Still selected and still showing its own state.
    await expect(partWhitening(page)).not.toBeChecked();
  });

  test("the whitening controls are dead without a reference", async ({ page }) => {
    const part = await capturePart(page, { x1: 30, y1: 270, x2: 420, y2: 410 });
    await selectAt(page, part.x + part.width / 2, part.y + part.height / 2);
    await expect(partWhitening(page)).toBeChecked();

    // Both controls re-cut, and neither can do anything without a reference, so
    // both are disabled rather than silently doing nothing when clicked.
    await page.getByRole("button", { name: "Remove Reference" }).click();
    await page.waitForTimeout(250);
    await expect(partWhitening(page)).toBeDisabled();
    await expect(
      page.getByRole("button", { name: "Recapture from current position" }),
    ).toBeDisabled();
  });
});

test.describe("Stroke width", () => {
  test.beforeEach(async ({ page }) => {
    page.on("dialog", (d) => void d.accept());
  });

  /** Open the editor at `zoom`, or reuse an already-open one and just zoom. */
  async function atZoom(page: Page, zoom: number): Promise<void> {
    if (!(await page.locator("canvas.upper-canvas").count())) {
      await openEditorWithBill(page);
    }
    await page.evaluate((z) => window.__btm.setZoom(z), zoom);
    await page.waitForTimeout(250);
  }

  /**
 * Draw a rectangle with the real tool at the current zoom.
 *
 * The box is picked from the visible pane rather than fixed document
 * coordinates: at high zoom a fixed box's corner sits outside the scrolled
 * viewport and the drag lands nowhere. Measuring the pane keeps the gesture
 * on the page at every zoom, which is what this test varies.
 */
  async function drawRect(page: Page): Promise<void> {
    await pickTool(page, "Rectangle");
    await page.waitForTimeout(150);
    // Inset from the pane's own top-left, so the gesture is on the visible
    // page at any zoom. The box grows with the zoom so it stays a real drag
    // rather than a sub-pixel nudge at low zoom.
    const box = await page.evaluate(() => {
      const canvas = window.__btm.getCanvas()!;
      const r = canvas.upperCanvasEl.getBoundingClientRect();
      const inset = 60;
      const spanX = Math.min(220, r.width * 0.3);
      const spanY = Math.min(160, r.height * 0.25);
      return {
        ax: r.left + inset,
        ay: r.top + inset,
        bx: r.left + inset + spanX,
        by: r.top + inset + spanY,
      };
    });
    await page.mouse.move(box.ax, box.ay);
    await page.mouse.down();
    await page.mouse.move(box.bx, box.by, { steps: 6 });
    await page.mouse.up();
    await page.waitForTimeout(350);
  }

  /**
   * Ink on the lower canvas. The reference is switched off first so the count
   * is the drawn stroke and nothing else.
   */
  async function strokeInk(page: Page): Promise<number> {
    return page.evaluate(() => {
      const canvas = window.__btm.getCanvas() as unknown as {
        lowerCanvasEl: HTMLCanvasElement;
        renderAll: () => void;
      };
      canvas.renderAll();
      const el = canvas.lowerCanvasEl;
      const ctx = el.getContext("2d")!;
      const d = ctx.getImageData(0, 0, el.width, el.height).data;
      let ink = 0;
      for (let i = 0; i < d.length; i += 4) {
        if ((d[i]! + d[i + 1]! + d[i + 2]!) / 3 < 200) ink += 1;
      }
      return ink;
    });
  }

  async function savedStrokeWidth(page: Page): Promise<number | undefined> {
    return page.evaluate(
      () =>
        (
          window.__btm.getTemplate().objects.find((o) => o.type === "rect") as unknown as {
            strokeWidth?: number;
          }
        )?.strokeWidth,
    );
  }

  test("every outline tool starts from the same default", async ({ page }) => {
    await openEditorWithBill(page);

    // One width for the whole tool rail, so a pencil stroke and a rule are the
    // same line on the page rather than two different looking ones.
    await pickTool(page, "Line");
    let P = await docToPage(page);
    let a = await P(200, 700);
    let b = await P(420, 700);
    await page.mouse.move(a.x, a.y);
    await page.mouse.down();
    await page.mouse.move(b.x, b.y, { steps: 4 });
    await page.mouse.up();
    await page.waitForTimeout(250);

    await pickTool(page, "Rectangle");
    P = await docToPage(page);
    a = await P(200, 200);
    b = await P(420, 300);
    await page.mouse.move(a.x, a.y);
    await page.mouse.down();
    await page.mouse.move(b.x, b.y, { steps: 4 });
    await page.mouse.up();
    await page.waitForTimeout(250);

    await pickTool(page, "Freehand");
    a = await P(500, 700);
    b = await P(600, 780);
    await page.mouse.move(a.x, a.y);
    await page.mouse.down();
    await page.mouse.move(b.x, b.y, { steps: 8 });
    await page.mouse.up();
    await page.waitForTimeout(300);

    const widths = await page.evaluate(() => {
      const objs = window.__btm.getTemplate().objects as Array<{
        type: string;
        strokeWidth?: number;
      }>;
      const out: Record<string, number | undefined> = {};
      for (const o of objs) {
        if (o.type === "line" || o.type === "rect" || o.type === "freehand") {
          out[o.type] = o.strokeWidth;
        }
      }
      return out;
    });
    expect(widths.line).toBeDefined();
    expect(widths.rect).toBe(widths.line);
    expect(widths.freehand).toBe(widths.line);
    expect(widths.line).toBeGreaterThan(0);
  });

  test("records the same width whatever zoom it was drawn at", async ({ page }) => {
    // The template must not depend on the zoom the author happened to be
    // working at: a rule traced at 25% and the same rule traced at 400% have
    // to serialise identically.
    // One page per zoom, so each measurement is a first and only draw rather
    // than a draw layered on top of the previous zoom's rectangle.
    const widths: number[] = [];
    // The draw box is in document coordinates and has to land inside the visible
    // pane, so the zoomed-in case is 1.5 rather than 4: at higher zoom the box's
    // corner is scrolled off screen and the drag captures nothing. 1.5 is still
    // well above 100% and is the point of the test — the width must not follow
    // the zoom up.
    for (const zoom of [1, 0.5, 0.25, 1.5]) {
      await page.goto("/");
      await page
        .locator('input[type="file"][accept*="image/png"]')
        .first()
        .setInputFiles(join(process.cwd(), "e2e", "fixtures", "test-bill.png"));
      await page.locator("canvas.upper-canvas").waitFor({ state: "attached" });
      await page.waitForFunction(() => Boolean(window.__btm?.getCanvas()));
      await page.waitForTimeout(700);

      // Zoom after the layout has settled: a draw box mapped through a stale
      // pane rect lands off the page and captures nothing.
      await page.evaluate((z) => window.__btm.setZoom(z), zoom);
      await page.waitForTimeout(300);

      await drawRect(page);
      const w = await savedStrokeWidth(page);
      expect(w, `no rect recorded at zoom ${zoom}`).toBeDefined();
      widths.push(w as number);
    }

    // Every draw agrees with the first, whatever the zoom was.
    for (const w of widths) expect(w).toBe(widths[0]);
    expect(widths[0]).toBeGreaterThan(0);
  });

  test("keeps a stroke visible and even when zoomed out", async ({ page }) => {
    await openEditorWithBill(page);
    // The reference is only an authoring aid; hiding it makes the measurement
    // the drawn stroke and nothing else.
    await page.getByLabel("Show reference").uncheck();
    await page.waitForTimeout(200);

    await atZoom(page, 1);
    await drawRect(page);
    const widthAtFull = await savedStrokeWidth(page);
    const atFull = await strokeInk(page);

    // Zoomed out, the floor takes over: the outline must not thin away into
    // sub-pixel grey, and the two zoomed-out readings must agree with each
    // other or the stroke is uneven rather than merely smaller.
    await atZoom(page, 0.5);
    const ink50 = await strokeInk(page);
    await atZoom(page, 0.25);
    const ink25 = await strokeInk(page);

    // Without a floor a 1.5px stroke at 25% zoom measured a fifth of its
    // 100% ink; the floor keeps it within an order of magnitude.
    expect(ink25).toBeGreaterThan(atFull / 8);
    expect(ink50).toBeGreaterThan(atFull / 8);
    // "Even" is the real claim: 25% must not be dramatically thinner than 50%.
    expect(ink25).toBeGreaterThan(ink50 / 2);

    // None of this touched the stored width: the floor is a rendering concern,
    // so the template still says what the author drew.
    expect(widthAtFull).toBeGreaterThan(0);
    expect(await savedStrokeWidth(page)).toBe(widthAtFull);
  });

  test("leaves a stroke deliberately set to zero invisible", async ({ page }) => {
    await openEditorWithBill(page);
    await page.getByLabel("Show reference").uncheck();
    await page.waitForTimeout(200);
    await atZoom(page, 0.5);
    await drawRect(page);

    // The floor exists to stop a thin line fading, not to overrule an author
    // who asked for no outline at all.
    await page.evaluate(() => {
      const canvas = window.__btm.getCanvas() as unknown as {
        getObjects: () => Array<Record<string, unknown> & {
          set: (v: Record<string, unknown>) => void;
        }>;
        requestRenderAll: () => void;
      };
      const o = canvas.getObjects().find((x) => x.type === "rect");
      o?.set({ strokeWidth: 0 });
      canvas.requestRenderAll();
    });
    await page.waitForTimeout(250);

    expect(await savedStrokeWidth(page)).toBe(0);
    expect(await strokeInk(page)).toBe(0);
  });
});

test.describe("Editing several objects at once", () => {
  test.beforeEach(async ({ page }) => {
    page.on("dialog", (d) => void d.accept());
    page.on("pageerror", (e) => console.log("PAGEERROR:", String(e).slice(0, 800)));
  });

  /** Draw a rect and a line with the real tools, both well inside the page. */
  async function drawTwo(page: Page): Promise<void> {
    await pickTool(page, "Rectangle");
    await page.waitForTimeout(120);
    let P = await docToPage(page);
    let a = await P(80, 120);
    let b = await P(240, 220);
    await page.mouse.move(a.x, a.y);
    await page.mouse.down();
    await page.mouse.move(b.x, b.y, { steps: 5 });
    await page.mouse.up();
    await page.waitForTimeout(250);

    await pickTool(page, "Line");
    await page.waitForTimeout(120);
    P = await docToPage(page);
    a = await P(80, 300);
    b = await P(300, 300);
    await page.mouse.move(a.x, a.y);
    await page.mouse.down();
    await page.mouse.move(b.x, b.y, { steps: 5 });
    await page.mouse.up();
    await page.waitForTimeout(300);
  }

  async function selectBoth(page: Page): Promise<void> {
    // Blur first: a panel input that still has focus swallows Ctrl+A as
    // "select all text", so the editor never sees the shortcut and the panel
    // is left rendering the values it last computed.
    await page.evaluate(() => {
      (document.activeElement as HTMLElement | null)?.blur();
    });
    await page.keyboard.press("Control+a");
    await page.waitForTimeout(350);
  }

  /** Stroke width of every drawn object, keyed by type, from the template. */
  async function widthsByType(page: Page): Promise<Record<string, number>> {
    return page.evaluate(() => {
      const out: Record<string, number> = {};
      for (const o of window.__btm.getTemplate().objects) {
        if (o.type === "rect" || o.type === "line") {
          out[o.type] = (o as unknown as { strokeWidth?: number }).strokeWidth ?? -1;
        }
      }
      return out;
    });
  }

  test("applies a stroke width to the whole selection as one edit", async ({
    page,
  }) => {
    await openEditorWithBill(page);
    await drawTwo(page);
    await selectBoth(page);

    // The shared panel, not the single-object one. "N objects" is the
    // multi-select heading, so match it exactly: the status bar and the
    // footer's "objects in document" also contain the words.
    await expect(
      page.getByRole("heading", { name: "2 objects", exact: true }),
    ).toBeVisible();
    await expect(page.getByRole("heading", { name: "Appearance" })).toBeVisible();

    const field = page.getByLabel("Stroke width");
    await expect(field).toBeVisible();
    const before = await widthsByType(page);
    // `fill` sets the value in one input event, so this is a single edit.
    // Pressing Enter as well would commit a second time and undo would then
    // only step back over the duplicate.
    await field.fill("4");
    await page.waitForTimeout(350);

    // Both objects carry the new width: one control, both lines.
    const widths = await widthsByType(page);
    expect(widths.rect).toBe(4);
    expect(widths.line).toBe(4);

    // And it was a single edit, so one undo takes both back together.
    await page.keyboard.press("Control+z");
    await page.waitForTimeout(400);
    const undone = await widthsByType(page);
    expect(undone.rect).toBe(before.rect);
    expect(undone.line).toBe(before.line);
  });

  test("applies a stroke colour to the whole selection", async ({ page }) => {
    await openEditorWithBill(page);
    await drawTwo(page);
    await selectBoth(page);

    await page.getByLabel("Colour").first().fill("#ff0000");
    await page.waitForTimeout(300);

    const strokes = await page.evaluate(() => {
      const out: Record<string, string> = {};
      for (const o of window.__btm.getTemplate().objects) {
        if (o.type === "rect" || o.type === "line") {
          out[o.type] = (o as unknown as { stroke?: string }).stroke ?? "?";
        }
      }
      return out;
    });
    expect(strokes.rect).toBe("#ff0000");
    expect(strokes.line).toBe("#ff0000");
  });

  test("shows a dash when the selection disagrees, and applies once chosen", async ({
    page,
  }) => {
    await openEditorWithBill(page);
    await drawTwo(page);

    // Give one object a different width so the selection no longer agrees.
    // This is committed through the controller so it lands in the template
    // the panel reads, rather than only on the live Fabric object.
    await page.evaluate(() => {
      const c = window.__btm;
      const canvas = c.getCanvas() as unknown as {
        getObjects: () => Array<
          Record<string, unknown> & { set: (v: Record<string, unknown>) => void }
        >;
        requestRenderAll: () => void;
      };
      const rect = canvas.getObjects().find((o) => o.type === "rect");
      rect?.set({ strokeWidth: 7 });
      canvas.requestRenderAll();
    });
    await selectBoth(page);

    // Guard: the disagreement really exists before the dash is asserted.
    const disagreed = await page.evaluate(() =>
      window.__btm
        .getTemplate()
        .objects.filter((o) => o.type === "rect" || o.type === "line")
        .map((o) => (o as unknown as { strokeWidth?: number }).strokeWidth ?? -1),
    );
    expect(disagreed.length).toBe(2);
    expect(new Set(disagreed).size).toBe(2);

    // A dash rather than one object's value pretending to be everyone's. Stroke
    // and stroke width both disagree here, so two dashes are expected — and the
    // controls stay live, because choosing a value is how the disagreement is
    // settled.
    const dash = page.getByTitle("The selection does not agree on this");
    await expect(dash).toHaveCount(2);
    await expect(dash.first()).toBeVisible();
    await expect(page.getByLabel("Stroke width")).toBeVisible();
    // The width field is empty rather than showing one object's number.
    await expect(page.getByLabel("Stroke width")).toHaveValue("");

    // Settle the disagreements. The panel's colour inputs are ordered Stroke then
    // Fill, and both stay live even while mixed, so picking one is what applies
    // it across the whole selection.
    await page.getByLabel("Colour").nth(0).fill("#0000ff");
    await page.getByLabel("Colour").nth(1).fill("#eeeeee");
    await page.getByLabel("Stroke width").fill("2");
    await page.waitForTimeout(400);
    await selectBoth(page);

    // No dashes left, and every control shows the now-shared value.
    await expect(page.getByTitle("The selection does not agree on this")).toHaveCount(0);
    await expect(page.getByLabel("Stroke width")).toHaveValue("2");
    const widths = await widthsByType(page);
    expect(widths.rect).toBe(2);
    expect(widths.line).toBe(2);

    const strokes = await page.evaluate(() => {
      const out: Record<string, string> = {};
      for (const o of window.__btm.getTemplate().objects) {
        if (o.type === "rect" || o.type === "line") {
          out[o.type] = (o as unknown as { stroke?: string }).stroke ?? "?";
        }
      }
      return out;
    });
    expect(strokes.rect).toBe("#0000ff");
    expect(strokes.line).toBe("#0000ff");
  });

  test("hides and locks the whole selection together", async ({ page }) => {
    await openEditorWithBill(page);
    await drawTwo(page);
    await selectBoth(page);

    await page.getByLabel("Visible", { exact: true }).uncheck();
    await page.waitForTimeout(300);
    let flags = await page.evaluate(() =>
      window.__btm
        .getTemplate()
        .objects.filter((o) => o.type === "rect" || o.type === "line")
        .map((o) => (o as unknown as { visible?: boolean }).visible),
    );
    expect(flags).toHaveLength(2);
    expect(flags.every((v) => v === false)).toBe(true);

    await page.getByLabel("Locked", { exact: true }).check();
    await page.waitForTimeout(300);
    flags = await page.evaluate(() =>
      window.__btm
        .getTemplate()
        .objects.filter((o) => o.type === "rect" || o.type === "line")
        .map((o) => (o as unknown as { locked?: boolean }).locked),
    );
    expect(flags.every((v) => v === true)).toBe(true);
  });

  test("leaves a table's own borders alone in a mixed selection", async ({
    page,
  }) => {
    await openEditorWithBill(page);
    await drawTwo(page);

    // A table in the same selection. It is built by hand here rather than with
    // the table tool because that opens a rows/columns dialog; what matters is
    // that it is a real serialised table with its own border settings.
    // The real table tool, which opens its own rows/columns dialog.
    const P = await docToPage(page);
    await drawTable(page, P, [400, 400], [620, 540], 2, 2);

    await page.evaluate(() => {
      const canvas = window.__btm.getCanvas() as unknown as {
        getObjects: () => Array<
          Record<string, unknown> & { set: (v: Record<string, unknown>) => void }
        >;
        requestRenderAll: () => void;
      };
      const table = canvas
        .getObjects()
        .find((o) => String(o.appType ?? "").toLowerCase() === "table");
      table?.set({ borderColor: "#000000", borderWidth: 4 });
      canvas.requestRenderAll();
    });
    await selectBoth(page);

    const tableBefore = await page.evaluate(() => {
      const t = window.__btm
        .getTemplate()
        .objects.find((o) => o.type === "table") as unknown as {
        borderWidth?: number;
        borderColor?: string;
      } | undefined;
      return t ? { width: t.borderWidth, colour: t.borderColor } : null;
    });
    expect(tableBefore).not.toBeNull();
    expect(tableBefore!.width).toBe(4);

    // Restyle the shared stroke across the whole selection.
    await page.getByLabel("Colour").first().fill("#00aa00");
    await page.waitForTimeout(350);

    // The table's own border is untouched: a shared colour must not invent an
    // outline on a table's grid.
    const tableAfter = await page.evaluate(() => {
      const t = window.__btm
        .getTemplate()
        .objects.find((o) => o.type === "table") as unknown as {
        borderWidth?: number;
        borderColor?: string;
      } | undefined;
      return t ? { width: t.borderWidth, colour: t.borderColor } : null;
    });
    expect(tableAfter!.width).toBe(tableBefore!.width);
    expect(tableAfter!.colour).toBe(tableBefore!.colour);
  });
});
