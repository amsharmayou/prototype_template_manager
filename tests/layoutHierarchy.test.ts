import { describe, expect, it } from "vitest";
import { calculateLayout } from "@/lib/render/layout";
import type { LayoutInput } from "@/lib/render/layout";
import type { ContentMeasurement } from "@/lib/render/measure";
import { validateLayout } from "@/lib/package/layout";
import type { DocumentLayoutPolicy, ObjectExpansion, TemplateObject } from "@/lib/template/types";

const base = {
  rotation: 0, opacity: 1, visible: true, locked: false, zIndex: 0, parentId: null,
  stroke: "#000000", strokeWidth: 1, fill: "transparent",
};
const rect = (id: string, x: number, y: number, w: number, h: number, extra?: Record<string, unknown>): TemplateObject =>
  ({ ...base, id, type: "rect", name: id, role: null, x, y, width: w, height: h, cornerRadius: 0, ...extra }) as TemplateObject;
const text = (id: string, x: number, y: number, w: number, h: number, extra?: Record<string, unknown>): TemplateObject =>
  ({
    ...base, id, type: "text", name: id, role: null, x, y, width: w, height: h,
    text: "{{a}}", fontFamily: "Arial", fontSize: 12, fontWeight: "normal",
    fontStyle: "normal", textAlign: "left", lineHeight: 1.16, charSpacing: 0,
    roleKind: "variable", textVerticalAlign: "top", ...extra,
  }) as TemplateObject;
const needs = (w: number, h: number): ContentMeasurement => ({ naturalWidth: w, height: h });
const FIXED: DocumentLayoutPolicy = { growthX: "fixed", growthY: "fixed" };
function run(p: Partial<LayoutInput> & { objects: TemplateObject[] }): ReturnType<typeof calculateLayout> {
  return calculateLayout({
    objects: p.objects, measurements: p.measurements ?? {}, guides: p.guides ?? [],
    attachments: p.attachments ?? [], documentPolicy: p.documentPolicy ?? FIXED,
    document: p.document ?? { width: 800, height: 1000 },
    ...(p.collision !== undefined ? { collision: p.collision } : {}),
  });
}
const boxOf = (objects: TemplateObject[], id: string) => {
  const o = objects.find((x) => x.id === id);
  if (!o) throw new Error(`no object ${id}`);
  return { x: o.x, y: o.y, width: o.width, height: o.height };
};
const GROW_Y: ObjectExpansion = { x: { mode: "fixed" }, y: { mode: "unbounded", strategy: "wrap" } };

describe("explicit container membership", () => {
  it("grows an enabled container around its declared child, keeping padding", () => {
    const out = run({
      objects: [
        rect("outer", 10, 10, 200, 100, { container: { enabled: true, padding: { top: 5, right: 5, bottom: 10, left: 5 } } }),
        text("t1", 15, 15, 100, 20, { expansion: GROW_Y, layoutParentId: "outer" }),
      ],
      measurements: { t1: needs(80, 120) },
    });
    expect(boxOf(out.objects, "t1").height).toBeCloseTo(120, 5);
    expect(boxOf(out.objects, "outer").height).toBeCloseTo(135, 5);
  });
  it("leaves a plain frame alone: proximity never creates membership", () => {
    const out = run({
      objects: [rect("frame", 10, 10, 200, 100), text("t1", 15, 15, 100, 20, { expansion: GROW_Y })],
      measurements: { t1: needs(80, 120) },
    });
    expect(boxOf(out.objects, "frame")).toEqual({ x: 10, y: 10, width: 200, height: 100 });
  });
  it("reports a child that outgrows a fixed container", () => {
    const out = run({
      objects: [
        rect("box", 10, 10, 200, 40, { container: { enabled: true, growthY: "fixed" } }),
        text("t1", 15, 15, 100, 20, { expansion: GROW_Y, layoutParentId: "box" }),
      ],
      measurements: { t1: needs(80, 200) },
    });
    expect(boxOf(out.objects, "box").height).toBeCloseTo(40, 5);
    expect(out.diagnostics.join(" ")).toContain("t1");
  });
});

describe("nested containers propagate inner to outer", () => {
  it("grows the outer frame when the inner panel grows", () => {
    const out = run({
      objects: [
        rect("outer", 0, 0, 300, 150, { container: { enabled: true, padding: { top: 10, right: 10, bottom: 10, left: 10 } } }),
        rect("inner", 10, 10, 200, 100, {
          container: { enabled: true, padding: { top: 5, right: 5, bottom: 5, left: 5 } },
          layoutParentId: "outer",
        }),
        text("t1", 15, 15, 100, 20, { expansion: GROW_Y, layoutParentId: "inner" }),
      ],
      measurements: { t1: needs(80, 150) },
    });
    expect(boxOf(out.objects, "inner").height).toBeCloseTo(160, 5);
    expect(boxOf(out.objects, "outer").height).toBeCloseTo(180, 5);
  });
});

describe("sibling anchors", () => {
  it("keeps a bottom-anchored label at the parent bottom inset", () => {
    const out = run({
      objects: [
        rect("box", 10, 10, 200, 100, { container: { enabled: true, padding: { top: 5, right: 5, bottom: 5, left: 5 } } }),
        text("grower", 15, 15, 100, 20, { expansion: GROW_Y, layoutParentId: "box" }),
        text("label", 15, 80, 100, 20, { layoutParentId: "box", anchor: { vertical: "end" } }),
      ],
      measurements: { grower: needs(80, 150) },
    });
    const box = boxOf(out.objects, "box");
    const label = boxOf(out.objects, "label");
    expect(label.y + label.height).toBeCloseTo(box.y + box.height - 10, 1);
    expect(boxOf(out.objects, "grower").y).toBeCloseTo(15, 5);
  });
  it("keeps a top-anchored sibling exactly where drawn", () => {
    const out = run({
      objects: [
        rect("box", 10, 10, 200, 100, { container: { enabled: true } }),
        text("grower", 15, 15, 100, 20, { expansion: GROW_Y, layoutParentId: "box" }),
        text("top", 15, 15, 50, 10, { layoutParentId: "box", anchor: { vertical: "start" } }),
      ],
      measurements: { grower: needs(80, 120) },
      collision: "allow",
    });
    expect(boxOf(out.objects, "top").y).toBeCloseTo(15, 5);
  });
});

describe("collisions", () => {
  const overlapping = () => [
    rect("box", 10, 10, 200, 200, { container: { enabled: true } }),
    text("a", 15, 15, 100, 60, { layoutParentId: "box" }),
    text("b", 15, 40, 100, 60, { layoutParentId: "box" }),
  ];
  it("reports siblings that overlap inside one container", () => {
    const out = run({ objects: overlapping() });
    expect(out.diagnostics.join(" ")).toContain("overlaps");
  });
  it("stays silent with collision allow", () => {
    const out = run({ objects: overlapping(), collision: "allow" });

    expect(out.diagnostics.join(" ")).not.toContain("overlaps");
  });
});

/* 9.4 */ describe("container padding and size limits", () => {
  const frame = (policy: Record<string, unknown>) => rect("frame", 100, 40, 200, 120, { container: policy });

  it("leaves room for the configured padding on every side", () => {
    const out = run({
      objects: [
        frame({ enabled: true, padding: { top: 4, right: 20, bottom: 4, left: 8 } }),
        text("t1", 108, 44, 100, 20, { layoutParentId: "frame", expansion: { x: { mode: "unbounded" }, y: { mode: "unbounded" } } }),
      ],
      measurements: { t1: needs(300, 120) },
    });

    // Child bottom 44 + 120 = 164, plus 4px of padding.
    expect(boxOf(out.objects, "frame").height).toBeCloseTo(128, 5);
    // Child right 108 + 300 = 408, plus 20px of padding.
    expect(boxOf(out.objects, "frame").width).toBeCloseTo(328, 5);
  });

  it("never shrinks below the configured minimum size", () => {
    const out = run({
      objects: [
        frame({ enabled: true, minWidth: 260, minHeight: 180 }),
        text("t1", 108, 44, 20, 20, { layoutParentId: "frame" }),
      ],
    });

    expect(boxOf(out.objects, "frame").width).toBe(260);
    expect(boxOf(out.objects, "frame").height).toBe(180);
  });

  it("stops at the configured maximum size and reports nothing else", () => {
    const out = run({
      objects: [
        frame({ enabled: true, maxWidth: 240, maxHeight: 200 }),
        text("t1", 108, 44, 100, 20, { layoutParentId: "frame", expansion: { x: { mode: "unbounded" }, y: { mode: "unbounded" } } }),
      ],
      measurements: { t1: needs(400, 300) },
    });

    expect(boxOf(out.objects, "frame").width).toBe(240);
    expect(boxOf(out.objects, "frame").height).toBe(200);
    // The container was told to stop, so the content no longer fits it.
    expect(out.diagnostics.join(" ")).toContain("t1");
  });

  it("never grows past the maximum, and reports that the content did not fit", () => {
    const out = run({
      objects: [
        frame({ enabled: true, maxWidth: 240, maxHeight: 200, padding: { top: 0, right: 0, bottom: 0, left: 0 } }),
        text("t1", 108, 44, 100, 20, { layoutParentId: "frame", expansion: { x: { mode: "unbounded" }, y: { mode: "unbounded" } } }),
      ],
      measurements: { t1: needs(400, 300) },
    });

    expect(boxOf(out.objects, "frame").width).toBeLessThanOrEqual(240);
    expect(boxOf(out.objects, "frame").height).toBeLessThanOrEqual(200);
  });
});

/* 9.5, 14.2 */ describe("anchors on both axes", () => {
  const panel = () =>
    rect("panel", 100, 40, 200, 120, {
      container: { enabled: true, growthX: "content", growthY: "content" },
    });

  it("stretch keeps the insets the author drew, and reports a field growing into it", () => {
    const out = run({
      objects: [
        panel(),
        text("t1", 110, 50, 100, 20, { layoutParentId: "panel", expansion: { x: { mode: "unbounded" }, y: { mode: "unbounded" } } }),
        rect("band", 110, 70, 180, 40, {
          layoutParentId: "panel",
          anchor: { vertical: "stretch", horizontal: "stretch" },
        }),
      ],
      measurements: { t1: needs(100, 120) },
    });

    const p = boxOf(out.objects, "panel");
    const band = boxOf(out.objects, "band");
    // The band was drawn 30px below the panel's top, 50px above its bottom and
    // 10px short of its right edge; all three are the configured insets and all
    // three survive the parent growing.
    expect(band.y - p.y).toBeCloseTo(30, 5);
    expect(p.y + p.height - (band.y + band.height)).toBeCloseTo(50, 5);
    expect(p.x + p.width - (band.x + band.width)).toBeCloseTo(10, 5);
    // The field grew straight through it, which must be reported rather than
    // silently resolved by pushing either of them.
    expect(out.diagnostics.join(" ")).toContain("overlaps");
  });

  it("an end-anchored label keeps its distance from the right edge", () => {
    const out = run({
      objects: [
        panel(),
        text("t1", 110, 50, 100, 20, { layoutParentId: "panel", expansion: { x: { mode: "unbounded" }, y: { mode: "fixed" } } }),
        rect("label", 180, 140, 100, 20, {
          layoutParentId: "panel",
          anchor: { horizontal: "end", vertical: "start", rightOffset: 20 },
        }),
      ],
      measurements: { t1: needs(300, 18) },
    });

    const p = boxOf(out.objects, "panel");
    const label = boxOf(out.objects, "label");
    expect(p.x + p.width - (label.x + label.width)).toBeCloseTo(20, 5);
  });

  it("a start-anchored sibling does not move when the parent grows", () => {
    const out = run({
      objects: [
        panel(),
        text("t1", 110, 50, 100, 20, { layoutParentId: "panel", expansion: { x: { mode: "fixed" }, y: { mode: "unbounded" } } }),
        rect("label", 110, 70, 100, 20, { layoutParentId: "panel", anchor: { vertical: "start" } }),
      ],
      measurements: { t1: needs(100, 120) },
    });

    expect(boxOf(out.objects, "label").y).toBeCloseTo(70, 5);
  });

  it("reports a fixed frame overflowing on the axis that did not grow", () => {
    const out = run({
      objects: [
        rect("frame", 100, 40, 200, 120, {
          container: { enabled: true, growthX: "content", growthY: "fixed", padding: { top: 0, right: 0, bottom: 0, left: 0 } },
        }),
        text("t1", 110, 50, 100, 20, { layoutParentId: "frame", expansion: { x: { mode: "unbounded" }, y: { mode: "unbounded" } } }),
      ],
      measurements: { t1: needs(300, 200) },
    });

    // X grew (the frame widened to contain 110+300=410), Y stayed fixed and the
    // text now runs past the bottom, which must be reported rather than hidden.
    expect(boxOf(out.objects, "frame").width).toBe(310);
    expect(out.diagnostics.join(" ")).toContain("t1");
  });

  it("says nothing about siblings that do not overlap", () => {
    const out = run({
      objects: [
        panel(),
        text("t1", 110, 50, 100, 20, { layoutParentId: "panel", expansion: { x: { mode: "fixed" }, y: { mode: "unbounded" } } }),
        rect("below", 110, 130, 100, 20, { layoutParentId: "panel" }),
      ],
      measurements: { t1: needs(100, 60) },
    });

    expect(out.diagnostics.join(" ")).not.toContain("overlaps");
  });
});

// A sibling of `collisions`, not nested inside one of its cases: a `describe`
// written inside a running test body registers none of its own tests, which is
// how the three cases below spent their first life written but never run.
describe("hierarchy validation", () => {
  const tpl = (layout: unknown, objects: unknown[]) => ({
    templateVersion: 2 as const,
    document: { width: 800, height: 1000 },
    meta: { name: "t", modifiedAt: "" },
    objects: objects as never[],
    ...(layout === undefined ? {} : { layout: layout as never }),
  });
  const obj = (id: string, extra?: Record<string, unknown>) => ({
    id, type: "rect", name: id, role: null, x: 0, y: 0, width: 200, height: 100,
    rotation: 0, opacity: 1, visible: true, locked: false, zIndex: 0, parentId: null,
    stroke: "#000", strokeWidth: 1, fill: "transparent", cornerRadius: 0, ...extra,
  });
  it("rejects an unknown layout parent", () => {
    const issues = validateLayout(tpl({ mode: "variable" }, [obj("r1", { layoutParentId: "missing" })]) as never);
    expect(issues.some((i: { path: string }) => i.path.includes("layoutParentId"))).toBe(true);
  });
  it("rejects a layout-parent cycle", () => {
    const issues = validateLayout(tpl({ mode: "variable" }, [
      obj("a", { layoutParentId: "b" }), obj("b", { layoutParentId: "a" }),
    ]) as never);
    expect(issues.some((i: { severity: string }) => i.severity === "error")).toBe(true);
  });
  it("rejects a bad anchor rule and collision mode", () => {
    const issues = validateLayout(tpl({ mode: "variable", collision: "push" }, [
      obj("t1", { layoutParentId: "r1", anchor: { vertical: "middle" } }), obj("r1"),
    ]) as never);
    expect(issues.some((i: { path: string }) => i.path.includes("anchor"))).toBe(true);
    expect(issues.some((i: { path: string }) => i.path.includes("collision"))).toBe(true);
  });
});
