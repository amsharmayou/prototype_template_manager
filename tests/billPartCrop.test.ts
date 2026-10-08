import { describe, expect, it } from "vitest";
import { clippedDocumentRect, imageRectForBox } from "@/lib/canvas/billPartCrop";

const DOC = { width: 1000, height: 700 };
const IMAGE = { width: 1000, height: 700 };

describe("imageRectForBox", () => {
  it("maps a document box to reference pixels", () => {
    expect(
      imageRectForBox(
        { left: 100, top: 60, width: 200, height: 80 },
        { width: 1000, height: 700 },
        { width: 500, height: 350 },
      ),
    ).toEqual({ left: 50, top: 30, width: 100, height: 40 });
  });

  it("clips to the reference image", () => {
    expect(
      imageRectForBox(
        { left: 400, top: 300, width: 400, height: 400 },
        { width: 500, height: 350 },
        { width: 1000, height: 700 },
      ),
    ).toEqual({ left: 800, top: 600, width: 200, height: 100 });
  });
});

describe("clippedDocumentRect", () => {
  it("returns the drawn box unchanged when it fits inside the reference", () => {
    const rect = { left: 100, top: 60, width: 200, height: 80 };
    expect(clippedDocumentRect(rect, DOC, IMAGE)).toEqual(rect);
  });

  it("trims a box that overhangs the right and bottom edges", () => {
    const clipped = clippedDocumentRect(
      { left: 800, top: 600, width: 400, height: 300 },
      DOC,
      IMAGE,
    );
    expect(clipped.left).toBeCloseTo(800);
    expect(clipped.top).toBeCloseTo(600);
    expect(clipped.width).toBeCloseTo(200);
    expect(clipped.height).toBeCloseTo(100);
  });

  it("clamps a box that starts off the top-left", () => {
    const clipped = clippedDocumentRect(
      { left: -50, top: -30, width: 250, height: 90 },
      DOC,
      IMAGE,
    );
    expect(clipped.left).toBeCloseTo(0);
    expect(clipped.top).toBeCloseTo(0);
    expect(clipped.width).toBeCloseTo(200);
    expect(clipped.height).toBeCloseTo(60);
  });

  it("keeps the clipped box in the same aspect ratio as the pixel crop", () => {
    // The placed object is scaled by `clip.width / crop.width`, so a stretched
    // result can only come from the two disagreeing. This is the overhanging
    // case the spec calls out: the raw drag box is 300x200 and the crop really
    // taken is the 10x10 corner.
    const rect = { left: 990, top: 690, width: 300, height: 200 };
    const pixels = imageRectForBox(rect, DOC, IMAGE);
    const clipped = clippedDocumentRect(rect, DOC, IMAGE);

    expect(pixels.width).toBe(10);
    expect(pixels.height).toBe(10);
    expect(clipped.left).toBeCloseTo(990);
    expect(clipped.top).toBeCloseTo(690);
    expect(clipped.width).toBeCloseTo(10);
    expect(clipped.height).toBeCloseTo(10);
    // Scaling that crop onto the raw drag box would have smeared it 30x.
    expect(clipped.width).toBeLessThan(rect.width / 10);
    expect(clipped.width / clipped.height).toBeCloseTo(pixels.width / pixels.height);
  });

  it("tracks the pixel crop through a non-uniform document/reference fit", () => {
    // A template sized for a different bill stretches the reference onto the
    // document, so the two axes no longer agree and the crop's pixel aspect
    // differs from the drawn box's.
    const image = { width: 500, height: 700 };
    const rect = { left: 500, top: 400, width: 400, height: 300 };
    const pixels = imageRectForBox(rect, DOC, image);
    const clipped = clippedDocumentRect(rect, DOC, image);

    // Nothing to trim, so the placed box is the drawn box...
    expect(clipped.left).toBeCloseTo(rect.left);
    expect(clipped.top).toBeCloseTo(rect.top);
    expect(clipped.width).toBeCloseTo(rect.width);
    expect(clipped.height).toBeCloseTo(rect.height);
    // ...while the crop keeps the reference's aspect. Both scale factors are
    // built from this same clamp, which is the pairing that stays consistent.
    expect(clipped.width / clipped.height).not.toBeCloseTo(
      pixels.width / pixels.height,
    );
    expect(clipped.width / pixels.width).toBeCloseTo(rect.width / pixels.width);
    expect(clipped.height / pixels.height).toBeCloseTo(rect.height / pixels.height);
  });
});
