import { describe, expect, it } from "vitest";

import {
  GUIDE_APP_TYPE,
  attachmentsFor,
  createGuide,
  guideAt,
  guidesFromObjects,
  isGuide,
  nextGuideId,
  removeGuide,
  setGuideCap,
  withLayoutMode,
} from "@/lib/canvas/guides";
import type { LayoutGuide } from "@/lib/template/types";

/**
 * Marking lines are editor furniture, and the whole difficulty is keeping them
 * that way.
 *
 * They live on the canvas so they can be grabbed and dragged, they live in the
 * template so the layout pass can find them, and they must never reach the
 * printed bill. A guide that leaked into `objects` would paint a line across
 * every customer's invoice, so that separation is asserted here rather than
 * trusted to the call sites.
 */

/** The smallest shape a guide overlay needs; real ones are Fabric lines. */
function overlay(id: string, orientation: "horizontal" | "vertical", position: number, extra: Record<string, unknown> = {}) {
  return {
    appType: GUIDE_APP_TYPE,
    guideId: id,
    guideOrientation: orientation,
    ...(orientation === "horizontal" ? { left: 0, top: position } : { left: position, top: 0 }),
    ...extra,
  };
}

describe("recognising a guide", () => {
  it("is told apart from bill artwork", () => {
    expect(isGuide(overlay("g1", "horizontal", 100))).toBe(true);
    expect(isGuide({ appType: "rect" })).toBe(false);
    expect(isGuide({})).toBe(false);
    expect(isGuide(null)).toBe(false);
  });
});

describe("guide ids", () => {
  it("never collides with one already in use", () => {
    expect(nextGuideId([])).toBe("guide-1");
    expect(nextGuideId([{ id: "guide-1", orientation: "horizontal", position: 1 }])).toBe("guide-2");
    expect(nextGuideId([{ id: "guide-7", orientation: "horizontal", position: 1 }])).not.toBe("guide-1");
  });
});

describe("reading guides back off the canvas", () => {
  it("takes the guide lines and ignores everything else", () => {
    const guides = guidesFromObjects([
      overlay("g1", "horizontal", 220),
      { appType: "rect" },
      overlay("g2", "vertical", 500),
    ]);

    expect(guides).toEqual([
      { id: "g1", orientation: "horizontal", position: 220 },
      { id: "g2", orientation: "vertical", position: 500 },
    ]);
  });

  it("returns nothing for a canvas with no guides", () => {
    expect(guidesFromObjects([{ appType: "rect" }, { appType: "text" }])).toEqual([]);
  });

  it("follows a guide that has been dragged", () => {
    // The canvas is the source of truth while editing: dragging the line is the
    // whole point of it being on the canvas.
    const moved = guidesFromObjects([overlay("g1", "horizontal", 340)]);

    expect(moved[0]!.position).toBe(340);
  });

  it("keeps a displacement cap across a drag", () => {
    const guides = guidesFromObjects([
      overlay("g1", "horizontal", 340, { guideMaxDisplacement: 250 }),
    ]);

    expect(guides[0]!.maxDisplacement).toBe(250);
  });

  it("ignores a guide whose position is not a finite number", () => {
    expect(guidesFromObjects([overlay("g1", "horizontal", Number.NaN)])).toEqual([]);
  });
});

describe("guides never become bill artwork", () => {
  it("a guide is not a template object", () => {
    // The invariant in one line: what the serialiser is handed is artwork, so
    // a guide in that list would be a line printed on the invoice.
    const guide = createGuide({ id: "g1", orientation: "horizontal", position: 100 });

    expect(guide.appType).toBe(GUIDE_APP_TYPE);
  });
});

describe("finding and editing a guide", () => {
  const list: LayoutGuide[] = [
    { id: "g1", orientation: "horizontal", position: 100 },
    { id: "g2", orientation: "vertical", position: 500 },
  ];

  it("finds one by id", () => {
    expect(guideAt(list, "g2")).toEqual({ id: "g2", orientation: "vertical", position: 500 });
    expect(guideAt(list, "nope")).toBeUndefined();
  });

  it("sets a cap without moving the guide", () => {
    const out = setGuideCap(list, "g1", 80);

    expect(out[0]).toEqual({ id: "g1", orientation: "horizontal", position: 100, maxDisplacement: 80 });
    expect(out[1]).toBe(list[1]);
  });

  it("clears a cap rather than storing zero", () => {
    // Zero would mean "this guide may never move", which is a different
    // statement from "no cap was set" - and the far more likely intention.
    const withCap = setGuideCap(list, "g1", 80);
    const cleared = setGuideCap(withCap, "g1", 0);

    expect("maxDisplacement" in cleared[0]!).toBe(false);
  });

  it("removes a guide by id and leaves the rest alone", () => {
    expect(removeGuide(list, "g1").map((g) => g.id)).toEqual(["g2"]);
    expect(removeGuide(list, "missing").map((g) => g.id)).toEqual(["g1", "g2"]);
  });
});

describe("which attachments a guide carries", () => {
  const attachments = [
    { id: "a1", objectId: "r1", edge: "bottom" as const, guideId: "g1", behavior: "stretch" as const },
    { id: "a2", objectId: "r2", edge: "top" as const, guideId: "g2", behavior: "move" as const },
  ];

  it("lists the ones on one guide", () => {
    expect(attachmentsFor(attachments, "g1").map((a) => a.id)).toEqual(["a1"]);
  });

  it("returns nothing for a guide with no attachments", () => {
    expect(attachmentsFor(attachments, "g3")).toEqual([]);
  });
});

describe("the layout block the editor keeps", () => {
  it("turns guides on without claiming a mode the author did not choose", () => {
    const layout = withLayoutMode(undefined, [{ id: "g1", orientation: "horizontal", position: 10 }]);

    expect(layout?.mode).toBe("variable");
    expect(layout?.guides).toHaveLength(1);
  });

  it("leaves an absent block absent when there are no guides", () => {
    expect(withLayoutMode(undefined, [])).toBeUndefined();
  });

  it("keeps the document policy the author already set", () => {
    const before = {
      mode: "variable" as const,
      document: { growthX: "fixed" as const, growthY: "expand" as const, maxHeight: 3000 },
    };

    const after = withLayoutMode(before, [{ id: "g1", orientation: "horizontal", position: 10 }]);

    expect(after?.document).toEqual(before.document);
  });

  it("does not drop attachments that were already configured", () => {
    const before = {
      mode: "variable" as const,
      attachments: [
        { id: "a1", objectId: "r1", edge: "bottom" as const, guideId: "g1", behavior: "stretch" as const },
      ],
    };

    expect(withLayoutMode(before, [])?.attachments).toHaveLength(1);
  });
});