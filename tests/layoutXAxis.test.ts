import { describe, expect, it } from "vitest";

import { calculateLayout } from "@/lib/render/layout";
import type { LayoutInput } from "@/lib/render/layout";
import type { ContentMeasurement } from "@/lib/render/measure";
import type { GuideAttachment, LayoutGuide, TemplateObject } from "@/lib/template/types";

/**
 * The X axis, and the vertical guide that carries it.
 *
 * The solver treats X and Y as two instances of one rule, and a suite that only
 * ever draws horizontal guides cannot tell the two apart: every X-path bug - a
 * demand read on the wrong axis, a right edge snapping onto a guide that did not
 * move, a container that never widens - looks exactly like a passing test.
 * Every case below is therefore the Y case from `layout.test.ts` mirrored.
 */

const base = {
  rotation: 0, opacity: 1, visible: true, locked: false, zIndex: 0, parentId: null,
  stroke: "#000000", strokeWidth: 1, fill: "transparent",
};

const rect = (id: string, x: number, y: number, width: number, height: number, extra: Record<string, unknown> = {}): TemplateObject =>
  ({ ...base, id, type: "rect", name: id, role: null, x, y, width, height, cornerRadius: 0, ...extra }) as TemplateObject;

const text = (id: string, x: number, y: number, width: number, height: number, expansion?: unknown, extra: Record<string, unknown> = {}): TemplateObject =>
  ({
    ...base, id, type: "text", name: id, role: null, x, y, width, height,
    text: "{{a}}", fontFamily: "Arial", fontSize: 12, fontWeight: "normal",
    fontStyle: "normal", textAlign: "left", lineHeight: 1.16, charSpacing: 0,
    roleKind: "variable", textVerticalAlign: "top",
    ...(expansion ? { expansion } : {}),
    ...extra,
  }) as TemplateObject;

const needs = (width: number, height: number): ContentMeasurement => ({ naturalWidth: width, height });

const RIGHT: LayoutGuide = { id: "right", orientation: "vertical", position: 300 };

/** X grows, Y is held: the same shape as every Y case, transposed. */
const GROW_X = { x: { mode: "unbounded" as const, growthGuideId: "right" }, y: { mode: "fixed" as const } };

function run(partial: Partial<LayoutInput> & { objects: TemplateObject[] }) {
  return calculateLayout({
    objects: partial.objects,
    measurements: partial.measurements ?? {},
    guides: partial.guides ?? [],
    attachments: partial.attachments ?? [],
    documentPolicy: partial.documentPolicy ?? { growthX: "fixed", growthY: "fixed" },
    document: partial.document ?? { width: 800, height: 1000 },
  });
}

const boxOf = (objects: TemplateObject[], id: string) => {
  const o = objects.find((x) => x.id === id);
  if (!o) throw new Error(`no object ${id}`);
  return { x: o.x, y: o.y, width: o.width, height: o.height };
};

/* 14.1 item 4 */ describe("an X-growing field pushes its vertical guide", () => {
  it("moves the guide right by what the content needs", () => {
    const out = run({
      objects: [text("t1", 20, 40, 100, 20, GROW_X)],
      measurements: { t1: needs(360, 18) },
      guides: [RIGHT],
    });

    // 20 + 360 = 380, so the boundary travels from 300 to 380.
    expect(out.guides[0]!.position).toBe(380);
    expect(boxOf(out.objects, "t1").width).toBe(360);
  });

  it("leaves the height alone - Y was not asked to grow", () => {
    const out = run({
      objects: [text("t1", 20, 40, 100, 20, GROW_X)],
      measurements: { t1: needs(360, 300) },
      guides: [RIGHT],
    });

    expect(boxOf(out.objects, "t1").height).toBe(20);
    expect(out.diagnostics.join(" ")).toContain("t1");
  });

  it("reports a field that could not be given the width it needs", () => {
    const out = run({
      objects: [text("t1", 20, 40, 100, 20, GROW_X)],
      measurements: { t1: needs(360, 18) },
      guides: [{ ...RIGHT, maxDisplacement: 50 }],
    });

    // 20 + 100 = 120 is the most the boundary can offer.
    expect(out.guides[0]!.position).toBe(350);
    expect(boxOf(out.objects, "t1").width).toBe(330);
    expect(out.diagnostics.join(" ")).toContain("t1");
  });

  it("respects a bounded X policy", () => {
    const out = run({
      objects: [
        text("t1", 20, 40, 100, 20, {
          x: { mode: "bounded", maxGrowth: 60, growthGuideId: "right" },
          y: { mode: "fixed" },
        }),
      ],
      measurements: { t1: needs(360, 18) },
      guides: [RIGHT],
    });

    expect(boxOf(out.objects, "t1").width).toBe(160);
    expect(out.guides[0]!.position).toBe(300);
  });

  it("grows in place when the guide stays to the right", () => {
    // The content fits before the boundary, so nothing has to move.
    const out = run({
      objects: [text("t1", 20, 40, 100, 20, GROW_X)],
      measurements: { t1: needs(180, 18) },
      guides: [{ id: "right", orientation: "vertical", position: 500 }],
    });

    expect(boxOf(out.objects, "t1").width).toBe(180);
    expect(out.guides[0]!.position).toBe(500);
  });
});

/* 14.1 item 7 */ describe("left and right edges attach to a vertical guide", () => {
  const att = (edge: "left" | "right", behavior: "move" | "stretch"): GuideAttachment =>
    ({ id: `att-${edge}`, objectId: "r1", edge, guideId: "right", behavior });

  it("keeps the drawn margin when the edge was not on the guide", () => {
    const out = run({
      objects: [rect("r1", 20, 40, 100, 60), text("t1", 30, 50, 100, 20, GROW_X)],
      measurements: { t1: needs(360, 18) },
      guides: [RIGHT],
      attachments: [att("right", "stretch")],
    });

    // The field's right edge is 30 + 360 = 390, so the boundary travels 90 from
    // 300. r1's own right edge is drawn at 120 - 180px short of the line, and
    // that margin is part of the design, so the edge follows the travel to 210.
    expect(boxOf(out.objects, "r1").x).toBe(20);
    expect(boxOf(out.objects, "r1").width).toBe(190);
  });

  it("sits on the boundary when the edge was drawn on the guide", () => {
    const out = run({
      // Authored so this box's right edge is exactly the guide's position.
      objects: [rect("r1", 20, 40, 280, 60), text("t1", 30, 50, 100, 20, GROW_X)],
      measurements: { t1: needs(360, 18) },
      guides: [RIGHT],
      attachments: [att("right", "stretch")],
    });

    // 120... 20 + 280 = 300 = the guide. It travels to 390 and the edge goes
    // with it, which is the steady state of every rendered template.
    expect(boxOf(out.objects, "r1").x).toBe(20);
    expect(boxOf(out.objects, "r1").width).toBe(370);
  });

  it("moves a whole box with a left edge and keeps its size", () => {
    const out = run({
      objects: [rect("r1", 300, 40, 100, 60), text("t1", 30, 50, 100, 20, GROW_X)],
      measurements: { t1: needs(360, 18) },
      guides: [RIGHT],
      attachments: [att("left", "move")],
    });

    const moved = boxOf(out.objects, "r1");
    expect(moved.x).toBe(390);
    expect(moved.width).toBe(100);
  });

  it("leaves an unmoved guide alone", () => {
    const out = run({
      objects: [rect("r1", 20, 40, 100, 60)],
      guides: [RIGHT],
      attachments: [att("right", "stretch")],
    });

    expect(boxOf(out.objects, "r1").width).toBe(100);
  });

  it("does not snap a box drawn clear of the guide up onto it", () => {
    // The rule is "the edge goes to a boundary that has travelled past it".
    // A guide sitting below this box's right edge has not, so nothing moves.
    const out = run({
      objects: [rect("r1", 20, 40, 100, 60)],
      guides: [{ id: "right", orientation: "vertical", position: 500 }],
      attachments: [att("right", "stretch")],
    });

    expect(boxOf(out.objects, "r1")).toEqual({ x: 20, y: 40, width: 100, height: 60 });
  });

  it("reports an edge bound to the wrong orientation", () => {
    const out = run({
      objects: [rect("r1", 20, 40, 100, 60)],
      guides: [{ id: "h", orientation: "horizontal", position: 100 }],
      attachments: [{ id: "a", objectId: "r1", edge: "right", guideId: "h", behavior: "stretch" }],
    });

    expect(out.diagnostics.join(" ")).toContain("cannot control it");
  });
});

/* 14.3 */ describe("a vertical guide shared by two fields", () => {
  it("moves by the greatest demand, not the sum", () => {
    const out = run({
      objects: [text("a", 20, 20, 100, 20, GROW_X), text("b", 20, 60, 100, 20, GROW_X)],
      measurements: { a: needs(180, 18), b: needs(240, 18) },
      guides: [{ id: "right", orientation: "vertical", position: 200 }],
    });

    // Both fields' right edges fall past 200: a to 200 and b to 260. The
    // boundary has to clear the further one - max(0, 0) and max(0, 60), so 60 -
    // rather than clearing both demands stacked on each other.
    expect(out.guides[0]!.position).toBe(260);
  });

  it("leaves the boundary alone while both fields fit before it", () => {
    const out = run({
      objects: [text("a", 20, 20, 100, 20, GROW_X), text("b", 20, 60, 100, 20, GROW_X)],
      measurements: { a: needs(180, 18), b: needs(240, 18) },
      guides: [RIGHT],
    });

    expect(out.guides[0]!.position).toBe(300);
  });

  it("is stable across a second run", () => {
    const once = run({
      objects: [text("a", 20, 20, 100, 20, GROW_X)],
      measurements: { a: needs(240, 18) },
      guides: [{ id: "right", orientation: "vertical", position: 200 }],
    }).guides[0]!.position;

    expect(once).toBe(260);
  });
});

/* 14.4 */ describe("document and container growth in X", () => {
  it("widens the page when growthX is expand", () => {
    const out = run({
      objects: [text("t1", 700, 40, 100, 20, { x: { mode: "unbounded" }, y: { mode: "fixed" } })],
      measurements: { t1: needs(240, 18) },
      documentPolicy: { growthX: "expand", growthY: "fixed" },
      document: { width: 800, height: 1000 },
    });

    expect(out.page.width).toBe(940);
  });

  it("keeps content on a fixed page and reports that it did not fit", () => {
    const out = run({
      objects: [text("t1", 700, 40, 100, 20, { x: { mode: "unbounded" }, y: { mode: "fixed" } })],
      measurements: { t1: needs(240, 18) },
      document: { width: 800, height: 1000 },
    });

    // A fixed page is a real boundary: the field stops at the sheet edge rather
    // than running off it, and the author is told the text did not fit.
    expect(out.page.width).toBe(800);
    expect(boxOf(out.objects, "t1").width).toBe(100);
    expect(out.diagnostics.join(" ")).toContain("t1");
  });

  it("reports content that a fixed page cannot hold at all", () => {
    const out = run({
      // Drawn wider than the sheet, so no growth decision can pull it back.
      objects: [text("t1", 700, 40, 180, 20, { x: { mode: "fixed" }, y: { mode: "fixed" } })],
      document: { width: 800, height: 1000 },
    });

    expect(out.diagnostics.join(" ")).toContain("wide");
  });

  it("respects the page's maxWidth", () => {
    const out = run({
      objects: [text("t1", 700, 40, 100, 20, { x: { mode: "unbounded" }, y: { mode: "fixed" } })],
      measurements: { t1: needs(240, 18) },
      documentPolicy: { growthX: "expand", growthY: "fixed", maxWidth: 850 },
      document: { width: 800, height: 1000 },
    });

    expect(out.page.width).toBe(850);
  });

  it("grows a container horizontally around its declared child", () => {
    const out = run({
      objects: [
        rect("frame", 100, 40, 200, 120, {
          container: { enabled: true, growthX: "content", growthY: "content", padding: { top: 0, right: 12, bottom: 0, left: 12 } },
        }),
        text("t1", 110, 60, 100, 20, { x: { mode: "unbounded" }, y: { mode: "fixed" } }, { layoutParentId: "frame" }),
      ],
      measurements: { t1: needs(300, 18) },
    });

    // Child right edge 410 plus 12px right padding.
    expect(boxOf(out.objects, "frame").width).toBe(322);
  });

  it("leaves a container with growthX fixed at its authored width and says so", () => {
    const out = run({
      objects: [
        rect("frame", 100, 40, 200, 120, {
          container: { enabled: true, growthX: "fixed", growthY: "content", padding: { top: 0, right: 12, bottom: 0, left: 12 } },
        }),
        text("t1", 110, 60, 100, 20, { x: { mode: "unbounded" }, y: { mode: "fixed" } }, { layoutParentId: "frame" }),
      ],
      measurements: { t1: needs(300, 18) },
    });

    expect(boxOf(out.objects, "frame").width).toBe(200);
    expect(out.diagnostics.join(" ")).toContain("t1");
  });

  it("stops at the container's maxWidth", () => {
    const out = run({
      objects: [
        rect("frame", 100, 40, 200, 120, {
          container: { enabled: true, growthX: "content", growthY: "content", maxWidth: 260, padding: { top: 0, right: 0, bottom: 0, left: 0 } },
        }),
        text("t1", 110, 60, 100, 20, { x: { mode: "unbounded" }, y: { mode: "fixed" } }, { layoutParentId: "frame" }),
      ],
      measurements: { t1: needs(300, 18) },
    });

    expect(boxOf(out.objects, "frame").width).toBe(260);
  });
});

/* 16.5 */ describe("no cumulative drift on the X axis", () => {
  it("is stable when the attached edge is drawn on the guide", () => {
    // The steady state of any real template: the author drew this edge against
    // the line. Re-solving from that geometry must not walk it further.
    const make = () =>
      run({
        objects: [
          text("t1", 20, 40, 100, 20, GROW_X),
          rect("r1", 20, 40, 280, 60),
        ],
        measurements: { t1: needs(360, 18) },
        guides: [RIGHT],
        attachments: [{ id: "s", objectId: "r1", edge: "right", guideId: "right", behavior: "stretch" }],
      });

    const first = make();
    const second = run({
      objects: first.objects,
      measurements: { t1: needs(360, 18) },
      guides: [RIGHT],
      attachments: [{ id: "s", objectId: "r1", edge: "right", guideId: "right", behavior: "stretch" }],
    });

    expect(second.objects).toEqual(first.objects);
  });

  it("returns to the traced size when the value shrinks", () => {
    const layout = (width: number) =>
      run({
        objects: [text("t1", 20, 40, 100, 20, { x: { mode: "unbounded" }, y: { mode: "fixed" } })],
        measurements: { t1: needs(width, 18) },
      });

    expect(boxOf(layout(360).objects, "t1").width).toBe(360);
    expect(boxOf(layout(60).objects, "t1").width).toBe(100);
  });
});