import { expect, test, type Page } from "@playwright/test";
import { readFileSync } from "node:fs";

const TPL = {
  templateVersion: 1,
  document: { width: 794, height: 1123 },
  meta: { name: "acme-gmv", modifiedAt: "2026-10-03T00:00:00.000Z" },
  objects: [
    {
      id: "t1", type: "text", name: "Invoice No", role: null, x: 40, y: 40,
      width: 420, height: 28, rotation: 0, opacity: 1, visible: true, locked: false,
      zIndex: 0, parentId: null, stroke: "#000000", strokeWidth: 0, fill: "#000000",
      text: "Invoice {{invoice_number}}", fontFamily: "Arial", fontSize: 18,
      fontWeight: "bold", fontStyle: "normal", textAlign: "left", lineHeight: 1.16,
      charSpacing: 0, roleKind: "variable", textVerticalAlign: "top",
    },
    {
      id: "t2", type: "text", name: "Date", role: null, x: 40, y: 84,
      width: 420, height: 20, rotation: 0, opacity: 1, visible: true, locked: false,
      zIndex: 1, parentId: null, stroke: "#000000", strokeWidth: 0, fill: "#000000",
      text: "Date: {{invoice_date}}", fontFamily: "Arial", fontSize: 14,
      fontWeight: "normal", fontStyle: "normal", textAlign: "left", lineHeight: 1.16,
      charSpacing: 0, roleKind: "variable", textVerticalAlign: "top",
    },
    {
      id: "tb", type: "table", name: "Items", role: "items", x: 40, y: 140,
      width: 400, height: 60, rotation: 0, opacity: 1, visible: true, locked: false,
      zIndex: 2, parentId: null, stroke: "#000000", strokeWidth: 1, fill: "transparent",
      rows: 2, columns: 2, colWidths: [200, 200], rowHeights: [30, 30],
      cells: [
        { text: "{{item_name}}", textAlign: "left", fontSize: 12, fontWeight: "normal" },
        { text: "{{total}}", textAlign: "right", fontSize: 12, fontWeight: "normal" },
        { text: "Widget", textAlign: "left", fontSize: 12, fontWeight: "normal" },
        { text: "{{total}}", textAlign: "right", fontSize: 12, fontWeight: "normal" },
      ],
      borderColor: "#000000", borderWidth: 1, cellFill: "transparent",
      headerRow: false, headerFill: "transparent", headerTextColor: "#000000",
      cellTextColor: "#000000", padding: 4, fontFamily: "Arial",
    },
    {
      id: "ph1", type: "image-placeholder", name: "Logo", role: "logo", x: 560, y: 40,
      width: 120, height: 60, rotation: 0, opacity: 1, visible: true, locked: false,
      zIndex: 3, parentId: null, stroke: "#000000", strokeWidth: 1, fill: "transparent",
      placeholderRole: "logo", label: "LOGO",
    },
  ],
};

async function loadFixtureTemplate(page: Page): Promise<void> {
  await page.goto("/");
  await page
    .locator('input[type="file"][accept*="image/png"]')
    .first()
    .setInputFiles("e2e/fixtures/test-bill.png");
  await page.locator("canvas.upper-canvas").waitFor({ state: "attached" });
  await page.waitForFunction(() => Boolean(window.__btm?.getCanvas()));
  // Empty the traced objects, then load the fixture so the placeholder
  // variables exist regardless of the seeded reference image geometry.
  await page.evaluate((t) => {
    window.__btm.loadTemplate(t as never);
  }, JSON.parse(JSON.stringify(TPL)));
  await page.waitForTimeout(500);
}

test.describe("Data-bound renderer page", () => {
  test.beforeEach(async ({ page }) => {
    page.on("dialog", (d) => void d.accept());
  });

  test("turns a traced template into a form, preview and PDF", async ({ page }) => {
    await loadFixtureTemplate(page);

    // Save to this device so the renderer page's library picks it up.
    await page.getByRole("button", { name: "Save to My Templates" }).click();
    await page.waitForTimeout(200);

    await page.goto("/render");
    await expect(page.getByText("Saved templates on this device")).toBeVisible();
    await page.getByRole("button", { name: /acme-gmv/ }).click();

    // The form mirrors the traced structure.
    await expect(page.getByText("Invoice Number")).toBeVisible();
    await expect(page.getByText("Invoice Date")).toBeVisible();
    await expect(page.getByText("Item Name")).toBeVisible();
    await expect(page.getByText("Logo").first()).toBeVisible();

    await page.getByRole("button", { name: "Fill sample data" }).click();

    // The live preview shows the filled values, not the tokens.
    const frame = page.frameLocator('iframe[title="Rendered document preview"]');
    await expect(frame.getByText(/INV-2026-1042/)).toBeVisible();
    await expect(frame.getByText(/2026-10-03/)).toBeVisible();
    await expect(frame.getByText(/A4 Notebook/)).toBeVisible();

    // PDF export produces a real, filled PDF.
    const [pdfDownload] = await Promise.all([
      page.waitForEvent("download"),
      page.getByRole("button", { name: "Download PDF" }).click(),
    ]);
    const pdfPath = await pdfDownload.path();
    const pdf = readFileSync(pdfPath);
    expect(pdf.subarray(0, 4).toString("latin1")).toBe("%PDF");
    expect(pdf.length).toBeGreaterThan(1000);

    // HTML export contains the filled text and no unresolved token or script.
    const [htmlDownload] = await Promise.all([
      page.waitForEvent("download"),
      page.getByRole("button", { name: "Download HTML" }).click(),
    ]);
    const html = readFileSync(await htmlDownload.path()).toString("utf8");
    expect(html.startsWith("<!DOCTYPE html>")).toBe(true);
    expect(html).toContain("INV-2026-1042");
    expect(html).not.toContain("{{invoice_number}}");
    expect(html).not.toContain("<script");
  });

  test("the editor's Fill & Render button hands the template over directly", async ({
    page,
  }) => {
    await loadFixtureTemplate(page);

    await page.getByRole("button", { name: /Fill & Render/ }).click();
    await page.waitForURL("**/render");

    // Same template, one click later: the form is already there.
    await expect(page.getByText("Invoice Number")).toBeVisible();
    await page.getByRole("button", { name: "Fill sample data" }).click();

    const frame = page.frameLocator('iframe[title="Rendered document preview"]');
    await expect(frame.getByText(/INV-2026-1042/)).toBeVisible();
  });

  test("a placeholder spec drives the form's label, type and length", async ({
    page,
  }) => {
    await loadFixtureTemplate(page);
    // Author the contract in the editor the way the panel does, then confirm it
    // reaches the generated form rather than being lost in the handoff.
    await page.evaluate((t) => {
      window.__btm.loadTemplate(t as never);
      window.__btm.updatePlaceholder("invoice_number", {
        label: "Bill reference",
        maxLength: 8,
      });
      window.__btm.updatePlaceholder("invoice_date", { type: "date" });
    }, JSON.parse(JSON.stringify(TPL)));

    await page.getByRole("button", { name: /Fill & Render/ }).click();
    await page.waitForURL("**/render");

    await expect(page.getByText("Bill reference")).toBeVisible();
    const reference = page.locator('input[name="invoice_number"]');
    await expect(reference).toHaveAttribute("maxlength", "8");
    // The spec's date override beats the key-name inference for the other one.
    await expect(page.locator('input[name="invoice_date"]')).toHaveAttribute(
      "type",
      "date",
    );
  });

  test("the Placeholders panel edits a contract without touching raw JSON", async ({
    page,
  }) => {
    await loadFixtureTemplate(page);

    // The panel lists what the trace discovered, so it is a working inventory
    // rather than something to type keys into.
    await expect(page.getByRole("button", { name: /Invoice Number/ })).toBeVisible();
    await page.getByRole("button", { name: /Invoice Number/ }).click();

    const labelField = page.getByLabel("Form label");
    await labelField.fill("Bill reference");
    await labelField.blur();

    // A family that is not on the list is still reachable, because the whole
    // point of the field is faces the dropdown cannot know about.
    const customFamily = page.getByPlaceholder("Or any installed family");
    await customFamily.fill("Billington Script");
    await customFamily.blur();

    // The contract survives a save/load round-trip through the template.
    const stored = await page.evaluate(() =>
      window.__btm.getTemplate().meta.placeholders,
    );
    expect(stored).toEqual([
      { key: "invoice_number", label: "Bill reference", fontFamily: "Billington Script" },
    ]);

    await page.evaluate(() => window.__btm.loadTemplate(window.__btm.getTemplate()));
    await expect(page.getByRole("button", { name: /Bill reference/ })).toBeVisible();
  });
});
