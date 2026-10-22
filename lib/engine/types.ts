/**
 * The display list: everything the print output needs, already positioned.
 *
 * Backends paint. None of them breaks a line, sizes a row, or picks a font:
 * every box, rule, image and line of text arrives here with its final
 * coordinates in document pixels, so a PDF, a canvas preview and a PNG test
 * rasterise the same arithmetic. Purity: construction is a pure function of
 * the bound template and the font metrics; nothing here touches a runtime.
 */

import type { ContentMeasurement } from "@/lib/render/measure";

export { type ContentMeasurement };

/** One font the display list uses, by file inside the font set. */
export interface FontRef {
  /** Font file, e.g. `fonts/Arimo_400Regular.ttf`. */
  file: string;
  family: string;
  weight: 400 | 700;
  italic: boolean;
}

/** A line of text at its final position and metrics. */
export interface DisplayLine {
  /** Left edge of the line box, in document px. */
  x: number;
  /** Baseline of the line, in document px. */
  baseline: number;
  text: string;
  font: FontRef;
  /** Font size in document px. */
  size: number;
  /** Letter spacing in px (converted from the template's hundredths of a point). */
  spacing: number;
  /** Line width in px, from the font book. */
  width: number;
  /**
   * Shaped glyphs for lines a shaper laid out (complex scripts).
   *
   * Present only when a shaped run produced this line: `x`/`y` is each
   * glyph's draw point in document px, baseline-anchored with y down, ready
   * for the writer to paint as font outlines. Absent means the line is drawn
   * as text.
   */
  glyphs?: Array<{ gid: number; x: number; y: number }>;
}

export type DisplayPaint =
  | { kind: "rect"; x: number; y: number; width: number; height: number; fill?: string; stroke?: string; strokeWidth?: number; radius?: number }
  | { kind: "ellipse"; cx: number; cy: number; rx: number; ry: number; fill?: string; stroke?: string; strokeWidth?: number }
  | { kind: "path"; d: string; fill?: string; stroke?: string; strokeWidth?: number }
  | { kind: "line"; x1: number; y1: number; x2: number; y2: number; stroke: string; strokeWidth: number }
  | { kind: "image"; x: number; y: number; width: number; height: number; src: string }
  | {
      kind: "text";
      lines: DisplayLine[];
      /** Horizontal alignment inside the box: lines are already positioned. */
      color: string;
    };

export interface DisplayList {
  page: { width: number; height: number };
  fonts: FontRef[];
  paint: DisplayPaint[];
  /** The renderer's own warnings, carried to every consumer verbatim. */
  warnings: string[];
}
