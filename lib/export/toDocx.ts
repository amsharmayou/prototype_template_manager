"use client";

import {
  AlignmentType,
  BorderStyle,
  Document,
  HeadingLevel,
  Packer,
  Paragraph,
  Table,
  TableCell,
  TableRow,
  TextRun,
  WidthType,
} from "docx";

import { downloadBlob, safeFilename } from "./download";
import type {
  BillTemplate,
  ImagePlaceholderObject,
  LineObject,
  ShapeObject,
  TableObject,
  TemplateObject,
  TextObject,
} from "@/lib/template/types";

/** 1 document pixel at 96dpi. */
const PX_TO_TWIP = 15;
const PX_TO_HALF_PT = 1.5;

function twips(px: number): number {
  return Math.round(px * PX_TO_TWIP);
}

function halfPoints(px: number): number {
  return Math.max(2, Math.round(px * PX_TO_HALF_PT));
}

/** Characters Word rejects outright. */
function clean(text: string): string {
  return text.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, "");
}

interface Placed {
  object: TemplateObject;
  x: number;
  y: number;
  width: number;
  height: number;
}

function bounds(o: TemplateObject): Placed {
  return {
    object: o,
    x: o.x,
    y: o.y,
    width: Math.max(0, o.width),
    height: Math.max(0, o.height),
  };
}

/**
 * Group objects that share vertical space into horizontal bands.
 *
 * Word has no absolute positioning, so column structure has to be recovered
 * from geometry: objects whose vertical ranges overlap belong on the same
 * visual row and are laid out side by side.
 */
function buildBands(items: Placed[], tolerance = 6): Placed[][] {
  const sorted = [...items].sort((a, b) => a.y - b.y || a.x - b.x);
  const bands: Placed[][] = [];
  let current: Placed[] = [];
  let bottom = -Infinity;

  for (const item of sorted) {
    if (current.length === 0 || item.y < bottom - tolerance) {
      if (current.length) bands.push(current);
      current = [item];
      bottom = item.y + item.height;
    } else {
      current.push(item);
      bottom = Math.max(bottom, item.y + item.height);
    }
  }
  if (current.length) bands.push(current);
  return bands;
}

function border(color: string, size: number) {
  return {
    style: size > 0 ? BorderStyle.SINGLE : BorderStyle.NONE,
    size: Math.max(2, Math.round(size * 8)),
    color: color.replace("#", "").toUpperCase() || "000000",
  };
}

const NO_BORDER = {
  style: BorderStyle.NONE,
  size: 0,
  color: "FFFFFF",
};

function textParagraph(
  o: TextObject,
  opts: { align?: (typeof AlignmentType)[keyof typeof AlignmentType]; indent?: number } = {},
): Paragraph {
  const color = (o.fill && o.fill !== "transparent" ? o.fill : "#000000")
    .replace("#", "")
    .toUpperCase();
  return new Paragraph({
    alignment: opts.align ?? AlignmentType.LEFT,
    indent: opts.indent ? { left: twips(opts.indent) } : undefined,
    spacing: { before: 0, after: 0 },
    children: [
      new TextRun({
        text: clean(o.text),
        font: o.fontFamily || "Arial",
        size: halfPoints(o.fontSize),
        bold: o.fontWeight === "bold",
        italics: o.fontStyle === "italic",
        color,
      }),
    ],
  });
}

function shapeParagraph(o: ShapeObject | LineObject): Paragraph {
  const isLineLike = o.type === "line" || o.type === "hr" || o.type === "vr";
  const indent = twips(Math.max(0, o.x));

  if (isLineLike) {
    const line = o as LineObject;
    const isVertical = o.type === "vr";
    const isHorizontal = o.type === "hr" || Math.abs(line.y2 - line.y) < 1.5;
    if (isVertical) {
      // A vertical rule has no direct Word equivalent; keep a thin spacer
      // that occupies its width so the column rhythm survives.
      return new Paragraph({
        spacing: { before: 0, after: 0 },
        indent: { left: indent },
        border: { right: border(o.stroke, Math.max(0.5, o.strokeWidth)) },
        children: [new TextRun({ text: "", size: 2 })],
      });
    }
    if (isHorizontal) {
      return new Paragraph({
        spacing: { before: 0, after: 0 },
        indent: { left: indent },
        border: isHorizontal
          ? { bottom: border(o.stroke, Math.max(0.5, o.strokeWidth)) }
          : undefined,
        children: [new TextRun({ text: "", size: 2 })],
      });
    }
    return new Paragraph({
      spacing: { before: 0, after: 0 },
      indent: { left: indent },
      border: { bottom: border(o.stroke, Math.max(0.5, o.strokeWidth)) },
      children: [new TextRun({ text: "", size: 2 })],
    });
  }

  const shape = o as ShapeObject;
  const filled = shape.fill && shape.fill !== "transparent";
  return new Paragraph({
    spacing: { before: 0, after: 0 },
    indent: { left: indent },
    border: {
      top: border(shape.stroke, shape.strokeWidth),
      bottom: border(shape.stroke, shape.strokeWidth),
      left: border(shape.stroke, shape.strokeWidth),
      right: border(shape.stroke, shape.strokeWidth),
    },
    shading: filled
      ? { fill: shape.fill.replace("#", "").toUpperCase() }
      : undefined,
    children: [
      new TextRun({
        text: "",
        size: halfPoints(Math.max(6, Math.min(24, shape.height))),
      }),
    ],
  });
}

function placeholderParagraph(
  o: ImagePlaceholderObject,
  indent?: number,
): Paragraph {
  return new Paragraph({
    alignment: AlignmentType.CENTER,
    spacing: { before: 0, after: 0 },
    indent: indent ? { left: twips(indent) } : undefined,
    children: [
      new TextRun({
        text: `[${o.label || o.placeholderRole.toUpperCase()}]`,
        font: "Arial",
        size: halfPoints(11),
        color: "808080",
        italics: true,
      }),
    ],
  });
}

function tableToDocx(o: TableObject): Table {
  const rows = o.rowHeights.map((_, r) => {
    const cells = o.colWidths.map((_, c) => {
      const cell = o.cells[r * o.colWidths.length + c] ?? {
        text: "",
        textAlign: "left" as const,
        fontSize: 12,
        fontWeight: "normal" as const,
      };
      const isHeader = o.headerRow && r === 0;
      const colour = (
        isHeader ? o.headerTextColor : o.cellTextColor
      ).replace("#", "").toUpperCase();
      const align =
        cell.textAlign === "center"
          ? AlignmentType.CENTER
          : cell.textAlign === "right"
            ? AlignmentType.RIGHT
            : AlignmentType.LEFT;
      return new TableCell({
        width: { size: twips(o.colWidths[c] ?? 0), type: WidthType.DXA },
        margins: {
          top: twips(o.padding),
          bottom: twips(o.padding),
          left: twips(o.padding),
          right: twips(o.padding),
        },
        shading: (() => {
          const fill = isHeader ? o.headerFill : o.cellFill;
          return fill && fill !== "transparent"
            ? { fill: fill.replace("#", "").toUpperCase() }
            : undefined;
        })(),
        children: [
          new Paragraph({
            alignment: align,
            spacing: { before: 0, after: 0 },
            children: [
              new TextRun({
                text: clean(cell.text),
                font: o.fontFamily || "Arial",
                size: halfPoints(cell.fontSize),
                bold: cell.fontWeight === "bold" || isHeader,
                color: colour,
              }),
            ],
          }),
        ],
      });
    });
    return new TableRow({ children: cells, height: { value: twips(o.rowHeights[r] ?? 0), rule: "atLeast" as never } });
  });

  const edge = border(o.borderColor, o.borderWidth);
  return new Table({
    width: { size: twips(o.width), type: WidthType.DXA },
    rows,
    borders: {
      top: edge,
      bottom: edge,
      left: edge,
      right: edge,
      insideHorizontal: edge,
      insideVertical: edge,
    },
  });
}

/** Column layout inside one band, using a borderless table. */
function bandToTable(band: Placed[]): Table {
  const ordered = [...band].sort((a, b) => a.x - b.x);
  const cells = ordered.map((item) => {
    const children: Paragraph[] = [];
    const o = item.object;
    if (o.type === "text") {
      children.push(
        textParagraph(o as TextObject, {
          align:
            (o as TextObject).textAlign === "center"
              ? AlignmentType.CENTER
              : (o as TextObject).textAlign === "right"
                ? AlignmentType.RIGHT
                : AlignmentType.LEFT,
        }),
      );
    } else if (o.type === "image-placeholder") {
      children.push(placeholderParagraph(o as ImagePlaceholderObject));
    } else if (o.type === "line" || o.type === "hr" || o.type === "vr") {
      children.push(shapeParagraph(o as LineObject));
    } else {
      children.push(shapeParagraph(o as ShapeObject));
    }
    return new TableCell({
      width: { size: twips(item.width), type: WidthType.DXA },
      borders: {
        top: NO_BORDER,
        bottom: NO_BORDER,
        left: NO_BORDER,
        right: NO_BORDER,
      },
      children,
    });
  });

  return new Table({
    width: { size: 100, type: WidthType.PERCENTAGE },
    rows: [new TableRow({ children: cells })],
    borders: {
      top: NO_BORDER,
      bottom: NO_BORDER,
      left: NO_BORDER,
      right: NO_BORDER,
      insideHorizontal: NO_BORDER,
      insideVertical: NO_BORDER,
    },
  });
}

/**
 * Build a Word document from the template.
 *
 * Text, tables, rules and placeholder boxes are recreated as native Word
 * constructs. The canvas is never screenshotted: structure is preserved, at
 * the cost of exact pixel positioning (Word has no absolute layout).
 */
export async function exportDocx(template: BillTemplate): Promise<void> {
  const { width, height } = template.document;
  const placed = template.objects
    .filter((o) => o.visible)
    .map(bounds);
  const bands = buildBands(placed);

  const body: (Paragraph | Table)[] = [];
  let cursorY = 0;

  for (const band of bands) {
    const bandTop = Math.min(...band.map((b) => b.y));
    const bandHeight = Math.max(...band.map((b) => b.y + b.height)) - bandTop;
    const gap = Math.max(0, bandTop - cursorY);
    if (gap > 0) {
      body.push(
        new Paragraph({
          spacing: { before: twips(gap), after: 0 },
          children: [new TextRun({ text: "", size: 2 })],
        }),
      );
    }

    // A table gets a band of its own so it is never squeezed into a column.
    const tableItems = band.filter((b) => b.object.type === "table");
    const others = band.filter((b) => b.object.type !== "table");

    if (others.length === 1) {
      const only = others[0]!;
      if (only.object.type === "text") {
        const t = only.object as TextObject;
        body.push(
          textParagraph(t, {
            align:
              t.textAlign === "center"
                ? AlignmentType.CENTER
                : t.textAlign === "right"
                  ? AlignmentType.RIGHT
                  : AlignmentType.LEFT,
            indent: t.x,
          }),
        );
      } else if (only.object.type === "image-placeholder") {
        body.push(placeholderParagraph(only.object as ImagePlaceholderObject, only.object.x));
      } else {
        body.push(
          new Paragraph({
            spacing: { before: 0, after: 0 },
            indent: { left: twips(only.object.x) },
            children: [new TextRun({ text: "", size: 2 })],
          }),
        );
        body.push(
          shapeParagraph(only.object as ShapeObject | LineObject),
        );
      }
    } else if (others.length > 1) {
      body.push(bandToTable(others));
    }

    for (const item of tableItems) {
      const t = item.object as TableObject;
      const indentP = new Paragraph({
        spacing: { before: 0, after: 0 },
        indent: { left: twips(t.x) },
        children: [new TextRun({ text: "", size: 2 })],
      });
      body.push(indentP);
      body.push(tableToDocx(t));
    }

    cursorY = bandTop + bandHeight;
  }

  const doc = new Document({
    creator: "Bill Template Maker",
    title: template.meta.name,
    description:
      "Structural bill template generated from a traced layout.",
    sections: [
      {
        properties: {
          page: {
            size: { width: twips(width), height: twips(height) },
            margin: { top: 0, right: 0, bottom: 0, left: 0 },
          },
        },
        children:
          body.length > 0
            ? body
            : [
                new Paragraph({
                  heading: HeadingLevel.HEADING_1,
                  children: [new TextRun({ text: template.meta.name })],
                }),
              ],
      },
    ],
  });

  const blob = await Packer.toBlob(doc);
  downloadBlob(blob, `${safeFilename(template.meta.name)}.docx`);
}
