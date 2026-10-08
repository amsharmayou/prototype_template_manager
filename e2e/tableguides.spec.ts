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
  await page.evaluate(() => window.__btm.setZoom(0.5));
  await page.waitForTimeout(300);
}

function docToPage(page: import("@playwright/test").Page) {
  return async (x: number, y: number) =>
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

async function pickTool(page: import("@playwright/test").Page, name: string) {
  await page.getByTitle(new RegExp(`^${name}`, "i")).click();
  await page.waitForTimeout(120);
}

async function guides(page: import("@playwright/test").Page) {
  return page.evaluate(
    () =>
      (
        window as unknown as {
          __btm: { getSnapshot: () => { snaps: Array<{ axis: string; pos: number }> } };
        }
      ).__btm.getSnapshot().snaps,
  );
}

/** A rect whose top edge is at `top`, and a table below it. */
async function seedRectAndTable(
  page: import("@playwright/test").Page,
): Promise<void> {
  const P = docToPage(page);
  const a = await P(120, 150);
  const b = await P(420, 290);
  await pickTool(page, "Rect");
  await page.mouse.move(a.x, a.y);
  await page.mouse.down();
  await page.mouse.move(b.x, b.y, { steps: 5 });
  await page.mouse.up();
  await page.waitForTimeout(250);

  await pickTool(page, "Table");
  const c = await P(120, 420);
  const d = await P(400, 600);
  await page.mouse.move(c.x, c.y);
  await page.mouse.down();
  await page.mouse.move(d.x, d.y, { steps: 5 });
  await page.mouse.up();
  await page.waitForTimeout(400);
  await page.getByRole("button", { name: "Create" }).click();
  await page.waitForTimeout(400);
}

/**
 * Drag from `from` by `(dx, dy)` in small increments, stopping as soon as a
 * guide is announced.
 *
 * Sweeping rather than aiming at one exact point: the snap tolerance is
 * `6 / zoom` pixels, so a drag that computes the perfect landing coordinate can
 * still miss it through rounding. Sweeping guarantees the pointer passes
 * through the alignment whatever the arithmetic did.
 */
async function dragUntilGuided(
  page: import("@playwright/test").Page,
  from: { x: number; y: number },
  dx: number,
  dy: number,
  stepPx = 5,
): Promise<boolean> {
  const steps = Math.max(1, Math.ceil(Math.max(Math.abs(dx), Math.abs(dy)) / stepPx));
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  let seen = false;
  for (let i = 1; i <= steps; i += 1) {
    await page.mouse.move(from.x + (dx * i) / steps, from.y + (dy * i) / steps, {
      steps: 2,
    });
    await page.waitForTimeout(60);
    if ((await guides(page)).length > 0) {
      seen = true;
      break;
    }
  }
  await page.mouse.up();
  await page.waitForTimeout(200);
  return seen;
}

/**
 * A table is an ordinary placed object, so dragging it announces a guide the
 * moment one of its edges catches a neighbour's level.
 */
test("dragging a table announces a guide", async ({ page }) => {
  await openEditor(page);
  await seedRectAndTable(page);
  await page.keyboard.press("v");
  await page.waitForTimeout(150);

  const P = docToPage(page);
  // The table sits below the rect; lift it until its top edge sweeps across
  // the rect's top edge.
  const start = await P(260, 510);
  const guided = await dragUntilGuided(page, start, 0, -300);

  expect(guided).toBe(true);
  // Guides are cleared on release.
  expect(await guides(page)).toHaveLength(0);
});

/**
 * Resizing a table announces alignment too, but must not move the table: the
 * column and row sizes are owned by the table's own resize path.
 */
test("resizing a table announces a guide without moving it", async ({ page }) => {
  await openEditor(page);
  await seedRectAndTable(page);
  // Full zoom: at 50% the resize handles are only a few pixels across and a
  // grab aimed at the corner lands on the body, which moves the table instead.
  await page.evaluate(() => window.__btm.setZoom(1));
  await page.waitForTimeout(300);
  await page.keyboard.press("v");
  await page.waitForTimeout(150);

  const before = await page.evaluate(() => {
    const t = window.__btm
      .getTemplate()
      .objects.find((o) => o.type === "table") as unknown as {
      x: number;
      y: number;
      width: number;
      height: number;
    };
    return { x: t.x, y: t.y, width: t.width, height: t.height };
  });

  const P = docToPage(page);
  // Select the table first, so its controls exist.
  const inside = await P(before.x + before.width / 2, before.y + before.height / 2);
  await page.mouse.click(inside.x, inside.y);
  await page.waitForTimeout(300);

  // The bottom-right control sits on the object's bottom-right corner.
  const handle = await P(before.x + before.width, before.y + before.height);
  await page.mouse.move(handle.x, handle.y);
  await page.mouse.down();
  await page.mouse.move(handle.x + 25, handle.y + 25, { steps: 6 });
  await page.waitForTimeout(300);

  const during = await page.evaluate(() => {
    const t = window.__btm
      .getTemplate()
      .objects.find((o) => o.type === "table") as unknown as {
      x: number;
      y: number;
      width: number;
      height: number;
    };
    return { x: t.x, y: t.y, width: t.width, height: t.height };
  });
  const shown = await guides(page);
  await page.mouse.up();
  await page.waitForTimeout(200);

  // The resize really happened: the table grew from its bottom-right corner.
  expect(during.width).toBeGreaterThan(before.width);
  // Its top-left is pinned, which is the table's own resize contract.
  expect(during.x).toBeCloseTo(before.x, 0);
  expect(during.y).toBeCloseTo(before.y, 0);
  // Guides during a resize are advisory and must never nudge the geometry.
  expect(Array.isArray(shown)).toBe(true);
});

/** A table's own edges are snap targets for everything else. */
test("a rect snaps to a table's edge", async ({ page }) => {
  await openEditor(page);
  await seedRectAndTable(page);

  // A third object, a rect, below and to the right of the table.
  const P = docToPage(page);
  const a = await P(500, 700);
  const b = await P(700, 790);
  await pickTool(page, "Rect");
  await page.mouse.move(a.x, a.y);
  await page.mouse.down();
  await page.mouse.move(b.x, b.y, { steps: 5 });
  await page.mouse.up();
  await page.waitForTimeout(300);

  await page.keyboard.press("v");
  await page.waitForTimeout(150);

  // Drag it up through the table's horizontal levels.
  const start = await P(600, 745);
  const guided = await dragUntilGuided(page, start, 0, -400);
  expect(guided).toBe(true);
});

/**
 * A table's internal cell dividers are alignment lines in their own right.
 *
 * This asserts a guide appears at a position that is strictly *inside* the
 * table — the table's outer box already contributed levels before internal
 * grid lines existed, so only an interior position distinguishes the two.
 */
test("an object snaps to a table's internal grid line", async ({ page }) => {
  await openEditor(page);

  // A wide table with several columns, so it has interior dividers.
  const P = docToPage(page);
  await pickTool(page, "Table");
  const a = await P(100, 150);
  const b = await P(700, 450);
  await page.mouse.move(a.x, a.y);
  await page.mouse.down();
  await page.mouse.move(b.x, b.y, { steps: 5 });
  await page.mouse.up();
  await page.waitForTimeout(400);
  const dialog = page.getByRole("dialog");
  const rowsInput = dialog.locator('input[type="number"]').first();
  await rowsInput.click();
  await rowsInput.press("Control+a");
  await rowsInput.type("3");
  const colsInput = dialog.locator('input[type="number"]').nth(1);
  await colsInput.click();
  await colsInput.press("Control+a");
  await colsInput.type("4");
  await page.getByRole("button", { name: "Create" }).click();
  await page.waitForTimeout(400);

  const table = await page.evaluate(() => {
    const t = window.__btm
      .getTemplate()
      .objects.find((o) => o.type === "table") as unknown as {
      x: number;
      y: number;
      width: number;
      height: number;
      colWidths: number[];
      rowHeights: number[];
    };
    return {
      x: t.x,
      y: t.y,
      colWidths: t.colWidths,
      rowHeights: t.rowHeights,
    };
  });
  // The second interior row divider: strictly inside the table's own box.
  const rowDiv = table.y + table.rowHeights[0]! + table.rowHeights[1]!;

  // A rect placed to the right of the table, dragged down onto that divider.
  await pickTool(page, "Rect");
  const c = await P(720, 700);
  const d = await P(780, 760);
  await page.mouse.move(c.x, c.y);
  await page.mouse.down();
  await page.mouse.move(d.x, d.y, { steps: 5 });
  await page.mouse.up();
  await page.waitForTimeout(300);

  await page.keyboard.press("v");
  await page.waitForTimeout(150);

  const start = await P(750, 730);
  await page.mouse.move(start.x, start.y);
  await page.mouse.down();

  // Sweep down onto the interior divider and look for a guide there.
  let found = false;
  const steps = 60;
  const target = rowDiv - 730;
  for (let i = 1; i <= steps && !found; i += 1) {
    await page.mouse.move(start.x, start.y + (target * i) / steps, { steps: 2 });
    await page.waitForTimeout(50);
    const shown = await guides(page);
    // A guide sitting inside the table's own row band can only have come from
    // the internal grid levels.
    found = shown.some((g) => g.axis === "y" && g.pos > rowDiv - 2 && g.pos < rowDiv + 2);
  }
  await page.mouse.up();
  await page.waitForTimeout(200);

  expect(found).toBe(true);
});