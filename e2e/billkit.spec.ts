import { expect, test } from "@playwright/test";
import { join } from "node:path";

const FIXTURE = join(process.cwd(), "e2e", "fixtures", "test-bill.png");

/** Where the template is stashed so it can be read back after a reload. */
const SAVE_KEY = "billkit-spec-template";

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

async function drawTableWithBand(page: import("@playwright/test").Page) {
  const P = docToPage(page);
  await pickTool(page, "Table");
  const a = await P(80, 200);
  const b = await P(520, 380);
  await page.mouse.move(a.x, a.y);
  await page.mouse.down();
  await page.mouse.move(b.x, b.y, { steps: 6 });
  await page.mouse.up();
  await page.waitForTimeout(400);

  const dialog = page.getByRole("dialog");
  const rows = dialog.locator('input[type="number"]').first();
  await rows.click();
  await rows.press("Control+a");
  await rows.type("3");
  await dialog.getByRole("button", { name: "Create" }).click();
  await page.waitForTimeout(400);
}

/**
 * Select the table, mark its rows as a band, and put a column token in each of
 * the band's cells so the renderer has something to resolve per item.
 *
 * The band is narrowed to a single row so the last row stays outside it and can
 * carry the computed total.
 */
async function markBand(page: import("@playwright/test").Page) {
  await page.keyboard.press("v");
  const P = docToPage(page);
  const inside = await P(300, 260);
  await page.mouse.click(inside.x, inside.y);
  await page.waitForTimeout(300);

  await page.getByLabel("Repeat these rows once per item").check();
  await page.waitForTimeout(300);

  // The panel defaults the band to every row but the first; narrow it to one so
  // a trailer row is left for the total.
  const lastRow = page.getByLabel("Last row");
  await lastRow.click();
  await lastRow.press("Control+a");
  await lastRow.type("1");
  await page.waitForTimeout(300);

  await page.evaluate(() => {
    window.__btm.updateTable((t) => {
      t.setCellText(1, 0, "{{description}}");
      t.setCellText(1, 1, "{{amount}}");
      t.setCellText(2, 1, "{{total}}");
    }, "Seed band tokens");
  });
  await page.waitForTimeout(300);
}

const tableOf = (t: unknown) =>
  (t as { objects: { type: string; repeat?: { key: string } }[] }).objects.find(
    (o) => o.type === "table",
  )!;

test.describe("billkit package and repeating line items", () => {
  test("a band survives save and reload", async ({ page }) => {
    await openEditor(page);
    await drawTableWithBand(page);
    await markBand(page);

    const saved = await page.evaluate((key) => {
      const tpl = window.__btm.getTemplate();
      window.localStorage.setItem(key, JSON.stringify(tpl));
      return tpl;
    }, SAVE_KEY);
    expect(tableOf(saved).repeat?.key).toBe("items");

    // The band must come back after a reload, or authoring it is pointless.
    await openEditor(page);
    const restored = await page.evaluate((key) => {
      window.__btm.loadTemplate(
        JSON.parse(window.localStorage.getItem(key)!) as never,
      );
      return window.__btm.getTemplate();
    }, SAVE_KEY);
    expect(tableOf(restored).repeat?.key).toBe("items");
  });

  test("filling items produces one rendered row per item plus the total", async ({ page }) => {
    await openEditor(page);
    await drawTableWithBand(page);
    await markBand(page);

    const html = await page.evaluate(() => {
      const btm = window.__btm as unknown as {
        getTemplate: () => unknown;
        renderHtmlForTest: (t: unknown, values: Record<string, string>) => string;
      };
      const t = btm.getTemplate();
      return btm.renderHtmlForTest(t, {
        items: JSON.stringify([
          { description: "Wheat flour", amount: "100.00" },
          { description: "Rice", amount: "250.50" },
        ]),
      });
    });

    expect(html).toContain("Wheat flour");
    expect(html).toContain("Rice");
    expect(html).toContain("250.50");
    expect(html).toContain("350.50");
    expect(html).not.toContain("{{description}}");
    expect(html).not.toContain("{{total}}");
  });

  test("a build/parse/resolve round trip preserves the rendered output", async ({ page }) => {
    await openEditor(page);
    await drawTableWithBand(page);
    await markBand(page);

    const same = await page.evaluate(() => {
      const btm = window.__btm as unknown as {
        getTemplate: () => unknown;
        renderHtmlForTest: (t: unknown, values: Record<string, string>) => string;
        packageRoundTripHtml: (t: unknown) => string;
      };
      const t = btm.getTemplate();
      const direct = btm.renderHtmlForTest(t, {});
      const round = btm.packageRoundTripHtml(t);
      return { same: direct === round, direct };
    });
    expect(same.same).toBe(true);
    expect(same.direct.length).toBeGreaterThan(0);
  });
});
