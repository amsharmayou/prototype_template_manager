/**
 * Proves variable repeat rows through the *real* host contract.
 *
 * Loads the same `billkit.js` the Android WebView runs, then drives
 * `measurePlan -> measure -> render` by hand inside a browser - which is the
 * only place the DOM half can be exercised. Everything here is the shipped
 * bundle, not a test double, so a regression in the bridge or the measurer
 * shows up as a wrong row height rather than as a green unit test.
 *
 * Run with:  npm run test:e2e
 */
import { expect, test } from "@playwright/test";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const ROOT = resolve(__dirname, "..");
const BUNDLE = resolve(ROOT, "public", "billkit.js");

/**
 * The demo template, generated rather than committed.
 *
 * A checked-in copy would drift from the generator, and a fixture that no
 * longer matches what the tool produces is worse than no fixture.
 */
function demoTemplate(): string {
  const dir = mkdtempSync(join(tmpdir(), "billkit-rows-"));
  try {
// `npx.cmd` rather than `npx`: on Windows the bare name is a batch script
    // that cannot be spawned directly, and a missing fixture fails as an
    // ENOENT that looks nothing like the real problem.
    execFileSync(
      process.platform === "win32" ? "npx.cmd" : "npx",
      ["tsx", "tools/make-rows-demo.ts", join(dir, "demo.btpkg")],
      { cwd: ROOT, stdio: "pipe", shell: process.platform === "win32" },
    );
    return readFileSync(join(dir, "demo.template.json"), "utf8");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

/**
 * Long enough to genuinely wrap.
 *
 * The description column is 538px of usable width, so a merely "long" string
 * still fits on one line and the row correctly refuses to grow. These are sized
 * to overflow it, which is the only way this test can tell a working row height
 * from a traced one that never needed to move.
 */
const ITEMS = [
  { desc: "Short one", amount: "10" },
  {
    desc:
      "A considerably longer description of the goods supplied, including the extended warranty and the " +
      "delivery details that were agreed with the customer at the time of ordering, which wraps well " +
      "past the width of the column it is printed in",
    amount: "25",
  },
  { desc: "Third", amount: "5" },
];

function rowHeights(html: string): number[] {
  return [...html.matchAll(/<tr style="height: ([\d.]+)px">/g)].map((m) => Number(m[1]));
}

test.describe("variable repeat rows through the host contract", () => {
  test("rows grow to fit their tallest cell", async ({ page }) => {
    const bundle = readFileSync(BUNDLE, "utf8");
    const template = demoTemplate();
    const values = JSON.stringify({ items: JSON.stringify(ITEMS) });
    const computed = JSON.stringify([
      { key: "total", op: "sum", args: ["items.amount"] },
    ]);

    await page.goto("about:blank");
    await page.addScriptTag({ content: bundle });

    const result = await page.evaluate(
      ({ template, values, computed }) => {
const api = (window as unknown as {
          billkit: {
            measurePlan: (...a: string[]) => unknown[];
            measure: (plan: unknown[]) => unknown;
            render: (...a: string[]) => unknown;
          };
        }).billkit;
        const plan = api.measurePlan(template, values, computed) as Array<{
          id: string;
          text: string;
          width: number;
          wrap: boolean;
          kind?: string;
        }>;
        // The plan crosses to `measure` as an array, not as JSON: it was just
        // built here, so serialising it would only add a parse on both sides.
        const measurements = api.measure(plan) as Record<
          string,
          { naturalWidth: number; height: number }
        >;
        const rendered = api.render(
          template,
          values,
          computed,
          JSON.stringify(measurements),
        ) as { html: string; warnings: string[] };

        return {
          plan,
          measurements,
          html: rendered.html,
          warnings: rendered.warnings,
        };
      },
      { template, values, computed },
    );

    // The plan has to reach every rendered cell, keyed by expanded row.
    expect(result.plan.length).toBeGreaterThan(0);
    expect(result.plan.some((r) => r.kind === "cell")).toBe(true);

    // 1 header + 3 items + 1 trailer.
    const heights = rowHeights(result.html);
    expect(heights).toHaveLength(5);

    // The long description must have produced a visibly taller row than the
    // short ones. This is the assertion the whole feature exists for.
    expect(heights[2]).toBeGreaterThan(heights[1]);
    expect(heights[2]).toBeGreaterThan(heights[3]);

    // The trailer sits below the whole band.
    expect(heights[4]).toBeGreaterThan(0);

// The total is computed from values, never from row heights.
    expect(result.html).toContain("40.00");

    // The long description must actually have been measured as a multi-line
    // block. If it were measured at the full table width instead of the
    // column, it would come back as a single line and this row would stay at
    // its traced height - which is the bug this test exists to catch.
    const longId = result.plan.find((r) => r.text.startsWith("A considerably"))?.id;
    expect(longId).toBeTruthy();
    expect(result.measurements[longId!].height).toBeGreaterThan(20);
  });

  test("the measured plan matches what actually renders", async ({ page }) => {
    const bundle = readFileSync(BUNDLE, "utf8");
    const template = demoTemplate();
    const values = JSON.stringify({ items: JSON.stringify(ITEMS) });
    const computed = JSON.stringify([
      { key: "total", op: "sum", args: ["items.amount"] },
    ]);

    await page.goto("about:blank");
    await page.addScriptTag({ content: bundle });

    const { plan, measured } = await page.evaluate(
      ({ template, values, computed }) => {
const api = (window as unknown as {
          billkit: {
            measurePlan: (...a: string[]) => Array<{ id: string }>;
            measure: (plan: unknown[]) => unknown;
          };
        }).billkit;
        const plan = api.measurePlan(template, values, computed);
        return { plan, measured: api.measure(plan) };
      },
      { template, values, computed },
    );

    // Every key the plan asks for must come back measured: a silently dropped
    // cell is a row that keeps its traced height with nothing to indicate why.
    const ids = plan.map((r) => r.id);
    for (const id of ids) {
      expect(Object.keys(measured as object)).toContain(id);
    }
  });
});

