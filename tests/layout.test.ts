import { describe, expect, it } from "vitest";

import { calculateLayout } from "@/lib/render/layout";
import type { LayoutInput } from "@/lib/render/layout";
import type { ContentMeasurement } from "@/lib/render/measure";
import type {
  DocumentLayoutPolicy,
  GuideAttachment,
  LayoutGuide,
  ObjectExpansion,
  TemplateObject,
} from "@/lib/template/types";

/**
 * The layout solver, driven entirely by measurements supplied from outside.
 *
 * Every render starts from the authored geometry and produces the same result
 * for the same input - no growth is ever carried from one render to the next,
 * because a bill whose second render is taller than its first is a bill that
 * grows without limit.
 */

const base = {
  rotation: 0, opacity: 1, visible: true, locked: false, zIndex: 0, parentId: null,
  stroke: "#000000", strokeWidth: 1, fill: "transparent",
};

const rect = (id: string, x: number, y: number, width: number, height: number): TemplateObject =>
  ({ ...base, id, type: "rect", name: id, role: null, x, y, width, height, cornerRadius: 0 }) as TemplateObject;

const text = (id: string, x: number, y: number, width: number, height: number, expansion?: ObjectExpansion): TemplateObject =>
  ({
    ...base, id, type: "text", name: id, role: null, x, y, width, height,
    text: "{{a}}", fontFamily: "Arial", fontSize: 12, fontWeight: "normal",
    fontStyle: "normal", textAlign: "left", lineHeight: 1.16, charSpacing: 0,
    roleKind: "variable", textVerticalAlign: "top",
    ...(expansion ? { expansion } : {}),
  }) as TemplateObject;

/** Content that needs `width` px on one line and `height` px wrapped at the base width. */
const needs = (width: number, height: number): ContentMeasurement => ({ naturalWidth: width, height });

const FIXED: DocumentLayoutPolicy = { growthX: "fixed", growthY: "fixed" };

function run(partial: Partial<LayoutInput> & { objects: TemplateObject[] }): ReturnType<typeof calculateLayout> {
  return calculateLayout({
    objects: partial.objects,
    measurements: partial.measurements ?? {},
    guides: partial.guides ?? [],
    attachments: partial.attachments ?? [],
    documentPolicy: partial.documentPolicy ?? FIXED,
    document: partial.document ?? { width: 800, height: 1000 },
  });
}

const boxOf = (objects: TemplateObject[], id: string) => {
  const o = objects.find((x) => x.id === id);
  if (!o) throw new Error(`no object ${id}`);
  return { x: o.x, y: o.y, width: o.width, height: o.height };
};

/* 1 */ describe("fixed on both axes", () => {
  it("keeps the base geometry", () => {
    const out = run({
      objects: [text("t1", 10, 10, 100, 20, { x: { mode: "fixed" }, y: { mode: "fixed" } })],
      measurements: { t1: needs(400, 90) },
    });

    expect(boxOf(out.objects, "t1")).toEqual({ x: 10, y: 10, width: 100, height: 20 });
  });

  it("reports that the content does not fit", () => {
    const out = run({
      objects: [text("t1", 10, 10, 100, 20, { x: { mode: "fixed" }, y: { mode: "fixed" } })],
      measurements: { t1: needs(400, 90) },
    });

    expect(out.diagnostics.join(" ")).toContain("t1");
  });
});

/* 2 */ describe("fixed X, unbounded Y", () => {
  it("keeps the width and grows the height to fit", () => {
    const out = run({
      objects: [text("t1", 10, 10, 100, 20, { x: { mode: "fixed" }, y: { mode: "unbounded", strategy: "wrap" } })],
      measurements: { t1: needs(400, 90) },
    });

    expect(boxOf(out.objects, "t1")).toEqual({ x: 10, y: 10, width: 100, height: 90 });
  });

  it("does not grow past what the content needs", () => {
    const out = run({
      objects: [text("t1", 10, 10, 100, 20, { x: { mode: "fixed" }, y: { mode: "unbounded" } })],
      measurements: { t1: needs(80, 18) },
    });

    expect(boxOf(out.objects, "t1").height).toBe(20);
  });
});

/* 3 */ describe("bounded Y", () => {
  it("stops at the cap and says so", () => {
    const out = run({
      objects: [text("t1", 10, 10, 100, 20, { x: { mode: "fixed" }, y: { mode: "bounded", maxGrowth: 40 } })],
      measurements: { t1: needs(400, 120) },
    });

    expect(boxOf(out.objects, "t1").height).toBe(60);
    expect(out.diagnostics.join(" ")).toContain("t1");
  });

  it("grows to exactly what is needed when it fits under the cap", () => {
    const out = run({
      objects: [text("t1", 10, 10, 100, 20, { x: { mode: "fixed" }, y: { mode: "bounded", maxGrowth: 200 } })],
      measurements: { t1: needs(400, 120) },
    });

    expect(boxOf(out.objects, "t1").height).toBe(120);
  });
});

/* 4 */ describe("bounded X, fixed Y", () => {
  it("grows the width within the cap", () => {
    const out = run({
      objects: [text("t1", 10, 10, 100, 20, { x: { mode: "bounded", maxGrowth: 150 }, y: { mode: "fixed" } })],
      measurements: { t1: needs(200, 18) },
    });

    expect(boxOf(out.objects, "t1").width).toBe(200);
  });

  it("reports content that still does not fit at the cap", () => {
    const out = run({
      objects: [text("t1", 10, 10, 100, 20, { x: { mode: "bounded", maxGrowth: 20 }, y: { mode: "fixed" } })],
      measurements: { t1: needs(400, 18) },
    });

    expect(boxOf(out.objects, "t1").width).toBe(120);
    expect(out.diagnostics.join(" ")).toContain("t1");
  });
});

/* 5 */ describe("unbounded X", () => {
  it("grows to the natural width", () => {
    const out = run({
      objects: [text("t1", 10, 10, 100, 20, { x: { mode: "unbounded" }, y: { mode: "fixed" } })],
      measurements: { t1: needs(260, 18) },
    });

    expect(boxOf(out.objects, "t1").width).toBe(260);
  });
});

/* 6 */ describe("both axes expandable", () => {
  it("resolves both axes deterministically, Y first then X", () => {
    const policy: ObjectExpansion = {
      x: { mode: "unbounded" },
      y: { mode: "unbounded", strategy: "wrap" },
    };
    const out = run({
      objects: [text("t1", 10, 10, 100, 20, policy)],
      measurements: { t1: needs(300, 90) },
    });

    // Same input, same answer, every time.
    const again = run({
      objects: [text("t1", 10, 10, 100, 20, policy)],
      measurements: { t1: needs(300, 90) },
    });

    expect(boxOf(out.objects, "t1")).toEqual(boxOf(again.objects, "t1"));
  });
});

/* 7 */ describe("a shared guide", () => {
  it("moves by the greatest demand, not the sum of them", () => {
    const guides: LayoutGuide[] = [{ id: "g", orientation: "horizontal", position: 100 }];
    const out = run({
      objects: [
        text("a", 10, 60, 100, 20, { x: { mode: "fixed" }, y: { mode: "unbounded", growthGuideId: "g" } }),
        text("b", 10, 70, 100, 20, { x: { mode: "fixed" }, y: { mode: "unbounded", growthGuideId: "g" } }),
      ],
      measurements: { a: needs(80, 40), b: needs(80, 60) },
      guides,
    });

    // a's bottom lands at 100 (no push); b's at 130 (30 of push).
    expect(boxOf(out.objects, "a").height).toBe(40);
    expect(boxOf(out.objects, "b").height).toBe(60);
    expect(boxOf(out.objects, "b").y + boxOf(out.objects, "b").height).toBe(130);
  });
});

/* 9 */ describe("a stretching border", () => {
  it("follows the guide while its opposite edge stays put", () => {
    const guides: LayoutGuide[] = [{ id: "bottom", orientation: "horizontal", position: 100 }];
    const attachments: GuideAttachment[] = [
      { id: "s", objectId: "r1", edge: "bottom", guideId: "bottom", behavior: "stretch" },
    ];
    const out = run({
      objects: [
        rect("r1", 10, 40, 200, 60),
        text("t1", 20, 50, 100, 20, { x: { mode: "fixed" }, y: { mode: "unbounded", growthGuideId: "bottom" } }),
      ],
      measurements: { t1: needs(80, 80) },
      guides,
      attachments,
    });

    const border = boxOf(out.objects, "r1");
    expect(border.y).toBe(40);
    expect(border.height).toBe(90);
  });
});

/* 10 */ describe("a moving table", () => {
  it("moves with the guide and keeps its size", () => {
    const guides: LayoutGuide[] = [{ id: "bottom", orientation: "horizontal", position: 100 }];
    const attachments: GuideAttachment[] = [
      { id: "m", objectId: "r1", edge: "top", guideId: "bottom", behavior: "move" },
    ];
    const out = run({
      objects: [
        // Authored so its top edge sits on the guide, which is what makes it
        // an attachment rather than two objects that happen to be nearby.
        rect("r1", 10, 100, 300, 40),
        text("t1", 20, 50, 100, 20, { x: { mode: "fixed" }, y: { mode: "unbounded", growthGuideId: "bottom" } }),
      ],
      measurements: { t1: needs(80, 70) },
      guides,
      attachments,
    });

    const moved = boxOf(out.objects, "r1");
    expect(moved.height).toBe(40);
    expect(moved.y).toBe(120);
  });
});

/* 11 */ describe("an unattached object", () => {
  it("does not move just because it sits near the guide", () => {
    const guides: LayoutGuide[] = [{ id: "g", orientation: "horizontal", position: 100 }];
    const out = run({
      objects: [
        rect("r1", 10, 90, 100, 20),
        text("t1", 20, 50, 100, 20, { x: { mode: "fixed" }, y: { mode: "unbounded", growthGuideId: "g" } }),
      ],
      measurements: { t1: needs(80, 80) },
      guides,
    });

    expect(boxOf(out.objects, "r1")).toEqual({ x: 10, y: 90, width: 100, height: 20 });
  });
});

/* 8 */ describe("sequential guides", () => {
  it("propagates movement through a chain in dependency order", () => {
    const guides: LayoutGuide[] = [
      { id: "g1", orientation: "horizontal", position: 100 },
      { id: "g2", orientation: "horizontal", position: 120 },
    ];
    const attachments: GuideAttachment[] = [
      // The band hangs from g1 and carries t2, so g2 cannot be placed until g1
      // has moved and taken t2 with it.
      { id: "s", objectId: "band", edge: "bottom", guideId: "g1", behavior: "stretch" },
      { id: "m", objectId: "footer", edge: "top", guideId: "g2", behavior: "move" },
    ];
    const out = run({
      objects: [
        rect("band", 10, 60, 200, 60),
        rect("footer", 10, 120, 200, 30),
        text("t1", 20, 50, 100, 20, { x: { mode: "fixed" }, y: { mode: "unbounded", growthGuideId: "g1" } }),
        text("t2", 20, 110, 100, 20, { x: { mode: "fixed" }, y: { mode: "unbounded", growthGuideId: "g2" } }),
      ],
      measurements: { t1: needs(80, 60), t2: needs(80, 40) },
      guides,
      attachments,
    });

    const at = (id: string) => out.guides.find((g) => g.id === id)!.position;
    // g1 cleared t1's new bottom (110); g2 then cleared t2's (150).
    expect(at("g1")).toBe(110);
    expect(at("g2")).toBe(150);
    // The band is traced to 120 with g1 drawn *inside* it at 100. A boundary a
    // box is attached to grows that box; it never collapses it onto itself, so
    // the band keeps its traced height rather than being cut back to the line.
    expect(boxOf(out.objects, "band").height).toBe(60);
    expect(boxOf(out.objects, "footer").y).toBe(150);
    expect(boxOf(out.objects, "footer").height).toBe(30);
  });
});

/* 13 */ describe("cycles", () => {
  it("refuses a cyclic dependency instead of resolving in some arbitrary order", () => {
    // Each field is pulled by one guide while its own growth pushes the other,
    // so there is no order in which both can be satisfied. A dependency only
    // exists where one object both grows into a guide and is attached to
    // another, which is why these are text objects rather than bare rectangles.
    const out = run({
      objects: [
        text("t1", 10, 60, 100, 20, { x: { mode: "fixed" }, y: { mode: "unbounded", growthGuideId: "g2" } }),
        text("t2", 10, 160, 100, 20, { x: { mode: "fixed" }, y: { mode: "unbounded", growthGuideId: "g1" } }),
      ],
      measurements: { t1: needs(80, 60), t2: needs(80, 60) },
      guides: [
        { id: "g1", orientation: "horizontal", position: 100 },
        { id: "g2", orientation: "horizontal", position: 200 },
      ],
      attachments: [
        { id: "a", objectId: "t1", edge: "left", guideId: "g1", behavior: "move" },
        { id: "b", objectId: "t2", edge: "left", guideId: "g2", behavior: "move" },
      ],
    });

    expect(out.diagnostics.join(" ")).toContain("cycle");
  });

  it("still produces geometry rather than giving up entirely", () => {
    const out = run({
      objects: [
        text("t1", 10, 60, 100, 20, { x: { mode: "fixed" }, y: { mode: "unbounded", growthGuideId: "g2" } }),
        text("t2", 10, 160, 100, 20, { x: { mode: "fixed" }, y: { mode: "unbounded", growthGuideId: "g1" } }),
      ],
      measurements: { t1: needs(80, 60), t2: needs(80, 60) },
      guides: [
        { id: "g1", orientation: "horizontal", position: 100 },
        { id: "g2", orientation: "horizontal", position: 200 },
      ],
      attachments: [
        { id: "a", objectId: "t1", edge: "left", guideId: "g1", behavior: "move" },
        { id: "b", objectId: "t2", edge: "left", guideId: "g2", behavior: "move" },
      ],
    });

    // Nothing moved, but the fields still grew to fit their own content: a
    // cycle in the boundaries must not also cost the text its height.
    expect(boxOf(out.objects, "t1").height).toBe(60);
    expect(boxOf(out.objects, "t2").height).toBe(60);
  });
});

/* 14 */ describe("caps", () => {
  it("stops the guide at its maximum displacement", () => {
    const guides: LayoutGuide[] = [{ id: "g", orientation: "horizontal", position: 100, maxDisplacement: 25 }];
    const out = run({
      objects: [text("t1", 10, 50, 100, 20, { x: { mode: "fixed" }, y: { mode: "unbounded", growthGuideId: "g" } })],
      measurements: { t1: needs(80, 200) },
      guides,
    });

    expect(out.guides[0]!.position).toBe(125);
    expect(out.diagnostics.join(" ")).toContain("g");
  });

  it("bounds the field to that guide, so the text cannot overrun the boundary", () => {
    const out = run({
      objects: [text("t1", 10, 50, 100, 20, { x: { mode: "fixed" }, y: { mode: "unbounded", growthGuideId: "g" } })],
      measurements: { t1: needs(80, 200) },
      guides: [{ id: "g", orientation: "horizontal", position: 100, maxDisplacement: 25 }],
    });

    // The content wanted 200px of height; the boundary only moved 25px.
    expect(boxOf(out.objects, "t1").height).toBe(75);
    expect(out.diagnostics.join(" ")).toContain("t1");
  });
});

/* 12 */ describe("invalid input", () => {
  it("ignores an attachment whose guide does not exist", () => {
    const out = run({
      objects: [rect("r1", 10, 10, 100, 40)],
      guides: [],
      attachments: [{ id: "a", objectId: "r1", edge: "bottom", guideId: "ghost", behavior: "stretch" }],
    });

    expect(boxOf(out.objects, "r1")).toEqual({ x: 10, y: 10, width: 100, height: 40 });
    expect(out.diagnostics.join(" ")).toContain("ghost");
  });

  it("ignores a non-finite measurement rather than poisoning the geometry", () => {
    const out = run({
      objects: [text("t1", 10, 10, 100, 20, { x: { mode: "fixed" }, y: { mode: "unbounded" } })],
      measurements: { t1: { naturalWidth: Number.NaN, height: Number.POSITIVE_INFINITY } },
    });

    expect(boxOf(out.objects, "t1")).toEqual({ x: 10, y: 10, width: 100, height: 20 });
    expect(out.diagnostics.join(" ")).toContain("t1");
  });
});

/* 15 */ describe("repeated renders", () => {
  it("produces the same layout from the same base geometry twice", () => {
    const make = () =>
      run({
        objects: [
          text("t1", 10, 50, 100, 20, { x: { mode: "fixed" }, y: { mode: "unbounded", growthGuideId: "g" } }),
          rect("r1", 10, 40, 200, 60),
        ],
        measurements: { t1: needs(80, 90) },
        guides: [{ id: "g", orientation: "horizontal", position: 100 }],
        attachments: [{ id: "s", objectId: "r1", edge: "bottom", guideId: "g", behavior: "stretch" }],
      });

    const first = make();
    const second = run({
      objects: first.objects,
      measurements: { t1: needs(80, 90) },
      guides: [{ id: "g", orientation: "horizontal", position: 100 }],
      attachments: [{ id: "s", objectId: "r1", edge: "bottom", guideId: "g", behavior: "stretch" }],
    });

    expect(second.objects.map((o) => ({ ...o }))).toEqual(first.objects.map((o) => ({ ...o })));
  });

  it("does not accumulate growth when fed its own previous output", () => {
    const first = run({
      objects: [text("t1", 10, 10, 100, 20, { x: { mode: "fixed" }, y: { mode: "unbounded" } })],
      measurements: { t1: needs(80, 90) },
    });
    const second = run({
      objects: first.objects,
      measurements: { t1: needs(80, 90) },
    });

    expect(boxOf(second.objects, "t1")).toEqual(boxOf(first.objects, "t1"));
  });

  it("leaves the caller's objects untouched", () => {
    const objects = [text("t1", 10, 10, 100, 20, { x: { mode: "fixed" }, y: { mode: "unbounded" } })];
    const before = { ...objects[0] };

    run({ objects, measurements: { t1: needs(80, 90) } });

    expect(objects[0]).toEqual(before);
  });
});

/* 16 */ describe("paint order", () => {
  it("keeps z-index ordering and never reorders objects", () => {
    const objects = [
      rect("z1", 0, 0, 10, 10),
      rect("z2", 0, 0, 10, 10),
      rect("z0", 0, 0, 10, 10),
    ];
    const out = run({ objects });

    expect(out.objects.map((o) => o.id)).toEqual(objects.map((o) => o.id));
    expect(out.objects.map((o) => o.zIndex)).toEqual(objects.map((o) => o.zIndex));
  });
});

/* 17 */ describe("convergence", () => {
  it("returns a printable layout from a mutually-bound pair of fields", () => {
    // t1 grows into g2 while g1 is what moves t1, and t2 does the reverse. The
    // boundaries cannot both be satisfied, so they are left alone and the text
    // is reported as not fitting - rather than the solve running until it
    // hangs the preview or the print dialog.
    const out = run({
      objects: [
        text("t1", 10, 60, 100, 20, { x: { mode: "fixed" }, y: { mode: "unbounded", growthGuideId: "g2" } }),
        text("t2", 10, 160, 100, 20, { x: { mode: "fixed" }, y: { mode: "unbounded", growthGuideId: "g1" } }),
      ],
      measurements: { t1: needs(80, 400), t2: needs(80, 400) },
      guides: [
        { id: "g1", orientation: "horizontal", position: 100 },
        { id: "g2", orientation: "horizontal", position: 200 },
      ],
      attachments: [
        { id: "a", objectId: "t1", edge: "left", guideId: "g1", behavior: "move" },
        { id: "b", objectId: "t2", edge: "left", guideId: "g2", behavior: "move" },
      ],
    });

    expect(out.diagnostics.length).toBeGreaterThan(0);
    expect(boxOf(out.objects, "t1").height).toBeGreaterThan(0);
    expect(Number.isFinite(out.page.height)).toBe(true);
  });

  it("terminates with geometry, not a missing object, when a boundary is capped hard", () => {
    const out = run({
      objects: [text("t1", 10, 50, 100, 20, { x: { mode: "fixed" }, y: { mode: "unbounded", growthGuideId: "g" } })],
      measurements: { t1: needs(80, 10_000) },
      guides: [{ id: "g", orientation: "horizontal", position: 100, maxDisplacement: 5 }],
      documentPolicy: { growthX: "fixed", growthY: "expand", maxHeight: 500 },
    });

    expect(out.objects).toHaveLength(1);
    expect(out.guides[0]!.position).toBe(105);
    expect(out.page.height).toBeLessThanOrEqual(500);
  });
});

/* 18 */ describe("determinism", () => {
  it("gives byte-identical output for identical input", () => {
    const build = () =>
      run({
        objects: [
          text("t1", 10, 50, 100, 20, { x: { mode: "fixed" }, y: { mode: "unbounded", growthGuideId: "g" } }),
          rect("r1", 10, 40, 200, 60),
        ],
        measurements: { t1: needs(80, 90) },
        guides: [{ id: "g", orientation: "horizontal", position: 100 }],
        attachments: [{ id: "s", objectId: "r1", edge: "bottom", guideId: "g", behavior: "stretch" }],
      });

    expect(JSON.stringify(build())).toBe(JSON.stringify(build()));
  });
});

/* document bounds */ describe("document policy", () => {
  it("leaves the page alone under a fixed policy", () => {
    const out = run({
      objects: [text("t1", 10, 10, 100, 20, { x: { mode: "fixed" }, y: { mode: "unbounded" } })],
      measurements: { t1: needs(80, 900) },
      document: { width: 800, height: 1000 },
    });

    expect(out.page).toEqual({ width: 800, height: 1000 });
  });

  it("grows the page to contain a taller bill when asked to", () => {
    const out = run({
      objects: [text("t1", 10, 10, 100, 20, { x: { mode: "fixed" }, y: { mode: "unbounded" } })],
      measurements: { t1: needs(80, 1500) },
      documentPolicy: { growthX: "fixed", growthY: "expand" },
      document: { width: 800, height: 1000 },
    });

    expect(out.page.height).toBe(1510);
  });

  it("never shrinks the page to fit", () => {
    // "expand" means grow to contain the content, not crop the page down to it.
    const out = run({
      objects: [text("t1", 10, 10, 100, 20, { x: { mode: "fixed" }, y: { mode: "unbounded" } })],
      measurements: { t1: needs(80, 300) },
      documentPolicy: { growthX: "fixed", growthY: "expand" },
      document: { width: 800, height: 1000 },
    });

    expect(out.page.height).toBe(1000);
  });

  it("stops growing at the declared maximum and reports it", () => {
    const out = run({
      objects: [text("t1", 10, 10, 100, 20, { x: { mode: "fixed" }, y: { mode: "unbounded" } })],
      measurements: { t1: needs(80, 5000) },
      documentPolicy: { growthX: "fixed", growthY: "expand", maxHeight: 2000 },
      document: { width: 800, height: 1000 },
    });

    expect(out.page.height).toBeLessThanOrEqual(2000);
    expect(out.diagnostics.join(" ")).toContain("height");
  });
});

/* an object with no policy */ describe("objects with no expansion policy", () => {
  it("are left exactly as authored", () => {
    const out = run({
      objects: [text("t1", 10, 10, 100, 20)],
      measurements: { t1: needs(400, 400) },
    });

    expect(boxOf(out.objects, "t1")).toEqual({ x: 10, y: 10, width: 100, height: 20 });
  });
});
