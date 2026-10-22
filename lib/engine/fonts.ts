/**
 * The font book: measurement from the bundled font files themselves.
 *
 * This is the one property that makes output identical everywhere - layout is
 * computed from the same OpenType tables on every runtime, never from
 * whatever fonts a device happens to have installed. The bundled set is
 * metric-compatible with the stacks templates were drawn under (Arimo/Arial,
 * Tinos/Times, Carlito/Calibri, Caladea/Cambria), so an older HTML preview of
 * the same template and this book agree to the pixel.
 */

import { Font, parse } from "opentype.js";

import type { ContentMeasurement } from "@/lib/render/measure";
import type { FontRef } from "./types";

export interface FontEntry extends FontRef {
  /** True when the family substitutes for the named system stack. */
  systemAlias: string;
}

const GOALS: FontEntry[] = [
  { file: "fonts/Arimo_400Regular.ttf", family: "Arimo", weight: 400, italic: false, systemAlias: "Arial" },
  { file: "fonts/Arimo_400Regular_Italic.ttf", family: "Arimo", weight: 400, italic: true, systemAlias: "Arial" },
  { file: "fonts/Arimo_700Bold.ttf", family: "Arimo", weight: 700, italic: false, systemAlias: "Arial" },
  { file: "fonts/Arimo_700Bold_Italic.ttf", family: "Arimo", weight: 700, italic: true, systemAlias: "Arial" },
  { file: "fonts/Tinos_400Regular.ttf", family: "Tinos", weight: 400, italic: false, systemAlias: "Times New Roman" },
  { file: "fonts/Tinos_400Regular_Italic.ttf", family: "Tinos", weight: 400, italic: true, systemAlias: "Times New Roman" },
  { file: "fonts/Tinos_700Bold.ttf", family: "Tinos", weight: 700, italic: false, systemAlias: "Times New Roman" },
  { file: "fonts/Tinos_700Bold_Italic.ttf", family: "Tinos", weight: 700, italic: true, systemAlias: "Times New Roman" },
  { file: "fonts/Carlito_400Regular.ttf", family: "Carlito", weight: 400, italic: false, systemAlias: "Calibri" },
  { file: "fonts/Carlito_700Bold.ttf", family: "Carlito", weight: 700, italic: false, systemAlias: "Calibri" },
  { file: "fonts/Caladea_400Regular.ttf", family: "Caladea", weight: 400, italic: false, systemAlias: "Cambria" },
  { file: "fonts/Caladea_700Bold.ttf", family: "Caladea", weight: 700, italic: false, systemAlias: "Cambria" },
  { file: "fonts/NotoSans_400Regular.ttf", family: "Noto Sans", weight: 400, italic: false, systemAlias: "" },
  { file: "fonts/NotoSans_700Bold.ttf", family: "Noto Sans", weight: 700, italic: false, systemAlias: "" },
  { file: "fonts/NotoSansDevanagari_400Regular.ttf", family: "Noto Sans Devanagari", weight: 400, italic: false, systemAlias: "" },
  { file: "fonts/NotoSansDevanagari_700Bold.ttf", family: "Noto Sans Devanagari", weight: 700, italic: false, systemAlias: "" },
];

/** Text whose correct layout needs a shaping engine this book cannot supply. */
const COMPLEX_SCRIPT_RX =
  /[\u0590-\u08FF\u0900-\u109F\u135D-\u135F\u1780-\u17FF\u200C-\u200D]/;

export function hasComplexScript(text: string): boolean {
  return COMPLEX_SCRIPT_RX.test(text);
}

export interface TextStyle {
  family: string;
  size: number;
  weight: "normal" | "bold";
  italic?: boolean;
  /** CSS letter-spacing in px (hundredths of a point are converted before here). */
  spacing?: number;
}

export type FontBytes = (file: string) => Uint8Array | undefined;

export class FontBook {
  private readonly faces = new Map<string, Font>();
  private readonly bytes = new Map<string, Uint8Array>();
  private readonly missing = new Set<string>();

  private constructor() {}

  /** Build a book from font bytes, keyed by archive-relative file path. */
  static load(
    sources: Iterable<[string, Uint8Array]>,
  ): { book: FontBook; failures: string[] } {
    const book = new FontBook();
    const failures: string[] = [];
    for (const [file, bytes] of sources) {
      try {
        const face = parse(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer);
        book.faces.set(file, face);
        book.bytes.set(file, bytes);
      } catch (error) {
        failures.push(`${file}: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
    for (const goal of GOALS) {
      // A face the set does not carry is a refusal at print time, never a
      // silent substitute: record it so callers can name the gap.
      if (!book.faces.has(goal.file)) failures.push(`${goal.file}: not in the provided set`);
    }
    return { book, failures };
  }

  private static normaliseFamily(family: string): string {
    return family.replace(/["']/g, "").trim().toLowerCase();
  }

  /** The bundled face that paints for the named family, or undefined. */
  refFor(style: Pick<TextStyle, "family" | "weight" | "italic">): FontRef | undefined {
    const asked = FontBook.normaliseFamily(style.family);
    const wantedWeight = style.weight === "bold" ? 700 : 400;
    const wantedItalic = style.italic === true;
    const score = (entry: FontEntry): number => {
      const alias = FontBook.normaliseFamily(entry.systemAlias);
      const familyHit =
        FontBook.normaliseFamily(entry.family) === asked || (alias !== "" && alias === asked);
      if (!familyHit) return 0;
      let points = 1;
      if (entry.weight === wantedWeight) points += 2;
      if (entry.italic === wantedItalic) points += 2;
      return points;
    };
    let best: { entry: FontRef; points: number } | undefined;
    for (const goal of GOALS) {
      const points = score(goal);
      if (points > 0 && (!best || points > best.points)) {
        best = { entry: goal, points };
      }
    }
    if (!best) {
      // Unstyled: whatever the set declares as the sans default.
      const fallback = GOALS.find((g) => g.file === "fonts/NotoSans_400Regular.ttf");
      return fallback ? { ...fallback } : undefined;
    }
    // The face chosen must exist in the parsed set; a missing file is tracked
    // as missing so the writer can refuse instead of substituting.
    if (!this.faces.has(best.entry.file)) {
      this.missing.add(best.entry.file);
      return undefined;
    }
    return { ...best.entry };
  }

  face(ref: FontRef): Font | undefined {
    return this.faces.get(ref.file);
  }

  bytesOf(ref: FontRef): Uint8Array | undefined {
    return this.bytes.get(ref.file);
  }

  filesMissing(): string[] {
    return [...this.missing];
  }

  /** Advance width of one text run in px, kerned, with letter spacing. */
  measure(text: string, style: TextStyle): number {
    const ref = this.refFor(style);
    if (!ref) return 0;
    const face = this.faces.get(ref.file);
    if (!face || text.length === 0) return 0;
    const spacing = style.spacing ?? 0;
    try {
      // Kerned advance, then one spacing per character - the same arithmetic
      // the CSS painter's letter-spacing applies, including after the last
      // character.
      return face.getAdvanceWidth(text, style.size, { kerning: true }) + spacing * text.length;
    } catch {
      return 0;
    }
  }

  /** Greedy word wrap with the same semantics as the CSS painter. */
  wrap(text: string, maxWidth: number, style: TextStyle): string[] {
    if (maxWidth <= 0) return [text];
    const out: string[] = [];
    for (const paragraph of text.split("\n")) {
      const words = paragraph.split(/\s+/).filter((w) => w.length > 0);
      if (words.length === 0) {
        out.push("");
        continue;
      }
      let line = "";
      for (const word of words) {
        const candidate = line.length === 0 ? word : `${line} ${word}`;
        if (this.measure(candidate, style) <= maxWidth || line.length === 0) {
          if (this.measure(candidate, style) <= maxWidth) {
            line = candidate;
            continue;
          }
          // Even the first word overflows: hard-break it.
          let chunk = "";
          for (const ch of word) {
            if (chunk.length > 0 && this.measure(chunk + ch, style) > maxWidth) {
              out.push(chunk);
              chunk = ch;
            } else {
              chunk += ch;
            }
          }
          line = chunk;
          continue;
        }
        out.push(line);
        line = word;
      }
      out.push(line);
    }
    return out;
  }

  metrics(ref: FontRef): { asc: number; desc: number } {
    const face = this.faces.get(ref.file);
    if (!face) return { asc: 0.88, desc: 0.12 };
    const units = face.unitsPerEm || 1000;
    const asc = face.ascender ?? face.tables?.os2?.sTypoAscender ?? Math.round(units * 0.88);
    const desc = face.descender ?? face.tables?.os2?.sTypoDescender ?? -Math.round(units * 0.12);
    return { asc: asc / units, desc: Math.abs(desc) / units };
  }

  ascent(ref: FontRef): number {
    return this.metrics(ref).asc;
  }

  lineHeightOf(size: number, multiplier: number): number {
    return size * multiplier;
  }

  /** The content measurement the layout solver expects for one wrapped box. */
  contentMeasurement(
    text: string,
    style: TextStyle,
    boxWidth: number,
    lineHeight: number,
    wrapping: boolean,
  ): ContentMeasurement {
    const lines = wrapping ? this.wrap(text, boxWidth, style) : [text];
    const widths = lines.map((line) => this.measure(line, style));
    const naturalWidth = widths.reduce((a, b) => Math.max(a, b), 0);
    const height = wrapping
      ? Math.max(lines.length, 1) * this.lineHeightOf(style.size, lineHeight)
      : this.lineHeightOf(style.size, lineHeight);
    return { naturalWidth, height };
  }
}

/** A stand-alone measure of one text box, for the pure test environment. */
export function measureWithBook(
  book: FontBook,
  text: string,
  style: TextStyle,
  boxWidth: number,
  lineHeight = 1.16,
): ContentMeasurement {
  return book.contentMeasurement(text, style, boxWidth, lineHeight, true);
}
