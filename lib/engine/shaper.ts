/**
 * The complex-script shaper: HarfBuzz over WASM.
 *
 * Shaping is what turns "characters" into "glyphs" - reordering, conjuncts,
 * matras and ligatures for the scripts that need it - and it is the one piece
 * of typography the pure engine cannot do with an advance-width table. A
 * run shaped here produces exact glyph IDs, advances and offsets, and the PDF
 * writer paints those glyphs as font outlines, so a Devanagari bill prints
 * the way the bill was authored rather than as a recomposed approximation.
 *
 * The WASM module is loaded lazily and optional in both directions: a host
 * without it keeps printing Latin documents and refuses complex ones with a
 * named message (never a substitution), and a host with it gains shaped
 * printing the way the browser preview already looks.
 */


/** One shaped glyph: IDs and metrics in font units. */
export interface ShapedGlyphUnits {
  /** HarfBuzz glyph ID (post-shaping). */
  gid: number;
  /** x advance, font units. */
  ax: number;
  /** x offset, font units. */
  dx: number;
  /** y offset, font units (positive = up). */
  dy: number;
  /** Cluster index into the source text. */
  cluster: number;
}

export interface ShapeResult {
  glyphs: ShapedGlyphUnits[];
  /** Total x advance in font units. */
  width: number;
}

interface HbFontHandle {
  /** The hb.Font instance, typed loosely against the wasm module's own types. */
  font: {
    setScale: (x: number, y: number) => void;
    drawGlyph: (glyph: number, drawFuncs: unknown, drawData?: unknown) => void;
  };
  upem: number;
}

export class ShaperUnavailableError extends Error {
  constructor() {
    super("the shaping engine (harfbuzzjs) is not loaded on this runtime");
  }
}

type HarfBuzzModule = {
  Blob: new (data: Uint8Array | ArrayBuffer) => unknown;
  Face: new (blob: unknown, index?: number) => { upem: number };
  Font: new (face: unknown) => {
    setScale: (x: number, y: number) => void;
    drawGlyph: (glyph: number, drawFuncs: unknown, drawData?: unknown) => void;
  };
  DrawFuncs: new () => {
    setMoveToFunc: (f: (x: number, y: number, drawData: unknown, userData: unknown) => void) => void;
    setLineToFunc: (f: (x: number, y: number, drawData: unknown, userData: unknown) => void) => void;
    setQuadraticToFunc: (f: (cx: number, cy: number, x: number, y: number, drawData: unknown, userData: unknown) => void) => void;
    setCubicToFunc: (f: (c1x: number, c1y: number, c2x: number, c2y: number, x: number, y: number, drawData: unknown, userData: unknown) => void) => void;
    setClosePathFunc: (f: (drawData: unknown, userData: unknown) => void) => void;
  };
  shape: (font: unknown, buffer: unknown) => void;
  Buffer: new () => {
    addText: (text: string) => void;
    guessSegmentProperties: () => void;
    getGlyphInfos: () => Array<{ codepoint: number; cluster: number }>;
    getGlyphPositions: () => Array<{ xAdvance: number; yAdvance: number; xOffset: number; yOffset: number }>;
  };
};

let modulePromise: Promise<HarfBuzzModule | undefined> | undefined;

/**
 * Load the shaping WASM once. Resolves `undefined` when the runtime cannot
 * provide the module - callers then keep the no-shaper contract (Latin prints,
 * complex-script runs refuse with a named message) instead of throwing.
 *
 * The module specifier is held in a variable and marked ignored for every
 * bundler on purpose: HarfBuzz's emscripten bundle must never enter the client
 * graph, because its node/browser bootstrap is not bundleable. Node loads it
 * from node_modules at runtime; a browser that cannot resolve it simply runs
 * without the shaper (Latin prints, complex runs refuse with a named message).
 */
export async function loadShaper(): Promise<boolean> {
  if (modulePromise === undefined) {
    const specifier = "harfbuzzjs";
    modulePromise = import(/* webpackIgnore: true */ /* turbopackIgnore: true */ specifier)
      .then((m) => m as unknown as HarfBuzzModule)
      .catch(() => undefined);
  }
  return (await modulePromise) !== undefined;
}

/** The loaded HarfBuzz module, or undefined when shaping is unavailable. */
export async function loadHarfBuzzModule(): Promise<HarfBuzzModule | undefined> {
  await loadShaper();
  return modulePromise;
}

/**
 * A shaping session over one font face.
 *
 * The HarfBuzz font is created from the same bytes every other consumer reads,
 * with the scale pinned to the face's own units per em: every advance and
 * offset is therefore a font unit, and the caller converts to pixels with one
 * ratio. Glyph outlines are collected through `drawGlyph` callbacks, which
 * hand back numeric coordinates - small enough to transform directly into
 * document pixel space without parsing a path string.
 */
export class Shaper {
  private readonly fonts = new Map<string, HbFontHandle>();
  private readonly paths = new Map<string, OutlineCommand[]>();
  private readonly drawFuncs: {
    setMoveToFunc: (f: (x: number, y: number, drawData: unknown, userData: unknown) => void) => void;
    setLineToFunc: (f: (x: number, y: number, drawData: unknown, userData: unknown) => void) => void;
    setQuadraticToFunc: (f: (cx: number, cy: number, x: number, y: number, drawData: unknown, userData: unknown) => void) => void;
    setCubicToFunc: (f: (c1x: number, c1y: number, c2x: number, c2y: number, x: number, y: number, drawData: unknown, userData: unknown) => void) => void;
    setClosePathFunc: (f: (drawData: unknown, userData: unknown) => void) => void;
  };
  private collected: OutlineCommand[] = [];
  private hb: HarfBuzzModule;

  private constructor(hb: HarfBuzzModule) {
    this.hb = hb;
    this.drawFuncs = new hb.DrawFuncs();
    this.drawFuncs.setMoveToFunc((x, y) => {
      this.collected.push({ op: "M", args: [x, y] });
    });
    this.drawFuncs.setLineToFunc((x, y) => {
      this.collected.push({ op: "L", args: [x, y] });
    });
    this.drawFuncs.setQuadraticToFunc((cx, cy, x, y) => {
      this.collected.push({ op: "Q", args: [cx, cy, x, y] });
    });
    this.drawFuncs.setCubicToFunc((c1x, c1y, c2x, c2y, x, y) => {
      this.collected.push({ op: "C", args: [c1x, c1y, c2x, c2y, x, y] });
    });
    this.drawFuncs.setClosePathFunc(() => {
      this.collected.push({ op: "Z", args: [] });
    });
  }

  /** Build a shaper from the loaded HarfBuzz module. */
  static from(hb: HarfBuzzModule): Shaper {
    return new Shaper(hb);
  }

  /** Create (or return) the HarfBuzz font for one bundled face. */
  hbFontFor(bytes: Uint8Array, file: string): HbFontHandle {
    const known = this.fonts.get(file);
    if (known) return known;
    const blob = new this.hb.Blob(bytes);
    const face = new this.hb.Face(blob, 0);
    const font = new this.hb.Font(face);
    font.setScale(face.upem, face.upem);
    const handle = { font, upem: face.upem };
    this.fonts.set(file, handle);
    return handle;
  }

  /**
   * Shape one run of text.
   *
   * The returned glyphs are in font units; the caller scales to pixels with
   * `size / upem` and lays them out left to right with their advances.
   */
  shape(font: HbFontHandle, text: string, bytes: Uint8Array): ShapeResult {
    void bytes;
    const buffer = new this.hb.Buffer();
    buffer.addText(text);
    buffer.guessSegmentProperties();
    this.hb.shape(font.font, buffer);
    const infos = buffer.getGlyphInfos();
    const positions = buffer.getGlyphPositions();
    const glyphs: ShapedGlyphUnits[] = [];
    const count = Math.min(infos.length, positions.length);
    for (let i = 0; i < count; i += 1) {
      const info = infos[i]!;
      const pos = positions[i]!;
      glyphs.push({
        gid: info.codepoint,
        cluster: info.cluster,
        ax: pos.xAdvance,
        dx: pos.xOffset,
        dy: pos.yOffset,
      });
    }
    return { glyphs, width: glyphs.reduce((a, g) => a + g.ax, 0) } satisfies ShapeResult;
  }

  /**
   * The outline of one glyph, in font units with y pointing up (TrueType
   * convention) and the origin at the glyph's own draw point. The caller
   * positions and flips it - the commands are numeric, so no path parsing is
   * needed anywhere downstream.
   */
  outline(font: HbFontHandle, gid: number): OutlineCommand[] {
    const cached = this.paths.get(pathKey(font, gid));
    if (cached) return cached;
    this.collected = [];
    font.font.drawGlyph(gid, this.drawFuncs, undefined);
    const commands = this.collected;
    this.paths.set(pathKey(font, gid), commands);
    this.collected = [];
    return commands;
  }
}

export interface OutlineCommand {
  op: "M" | "L" | "Q" | "C" | "Z";
  args: number[];
}

function pathKey(font: HbFontHandle, gid: number): string {
  const f = font.font as { ptr?: number };
  return `${f.ptr ?? "?"}:${gid}`;
}

