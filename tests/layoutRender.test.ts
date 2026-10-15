import { describe, expect, it } from "vitest";

import { renderHtml } from "@/lib/render";
import { emptyTemplate, TEMPLATE_VERSION } from "@/lib/template/types";
import type { BillTemplate, LayoutConfig, TemplateObject } from "@/lib/template/types";

/**
 * The layout pass, seen from where it is called.
 *
 * Two things matter here and neither is the arithmetic, which the solver's own
 * suite covers: a template with no layout block must render byte-for-byte as it
 * always has, and a template with one must actually reach the page.
 */

const base = {
  rotation: 0, opacity: 1, visible: true, locked: false, zIndex: 0, parentId: null,
  stroke: "#000000", strokeWidth: 1, fill: "transparent",
};

const text = (id: string, expansion?: unknown): TemplateObject =>
  ({
    ...base, id, type: "text", name: id, role: null, x: 10, y: 10, width: 100, height: 20,
    text: "{{a}}", fontFamily: "Arial", fontSize: 12, fontWeight: "normal",
    fontStyle: "normal", textAlign: "left", lineHeight: 1.16, charSpacing: 0,
    roleKind: "variable", textVerticalAlign: "top",
    ...(expansion ? { expansion } : {}),
  }) as TemplateObject;

const layout: LayoutConfig = {
  mode: "variable",
  document: { growthX: "fixed", growthY: "expand" },
  guides: [{ id: "g", orientation: "horizontal", position: 100 }],
  attachments: [
    { id: "a", objectId: "r1", edge: "bottom", guideId: "g", behavior: "stretch" },
  ],
};

const template = (withLayout: boolean, objects: TemplateObject[]): BillTemplate => ({
  templateVersion: TEMPLATE_VERSION,
  document: { width: 800, height: 1000 },
  meta: { name: "t", modifiedAt: "" },
  objects,
  ...(withLayout ? { layout } : {}),
});

const border: TemplateObject = {
  ...base, id: "r1", type: "rect", name: "r1", role: null,
  x: 5, y: 40, width: 200, height: 60, cornerRadius: 0,
};

describe("a template without layout is untouched", () => {
  it("renders exactly as before when no measurements are supplied", () => {
    const plain = template(false, [text("t1"), border]);

    const a = renderHtml(plain, { a: "hello" }).html;
    const b = renderHtml(plain, { a: "hello" }).html;

    expect(a).toBe(b);
    expect(a).toContain("height: 20px");
  });

  it("ignores an expansion policy when there is no layout block", () => {
    const plain = template(false, [
      text("t1", { x: { mode: "fixed" }, y: { mode: "unbounded" } }),
      border,
    ]);

    const { html } = renderHtml(plain, { a: "hello" }, {
      measurements: { t1: { naturalWidth: 500, height: 300 } },
    });

    expect(html).toContain("height: 20px");
  });
});

describe("a layout template reaches the page", () => {
  it("expands the field to the measured content height", () => {
    const t = template(true, [
      text("t1", { x: { mode: "fixed" }, y: { mode: "unbounded", growthGuideId: "g" } }),
      border,
    ]);

    const { html } = renderHtml(t, { a: "hello" }, {
      measurements: { t1: { naturalWidth: 80, height: 90 } },
    });

    expect(html).toContain("height: 90px");
  });

  it("stretches the attached border and grows the page", () => {
    const t = template(true, [
      text("t1", { x: { mode: "fixed" }, y: { mode: "unbounded", growthGuideId: "g" } }),
      border,
    ]);

    const { html, warnings } = renderHtml(t, { a: "hello" }, {
      measurements: { t1: { naturalWidth: 80, height: 90 } },
    });

    // Border top stays at 40 and its bottom follows the guide to 100.
    expect(html).toContain("height: 60px");
    expect(warnings).toEqual([]);
  });

  it("reports a field that could not be given the room it needs", () => {
    const t = template(true, [
      text("t1", { x: { mode: "fixed" }, y: { mode: "bounded", maxGrowth: 10 } }),
      border,
    ]);

    const { warnings } = renderHtml(t, { a: "hello" }, {
      measurements: { t1: { naturalWidth: 80, height: 300 } },
    });

    expect(warnings.join(" ")).toContain("t1");
  });

  it("renders unchanged when a layout template has no measurements to use", () => {
    const t = template(true, [
      text("t1", { x: { mode: "fixed" }, y: { mode: "unbounded", growthGuideId: "g" } }),
      border,
    ]);

    const { html } = renderHtml(t, { a: "hello" });

    expect(html).toContain("height: 20px");
    expect(html).toContain("height: 60px");
  });
});

describe("re-measuring a field the solver widened", () => {
  const widening = () =>
    template(true, [
      text("t1", { x: { mode: "unbounded" }, y: { mode: "unbounded" } }),
      border,
    ]);

  it("settles the height at the width the field was widened to", () => {
    // Measured at the base width the text wraps to 90px. Once the field is
    // 400px wide the same text is one line, and 32px is what it will really be
    // painted at - a host with a font engine settles it, an upper bound does not.
    const { objects } = renderHtml(widening(), { a: "hello" }, {
      measurements: { t1: { naturalWidth: 400, height: 90 } },
      remeasure: () => ({ naturalWidth: 400, height: 32 }),
    });

    expect(objects.find((o) => o.id === "t1")!.height).toBe(32);
  });

  it("keeps the base-width measurement when the host cannot re-measure", () => {
    const { objects } = renderHtml(widening(), { a: "hello" }, {
      measurements: { t1: { naturalWidth: 400, height: 90 } },
    });

    expect(objects.find((o) => o.id === "t1")!.height).toBe(90);
  });

  it("keeps the original figure when the host declines to re-measure one", () => {
    const { objects } = renderHtml(widening(), { a: "hello" }, {
      measurements: { t1: { naturalWidth: 400, height: 90 } },
      remeasure: () => undefined,
    });

    expect(objects.find((o) => o.id === "t1")!.height).toBe(90);
  });

  it("ignores a re-measurement that is not a finite size", () => {
    const { objects } = renderHtml(widening(), { a: "hello" }, {
      measurements: { t1: { naturalWidth: 400, height: 90 } },
      remeasure: () => ({ naturalWidth: Number.NaN, height: Number.POSITIVE_INFINITY }),
    });

    expect(objects.find((o) => o.id === "t1")!.height).toBe(90);
  });

  it("never asks about a field whose width did not change", () => {
    const t = template(true, [
      text("t1", { x: { mode: "fixed" }, y: { mode: "unbounded", growthGuideId: "g" } }),
      border,
    ]);
    const asked: string[] = [];

    renderHtml(t, { a: "hello" }, {
      measurements: { t1: { naturalWidth: 80, height: 90 } },
      remeasure: (id) => {
        asked.push(id);
        return undefined;
      },
    });

    expect(asked).toEqual([]);
  });
});

describe("the fingerprint tells a layout change apart from a cosmetic one", () => {
  const hash = (t: BillTemplate) =>
    /data-template-hash="([0-9a-f]{64})"/.exec(renderHtml(t).html)![1];

  it("differs when only the layout rules differ", () => {
    // Otherwise two templates that lay out differently would share a
    // fingerprint, and every cache keyed on it would serve the wrong bill.
    const withRule = template(true, [text("t1"), border]);
    const other = template(
      true,
      [text("t1"), border],
    );
    other.layout = { ...layout, guides: [{ id: "g", orientation: "horizontal", position: 140 }] };

    expect(hash(withRule)).not.toBe(hash(other));
  });
});

describe("a variable-layout template still renders an empty page sanely", () => {
  it("handles the empty template", () => {
    const empty: BillTemplate = { ...emptyTemplate(), layout: { mode: "variable" } };

    const { html, variables } = renderHtml(empty, {});

    expect(html).toContain("<!DOCTYPE html>");
    expect(variables).toEqual([]);
  });
});