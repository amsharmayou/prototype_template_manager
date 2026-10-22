import { describe, expect, it } from "vitest";

import { fillTemplate } from "@/lib/template/dataBinding";
import { renderHtml } from "@/lib/render";
import type { BillTemplate } from "@/lib/template/types";

/**
 * New_Expandable §17 worked example, driven end to end.
 *
 * A standalone nested template (outer → inner → growing field + anchored
 * footer) committed as JSON so this suite runs without the demo tool. A long
 * address grows the field, the inner panel and the outer frame together,
 * while the footer keeps its bottom inset.
 */

import nested from "./fixtures/nested-demo.template.json";

const LINE = 12 * 1.16;

function renderWith(lines: number) {
  const t = nested as unknown as BillTemplate;
  const values = { customer_address: Array.from({ length: lines }, (_, i) => `Line ${i + 1}`).join("\n") };
  const filled = fillTemplate(t, values);
  return renderHtml(filled, values, {
    measurements: { f_address: { naturalWidth: 200, height: lines * LINE } },
  });
}

const box = (objects: BillTemplate["objects"], id: string) => {
  const o = objects.find((x) => x.id === id);
  if (!o) throw new Error(`no object ${id}`);
  return { x: o.x, y: o.y, width: o.width, height: o.height };
}

describe("the nested demo grows together", () => {
  it("grows field, inner panel and outer frame with a long value", () => {
    const short = renderWith(1);
    const long = renderWith(10);

    expect(box(long.objects, "f_address").height).toBeGreaterThan(box(short.objects, "f_address").height);
    expect(box(long.objects, "inner").height).toBeGreaterThan(box(short.objects, "inner").height);
    expect(box(long.objects, "outer").height).toBeGreaterThan(box(short.objects, "outer").height);
    // Inner keeps its 8px bottom pad; outer keeps its 10px bottom pad.
    expect(box(long.objects, "inner").height).toBeCloseTo(
      box(long.objects, "f_address").y + box(long.objects, "f_address").height + 8 - box(long.objects, "inner").y,
      0,
    );
  });

  it("keeps the footer at the inner panel's bottom inset", () => {
    const long = renderWith(10);
    const inner = box(long.objects, "inner");
    const footer = box(long.objects, "t_footer");
    // Authored 20px above the inner bottom (200-190... panel grew, inset kept).
    const baseInner = (nested as unknown as BillTemplate).objects.find((o) => o.id === "inner")!;
    const baseFooter = (nested as unknown as BillTemplate).objects.find((o) => o.id === "t_footer")!;
    const inset = baseInner.y + baseInner.height - (baseFooter.y + baseFooter.height);
    expect(footer.y + footer.height).toBeCloseTo(inner.y + inner.height - inset, 1);
  });

  it("renders the same bill twice and shrinks back on a short value", () => {
    expect(JSON.stringify(renderWith(10))).toBe(JSON.stringify(renderWith(10)));
    const grown = renderWith(10);
    const shrunk = renderWith(1);
    expect(box(shrunk.objects, "outer").height).toBeLessThan(box(grown.objects, "outer").height);
  });
});
