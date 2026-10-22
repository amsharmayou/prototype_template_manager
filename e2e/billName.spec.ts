import { expect, test } from "@playwright/test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const FIXTURE = join(process.cwd(), "e2e", "fixtures", "test-bill.png");
const FIXTURE_BYTES = readFileSync(FIXTURE);

/** Open the editor with the fixture uploaded under a chosen filename. */
async function openWithName(page: import("@playwright/test").Page, filename: string) {
  await page.goto("/");
  await page
    .locator('input[type="file"][accept*="image/png"]')
    .first()
    .setInputFiles({ name: filename, mimeType: "image/png", buffer: FIXTURE_BYTES });
  await page.locator("canvas.upper-canvas").waitFor({ state: "attached" });
  await page.waitForFunction(() => Boolean(window.__btm?.getCanvas()));
  await page.waitForTimeout(500);
}

/**
 * The traced file's name becomes the package name everywhere the bill travels:
 * the `.btpkg` filename, the admin catalog row, the Android browser. A
 * scanner's or screenshot's filename is not a name for a bill, so the editor
 * seeds the name field with a sensible default the user can still overwrite.
 */
test.describe("the bill's starting name", () => {
  test("a screenshot's filename does not become the bill name", async ({ page }) => {
    await openWithName(page, "Screenshot 2025-11-19 041211.png");
    await expect(page.locator("#btm-doc-name")).toHaveValue("Bill");
  });

  test("a camera's filename does not become the bill name", async ({ page }) => {
    await openWithName(page, "IMG_4821.jpg");
    await expect(page.locator("#btm-doc-name")).toHaveValue("Bill");
  });

  test("a name a person would recognise is kept", async ({ page }) => {
    await openWithName(page, "Lucky Cargo Movers.png");
    await expect(page.locator("#btm-doc-name")).toHaveValue("Lucky Cargo Movers");
  });

  test("the seeded name is editable, so the user has the last word", async ({ page }) => {
    await openWithName(page, "Screenshot 2025-11-19 041211.png");
    const field = page.locator("#btm-doc-name");
    await field.fill("March Lorry Receipt");
    await expect(field).toHaveValue("March Lorry Receipt");
  });
});
