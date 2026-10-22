/**
 * Turn a bound, solved template into the display list.
 *
 * Input is what `renderHtml` returns: objects with their final geometry (the
 * variable layout already solved, repeat bands already expanded) and the page
 * that was actually drawn. Everything here is a painting decision - which
 * face, which lines, which baselines - made once from the font book.
 */

import type { TableObject, TemplateObject } from "@/lib/template/types";
import { FontBook, hasComplexScript, type TextStyle } from "./fonts";
import type { DisplayList, DisplayLine, DisplayPaint, FontRef } from "./types";

export { hasComplexScript };

export interface ListInput {
  objects: readonly TemplateObject[];
  page: { width: number; height: number };
  warnings: readonly string[];
}

export interface ListOptions {
  book: FontBook;
  /** Refuse (via `onRefusal`) instead of painting when a run needs shaping. */
  refuseComplexScript?: boolean;
  onRefusal?: (message: string) => void;
}

function styleOf(o: Record<string, unknown>): TextStyle {
  const size = typeof o.fontSize === "number" && o.fontSize > 0 ? o.fontSize : 14;
  const sx = typeof o.scaleX === "number" && Number.isFinite(o.scaleX) && o.scaleX !== 0 ? o.scaleX : 1;
  const sy = typeof o.scaleY === "number" && Number.isFinite(o.scaleY) && o.scaleY !== 0 ? o.scaleY : 1;
  const spacing =
    typeof o.charSpacing === "number" && Number.isFinite(o.charSpacing)
      ? (o.charSpacing / 1000) * size
      : 0;
  return {
    family: typeof o.fontFamily === "string" && o.fontFamily.length > 0 ? o.fontFamily : "Arial",
    size: size * sy,
    weight: o.fontWeight === "bold" ? "bold" : "normal",
    italic: o.fontStyle === "italic",
    spacing: spacing * sx,
  };
}

function colorOf(v: unknown, fallback: string): string {
  return typeof v === "string" && v.length > 0 ? v : fallback;
}
void colorOf;

function hex(value: string | undefined, fallback: string): string {
  if (typeof value !== "string" || value.length === 0) return fallback;
  const v = value.trim();
  if (/^#[0-9a-fA-F]{3,8}$/.test(v)) return v;
  if (/^(rgba?\(|hsla?\()/i.test(v)) return v;
  return fallback;
}

/**
 * Lay out lines inside a box: wrap, position baselines with half-leading, and
 * align each line inside the available width. Returns every line already
 * positioned, or an empty list when nothing should paint.
 */
function layoutLines(
  book: FontBook,
  text: string,
  style: TextStyle,
  box: { x: number; y: number; width: number; height: number },
  opts: {
    lineHeight: number;
    wraps: boolean;
    align: "left" | "center" | "right";
    vertical: "top" | "middle" | "bottom";
    ref: FontRef;
    color: string;
    /** Shape this run with the shaper (complex scripts) instead of plain text. */
    shaped?: boolean;
  },
): DisplayPaint {
  const shapedWrap =
    opts.shaped === true ? book.shapeWrapped(opts.ref, text, box.width) : undefined;
  if (shapedWrap !== undefined) {
    const lineBox = opts.lineHeight * style.size;
    const metrics = book.metrics(opts.ref);
    const upem = book.upemOf(opts.ref);
    const k = style.size / upem;
    const block = shapedWrap.length * lineBox;
    const free = Math.max(0, box.height - block);
    const top =
      opts.vertical === "middle" ? box.y + free / 2
      : opts.vertical === "bottom" ? box.y + free
      : box.y;
    const positioned: DisplayLine[] = [];
    shapedWrap.forEach((line, i) => {
      const width = (line.widthUnits * style.size) / upem;
      const x =
        opts.align === "center" ? box.x + (box.width - width) / 2
        : opts.align === "right" ? box.x + box.width - width
        : box.x;
      const baseline =
        top + i * lineBox + (lineBox - (metrics.asc + metrics.desc) * style.size) / 2 + metrics.asc * style.size;
      // Per-glyph draw point: pen advances through the shaped sequence, each
      // glyph offset by dx/dy, scaled from font units into document pixels.
      let pen = 0;
      const glyphs = line.glyphs.map((g) => {
        const gx = x + (pen + g.dx) * k;
        const gy = baseline - g.dy * k;
        pen += g.ax + (opts.shaped ? (style.spacing ?? 0) / k : 0);
        return { gid: g.gid, x: gx, y: gy };
      });
      positioned.push({
        x,
        baseline,
        text: line.text,
        font: opts.ref,
        size: style.size,
        spacing: style.spacing ?? 0,
        width,
        glyphs,
      });
    });
    return { kind: "text", lines: positioned, color: opts.color };
  }
  const lines = opts.wraps ? book.wrap(text, box.width, style) : text.split("\n");
  const lineBox = opts.lineHeight * style.size;
  const metrics = book.metrics(opts.ref);
  const visible = lines.filter((l) => l.length > 0);
  const block = visible.length * lineBox;
  const free = Math.max(0, box.height - block);
  const top =
    opts.vertical === "middle" ? box.y + free / 2
    : opts.vertical === "bottom" ? box.y + free
    : box.y;
  const positioned: DisplayLine[] = [];
  visible.forEach((line, i) => {
    const width = book.measure(line, style);
    const x =
      opts.align === "center" ? box.x + (box.width - width) / 2
      : opts.align === "right" ? box.x + box.width - width
      : box.x;
    positioned.push({
      x,
      baseline: top + i * lineBox + (lineBox - (metrics.asc + metrics.desc) * style.size) / 2 + metrics.asc * style.size,
      text: line,
      font: opts.ref,
      size: style.size,
      spacing: style.spacing ?? 0,
      width,
    });
  });
  return { kind: "text", lines: positioned, color: opts.color };
}

function polygonPath(o: Record<string, unknown>): string | undefined {
  const pts = o.points;
  const w = typeof o.width === "number" ? o.width : 0;
  const h = typeof o.height === "number" ? o.height : 0;
  const x0 = typeof o.x === "number" ? o.x : 0;
  const y0 = typeof o.y === "number" ? o.y : 0;
  if (!Array.isArray(pts) || pts.length < 2) return undefined;
  const parts = pts.map((p, i) => {
    if (!Array.isArray(p) || p.length < 2) return undefined;
    const [px, py] = p as unknown[];
    if (typeof px !== "number" || typeof py !== "number") return undefined;
    return `${i === 0 ? "M" : "L"} ${(x0 + (px / 100) * w).toFixed(2)} ${(y0 + (py / 100) * h).toFixed(2)}`;
  });
  if (parts.some((p) => p === undefined)) return undefined;
  return `${parts.join(" ")} Z`;
}

/** Every object type the bound template can carry, painted once. */
export function buildDisplayList(input: ListInput, options: ListOptions): DisplayList {
  const { book } = options;
  const paint: DisplayPaint[] = [];
  const warnings: string[] = [];
  const refuse = (message: string): void => {
    if (options.onRefusal) options.onRefusal(message);
    warnings.push(message);
  };

  for (const o of input.objects as unknown as Record<string, unknown>[]) {
    const type = o.type;
    if (type === "rect" || type === "rounded-rect") {
      paint.push({
        kind: "rect",
        x: Number(o.x),
        y: Number(o.y),
        width: Number(o.width),
        height: Number(o.height),
        radius: type === "rounded-rect" ? Number(o.cornerRadius ?? 0) : 0,
        fill: o.fill === "transparent" ? undefined : hex(o.fill as string, "transparent"),
        stroke: hex(o.stroke as string, "#000000"),
        strokeWidth: Number(o.strokeWidth ?? 0),
      });
      continue;
    }
    if (type === "ellipse") {
      paint.push({
        kind: "ellipse",
        cx: Number(o.x) + Number(o.width) / 2,
        cy: Number(o.y) + Number(o.height) / 2,
        rx: Number(o.width) / 2,
        ry: Number(o.height) / 2,
        fill: o.fill === "transparent" ? undefined : hex(o.fill as string, "transparent"),
        stroke: hex(o.stroke as string, "#000000"),
        strokeWidth: Number(o.strokeWidth ?? 0),
      });
      continue;
    }
    if (type === "polygon" || type === "freehand") {
      const d = type === "polygon" ? polygonPath(o) : typeof o.path === "string" ? o.path : undefined;
      if (!d) continue;
      paint.push({
        kind: "path",
        d,
        fill: type === "polygon" && o.fill !== "transparent" ? hex(o.fill as string, "transparent") : undefined,
        stroke: hex(o.stroke as string, "#000000"),
        strokeWidth: Number(o.strokeWidth ?? 1),
      });
      continue;
    }
    if (type === "hr" || type === "vr") {
      paint.push({
        kind: "line",
        x1: Number(o.x),
        y1: Number(o.y),
        x2: Number(o.x2 ?? o.x),
        y2: Number(o.y2 ?? o.y),
        stroke: hex(o.stroke as string, "#000000"),
        strokeWidth: Number(o.strokeWidth ?? 1),
      });
      continue;
    }
    if (type === "image-placeholder" || type === "bill-part") {
      const src = o.src;
      if (typeof src !== "string" || src.length === 0) continue;
      paint.push({
        kind: "image",
        x: Number(o.x),
        y: Number(o.y),
        width: Number(o.width),
        height: Number(o.height),
        src,
      });
      continue;
    }
    if (type === "text" || type === "field") {
      const text = typeof o.text === "string" ? o.text : "";
      if (text.length === 0) continue;
      if (options.refuseComplexScript && hasComplexScript(text)) {
        refuse(
          `object "${String(o.name ?? o.id)}" carries characters this print engine must shape, and the shaping engine is unavailable; printing is refused rather than substituted`,
        );
        continue;
      }
      const style = styleOf(o);
      const ref = book.refFor(style);
      if (!ref) {
        refuse(`no bundled font for family "${String(o.fontFamily)}"; printing is refused rather than substituted`);
        continue;
      }
      const rawWrap = o.wrapWidth;
      const wrapWidth = typeof rawWrap === "number" && rawWrap > 0 ? Number(rawWrap) : 0;
      const sx = typeof o.scaleX === "number" && o.scaleX !== 0 ? o.scaleX : 1;
      const boxWidth = wrapWidth > 0 ? wrapWidth : Number(o.width);
      const align = (o.textAlign === "center" || o.textAlign === "right" ? o.textAlign : "left") as "left" | "center" | "right";
      const vertical = (o.textVerticalAlign === "middle" || o.textVerticalAlign === "bottom" ? o.textVerticalAlign : "top") as "top" | "middle" | "bottom";
      const complex = hasComplexScript(text);
      paint.push(
        layoutLines(book, text, style, {
          x: Number(o.x),
          y: Number(o.y),
          width: boxWidth * sx,
          height: Number(o.height),
        }, {
          lineHeight: typeof o.lineHeight === "number" ? o.lineHeight : 1.16,
          wraps: wrapWidth > 0,
          align,
          vertical,
          ref,
          color: hex(o.fill as string, "#000000"),
          // Complex runs are shaped only when a shaper is attached; otherwise
          // the run paints the approximate metric path and the print writer
          // refuses it rather than printing an unshaped approximation.
          shaped: complex && book.shaperReady(),
        }),
      );
      continue;
    }
    if (type === "table") {
      paintTable(book, o as unknown as TableObject, paint, refuse, options);
      continue;
    }
  }

  const fonts: FontRef[] = [];
  for (const p of paint) {
    if (p.kind !== "text") continue;
    for (const line of p.lines) {
      if (!fonts.some((f) => f.file === line.font.file)) fonts.push(line.font);
    }
  }
  return { page: { ...input.page }, fonts, paint, warnings };
}

/**
 * One display list per printable page.
 *
 * `renderDocument` returns the document cut into pages; each page is laid out
 * with the same font book and the same rules, so page 3 of a long bill is
 * positioned by the same arithmetic that positioned page 1. Shared warnings
 * ride on the first page - a caller reading one list should not have to know
 * which pass produced an entry.
 */
export function buildDisplayPages(
  pages: ReadonlyArray<{ objects: readonly TemplateObject[]; width: number; height: number }>,
  sharedWarnings: readonly string[],
  options: ListOptions,
): DisplayList[] {
  return pages.map((page, i) =>
    buildDisplayList(
      {
        objects: page.objects,
        page: { width: page.width, height: page.height },
        warnings: i === 0 ? sharedWarnings : [],
      },
      options,
    ),
  );
}

function paintTable(
  book: FontBook,
  o: TableObject,
  paint: DisplayPaint[],
  refuse: (message: string) => void,
  options: ListOptions,
): void {
  const cols = Array.isArray(o.colWidths) ? o.colWidths : [];
  const rowsH = Array.isArray(o.rowHeights) ? o.rowHeights : [];
  const colsCount = o.columns > 0 ? o.columns : 1;
  if (cols.length === 0 || rowsH.length === 0) return;
  const cells = Array.isArray(o.cells) ? o.cells : [];
  const x0 = Number(o.x);
  const y0 = Number(o.y);

  let rowCursor = y0;
  for (let r = 0; r < rowsH.length; r += 1) {
    const rowH = rowsH[r]!;
    let colCursor = x0;
    for (let c = 0; c < colsCount; c += 1) {
      const colW = cols[c] ?? 0;
      const cell = cells[r * colsCount + c];
      const header = o.headerRow === true && r === 0;
      const fill = header ? o.headerFill : o.cellFill;
      if (typeof fill === "string" && fill !== "transparent") {
        paint.push({ kind: "rect", x: colCursor, y: rowCursor, width: colW, height: rowH, fill: hex(fill, "transparent"), radius: 0 });
      }
      const text = typeof cell?.text === "string" ? cell.text : "";
      if (text.length > 0) {
        if (options.refuseComplexScript && hasComplexScript(text)) {
          refuse(`cell (${r}, ${c}) of "${o.name}" carries characters this print engine must shape, and the shaping engine is unavailable; printing is refused rather than substituted`);
        } else {
          const style: TextStyle = {
            family: o.fontFamily,
            size: typeof cell.fontSize === "number" && cell.fontSize > 0 ? cell.fontSize : 11,
            weight: cell?.fontWeight === "bold" ? "bold" : "normal",
            italic: false,
            spacing: 0,
          };
          const ref = book.refFor(style);
          if (!ref) {
            refuse(`no bundled font for family "${String(o.fontFamily)}" in "${o.name}"; printing is refused rather than substituted`);
          } else {
            const ink = header ? o.headerTextColor : o.cellTextColor;
            const base = typeof cell?.color === "string" ? cell.color : undefined;
            paint.push(
              layoutLines(book, text, style, {
                x: colCursor + o.padding,
                y: rowCursor,
                width: Math.max(0, colW - o.padding * 2),
                height: Math.max(0, rowH - o.padding * 2),
              }, {
                lineHeight: 1.2,
                wraps: true,
                align: cell?.textAlign ?? "left",
                vertical: "middle",
                ref,
                color: hex(base, header ? hex(ink, "#000000") : hex(o.cellTextColor, "#000000")),
                shaped: hasComplexScript(text) && book.shaperReady(),
              }),
            );
          }
        }
      }
      colCursor += colW;
    }
    rowCursor += rowH;
  }

  // Grid last, so lines paint over fills exactly as the HTML renderer stacks.
  const ink = hex(o.borderColor, "#000000");
  const bw = Math.max(0.5, Number(o.borderWidth ?? 1));
  let cursor = x0;
  paint.push({ kind: "line", x1: cursor, y1: y0, x2: cursor, y2: y0 + rowsH.reduce((a, b) => a + b, 0), stroke: ink, strokeWidth: bw });
  for (const w of cols) {
    cursor += w;
    paint.push({ kind: "line", x1: cursor, y1: y0, x2: cursor, y2: y0 + rowsH.reduce((a, b) => a + b, 0), stroke: ink, strokeWidth: bw });
  }
  let yCursor = y0;
  paint.push({ kind: "line", x1: x0, y1: yCursor, x2: x0 + cols.reduce((a, b) => a + b, 0), y2: yCursor, stroke: ink, strokeWidth: bw });
  for (const h of rowsH) {
    yCursor += h;
    paint.push({ kind: "line", x1: x0, y1: yCursor, x2: x0 + cols.reduce((a, b) => a + b, 0), y2: yCursor, stroke: ink, strokeWidth: bw });
  }
}

