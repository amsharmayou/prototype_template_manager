import { expect, test } from "@playwright/test";
import { join } from "node:path";

const FIXTURE = join(process.cwd(), "e2e", "fixtures", "test-bill.png");

async function openEditor(page: import("@playwright/test").Page) {
  await page.goto("/");
  await page
    .locator('input[type="file"][accept*="image/png"]')
    .first()
    .setInputFiles(FIXTURE);
  await page.locator("canvas.upper-canvas").waitFor({ state: "attached" });
  await page.waitForFunction(() => Boolean(window.__btm?.getCanvas()));
  await page.waitForTimeout(700);
}

/** Drag a table box and fill in the rows/columns prompt. */
async function createTable(
  page: import("@playwright/test").Page,
  at: { x: number; y: number },
  size: { w: number; h: number },
  rows: number,
  cols: number,
): Promise<void> {
  await page.getByTitle(/^Table/i).click();
  await page.waitForTimeout(150);
  const box = await page.evaluate((a) => {
    const canvas = window.__btm.getCanvas()!;
    const r = canvas.upperCanvasEl.getBoundingClientRect();
    const s = window.__btm.getSnapshot();
    return {
      ax: r.left + s.tx + a.x,
      ay: r.top + s.ty + a.y,
      bx: r.left + s.tx + a.x + a.w,
      by: r.top + s.ty + a.y + a.h,
    };
  }, { x: at.x, y: at.y, w: size.w, h: size.h });
  await page.mouse.move(box.ax, box.ay);
  await page.mouse.down();
  await page.mouse.move(box.bx, box.by, { steps: 5 });
  await page.mouse.up();
  await page.waitForTimeout(400);

  const dialog = page.getByRole("dialog");
  await expect(dialog).toBeVisible();
  const rowsInput = dialog.locator('input[type="number"]').first();
  await rowsInput.click();
  await rowsInput.press("Control+a");
  await rowsInput.type(String(rows));
  const colsInput = dialog.locator('input[type="number"]').nth(1);
  await colsInput.click();
  await colsInput.press("Control+a");
  await colsInput.type(String(cols));
  await page.getByRole("button", { name: "Create" }).click();
  await page.waitForTimeout(500);
}

async function tables(page: import("@playwright/test").Page) {
  return page.evaluate(() =>
    window.__btm
      .getTemplate()
      .objects.filter((o) => o.type === "table")
      .map((o) => {
        const t = o as unknown as {
          name: string;
          rows: number;
          columns: number;
          x: number;
          y: number;
        };
        return { name: t.name, rows: t.rows, columns: t.columns, x: t.x, y: t.y };
      }),
  );
}

/**
 * Each table's rows/columns prompt configures the table that was just dragged
 * out, not whichever table happens to be first on the canvas.
 */
test("a second table's prompt configures the new table, not the first", async ({
  page,
}) => {
  await openEditor(page);

  await createTable(page, { x: 80, y: 100 }, { w: 240, h: 120 }, 2, 3);
  const first = await tables(page);
  expect(first).toHaveLength(1);
  expect(first[0]!.rows).toBe(2);
  expect(first[0]!.columns).toBe(3);

  // A second table, somewhere else on the page, with a different shape.
  await createTable(page, { x: 80, y: 500 }, { w: 300, h: 200 }, 7, 8);

  const both = await tables(page);
  // Two tables exist...
  expect(both).toHaveLength(2);

  // ...the first is untouched by the second's prompt...
  const original = both.find((t) => t.x === first[0]!.x && t.y === first[0]!.y);
  expect(original).toBeDefined();
  expect(original!.rows).toBe(2);
  expect(original!.columns).toBe(3);

  // ...and the new one carries the shape that was asked for.
  const added = both.find((t) => t.x !== first[0]!.x || t.y !== first[0]!.y);
  expect(added).toBeDefined();
  expect(added!.rows).toBe(7);
  expect(added!.columns).toBe(8);
});

test("cancelling the prompt leaves no table behind", async ({ page }) => {
  await openEditor(page);
  await page.getByTitle(/^Table/i).click();
  await page.waitForTimeout(150);
  const box = await page.evaluate(() => {
    const canvas = window.__btm.getCanvas()!;
    const r = canvas.upperCanvasEl.getBoundingClientRect();
    const s = window.__btm.getSnapshot();
    return {
      ax: r.left + s.tx + 120,
      ay: r.top + s.ty + 120,
      bx: r.left + s.tx + 400,
      by: r.top + s.ty + 280,
    };
  });
  await page.mouse.move(box.ax, box.ay);
  await page.mouse.down();
  await page.mouse.move(box.bx, box.by, { steps: 5 });
  await page.mouse.up();
  await page.waitForTimeout(400);

  const dialog = page.getByRole("dialog");
  await expect(dialog).toBeVisible();
  await page.getByRole("button", { name: /cancel/i }).click();
  await page.waitForTimeout(400);

  // The box the user dragged is discarded with the prompt. Leaving a default
  // 2x2 table on the canvas would be a table the user never asked for.
  const left = await tables(page);
  expect(left).toHaveLength(0);
});

test("each table gets its own name", async ({ page }) => {
  await openEditor(page);
  await createTable(page, { x: 80, y: 100 }, { w: 240, h: 120 }, 2, 2);
  await createTable(page, { x: 80, y: 400 }, { w: 240, h: 120 }, 2, 2);

  const both = await tables(page);
  expect(both).toHaveLength(2);
  // Two tables must not both be called "Table 1": the layers panel and the
  // template would be ambiguous.
  expect(both[0]!.name).not.toBe(both[1]!.name);
});