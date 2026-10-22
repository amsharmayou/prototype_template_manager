/**
 * The reference bill image, treated as the canvas background rather than a
 * selectable Fabric object.
 *
 * Fabric renders `canvas.backgroundImage` through the viewport transform
 * (`backgroundVpt: true`), so the reference and every traced object share one
 * affine surface: zoom and pan move them together, and the reference can never
 * be selected, moved, scaled, layered, serialised or exported, because it is
 * not a member of the scene's object list at all.
 */

import { FabricImage, type Canvas } from "fabric";

export interface ReferenceHandle {
  image: FabricImage;
  /** Natural (unstretched) image dimensions. */
  width: number;
  height: number;
  sourceWidth: number;
  sourceHeight: number;
  /** Original authoring aid; never serialized into the bill template. */
  sourceDataUrl: string;
  crop: ReferenceCrop;
  rotation: 0 | 90 | 180 | 270;
}

export interface ReferenceCrop {
  top: number;
  right: number;
  bottom: number;
  left: number;
}

export const EMPTY_REFERENCE_CROP: ReferenceCrop = { top: 0, right: 0, bottom: 0, left: 0 };

/**
 * Average the colour of the 1px outer ring of the image, capped at 32px on the
 * long edge. The result is used as the canvas background so the seam between
 * the bill and the pane blends in. Falls back to white on any failure — a
 * scanned bill on white yields white, so the seam is invisible.
 */
export function sampleBorderColor(image: FabricImage): string {
  try {
    const nw = image.width || 0;
    const nh = image.height || 0;
    if (nw <= 0 || nh <= 0) return "#ffffff";
    const scale = Math.min(1, 32 / Math.max(nw, nh));
    const w = Math.max(1, Math.round(nw * scale));
    const h = Math.max(1, Math.round(nh * scale));
    const el = document.createElement("canvas");
    el.width = w;
    el.height = h;
    const ctx = el.getContext("2d");
    if (!ctx) return "#ffffff";
    const src = image.getElement() as HTMLImageElement;
    ctx.drawImage(src, 0, 0, w, h);
    const ring = [
      ...row(ctx, 0, 0, w),
      ...row(ctx, 0, h - 1, w),
      ...column(ctx, 0, 0, h),
      ...column(ctx, w - 1, 0, h),
    ];
    if (ring.length === 0) return "#ffffff";
    let r = 0;
    let g = 0;
    let b = 0;
    for (const [cr, cg, cb] of ring) {
      r += cr;
      g += cg;
      b += cb;
    }
    const n = ring.length;
    const hex = (v: number) =>
      Math.round(v / n).toString(16).padStart(2, "0");
    return `#${hex(r)}${hex(g)}${hex(b)}`;
  } catch {
    return "#ffffff";
  }
}

function row(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
): Array<[number, number, number]> {
  const out: Array<[number, number, number]> = [];
  for (let i = 0; i < w; i++) {
    const d = ctx.getImageData(x + i, y, 1, 1).data;
    out.push([d[0]!, d[1]!, d[2]!]);
  }
  return out;
}

function column(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  h: number,
): Array<[number, number, number]> {
  const out: Array<[number, number, number]> = [];
  for (let i = 0; i < h; i++) {
    const d = ctx.getImageData(x, y + i, 1, 1).data;
    out.push([d[0]!, d[1]!, d[2]!]);
  }
  return out;
}

/**
 * Load the image and install it as the canvas background, fitted to the
 * document rect. Returns a handle the controller keeps; the caller adopts the
 * returned natural size as the document size.
 */
export async function install(
  canvas: Canvas,
  dataUrl: string,
  opacity: number,
): Promise<ReferenceHandle> {
  const image = await FabricImage.fromURL(dataUrl, {
    crossOrigin: "anonymous",
  });
  const width = Math.round(image.width ?? 0);
  const height = Math.round(image.height ?? 0);
  const ref: ReferenceHandle = {
    image,
    width,
    height,
    sourceWidth: width,
    sourceHeight: height,
    sourceDataUrl: dataUrl,
    crop: { ...EMPTY_REFERENCE_CROP },
    rotation: 0,
  };
  image.set({
    left: 0,
    top: 0,
    originX: "left",
    originY: "top",
    selectable: false,
    evented: false,
    opacity: clampOpacity(opacity),
  } as never);
  fitTo(ref, { width: width || 1, height: height || 1 });
  canvas.backgroundImage = image;
  canvas.backgroundColor = sampleBorderColor(image);
  canvas.requestRenderAll();
  return ref;
}

/** Create an adjusted authoring reference without mutating or serializing its source. */
export async function buildAdjustedReference(
  current: ReferenceHandle,
  crop: ReferenceCrop,
  rotation: 0 | 90 | 180 | 270,
  opacity: number,
): Promise<ReferenceHandle> {
  const source = await loadImage(current.sourceDataUrl);
  const safeCrop = clampCrop(crop);
  const sx = source.naturalWidth * safeCrop.left / 100;
  const sy = source.naturalHeight * safeCrop.top / 100;
  const sw = source.naturalWidth * (100 - safeCrop.left - safeCrop.right) / 100;
  const sh = source.naturalHeight * (100 - safeCrop.top - safeCrop.bottom) / 100;
  const sideways = rotation === 90 || rotation === 270;
  const outWidth = Math.max(1, Math.round(sideways ? sh : sw));
  const outHeight = Math.max(1, Math.round(sideways ? sw : sh));
  const work = document.createElement("canvas");
  work.width = outWidth;
  work.height = outHeight;
  const context = work.getContext("2d");
  if (!context) throw new Error("Could not prepare the cropped reference image.");
  if (rotation === 90) {
    context.translate(outWidth, 0);
    context.rotate(Math.PI / 2);
  } else if (rotation === 180) {
    context.translate(outWidth, outHeight);
    context.rotate(Math.PI);
  } else if (rotation === 270) {
    context.translate(0, outHeight);
    context.rotate(-Math.PI / 2);
  }
  context.drawImage(source, sx, sy, sw, sh, 0, 0, sw, sh);
  const image = await FabricImage.fromURL(work.toDataURL("image/png"), {
    crossOrigin: "anonymous",
  });
  image.set({
    left: 0,
    top: 0,
    originX: "left",
    originY: "top",
    selectable: false,
    evented: false,
    opacity: clampOpacity(opacity),
  } as never);
  return {
    image,
    width: Math.round(image.width ?? outWidth),
    height: Math.round(image.height ?? outHeight),
    sourceWidth: current.sourceWidth,
    sourceHeight: current.sourceHeight,
    sourceDataUrl: current.sourceDataUrl,
    crop: safeCrop,
    rotation,
  };
}

/** Crop the centre of an image to match the page's aspect ratio. */
export function cropForPage(
  width: number,
  height: number,
  page: { width: number; height: number },
  rotation: 0 | 90 | 180 | 270,
): ReferenceCrop {
  // Cropping is applied to the unrotated source, so compare its aspect ratio
  // against the page rotated back into source coordinates.
  const sideways = rotation === 90 || rotation === 270;
  const imageAspect = width / Math.max(1, height);
  const pageAspect = sideways
    ? page.height / Math.max(1, page.width)
    : page.width / Math.max(1, page.height);
  if (imageAspect > pageAspect) {
    const keep = pageAspect / imageAspect;
    const trim = (100 - keep * 100) / 2;
    return { top: 0, right: trim, bottom: 0, left: trim };
  }
  const keep = imageAspect / pageAspect;
  const trim = (100 - keep * 100) / 2;
  return { top: trim, right: 0, bottom: trim, left: 0 };
}

function clampCrop(crop: ReferenceCrop): ReferenceCrop {
  const top = clampPercent(crop.top);
  const right = clampPercent(crop.right);
  const bottom = clampPercent(crop.bottom);
  const left = clampPercent(crop.left);
  const horizontalScale = Math.min(1, 90 / Math.max(1, left + right));
  const verticalScale = Math.min(1, 90 / Math.max(1, top + bottom));
  return {
    top: top * verticalScale,
    right: right * horizontalScale,
    bottom: bottom * verticalScale,
    left: left * horizontalScale,
  };
}

function clampPercent(value: number): number {
  return Number.isFinite(value) ? Math.min(90, Math.max(0, value)) : 0;
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error("Could not read the original reference image."));
    image.src = src;
  });
}

function clampOpacity(v: number): number {
  if (!Number.isFinite(v)) return 1;
  return Math.min(1, Math.max(0, v));
}

/**
 * Re-map the reference onto the document exactly: left 0, top 0, both axes
 * scaled to the page, so the underlay is pinned to the sheet corner to corner.
 *
 * Two flows guarantee this stays distortion-free in practice. When a photo is
 * first attached, the page *adopts* the image's natural size (uniform scale
 * 1); on every later rebinding - a template load, a page resize - the page has
 * its own fixed size, and the underlay follows it rather than floating
 * centred: a stranded, centred image is how tracing drifts by an inch after a
 * reload.
 */
export function fitTo(
  ref: ReferenceHandle,
  doc: { width: number; height: number },
): void {
  const nw = ref.width || 1;
  const nh = ref.height || 1;
  ref.image.set({
    left: 0,
    top: 0,
    originX: "left",
    originY: "top",
    scaleX: doc.width / nw,
    scaleY: doc.height / nh,
  } as never);
  ref.image.setCoords();
}

/** Toggle visibility by assigning or clearing the background image. */
export function setVisible(
  canvas: Canvas,
  ref: ReferenceHandle | null,
  visible: boolean,
): void {
  if (!ref) return;
  canvas.backgroundImage = visible ? ref.image : undefined;
  canvas.requestRenderAll();
}

export function setOpacity(ref: ReferenceHandle | null, value: number): void {
  if (!ref) return;
  ref.image.set({ opacity: clampOpacity(value) } as never);
}

/** Detach the image and restore the plain white page. */
export function remove(canvas: Canvas): void {
  canvas.backgroundImage = undefined;
  canvas.backgroundColor = "";
  canvas.requestRenderAll();
}
