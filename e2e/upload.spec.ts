import { expect, test } from "@playwright/test";

test.describe("first screen", () => {
  test("a non-picture file gets a toast and never an alert box", async ({
    page,
  }) => {
    const dialogs: string[] = [];
    page.on("dialog", (dialog) => {
      dialogs.push(dialog.message());
      void dialog.dismiss();
    });

    await page.goto("/");
    await page
      .locator('input[type="file"][accept*="image/png"]')
      .setInputFiles({
        name: "notes.txt",
        mimeType: "text/plain",
        buffer: Buffer.from("not a picture"),
      });

    await expect(
      page.getByText("That picture isn't a PNG, JPG or WebP"),
    ).toBeVisible();
    expect(dialogs).toEqual([]);
  });

  test("a broken template file gets an explaining toast", async ({ page }) => {
    await page.goto("/");
    await page
      .locator('input[type="file"][accept*="json"]')
      .first()
      .setInputFiles({
        name: "broken.json",
        mimeType: "application/json",
        buffer: Buffer.from("{ not json"),
      });

    await expect(page.getByText("That file isn't a bill template")).toBeVisible();
  });

  test("the sample bill opens the editor with a reference loaded", async ({
    page,
  }) => {
    await page.goto("/");
    await page.getByRole("button", { name: "Try a sample bill" }).click();
    // "Remove Reference" exists in both reference states; enabled proves the
    // editor opened *and* the picture loaded.
    await expect(
      page.getByRole("button", { name: "Remove Reference" }),
    ).toBeEnabled();
  });
});
