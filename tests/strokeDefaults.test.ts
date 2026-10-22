import { describe, expect, it } from "vitest";

import {
  DEFAULT_STROKE_WIDTH,
  MIN_STROKE_DEVICE_PX,
  applyStrokeFloor,
  renderedStrokeWidth,
  usesDefaultStroke,
} from "@/lib/canvas/strokeDefaults";

describe("renderedStrokeWidth", () => {
  it("leaves a normal stroke alone at or above 100% zoom", () => {
    // Above 1:1 the stroke scales with the page, which is what keeps a traced
    // line in proportion with the reference it was drawn over.
    expect(renderedStrokeWidth(1.5, 1)).toBe(1.5);
    expect(renderedStrokeWidth(1.5, 2)).toBe(1.5);
    expect(renderedStrokeWidth(1.5, 4)).toBe(1.5);
  });

  it("raises the width below 100% zoom so it never paints under a device pixel", () => {
    expect(renderedStrokeWidth(1.5, 0.5)).toBe(2);
    expect(renderedStrokeWidth(1, 0.25)).toBe(MIN_STROKE_DEVICE_PX / 0.25);
  });

  it("never returns less than the stored width", () => {
    for (const zoom of [0.1, 0.25, 0.5, 1, 1.5, 2, 8]) {
      expect(renderedStrokeWidth(1.5, zoom)).toBeGreaterThanOrEqual(1.5);
    }
  });

  it("respects a stroke deliberately set to zero", () => {
    // No stroke is a real choice; the floor must not invent a visible line.
    expect(renderedStrokeWidth(0, 0.25)).toBe(0);
    expect(renderedStrokeWidth(0, 1)).toBe(0);
  });

  it("passes through a non-finite or negative width unchanged", () => {
    expect(renderedStrokeWidth(-2, 0.5)).toBe(-2);
    expect(renderedStrokeWidth(Number.NaN, 0.5)).toBeNaN();
  });

  it("treats a non-positive zoom as 1:1 rather than dividing by zero", () => {
    expect(renderedStrokeWidth(2, 0)).toBe(2);
    expect(renderedStrokeWidth(2, Number.NaN)).toBe(2);
  });
});

describe("usesDefaultStroke", () => {
  it("covers every outline tool", () => {
    for (const kind of [
      "line",
      "hr",
      "vr",
      "rect",
      "rounded-rect",
      "ellipse",
      "polygon",
      "freehand",
    ]) {
      expect(usesDefaultStroke({ appType: kind })).toBe(true);
    }
  });

  it("excludes objects with their own border settings", () => {
    // A table's borders and a field's or image slot's box are structure, not a
    // traced line, and the floor must not imply the author drew them thinner.
    for (const kind of ["table", "field", "image-placeholder", "text", "bill-part"]) {
      expect(usesDefaultStroke({ appType: kind })).toBe(false);
    }
  });

  it("falls back to the template type when there is no appType", () => {
    expect(usesDefaultStroke({ type: "line" })).toBe(true);
    expect(usesDefaultStroke({ type: "table" })).toBe(false);
    expect(usesDefaultStroke({})).toBe(false);
  });
});

describe("DEFAULT_STROKE_WIDTH", () => {
  it("is a positive finite document-unit width", () => {
    expect(DEFAULT_STROKE_WIDTH).toBeGreaterThan(0);
    expect(Number.isFinite(DEFAULT_STROKE_WIDTH)).toBe(true);
  });

  it("survives a 25% zoom by painting at least a device pixel", () => {
    // 1.5 document units would be 0.375 device pixels at 25%, so the floor
    // takes over and the stroke paints a clean 1px line instead of fading out.
    const painted = renderedStrokeWidth(DEFAULT_STROKE_WIDTH, 0.25);
    expect(painted).toBe(MIN_STROKE_DEVICE_PX / 0.25);
    expect(painted * 0.25).toBeCloseTo(MIN_STROKE_DEVICE_PX, 10);
  });
});

describe("applyStrokeFloor", () => {
  it("marks outline objects for stretch-proof, uncached painting", () => {
    // Without strokeUniform Fabric multiplies the painted stroke by the
    // object's scaleX/scaleY, so a stretched shape thickens instead of merely
    // growing. The floor override only works on an object that paints fresh
    // each frame, which is why objectCaching has to be off as well.
    const obj = {
      strokeWidth: 1.5,
      _render(): void {},
      set(patch: Record<string, unknown>): void {
        Object.assign(obj, patch);
      },
    };
    applyStrokeFloor(obj as never, () => 1);
    expect(obj).toMatchObject({ objectCaching: false, strokeUniform: true });
  });
});