import { describe, expect, it } from "vitest";

import { levelsFromBounds, snapToLevels, type Levels } from "@/lib/canvas/snap";

const levels = (x: number[], y: number[]): Levels => ({ x, y });

describe("levelsFromBounds", () => {
  it("emits edges and centres on both axes", () => {
    const l = levelsFromBounds([{ left: 0, top: 0, right: 100, bottom: 40 }]);
    expect(l.x).toEqual([0, 50, 100]);
    expect(l.y).toEqual([0, 20, 40]);
  });
});

describe("snapToLevels", () => {
  const tolerance = 5;

  it("snaps the left edge to a nearby vertical level", () => {
    const edges = { left: 101, centreX: 141, right: 181, top: 0, centreY: 9, bottom: 18 };
    const r = snapToLevels(edges, levels([100], []), tolerance);
    expect(r.dx).toBe(-1);
    expect(r.guides).toEqual([{ axis: "x", pos: 100 }]);
  });

  it("picks the moving edge closest to a level", () => {
    const edges = { left: 0, centreX: 48, right: 97, top: 0, centreY: 0, bottom: 0 };
    const r = snapToLevels(edges, levels([100], []), tolerance);
    expect(r.dx).toBe(3); // right edge 97 -> 100
    expect(r.guides).toEqual([{ axis: "x", pos: 100 }]);
  });

  it("reports a shared level once even when several edges match", () => {
    const edges = { left: 99, centreX: 100, right: 101, top: 0, centreY: 0, bottom: 0 };
    const r = snapToLevels(edges, levels([100], []), tolerance);
    expect(r.dx).toBe(0);
    expect(r.guides).toEqual([{ axis: "x", pos: 100 }]);
  });

  it("produces no offset beyond tolerance", () => {
    const edges = { left: 120, centreX: 150, right: 180, top: 0, centreY: 0, bottom: 0 };
    const r = snapToLevels(edges, levels([100], []), tolerance);
    expect(r.dx).toBe(0);
    expect(r.guides).toEqual([]);
  });

  it("allows a corner to snap on both axes at once", () => {
    const edges = { left: 101, centreX: 141, right: 181, top: 21, centreY: 30, bottom: 39 };
    const r = snapToLevels(edges, levels([100], [20]), tolerance);
    expect(r.dx).toBe(-1);
    expect(r.dy).toBe(-1);
    expect(r.guides).toEqual(
      expect.arrayContaining([
        { axis: "x", pos: 100 },
        { axis: "y", pos: 20 },
      ]),
    );
  });

  it("no candidates means no offset and no guides", () => {
    const edges = { left: 0, centreX: 0, right: 0, top: 0, centreY: 0, bottom: 0 };
    const r = snapToLevels(edges, levels([], []), tolerance);
    expect(r.dx).toBe(0);
    expect(r.dy).toBe(0);
    expect(r.guides).toEqual([]);
  });
});
