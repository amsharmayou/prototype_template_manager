/**
 * The PDF backend: paint the display list into a print-ready, vector PDF with
 * embedded font subsets.
 *
 * The writer decides nothing about layout - the display list already carries
 * final positions - and refuses rather than substitutes: a font the bundle
 * does not carry, an image the bundle cannot resolve, or text that needs a
 * shaping engine none was given, each stops the print with a named refusal.
 *
 * Coordinates convert at 0.75 (96 dpi document px to 72 pt), which puts an A4
 * sheet on exactly 595.28 x 841.89 pt of paper.
 */

import fontkit from "@pdf-lib/fontkit";
import { PDFDocument, PDFFont, rgb, type PDFImage } from "pdf-lib";

import type { DisplayPaint, FontRef } from "./types";
import { hasComplexScript, type FontBook } from "./fonts";

export interface WritePdfOptions {
  book: FontBook;
  /** Resolve an image source to raw bytes; pkg:// assets are resolved upstream. */
  loadImage?: (src: string) => Promise<{ bytes: Uint8Array; mime: string } | undefined>;
  refuseComplexScript?: boolean;
  /** Text whose correct rendering needs a shaper that was not supplied. */
  title?: string;
}

export interface WritePdfResult {
  bytes: Uint8Array;
  refusals: string[];
}


function toRgb(value: string | undefined, fallback = "#000000"): { r: number; g: number; b: number } {
  const v = value && value !== "transparent" ? value : fallback;
  if (v.startsWith("#")) {
    const body = v.slice(1);
    const full = body.length <= 4 ? body.split("").map((ch) => ch + ch).join("") : body;
    const int = parseInt(full.slice(0, 6).padEnd(6, "0"), 16);
    if (Number.isFinite(int)) {
      return { r: ((int >> 16) & 0xff) / 255, g: ((int >> 8) & 0xff) / 255, b: (int & 0xff) / 255 };
    }
    return { r: 0, g: 0, b: 0 };
  }
  const fn = /rgba?\(([^)]+)\)/i.exec(v);
  if (fn) {
    const parts = fn[1]!.split(/[,\s/]+/).filter((p) => p.length > 0).map(Number);
    if (parts.length >= 3 && parts.slice(0, 3).every((n) => Number.isFinite(n))) {
      return { r: parts[0]! / 255, g: parts[1]! / 255, b: parts[2]! / 255 };
    }
  }
  return { r: 0, g: 0, b: 0 };
}

/** One display list: one printable page with its own extent. */
export interface PdfPageInput {
  page: { width: number; height: number };
  paint: DisplayPaint[];
  fonts: FontRef[];
}

export async function writePdf(pagesInput: readonly PdfPageInput[], options: WritePdfOptions): Promise<WritePdfResult> {
  // Convenience: a single page stays a single argument shape.
  const lists: readonly PdfPageInput[] = pagesInput;
  const refusals: string[] = [];
  const doc = await PDFDocument.create();
  doc.registerFontkit(fontkit);
  doc.setTitle(options.title ?? "Document");
  doc.setProducer("bill-template-maker");
  // The clock stays out of the print path: pdf-lib stamps creation and
  // modification times by default, and two saves that straddle a second
  // boundary would disagree byte-for-byte. A fixed epoch makes determinism a
  // property of the file, not of when the test happened to run.
  doc.setCreationDate(new Date(0));
  doc.setModificationDate(new Date(0));

  const embedded = new Map<string, PDFFont>();
  const embed = async (ref: FontRef): Promise<PDFFont | undefined> => {
    const known = embedded.get(ref.file);
    if (known) return known;
    const bytes = options.book.bytesOf(ref);
    if (!bytes) {
      refusals.push(`font ${ref.file} is missing from the bundle; refusing to substitute`);
      return undefined;
    }
    const font = await doc.embedFont(bytes, { subset: true }).catch((error: unknown) => {
      refusals.push(`font ${ref.file} could not be embedded: ${error instanceof Error ? error.message : String(error)}`);
      return undefined;
    });
    if (font) embedded.set(ref.file, font);
    return font;
  };

  const images = new Map<string, PDFImage>();

  // One PDF page per display list, in order. Metrics, subsets and images are
  // shared across the document: page 3 of a long bill embeds nothing new, so
  // a 60-line invoice stays one file with one font per face.
  const A4_PT = { w: 595.2756, h: 841.8898 };
  for (const list of lists) {
    // A4 templates land on the exact A4 point box (595.276 x 841.89); the 794
    // px template constant is 210.08 mm, a hair wide, and print paper is not.
    // The content scale follows the box, so a page that is not A4 keeps the
    // plain 0.75 px-to-pt conversion.
    const isA4 = list.page.width === 794 && list.page.height === 1123;
    const widthPt = isA4 ? A4_PT.w : list.page.width * (72 / 96);
    const pageH = isA4 ? A4_PT.h : list.page.height * (72 / 96);
    const k = widthPt / list.page.width;
    const page = doc.addPage([widthPt, pageH]);

  for (const item of list.paint) {
    if (item.kind === "rect") {
      if (item.fill && item.fill !== "transparent") {
        const c = toRgb(item.fill);
        page.drawRectangle({
          x: item.x * k,
          y: pageH - (item.y + item.height) * k,
          width: item.width * k,
          height: item.height * k,
          color: rgb(c.r, c.g, c.b),
          ...(item.radius ? { borderWidth: 0 } : {}),
        });
      }
      if (item.stroke && item.strokeWidth && item.strokeWidth > 0) {
        const c = toRgb(item.stroke);
        page.drawRectangle({
          x: item.x * k,
          y: pageH - (item.y + item.height) * k,
          width: item.width * k,
          height: item.height * k,
          borderColor: rgb(c.r, c.g, c.b),
          borderWidth: item.strokeWidth * k,
        });
      }
      continue;
    }
    if (item.kind === "ellipse") {
      const c = toRgb(item.stroke);
      if (item.fill && item.fill !== "transparent") {
        const f = toRgb(item.fill);
        page.drawEllipse({ x: item.cx * k, y: pageH - item.cy * k, xScale: item.rx * k, yScale: item.ry * k, color: rgb(f.r, f.g, f.b) });
      }
      if (item.strokeWidth && item.strokeWidth > 0) {
        page.drawEllipse({ x: item.cx * k, y: pageH - item.cy * k, xScale: item.rx * k, yScale: item.ry * k, borderColor: rgb(c.r, c.g, c.b), borderWidth: item.strokeWidth * k });
      }
      continue;
    }
    if (item.kind === "line") {
      const c = toRgb(item.stroke);
      page.drawLine({
        start: { x: item.x1 * k, y: pageH - item.y1 * k },
        end: { x: item.x2 * k, y: pageH - item.y2 * k },
        thickness: Math.max(0.25, item.strokeWidth * k),
        color: rgb(c.r, c.g, c.b),
      });
      continue;
    }
    if (item.kind === "path") {
      // Vector outlines (strokes, polygons) ride the display list as SVG paths
      // in document px; pdf-lib draws them as raw SVG in a top-left group.
      await page.drawSvgPath(item.d, {
        x: 0,
        y: pageH,
        ...(item.fill && item.fill !== "transparent" ? { color: (() => { const c = toRgb(item.fill!); return rgb(c.r, c.g, c.b); })() } : {}),
        borderColor: (() => { const c = toRgb(item.stroke); return rgb(c.r, c.g, c.b); })(),
        borderWidth: Math.max(0.25, (item.strokeWidth ?? 1) * k),
        scale: k,
      });
      continue;
    }
    if (item.kind === "image") {
      if (!item.src.startsWith("data:")) {
        refusals.push(`image source ${item.src.slice(0, 48)} is not embedded in the bundle; refusing to print without it`);
        continue;
      }
      let image = images.get(item.src);
      if (!image) {
        const header = /^data:(image\/[a-z0-9.+-]+);base64,/i.exec(item.src);
        if (!header) {
          refusals.push("an image source is not a data URI the bundle can print");
          continue;
        }
        const raw = item.src.slice(item.src.indexOf(",") + 1);
        const bin = typeof atob === "function" ? atob(raw) : Buffer.from(raw, "base64").toString("binary");
        const bytes = new Uint8Array(bin.length);
        for (let i = 0; i < bin.length; i += 1) bytes[i] = bin.charCodeAt(i);
        const embeddedImage = await (header[1]!.toLowerCase().includes("png") ? doc.embedPng(bytes) : doc.embedJpg(bytes)).catch((error: unknown) => {
          refusals.push(`an image could not be embedded: ${error instanceof Error ? error.message : String(error)}`);
          return undefined;
        });
        if (!embeddedImage) continue;
        image = embeddedImage;
        images.set(item.src, image);
      }
      page.drawImage(image, {
        x: item.x * k,
        y: pageH - (item.y + item.height) * k,
        width: item.width * k,
        height: item.height * k,
      });
      continue;
    }
    // Text lines. A shaped line (complex scripts) paints its glyphs as font
    // outlines - the shapes are the text, so no font embedding and no fallback
    // font are involved at all. Plain lines go through the embedded subset.
    for (const line of item.lines) {
      if (line.glyphs !== undefined && line.glyphs.length > 0) {
        if (options.refuseComplexScript && hasComplexScript(line.text)) {
          refusals.push(`a text run near y=${line.baseline} needs shaping this runtime cannot do; refusing to substitute`);
          continue;
        }
        const color = (() => { const c = toRgb(item.color); return rgb(c.r, c.g, c.b); })();
        const svg = line.glyphs
          .map((g) => options.book.glyphPathAt(line.font, g.gid, g.x, g.y, line.size))
          .filter((p) => p.length > 0)
          .join(" ");
        if (svg.length > 0) {
          await page.drawSvgPath(svg, { x: 0, y: pageH, scale: k, color });
        }
        continue;
      }
      if (options.refuseComplexScript && hasComplexScript(line.text)) {
        refusals.push(`a text run near y=${line.baseline} needs shaping this runtime cannot do; refusing to substitute`);
        continue;
      }
      const font = await embed(line.font);
      if (!font) continue;
      page.drawText(line.text, {
        x: line.x * k,
        y: pageH - line.baseline * k,
        size: line.size * k,
        font,
        color: (() => { const c = toRgb(item.color); return rgb(c.r, c.g, c.b); })(),
      });
    }
  }
  }

  const bytes = await doc.save({ useObjectStreams: false });
  return { bytes, refusals };
}
