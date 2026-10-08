import { describe, expect, it } from "vitest";

import {
  MAX_ZOOM,
  clampPan,
  clampZoom,
  containScale,
  fitView,
  panBy,
  sceneToScreen,
  screenToScene,
  viewportTransform,
  zoomAbout,
} from "@/lib/canvas/viewport";

const PANE = { width: 800, height: 1000 };
const DOC = { width: 794, height: 1123 };

describe("containScale", () => {
  it("is the smaller of the two axis ratios, so the whole bill fits", () => {
    // 800/794 = 1.0076, 1000/1123 = 0.8905 -> the height binds.
    expect(containScale(PANE, DOC)).toBeCloseTo(1000 / 1123, 6);
  });

  it("follows the width when the bill is landscape", () => {
    expect(containScale(PANE, { width: 2000, height: 500 })).toBeCloseTo(0.4, 6);
  });

  it("returns 1 rather than Infinity for a degenerate document", () => {
    expect(containScale(PANE, { width: 0, height: 0 })).toBe(1);
    expect(containScale(PANE, { width: -5, height: 1123 })).toBe(1);
  });

  it("returns 1 rather than NaN for a zero-sized pane", () => {
    expect(containScale({ width: 0, height: 0 }, DOC)).toBe(1);
  });
});

describe("clampZoom", () => {
  it("keeps a zoom inside the bounds", () => {
    expect(clampZoom(2, PANE, DOC)).toBe(2);
    expect(clampZoom(0.001, PANE, DOC)).toBeCloseTo(containScale(PANE, DOC) / 2, 6);
    expect(clampZoom(99, PANE, DOC)).toBe(MAX_ZOOM);
  });

  it("allows zooming out to roughly half the bill, not hard-stopping at fit", () => {
    // The first-zoom "welded" complaint came from a fit-scale floor: once the
    // user had zoomed in, every wheel-out stepped back into the same fit clamp
    // and never produced visible shrink. Now the gesture still works past fit.
    const fit = containScale(PANE, DOC);
    expect(clampZoom(fit / 10, PANE, DOC)).toBeCloseTo(fit / 2, 6);
  });

  it("falls back to the safe floor for a non-finite zoom", () => {
    const fit = containScale(PANE, DOC);
    expect(clampZoom(Number.NaN, PANE, DOC)).toBeCloseTo(fit / 2, 6);
    expect(clampZoom(Number.POSITIVE_INFINITY, PANE, DOC)).toBeCloseTo(fit / 2, 6);
  });

  it("floors at MAX_ZOOM when the fit scale would exceed it (degenerate tiny bill)", () => {
    // A 10x10 bill in a 1000px pane fits at 100x. The plan's bound is
    // min(fit, MAX_ZOOM), so the allowed range collapses to MAX_ZOOM rather
    // than letting an unbounded fit scale through.
    const tiny = { width: 1000, height: 1000 };
    expect(containScale(tiny, { width: 10, height: 10 })).toBe(100);
    expect(clampZoom(0.5, tiny, { width: 10, height: 10 })).toBe(MAX_ZOOM);
    expect(clampZoom(100, tiny, { width: 10, height: 10 })).toBe(MAX_ZOOM);
  });
});

describe("clampPan", () => {
  it("slides within PAN_SLACK of [pane - img, 0] when the image covers the pane", () => {
    // Pane 800 wide, image 1600 wide -> t may sit in [-832, 32].
    expect(clampPan(-400, 800, 1600)).toBe(-400);
    expect(clampPan(0, 800, 1600)).toBe(0);
    expect(clampPan(32, 800, 1600)).toBe(32);
    expect(clampPan(50, 800, 1600)).toBe(32);
    expect(clampPan(-832, 800, 1600)).toBe(-832);
    expect(clampPan(-5000, 800, 1600)).toBe(-832);
  });

  it("cages, not welds, when the image falls inside the pane", () => {
    // Page 400 in an 800 pane: it can sit flush anywhere against either edge,
    // but at most 32px of blank can peek out on any one side.
    expect(clampPan(0, 800, 400)).toBe(0);
    expect(clampPan(-999, 800, 400)).toBe(-32);
    expect(clampPan(999, 800, 400)).toBe(432);
    expect(clampPan(400, 800, 400)).toBe(400);
  });

  it("clips around equality with a full PAN_SLACK of give on each side", () => {
    expect(clampPan(37, 800, 800)).toBe(32);
    expect(clampPan(-37, 800, 800)).toBe(-32);
  });

  it("centres rather than producing NaN for a non-finite translation", () => {
    expect(clampPan(Number.NaN, 800, 400)).toBe(200);
    expect(clampPan(Number.POSITIVE_INFINITY, 800, 400)).toBe(200);
  });

  it("never lets the free slippage exceed PAN_SLACK", () => {
    // The point of the change: the page can rest with up to a 32px blank band
    // on either side, but never further, so the page cannot appear stuck.
    expect(clampPan(500, 800, 1600)).toBe(32);
    expect(clampPan(-500, 800, 1600)).toBe(-500);
    expect(clampPan(-833, 800, 1600)).toBe(-832);
  });
});

describe("sceneToScreen / screenToScene", () => {
  it("applies the affine transform in both directions", () => {
    const view = { zoom: 2, tx: -30, ty: 44 };
    const screen = sceneToScreen({ x: 100, y: 50 }, view);
    expect(screen).toEqual({ x: 170, y: 144 });
    const back = screenToScene(screen, view);
    expect(back.x).toBeCloseTo(100, 9);
    expect(back.y).toBeCloseTo(50, 9);
  });

  it("puts the scene origin at the translation", () => {
    expect(sceneToScreen({ x: 0, y: 0 }, { zoom: 3, tx: 7, ty: -9 })).toEqual({
      x: 7,
      y: -9,
    });
  });

  it("returns the origin rather than Infinity when the zoom is zero", () => {
    expect(screenToScene({ x: 10, y: 10 }, { zoom: 0, tx: 0, ty: 0 })).toEqual({
      x: 0,
      y: 0,
    });
  });
});

describe("viewportTransform", () => {
  it("emits the six-element affine Fabric expects", () => {
    expect(viewportTransform({ zoom: 1.5, tx: 10, ty: -20 })).toEqual([
      1.5, 0, 0, 1.5, 10, -20,
    ]);
  });
});

describe("zoomAbout", () => {
  it("leaves the scene point under the cursor invariant", () => {
    const start = fitView(PANE, DOC);
    const cursor = { x: 640, y: 480 };
    const before = screenToScene(cursor, start);

    for (const factor of [1.25, 2, 4, 0.5]) {
      const next = zoomAbout(cursor, start.zoom * factor, start, PANE, DOC);
      const after = screenToScene(cursor, next);
      // Clamping can legitimately move the view at the very edge of the pan
      // range, so the invariant is asserted away from the extremes.
      const stillInterior =
        Math.abs(next.tx) < Math.abs(PANE.width - DOC.width * next.zoom) - 1;
      if (stillInterior) {
        expect(after.x).toBeCloseTo(before.x, 6);
        expect(after.y).toBeCloseTo(before.y, 6);
      }
    }
  });

  it("zooms out when asked for a smaller zoom", () => {
    const start = { zoom: 4, tx: -100, ty: -100 };
    const next = zoomAbout({ x: 400, y: 500 }, 2, start, PANE, DOC);
    expect(next.zoom).toBe(2);
  });

  it("honours both clamps", () => {
    const start = fitView(PANE, DOC);
    expect(zoomAbout({ x: 0, y: 0 }, 1e9, start, PANE, DOC).zoom).toBe(MAX_ZOOM);
    expect(
      zoomAbout({ x: 0, y: 0 }, 1e-9, start, PANE, DOC).zoom,
    ).toBeCloseTo(containScale(PANE, DOC) / 2, 6);
  });

  it("never leaves a blank gap on an axis where the image covers the pane", () => {
    const start = fitView(PANE, DOC);
    const next = zoomAbout({ x: 0, y: 0 }, 8, start, PANE, DOC);
    const imgW = DOC.width * next.zoom;
    const imgH = DOC.height * next.zoom;
    if (imgW >= PANE.width) expect(next.tx).toBeLessThanOrEqual(32);
    if (imgH >= PANE.height) expect(next.ty).toBeLessThanOrEqual(32);
  });
});

describe("fitView", () => {
  it("shows the whole document and centres both axes", () => {
    const view = fitView(PANE, DOC);
    expect(view.zoom).toBeCloseTo(containScale(PANE, DOC), 6);
    // 794 * 0.8905 = 707 < 800, so x is centred; y exactly fills the pane.
    expect(view.tx).toBeCloseTo((PANE.width - DOC.width * view.zoom) / 2, 6);
    expect(view.ty).toBeCloseTo((PANE.height - DOC.height * view.zoom) / 2, 6);
  });

  it("is a fixed point of clamping", () => {
    const view = fitView(PANE, DOC);
    expect(clampPan(view.tx, PANE.width, DOC.width * view.zoom)).toBeCloseTo(
      view.tx,
      6,
    );
    expect(clampZoom(view.zoom, PANE, DOC)).toBeCloseTo(view.zoom, 6);
  });

  it("is total for a degenerate pane or document", () => {
    const v = fitView({ width: 0, height: 0 }, { width: 0, height: 0 });
    expect(Number.isFinite(v.zoom)).toBe(true);
    expect(Number.isFinite(v.tx)).toBe(true);
    expect(Number.isFinite(v.ty)).toBe(true);
  });
});

describe("panBy", () => {
  it("adds the screen delta and re-clamps", () => {
    const start = { zoom: 2, tx: -100, ty: -100 };
    const next = panBy(40, 25, start, PANE, DOC);
    expect(next.tx).toBe(-60);
    expect(next.ty).toBe(-75);
    expect(next.zoom).toBe(2);
  });

  it("stops at the image edge + PAN_SLACK in each direction", () => {
    // Zoomed in far enough that the image covers the pane on both axes.
    const zoom = 4;
    const imgW = DOC.width * zoom;
    const imgH = DOC.height * zoom;
    const start = { zoom, tx: 0, ty: 0 };

    const right = panBy(99999, 0, start, PANE, DOC);
    expect(right.tx).toBe(32);

    const left = panBy(-99999, 0, start, PANE, DOC);
    expect(left.tx).toBeCloseTo(PANE.width - imgW - 32, 6);

    const down = panBy(0, 99999, start, PANE, DOC);
    expect(down.ty).toBe(32);

    const up = panBy(0, -99999, start, PANE, DOC);
    expect(up.ty).toBeCloseTo(PANE.height - imgH - 32, 6);
  });

  it("cages rather than welds when the image is smaller than the pane", () => {
    // With no clamp drifting to the centre, the page instead stops once
    // PAN_SLACK blank is exposed through either pane edge - it can't vanish.
    const next = panBy(500, 500, { zoom: 0.5, tx: 0, ty: 0 }, PANE, DOC);
    expect(next.tx).toBeCloseTo(PANE.width - DOC.width * 0.5 + 32, 6);
    const nextY = panBy(-9999, -9999, { zoom: 0.5, tx: 46, ty: 10 }, PANE, DOC);
    expect(nextY.tx).toBeCloseTo(-32, 6);
    expect(nextY.ty).toBeCloseTo(-32, 6);
  });
});