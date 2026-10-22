import { expect, test } from "@playwright/test";

/**
 * The shell: step guide, app bar save, and the outcome-first copy menu.
 * These run against the same editor the other specs drive; they only assert
 * the new chrome, never the document.
 */
test.describe("editor shell", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/");
    await page
      .locator('input[type="file"][accept*="image/png"]')
      .setInputFiles({
        name: "bill.png",
        mimeType: "image/png",
        // 1×1 white PNG. The previous 4×4 buffer had a broken IDAT CRC:
        // <img> renders CRC-broken PNGs, createImageBitmap refuses them, so
        // the reference image never loaded and the editor never opened.
        buffer: Buffer.from(
          "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
          "base64",
        ),
      });
    await expect(
      page.getByRole("button", { name: "Remove Reference" }),
    ).toBeEnabled();
  });

  test("the step path marks the bill step done and stands on trace", async ({
    page,
  }) => {
    const steps = page.getByRole("navigation", { name: "Steps" });
    await expect(steps).toBeVisible();

    const bill = steps.getByRole("button", { name: /Your bill/ });
    await expect(bill).toContainText("done");

    const trace = steps.getByRole("button", { name: /Trace/ });
    await expect(trace).toHaveAttribute("aria-current", "step");
  });

  test("clicking a step opens its context and picks its tool", async ({
    page,
  }) => {
    const steps = page.getByRole("navigation", { name: "Steps" });
    await steps.getByRole("button", { name: /Mark data/ }).click();

    await expect(
      steps.getByRole("button", { name: /Mark data/ }),
    ).toHaveAttribute("aria-current", "step");
    await expect(page.getByRole("heading", { name: "Data fields" })).toBeVisible();

    const tool = await page.evaluate(
      () =>
        (
          window as unknown as {
            __btm: { getSnapshot(): { tool: string } };
          }
        ).__btm.getSnapshot().tool,
    );
    expect(tool).toBe("field");
  });

  test("arrow keys move along the steps", async ({ page }) => {
    const steps = page.getByRole("navigation", { name: "Steps" });
    await steps.getByRole("button", { name: /Your bill/ }).click();
    await page.keyboard.press("ArrowRight");
    await expect(
      steps.getByRole("button", { name: /Trace/ }),
    ).toHaveAttribute("aria-current", "step");
  });

  test("Next step walks forward one step at a time", async ({ page }) => {
    const steps = page.getByRole("navigation", { name: "Steps" });
    await steps.getByRole("button", { name: /Your bill/ }).click();
    await steps.getByRole("button", { name: /^Next/ }).click();
    await expect(
      steps.getByRole("button", { name: /Trace/ }),
    ).toHaveAttribute("aria-current", "step");
  });

  test("Save keeps a copy on the device and says so", async ({ page }) => {
    await page.getByRole("button", { name: "Save", exact: true }).click();
    await expect(page.getByText("Saved to this device")).toBeVisible();

    const saved = await page.evaluate(() =>
      JSON.parse(window.localStorage.getItem("btm:templates") ?? "[]") as Array<{
        name: string;
      }>,
    );
    expect(saved.length).toBeGreaterThan(0);
  });

  test("Get a copy groups by outcome, format second", async ({ page }) => {
    await page.getByRole("button", { name: /Get a copy/ }).click();

    await expect(page.getByRole("button", { name: "Print it" })).toBeVisible();
    await expect(page.getByRole("button", { name: "A picture" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Open in Word" })).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Template for an app" }).first(),
    ).toBeVisible();

    await page.keyboard.press("Escape");
    await expect(page.getByRole("button", { name: "Print it" })).toHaveCount(0);
  });
});
