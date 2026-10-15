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

// Declared here rather than inside the `it` above: a `describe` nested in a
// running test body registers none of its own cases, so the three validations
// below - unknown parent, parent cycle, contradictory anchor/collision - were
// written but never executed.
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
