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
}

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
  const ref: ReferenceHandle = { image, width, height };
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

function clampOpacity(v: number): number {
  if (!Number.isFinite(v)) return 1;
  return Math.min(1, Math.max(0, v));
}

/**
 * Stretch the image so it exactly covers the document rect. Called after the
 * page size changes — opening a bill (where it is the identity), loading a
 * template saved from a different bill, or undoing/redoing to a differently
 * sized snapshot.
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
