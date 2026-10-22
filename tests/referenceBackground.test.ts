import { describe, expect, it } from "vitest";

import { cropForPage } from "@/lib/canvas/referenceBackground";

describe("reference photo page fit crop", () => {
  it("trims the horizontal margins of a wide photo", () => {
    expect(cropForPage(1600, 1000, { width: 1000, height: 1000 }, 0)).toEqual({
      top: 0,
      right: 18.75,
      bottom: 0,
      left: 18.75,
    });
  });

  it("chooses crop edges in source coordinates before a quarter turn", () => {
    expect(cropForPage(1600, 1000, { width: 1000, height: 1000 }, 90)).toEqual({
      top: 0,
      right: 18.75,
      bottom: 0,
      left: 18.75,
    });
  });

  it("trims vertical source margins when a portrait photo is rotated to a landscape page", () => {
    const crop = cropForPage(1000, 1600, { width: 1600, height: 1200 }, 90);
    expect(crop.top).toBeCloseTo(8.333, 2);
    expect(crop.right).toBe(0);
    expect(crop.bottom).toBeCloseTo(8.333, 2);
    expect(crop.left).toBe(0);
  });

  it("does not crop when the image already matches the page", () => {
    expect(cropForPage(800, 1000, { width: 800, height: 1000 }, 0)).toEqual({
      top: 0,
      right: 0,
      bottom: 0,
      left: 0,
    });
  });
});
