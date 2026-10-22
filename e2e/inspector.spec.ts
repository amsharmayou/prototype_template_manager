import { expect, test, type Page } from "@playwright/test";
import { resolve } from "node:path";

const FIXTURE = resolve(__dirname, "fixtures/test-bill.png");

/**
 * The parts of `window.__btm` this spec uses.
 *
 * Declared as a type alias with inline `window as unknown as` casts — the
 * pattern of `e2e/shell.spec.ts` and `e2e/tableguides.spec.ts`. A `declare
 * global` here would merge (and conflict) with the full declaration in
 * `e2e/workflow.spec.ts`, which is the only spec that may own the global.
 */
type Btm = {
  getCanvas(): { upperCanvasEl: HTMLCanvasElement; getZoom(): number } | null;
  getSnapshot(): { tx: number; ty: number };
  setZoom(z: number): void;
};

async function openEditor(page: Page): Promise<void> {
  await page.goto("/");
  await page
    .locator('input[type="file"][accept*="image/png"]')
    .first()
    .setInputFiles(FIXTURE);
  await page.locator("canvas.upper-canvas").waitFor({ state: "attached" });
  await page.waitForFunction(() =>
    Boolean((window as unknown as { __btm?: Btm }).__btm?.getCanvas()),
  );
  await page.evaluate(() =>
    (window as unknown as { __btm: Btm }).__btm.setZoom(0.5),
  );
  await page.waitForTimeout(250);
}

async function pickTool(page: Page, name: string): Promise<void> {
  await page.getByTitle(new RegExp(`^${name}`, "i")).click();
  await page.waitForTimeout(80);
}

/** Convert document coordinates into page coordinates, re-read per call. */
async function docToPage(
  page: Page,
): Promise<(x: number, y: number) => Promise<{ x: number; y: number }>> {
  return async (x, y) =>
    page.evaluate(
      ([ax, ay]) => {
        const c = (window as unknown as { __btm: Btm }).__btm;
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

/** Draw a rectangle and leave it selected. */
async function drawAndSelectRect(page: Page): Promise<void> {
  await pickTool(page, "Rectangle");
  const P = await docToPage(page);
  const a = await P(120, 120);
  const b = await P(320, 260);
  await page.mouse.move(a.x, a.y);
  await page.mouse.down();
  await page.mouse.move(b.x, b.y, { steps: 3 });
  await page.mouse.up();
  await page.waitForTimeout(120);
  await pickTool(page, "Select");
  const center = await P(220, 190);
  await page.mouse.click(center.x, center.y);
}

test.describe("Inspector sections", () => {
  test.beforeEach(({ page }) => {
    page.on("dialog", (d) => void d.accept());
  });

  test("the index jumps to each section it names", async ({ page }) => {
    await openEditor(page);
    await drawAndSelectRect(page);

    const nav = page.getByRole("navigation", { name: "Inspector" });
    await expect(nav).toBeVisible();
    const buttons = nav.getByRole("button");
    const count = await buttons.count();
    expect(count).toBeGreaterThanOrEqual(2);

    for (let i = 0; i < count; i++) {
      const name = (await buttons.nth(i).innerText()).trim();
      await buttons.nth(i).click();
      // The button's word must be the section's word, and the click must
      // actually bring that section into the viewport.
      await expect(
        page.getByRole("heading", { name, exact: true }),
      ).toBeInViewport();
    }
  });

  test("a collapsed section stays collapsed after a detour", async ({ page }) => {
    await openEditor(page);
    await drawAndSelectRect(page);

    const nav = page.getByRole("navigation", { name: "Inspector" });
    await expect(nav).toBeVisible();
    const label = (await nav.getByRole("button").nth(1).innerText()).trim();
    const toggle = page
      .getByRole("heading", { name: label, exact: true })
      .locator("button");
    await toggle.click();
    await expect(toggle).toHaveAttribute("aria-expanded", "false");

    // Deselect by clicking empty paper: the single-object panel unmounts, so
    // its state dies with it — only the module-level memory can bring the
    // collapsed section back collapsed.
    const P = await docToPage(page);
    await pickTool(page, "Select");
    const empty = await P(620, 980);
    await page.mouse.click(empty.x, empty.y);
    await expect(nav).toBeHidden();
    const center = await P(220, 190);
    await page.mouse.click(center.x, center.y);

    await expect(
      page
        .getByRole("heading", { name: label, exact: true })
        .locator("button"),
    ).toHaveAttribute("aria-expanded", "false");
  });
});
