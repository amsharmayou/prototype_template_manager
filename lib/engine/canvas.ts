/**
 * The canvas painter: draw the display list onto a 2D surface for the editor
 * preview, a share-kit preview or a PNG in the test suite.
 *
 * Like every backend it only paints. Scaled by `scale` for zoom or raster
 * density; colors accept hex and the rgb() forms the display list carries.
 *
 * Pure with respect to the display list: the surface is the only input it
 * touches outside the list, and it draws nothing that was not already
 * positioned in the list.
 */

import type { DisplayList } from "./types";

export interface PaintListOptions {
  scale?: number;
  surface?: HTMLCanvasElement | OffscreenCanvas;
}

export function sizeCanvas(list: DisplayList, surface: HTMLCanvasElement, scale = 1): void {
  surface.width = Math.ceil(list.page.width * scale);
  surface.height = Math.ceil(list.page.height * scale);
}

function toFillStyle(value: string | undefined, fallback = "#000000"): string {
  if (typeof value !== "string" || value.length === 0 || value === "transparent") return fallback;
  return value;
}

/** Paint the list onto a CanvasRenderingContext2D the caller owns. */
export function paintList(
  ctx: CanvasRenderingContext2D,
  list: DisplayList,
  scale = 1,
  imageLoader?: (src: string, draw: (img: CanvasImageSource) => void) => void,
): string[] {
  const notes: string[] = [];
  ctx.save();
  ctx.scale(scale, scale);
  for (const item of list.paint) {
    if (item.kind === "rect") {
      if (item.fill && item.fill !== "transparent") {
        ctx.fillStyle = toFillStyle(item.fill);
        ctx.fillRect(item.x, item.y, item.width, item.height);
      }
      if (item.stroke && item.strokeWidth && item.strokeWidth > 0) {
        ctx.strokeStyle = toFillStyle(item.stroke);
        ctx.lineWidth = item.strokeWidth;
        if (item.radius && item.radius > 0) {
          ctx.beginPath();
          ctx.roundRect(item.x, item.y, item.width, item.height, item.radius);
          ctx.stroke();
        } else {
          ctx.strokeRect(item.x, item.y, item.width, item.height);
        }
      }
      continue;
    }
    if (item.kind === "ellipse") {
      ctx.beginPath();
      ctx.ellipse(item.cx, item.cy, Math.max(0.1, item.rx), Math.max(0.1, item.ry), 0, 0, Math.PI * 2);
      if (item.fill && item.fill !== "transparent") {
        ctx.fillStyle = toFillStyle(item.fill);
        ctx.fill();
      }
      if (item.strokeWidth && item.strokeWidth > 0) {
        ctx.strokeStyle = toFillStyle(item.stroke);
        ctx.lineWidth = item.strokeWidth;
        ctx.stroke();
      }
      continue;
    }
    if (item.kind === "line") {
      ctx.beginPath();
      ctx.strokeStyle = toFillStyle(item.stroke);
      ctx.lineWidth = Math.max(0.25, item.strokeWidth);
      ctx.moveTo(item.x1, item.y1);
      ctx.lineTo(item.x2, item.y2);
      ctx.stroke();
      continue;
    }
    if (item.kind === "path") {
      const path = new Path2D(item.d);
      ctx.beginPath();
      if (item.fill && item.fill !== "transparent") {
        ctx.fillStyle = toFillStyle(item.fill);
        ctx.fill(path);
      }
      if (item.strokeWidth && item.strokeWidth > 0) {
        ctx.strokeStyle = toFillStyle(item.stroke);
        ctx.lineWidth = Math.max(0.25, item.strokeWidth);
        ctx.stroke(path);
      }
      continue;
    }
    if (item.kind === "image") {
      const draw = (img: CanvasImageSource): void => ctx.drawImage(img, item.x, item.y, item.width, item.height);
      if (imageLoader) {
        imageLoader(item.src, draw);
      } else if (typeof Image !== "undefined") {
        const img = new Image();
        img.onload = () => draw(img);
        img.src = item.src;
      } else {
        notes.push(`image ${item.src.slice(0, 40)} not painted: no loader`);
      }
      continue;
    }
    ctx.fillStyle = toFillStyle(item.color);
    for (const line of item.lines) {
      const bold = line.font.weight === 700;
      ctx.font = `${line.font.italic ? "italic " : ""}${bold ? "bold " : ""}${line.size}px "${line.font.family}"`;
      ctx.textBaseline = "alphabetic";
      if (line.spacing > 0) {
        // Manual per-character advance so spacing matches the font book.
        let x = line.x;
        for (const ch of line.text) {
          ctx.fillText(ch, x, line.baseline);
          x += ctx.measureText(ch).width + line.spacing;
        }
      } else {
        ctx.fillText(line.text, line.x, line.baseline);
      }
    }
  }
  ctx.restore();
  return notes;
}

/** Paint into a fresh surface sized to the list. */
export function paintListToCanvas(list: DisplayList, scale = 1): HTMLCanvasElement | undefined {
  if (typeof document === "undefined") return undefined;
  const surface = document.createElement("canvas");
  sizeCanvas(list, surface, scale);
  const ctx = surface.getContext("2d");
  if (!ctx) return undefined;
  paintList(ctx, list, scale);
  return surface;
}
