import { expect, test, type Page } from "@playwright/test";
import { existsSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

/**
 * The share file's whole promise is that it works with nothing but a browser:
 * no server, no build step, no network. So these tests open it straight off
 * disk over `file://` and never touch the dev server the rest of the suite runs
 * against - if the kit needed an origin, it would fail here.
 */

const FIXTURE = join(process.cwd(), "e2e", "fixtures", "shared-template.html");

function sharedFileUrl(): string {
  return pathToFileURL(FIXTURE).href;
}

/** Load a template straight into the editor, without tracing one first. */
async function loadEditorTemplate(page: Page): Promise<void> {
  await page.goto("/");
  // The editor canvas only exists once a bill has been opened.
  await page
    .locator('input[type="file"][accept*="image/png"]')
    .first()
    .setInputFiles("e2e/fixtures/test-bill.png");
  await page.locator("canvas.upper-canvas").waitFor({ state: "attached" });
  await page.waitForFunction(() => Boolean(window.__btm?.getCanvas()));
  await page.evaluate(() => {
    const template = {
      templateVersion: 1,
      document: { width: 794, height: 1123 },
      meta: { name: "Shared from the editor", modifiedAt: "2026-10-04T00:00:00.000Z" },
      objects: [],
    };
    window.__btm?.loadTemplate(template as never);
  });
}

test.describe("Standalone shared template file", () => {
  test.skip(
    !existsSync(FIXTURE),
    "run `npm run build:share && npx tsx e2e/make-share-fixture.ts` first",
  );

  test("generates its form and previews the document offline", async ({ page }) => {
    await page.goto(sharedFileUrl());

    // The template's name and its placeholders became a form, offline.
    await expect(page.getByRole("heading", { name: "Shared tax invoice" })).toBeVisible();
    await expect(page.getByText("Your company name")).toBeVisible();
    await expect(page.getByText("Invoice number")).toBeVisible();

    // The spec's maxLength reached the real input.
    const invoiceRef = page.locator('input[name="invoice_ref"]');
    await expect(invoiceRef).toHaveAttribute("maxlength", "12");
    await invoiceRef.fill("INV-0001234567890");
    expect(await invoiceRef.evaluate((el) => (el as HTMLInputElement).value.length)).toBe(
      12,
    );

    // Typing updates the preview frame with the value, not the token.
    const preview = page.frameLocator('iframe[title="Preview"]');
    await expect(preview.getByText(/INV-000123/)).toBeVisible();
    await expect(preview.getByText("Static footer text")).toBeVisible();

    // A placeholder nobody filled is called out rather than silently printed.
    await expect(page.locator("#status")).toContainText("company");
  });

  test("applies the placeholder's printed style inside the preview", async ({ page }) => {
    await page.goto(sharedFileUrl());
    await page.locator('input[name="company"]').fill("Northwind Traders");

    const preview = page.frameLocator('iframe[title="Preview"]');
    const company = preview.getByText("Northwind Traders");
    await expect(company).toBeVisible();
    // The spec asked for Georgia + bold, not the host box's Arial.
    await expect(company).toHaveCSS("font-weight", "700");
    await expect(company).toHaveCSS("font-family", /Georgia/);
  });

  test("shows the traced colours in the shared document, not black", async ({
    page,
  }) => {
    await page.goto(sharedFileUrl());
    const preview = page.frameLocator('iframe[title="Preview"]');

    // A traced text colour must survive the trip into the offline render, even
    // when it is not the colour of the "Fill / print" path's default black.
    const footer = preview.getByText("Static footer text");
    await expect(footer).toHaveCSS("color", "rgb(185, 28, 28)");
  });

  test("keeps an unfilled placeholder legible instead of printing nothing", async ({
    page,
  }) => {
    await page.goto(sharedFileUrl());
    const preview = page.frameLocator('iframe[title="Preview"]');
    await expect(preview.getByText("{{company}}")).toBeVisible();
  });

  test("asks for a tickmark as a tickmark, not a free-text box", async ({
    page,
  }) => {
    await page.goto(sharedFileUrl());

    // The author set this slot's type to tickmark on the canvas. The generated
    // form has to honour it: a text input meant a bill could be answered
    // "maybe" and the tickmark branches of the form were unreachable.
    const tick = page.locator('select[name="paid"]');
    await expect(tick).toBeVisible();
    await expect(tick.locator("option")).toHaveText(["—", "✓", "✗"]);

    // Choosing one prints the glyph in the preview. Scoped to the paid slot's
    // own position because the checkbox slot below prints the same glyph.
    const preview = page.frameLocator('iframe[title="Preview"]');
    await expect(preview.getByText("{{paid}}")).toBeVisible();
    await tick.selectOption("✓");
    await expect(preview.getByText("{{paid}}")).toBeHidden();
    await expect(preview.getByText("✓").first()).toBeVisible();

    // An empty tick is left out of the values, so the token stays visible
    // rather than the slot being erased from the printed bill.
    await tick.selectOption("");
    await expect(preview.getByText("{{paid}}")).toBeVisible();
  });

  test("asks for a checkbox and prints a tick only when it is ticked", async ({
    page,
  }) => {
    await page.goto(sharedFileUrl());
    const box = page.locator('input[name="gift_wrap"][type="checkbox"]');
    await expect(box).toBeVisible();

    const preview = page.frameLocator('iframe[title="Preview"]');
    // Unticked, a checkbox prints nothing. Its `value` attribute is the tick
    // glyph, so reading that instead of its checked state would have shown a
    // tick nobody gave.
    await expect(preview.getByText("{{gift_wrap}}")).toBeVisible();
    await box.check();
    await expect(preview.getByText("{{gift_wrap}}")).toBeHidden();
    await box.uncheck();
    await expect(preview.getByText("{{gift_wrap}}")).toBeVisible();
  });

  test("prints a field with its own alignment and font", async ({ page }) => {
    await page.goto(sharedFileUrl());
    const preview = page.frameLocator('iframe[title="Preview"]');

    const note = preview.getByText("{{terms_note}}");
    await expect(note).toBeVisible();
    // Right-aligned, Georgia, bold, 20px — the field's own styling, not the
    // shared default of Arial 14 / left.
    await expect(note).toHaveCSS("text-align", "right");
    await expect(note).toHaveCSS("font-family", /Georgia/);
    await expect(note).toHaveCSS("font-weight", "700");
    await expect(note).toHaveCSS("font-size", "20px");
  });

  test("lists fields placed with the field tool under their own heading", async ({
    page,
  }) => {
    await page.goto(sharedFileUrl());
    // These slots report `source: "field"`. Without a group for that source the
    // share page filtered them out and told the recipient there was nothing
    // to fill.
    await expect(
      page.getByRole("heading", { name: "Fields", exact: true }),
    ).toBeVisible();
    await expect(page.getByText("Paid")).toBeVisible();
    await expect(page.locator("#status")).not.toContainText(
      "This template has no dynamic placeholders",
    );
  });

  test("prints a field's value in black, bounded by its box", async ({ page }) => {
    await page.goto(sharedFileUrl());
    await page.locator('select[name="paid"]').selectOption("✓");

    const preview = page.frameLocator('iframe[title="Preview"]');
    const tick = preview.getByText("✓").first();
    await expect(tick).toBeVisible();
    // Black, not the blue tint the editor draws behind a field marker.
    await expect(tick).toHaveCSS("color", "rgb(0, 0, 0)");
    // And bounded: the clip is on the field's own box, which is the element
    // wrapping the text, not the inner text node itself.
    const overflow = await tick.evaluate(
      (el) => getComputedStyle(el.parentElement as HTMLElement).overflow,
    );
    expect(overflow).toBe("hidden");
  });

  test("wraps a long field value onto the next line inside its box", async ({
    page,
  }) => {
    await page.goto(sharedFileUrl());
    // A text field slot, filled with a value far wider than the box.
    await page.locator('input[name="terms_note"]').fill(
      "Terms and conditions of sale and delivery apply to every order",
    );

    const preview = page.frameLocator('iframe[title="Preview"]');
    const note = preview.getByText(/Terms and conditions of sale/);
    await expect(note).toBeVisible();

    const box = await note.evaluate((el) => {
      const parent = el.parentElement as HTMLElement;
      const cs = getComputedStyle(parent);
      return {
        whiteSpace: cs.whiteSpace,
        overflowWrap: cs.overflowWrap,
        height: cs.height,
        width: cs.width,
        scrollWidth: parent.scrollWidth,
        clientWidth: parent.clientWidth,
      };
    });
    // Wraps rather than being cut off, at the slot's own width.
    expect(box.whiteSpace).toBe("pre-wrap");
    expect(box.overflowWrap).toBe("break-word");
    // The wrapped text stays inside the boundary rather than spilling.
    expect(box.scrollWidth).toBeLessThanOrEqual(box.clientWidth + 1);
  });
});

test.describe("Sharing a template out of the editor", () => {
  test.skip(
    !existsSync(FIXTURE),
    "run `npm run build:share && npx tsx e2e/make-share-fixture.ts` first",
  );

  test("downloads one file carrying both the kit and the template", async ({ page }) => {
    await loadEditorTemplate(page);

    const [download] = await Promise.all([
      page.waitForEvent("download"),
      page.getByRole("button", { name: "Share", exact: true }).click(),
    ]);
    expect(download.suggestedFilename()).toMatch(/\.html$/);

    const html = readFileSync(await download.path(), "utf8");
    expect(html.startsWith("<!DOCTYPE html>")).toBe(true);
    // The kit and the template both travel inside the one file.
    expect(html).toContain("bootShareKit");
    expect(html).toContain("Shared from the editor");
    // Nothing is fetched at runtime.
    expect(html).not.toContain("<script src=");
    expect(html).not.toContain("/sharekit.js");
  });

  test("the shared file it produces opens and works on its own", async ({ page }) => {
    await loadEditorTemplate(page);
    const [download] = await Promise.all([
      page.waitForEvent("download"),
      page.getByRole("button", { name: "Share", exact: true }).click(),
    ]);
    const saved = join(tmpdir(), "btm-downloaded-share.html");
    await download.saveAs(saved);

    await page.goto(pathToFileURL(saved).href);
    await expect(page.getByRole("heading", { name: "Shared from the editor" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Print / Save as PDF" })).toBeVisible();
  });
});