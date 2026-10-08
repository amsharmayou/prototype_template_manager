import { describe, expect, it } from "vitest";

import {
  acceptsSharedPaint,
  acceptsVisibility,
  sharedSelection,
} from "@/lib/canvas/sharedSelection";
import type { TemplateObject } from "@/lib/template/types";

function obj(over: { type: TemplateObject["type"] } & Record<string, unknown>) {
  return {
    id: over.id ?? "o1",
    name: over.name ?? "o",
    role: null,
    x: 0,
    y: 0,
    width: 10,
    height: 10,
    zIndex: 0,
    opacity: 1,
    visible: true,
    locked: false,
    ...over,
  } as TemplateObject;
}

const rect = (over: Partial<TemplateObject> = {}) =>
  obj({
    type: "rect",
    stroke: "#000000",
    strokeWidth: 1.5,
    fill: "transparent",
    ...over,
  });
const line = (over: Partial<TemplateObject> = {}) =>
  obj({
    id: "o2",
    type: "line",
    stroke: "#000000",
    strokeWidth: 1.5,
    fill: "transparent",
    ...over,
  });

describe("acceptsSharedPaint", () => {
  it("accepts the objects that draw their own stroke and fill", () => {
    for (const type of [
      "rect",
      "rounded-rect",
      "ellipse",
      "line",
      "hr",
      "vr",
      "polygon",
      "freehand",
      "text",
      "field",
    ] as const) {
      expect(acceptsSharedPaint(obj({ type }))).toBe(true);
    }
  });

  it("rejects a table, whose borders are its own structure", () => {
    expect(acceptsSharedPaint(obj({ type: "table" }))).toBe(false);
  });

  it("rejects an image slot, whose dashed box is its own border", () => {
    expect(acceptsSharedPaint(obj({ type: "image-placeholder" }))).toBe(false);
  });

  it("rejects a bill part, which is an image and has no outline at all", () => {
    expect(acceptsSharedPaint(obj({ type: "bill-part" }))).toBe(false);
  });
});

describe("acceptsVisibility", () => {
  it("lets everything but a table be hidden", () => {
    expect(acceptsVisibility(obj({ type: "rect" }))).toBe(true);
    expect(acceptsVisibility(obj({ type: "bill-part" }))).toBe(true);
    expect(acceptsVisibility(obj({ type: "table" }))).toBe(false);
  });
});

describe("sharedSelection", () => {
  it("reports nothing for an empty selection", () => {
    expect(sharedSelection([])).toEqual({});
  });

  it("reports a value every object agrees on", () => {
    const s = sharedSelection([
      rect({ stroke: "#ff0000", strokeWidth: 3 }),
      line({ stroke: "#ff0000", strokeWidth: 3 }),
    ]);
    expect(s.stroke).toBe("#ff0000");
    expect(s.strokeWidth).toBe(3);
  });

  it("marks a property undefined when the objects disagree", () => {
    const s = sharedSelection([
      rect({ strokeWidth: 1 }),
      line({ strokeWidth: 4 }),
    ]);
    expect(s.strokeWidth).toBeUndefined();
    expect(s.stroke).toBe("#000000");
  });

  it("treats a stroke width of 0 as a real shared value, not a missing one", () => {
    // An author who deliberately hid the outline set 0. That is agreement, so
    // the panel shows 0 and the floor leaves it invisible.
    const s = sharedSelection([rect({ strokeWidth: 0 }), line({ strokeWidth: 0 })]);
    expect(s.strokeWidth).toBe(0);
  });

  it("ignores a table when reading a shared stroke", () => {
    // A table's borderWidth must not be mistaken for a stroke, or the panel
    // would offer to restyle the table's grid with a colour picker.
    const s = sharedSelection([
      rect({ stroke: "#000000", strokeWidth: 1.5 }),
      obj({
        id: "t1",
        type: "table",
        borderWidth: 4,
        strokeWidth: 4,
        stroke: "#123456",
      }),
    ]);
    expect(s.stroke).toBe("#000000");
    expect(s.strokeWidth).toBe(1.5);
  });

  it("reports no stroke at all when only unstrokeable objects are selected", () => {
    const s = sharedSelection([
      obj({ id: "t1", type: "table", strokeWidth: 4, stroke: "#123456" }),
      obj({ id: "b1", type: "bill-part" }),
    ]);
    expect(s.stroke).toBeUndefined();
    expect(s.strokeWidth).toBeUndefined();
  });

  it("averages opacity rather than declaring it mixed", () => {
    const s = sharedSelection([
      rect({ opacity: 1 }),
      line({ opacity: 0.5 }),
      rect({ id: "o3", opacity: 0.2 }),
    ]);
    expect(s.opacity).toBeCloseTo(0.5667, 3);
  });

  it("agrees on locked even for objects that cannot be restyled", () => {
    const s = sharedSelection([
      rect({ locked: true }),
      obj({ id: "t1", type: "table", locked: true }),
    ]);
    expect(s.locked).toBe(true);
  });

  it("excludes a table from a shared visibility but still counts it for locked", () => {
    const s = sharedSelection([
      rect({ visible: false }),
      obj({ id: "t1", type: "table", visible: true }),
    ]);
    // The table cannot be hidden, so its visible flag is not evidence about
    // the others; visibility is reported from what can actually be hidden.
    expect(s.visible).toBe(false);
    expect(s.locked).toBe(false);
  });

  it("reports an absent fill as undefined rather than as agreement on nothing", () => {
    // A freehand stroke has no fill of its own; two of them agree on nothing
    // fillable, which is not the same as agreeing the fill is transparent.
    const s = sharedSelection([
      obj({ id: "f1", type: "freehand", strokeWidth: 1.5 }),
      obj({ id: "f2", type: "freehand", strokeWidth: 1.5 }),
    ]);
    expect(s.fill).toBeUndefined();
    expect(s.strokeWidth).toBe(1.5);
  });
});