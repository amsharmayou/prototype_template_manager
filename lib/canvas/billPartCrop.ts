import { normalisePaper } from "@/lib/canvas/paperNormalise";
import type { ReferenceHandle } from "@/lib/canvas/referenceBackground";
import type { SourceRect } from "@/lib/template/types";

export interface DocumentRect {
  left: number;
  top: number;
  width: number;
  height: number;
}

export function imageRectForBox(
  rect: DocumentRect,
  doc: { width: number; height: number },
  image: { width: number; height: number },
): { left: number; top: number; width: number; height: number } {
  const sx = image.width / Math.max(1, doc.width);
  const sy = image.height / Math.max(1, doc.height);
  const left = Math.max(0, Math.round(rect.left * sx));
  const top = Math.max(0, Math.round(rect.top * sy));
  const right = Math.min(image.width, Math.round((rect.left + rect.width) * sx));
  const bottom = Math.min(image.height, Math.round((rect.top + rect.height) * sy));
  return {
    left,
    top,
    width: Math.max(0, right - left),
    height: Math.max(0, bottom - top),
  };
}

/**
 * The drawn box restricted to the reference, in document coordinates.
 *
 * `imageRectForBox` clamps in reference pixels; this is the same clamp mapped
 * back into the space the box was drawn in. A drag that overhangs a reference
 * edge must be placed at the part the crop actually covers — scaling the crop
 * back onto the unclipped drag box smears it instead, and a drag that only
 * just touches the edge is the worst case of all: a two-pixel crop stretched
 * across the whole box.
 */
export function clippedDocumentRect(
  rect: DocumentRect,
  doc: { width: number; height: number },
  image: { width: number; height: number },
): DocumentRect {
  const box = imageRectForBox(rect, doc, image);
  const sx = image.width / Math.max(1, doc.width);
  const sy = image.height / Math.max(1, doc.height);
  const left = box.left / sx;
  const top = box.top / sy;
  return {
    left,
    top,
    width: (box.left + box.width) / sx - left,
    height: (box.top + box.height) / sy - top,
  };
}

export interface BillPartCrop {
  src: string;
  /** The clipped document box, not the raw drag: see `clippedDocumentRect`. */
  rect: DocumentRect;
  sourceRect: SourceRect;
  /** Whether `src`'s paper was whitened. Describes the pixels, not an intent. */
  normalized: boolean;
  width: number;
  height: number;
  /**
   * The crop's own canvas rather than a fresh `Image` built from `src`. The
   * canvas is already painted and immediately drawable; an `Image` is only
   * `complete` once the browser has decoded `src`, so handing one back made a
   * freshly captured part render as nothing until that decode finished.
   */
  image: HTMLCanvasElement | HTMLImageElement;
}

export interface CropOptions {
  /**
   * Whiten the crop's border-connected paper. Off means the crop is the
   * reference's own pixels, untouched.
   *
   * Off skips the `getImageData`/`putImageData` round-trip altogether rather
   * than normalising to nothing. That keeps an as-is crop pixel-exact — a
   * round-trip through `ImageData` is not guaranteed to be lossless — and
   * skips a full-canvas flood fill and re-encode.
   */
  normalise?: boolean;
}

export function cropBillPart(
  ref: ReferenceHandle,
  doc: { width: number; height: number },
  rect: DocumentRect,
  options: CropOptions = {},
): BillPartCrop | null {
  const normalise = options.normalise !== false;
  const box = imageRectForBox(rect, doc, { width: ref.width, height: ref.height });
  if (box.width < 2 || box.height < 2) return null;
  const source = ref.image.getElement() as HTMLImageElement;
  const canvas = document.createElement("canvas");
  canvas.width = box.width;
  canvas.height = box.height;
  const ctx = canvas.getContext("2d");
  if (!ctx) return null;
  ctx.drawImage(source, box.left, box.top, box.width, box.height, 0, 0, box.width, box.height);
  if (normalise) {
    const imageData = ctx.getImageData(0, 0, box.width, box.height);
    normalisePaper(imageData.data, box.width, box.height);
    ctx.putImageData(imageData, 0, 0);
  }
  const placed = clippedDocumentRect(rect, doc, {
    width: ref.width,
    height: ref.height,
  });
  return {
    src: canvas.toDataURL("image/png"),
    rect: placed,
    sourceRect: {
      x: placed.left,
      y: placed.top,
      width: placed.width,
      height: placed.height,
    },
    normalized: normalise,
    width: box.width,
    height: box.height,
    image: canvas,
  };
}
