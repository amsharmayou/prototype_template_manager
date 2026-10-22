/**
 * Fabric objects -> application template.
 *
 * Deliberately duck-typed and free of Fabric imports so it can be unit tested
 * and so the template format never becomes a Fabric dump. Every field of the
 * exported JSON is written explicitly here.
 */
import { cellIndex } from "@/lib/template/geometry";
import { analysePlaceholders } from "@/lib/template/placeholders";
import {
  DEFAULT_REPEAT_MAX_ITEMS,
  TEMPLATE_VERSION,
} from "@/lib/template/types";
import type {
  AxisExpansion,
  BillPartObject,
  BillTemplate,
  ContainerPolicy,
  FieldObject,
  FreehandObject,
  GroupObject,
  ImagePlaceholderObject,
  LayoutConfig,
  LineObject,
  ObjectExpansion,
  PolygonObject,
  ShapeObject,
  SourceRect,
  TableCell,
  TableObject,
  TableRepeat,
  TemplateObject,
  TemplateObjectBase,
  TextObject,
} from "@/lib/template/types";
/** The minimum shape this module needs from a Fabric object. */
export interface SerialisableObject {
  type: string;
  left?: number;
  top?: number;
  width?: number;
  height?: number;
  scaleX?: number;
  scaleY?: number;
  angle?: number;
  opacity?: number;
  visible?: boolean;
  stroke?: string | null;
  strokeWidth?: number;
  fill?: string | null;
  selectable?: boolean;
  editable?: boolean;
  getScaledWidth?: () => number;
  getScaledHeight?: () => number;
  getCenterPoint?: () => { x: number; y: number };
  getPositionByOrigin?: (originX: string, originY: string) => { x: number; y: number };
  getPointByOrigin?: (originX: string, originY: string) => { x: number; y: number };
  getObjects?: () => SerialisableObject[];
  readonly [key: string]: unknown;
}

const num = (v: unknown, fallback = 0): number =>
  typeof v === "number" && Number.isFinite(v) ? v : fallback;

const str = (v: unknown, fallback = ""): string =>
  typeof v === "string" ? v : fallback;

/**
 * Fabric 7 stores a Path's geometry as an array of command tuples, and exports
 * neither `joinPath` nor `getPathCommandsInfo`, so the SVG path data is built
 * here. `new Path(<data>)` parses this back into the same tuples, so
 * `hydrateFreehand` needs no change.
 */
function pathData(commands: unknown): string {
  if (!Array.isArray(commands)) return "";
  return commands
    .filter((c): c is unknown[] => Array.isArray(c) && typeof c[0] === "string")
    .map((c) => `${c[0]} ${c.slice(1).join(" ")}`)
    .join(" ");
}

/** Normalised, unrotated box for an object, in document coordinates. */
export function objectBox(o: SerialisableObject): {
  x: number;
  y: number;
  width: number;
  height: number;
} {
  // The template box tracks the object's own width/height, not Fabric's
  // stroke-inclusive scaled width: a 1px border on a 80px box must not take
  // the template's width to 81pt over a save↔reload cycle.
  const w = num(o.width) * num(o.scaleX, 1);
  const h = num(o.height) * num(o.scaleY, 1);
  // Ask Fabric for the corner itself. `getPositionByOrigin("left","top")` is
  // the exact inverse of the origin/angle `hydrate` writes, so it is a fixed
  // point across a save and reload for any stroke, rotation or scale.
  //
  // Deriving the corner from `getCenterPoint()` instead mixes two coordinate
  // systems: that centre is *stroke-inclusive*, so subtracting a
  // stroke-exclusive half-box left every object `strokeWidth / 2` further right
  // and down on every save - and the undo snapshot serialises the same way, so
  // a single undo/redo pair walked the whole bill across the page.
  const corner = o.getPositionByOrigin?.("left", "top") ?? o.getPointByOrigin?.("left", "top");
  if (corner) {
    return {
      x: Math.round(corner.x * 100) / 100,
      y: Math.round(corner.y * 100) / 100,
      width: Math.round(w * 100) / 100,
      height: Math.round(h * 100) / 100,
    };
  }
  const center = o.getCenterPoint?.();
  if (center) {
    return {
      x: Math.round((center.x - w / 2) * 100) / 100,
      y: Math.round((center.y - h / 2) * 100) / 100,
      width: Math.round(w * 100) / 100,
      height: Math.round(h * 100) / 100,
    };
  }
  return {
    x: num(o.left),
    y: num(o.top),
    width: Math.round(w * 100) / 100,
    height: Math.round(h * 100) / 100,
  };
}

function baseFields(
  o: SerialisableObject,
  zIndex: number,
): Omit<TemplateObjectBase, "type"> {
  const box = objectBox(o);
  const id = str(o.id, `obj_${zIndex}`);
  const rawName = str(o.name, "");
  // Layout membership is explicit and distinct from editor groups: a child
  // names its container with `layoutParentId`, and an anchor records which
  // edge it holds onto. Both ride as plain Fabric custom properties so they
  // survive canvas round-trips, undo snapshots and save/reload.
  const layoutParentId =
    typeof o.layoutParentId === "string" && o.layoutParentId.length > 0
      ? o.layoutParentId
      : null;
  const anchor =
    typeof o.anchor === "object" && o.anchor !== null
      ? (o.anchor as TemplateObjectBase["anchor"])
      : undefined;
  // The visibility condition rides the same way a custom policy does: read
  // shape-checked rather than spread, so a half-written condition degrades to
  // "always visible" instead of hiding a block on every render.
  const when = readVisibleWhen(o.visibleWhen);
  return {
    id,
    name: rawName || defaultName(o.type, zIndex),
    role: typeof o.role === "string" ? o.role : null,
    x: box.x,
    y: box.y,
    width: box.width,
    height: box.height,
    rotation: num(o.angle),
    opacity: num(o.opacity, 1),
    visible: o.visible !== false,
    locked: o.locked === true || o.selectable === false,
    zIndex,
    parentId: typeof o.parentId === "string" ? o.parentId : null,
    layoutParentId,
    ...(anchor === undefined ? {} : { anchor }),
    ...(when === undefined ? {} : { visibleWhen: when }),
    stroke: str(o.stroke, "#000000") || "#000000",
    strokeWidth: num(o.strokeWidth, 1),
    fill: str(o.fill, "transparent") || "transparent",
  };
}

/**
 * Read a visibility condition off a Fabric object, or `undefined` when it has
 * none.
 *
 * Shape-checked like every other custom property: the condition needs a field
 * key, and optionally a literal to compare against, which is "show only when
 * this field is filled (and equals this)". Anything else is treated as "no
 * condition", which is what an unconditioned object means today.
 */
function readVisibleWhen(v: unknown): TemplateObjectBase["visibleWhen"] | undefined {
  if (typeof v !== "object" || v === null) return undefined;
  const raw = v as { key?: unknown; equals?: unknown; notEmpty?: unknown };
  const key = typeof raw.key === "string" && raw.key.trim().length > 0 ? raw.key.trim() : undefined;
  if (key === undefined) return undefined;
  const equals = typeof raw.equals === "string" && raw.equals.length > 0 ? raw.equals : undefined;
  const notEmpty = raw.notEmpty === true ? true : undefined;
  if (equals === undefined && notEmpty === undefined) return { key };
  if (equals !== undefined) return { key, equals };
  return { key, notEmpty };
}

/**
 * Read a growth policy off a Fabric object, or `undefined` when it has none.
 *
 * Read rather than spread: `SerialisableObject` is duck-typed over whatever
 * Fabric holds, so `expansion` is `unknown` and a half-written or
 * hand-patched policy must not reach the template as-is. Only the shape the
 * renderer relies on is accepted - two axes, each with a known mode - and
 * anything else is treated as "this object has no policy", which is the same
 * thing it means today.
 */
function readExpansion(v: unknown): ObjectExpansion | undefined {
  if (typeof v !== "object" || v === null) return undefined;
  const raw = v as { x?: unknown; y?: unknown };
  const axis = (a: unknown): AxisExpansion | undefined => {
    if (typeof a !== "object" || a === null) return undefined;
    const rec = a as Record<string, unknown>;
    const mode = rec.mode;
    if (mode !== "fixed" && mode !== "bounded" && mode !== "unbounded") return undefined;
    const out: AxisExpansion = { mode };
    if (typeof rec.maxGrowth === "number" && Number.isFinite(rec.maxGrowth)) {
      out.maxGrowth = rec.maxGrowth;
    }
    if (typeof rec.growthGuideId === "string" && rec.growthGuideId.length > 0) {
      out.growthGuideId = rec.growthGuideId;
    }
    if (rec.strategy === "wrap" || rec.strategy === "noWrap") {
      out.strategy = rec.strategy;
    }
    return out;
  };
  const x = axis(raw.x);
  const y = axis(raw.y);
  if (!x || !y) return undefined;
  return { x, y };
}

/**
 * Read a container policy off a Fabric object, or `undefined` when it has none.
 *
 * Same defensive shape as `readExpansion`: only the fields the solver reads
 * survive, so a half-written policy degrades to "plain frame" rather than a
 * half-believed container.
 */
function readContainer(v: unknown): ContainerPolicy | undefined {
  if (typeof v !== "object" || v === null) return undefined;
  const raw = v as Record<string, unknown>;
  if (raw.enabled !== true) return undefined;
  const out: ContainerPolicy = { enabled: true };
  if (raw.growthX === "fixed" || raw.growthX === "content") out.growthX = raw.growthX;
  if (raw.growthY === "fixed" || raw.growthY === "content") out.growthY = raw.growthY;
  const pad = raw.padding;
  if (typeof pad === "object" && pad !== null) {
    const p = pad as Record<string, unknown>;
    const side = (k: string): number | undefined => {
      const n = p[k];
      return typeof n === "number" && Number.isFinite(n) && n >= 0 ? n : undefined;
    };
    const top = side("top");
    const right = side("right");
    const bottom = side("bottom");
    const left = side("left");
    if (top !== undefined || right !== undefined || bottom !== undefined || left !== undefined) {
      out.padding = {
        top: top ?? 0,
        right: right ?? 0,
        bottom: bottom ?? 0,
        left: left ?? 0,
      };
    }
  }
  for (const k of ["minWidth", "minHeight", "maxWidth", "maxHeight"] as const) {
    const n = raw[k];
    if (typeof n === "number" && Number.isFinite(n) && n >= 0) out[k] = n;
  }
  return out;
}

export function defaultName(type: string, index: number): string {
  const labels: Record<string, string> = {
    line: "Line",
    hr: "Horizontal Rule",
    vr: "Vertical Rule",
    rect: "Rectangle",
    "rounded-rect": "Rounded Rectangle",
    ellipse: "Ellipse",
    polygon: "Polygon",
    freehand: "Freehand",
    text: "Text",
    table: "Table",
    "image-placeholder": "Image Placeholder",
    "bill-part": "Bill Part",
    group: "Group",
    iText: "Text",
    textbox: "Text",
  };
  return `${labels[type] ?? "Object"} ${index + 1}`;
}

/** Extract a point list from a Fabric Polygon/Polyline. */
function readPoints(o: SerialisableObject): Array<[number, number]> {
  const raw = o.points;
  if (!Array.isArray(raw)) return [];
  return raw
    .map((p) => {
      if (Array.isArray(p) && p.length >= 2) {
        return [num(p[0]), num(p[1])] as [number, number];
      }
      if (p && typeof p === "object") {
        const q = p as { x?: unknown; y?: unknown };
        return [num(q.x), num(q.y)] as [number, number];
      }
      return null;
    })
    .filter((p): p is [number, number] => p !== null);
}

/**
 * A band that cannot identify its items would produce a table with no repeating
 * rows and no explanation, so it is dropped rather than written. The same shape
 * is checked again on hydration and again in the renderer, because a package can
 * be assembled from files this editor never saw.
 */
function serialiseRepeat(raw: unknown): TableRepeat | undefined {
  if (!raw || typeof raw !== "object") return undefined;
  const r = raw as Record<string, unknown>;
  const key = r.key;
  if (typeof key !== "string" || key.trim().length === 0) return undefined;
  const startRow = r.startRow;
  const endRow = r.endRow;
  if (typeof startRow !== "number" || !Number.isInteger(startRow) || startRow < 0) return undefined;
  if (typeof endRow !== "number" || !Number.isInteger(endRow) || endRow < startRow) return undefined;
  const maxItems =
    typeof r.maxItems === "number" && Number.isInteger(r.maxItems) && r.maxItems > 0
      ? r.maxItems
      : DEFAULT_REPEAT_MAX_ITEMS;
  return {
    startRow,
    endRow,
    key: key.trim(),
    ...(r.repeatHeader === true ? { repeatHeader: true } : {}),
    maxItems,
  };
}

function serialiseTable(
  o: SerialisableObject,
  zIndex: number,
): TableObject {
  const base = baseFields(o, zIndex);
  const colWidths = Array.isArray(o.colWidths)
    ? (o.colWidths as number[]).map((n) => num(n, 40))
    : [base.width / 2, base.width / 2];
  const rowHeights = Array.isArray(o.rowHeights)
    ? (o.rowHeights as number[]).map((n) => num(n, 24))
    : [base.height / 2, base.height / 2];
const rawCells = Array.isArray(o.cells) ? (o.cells as TableCell[]) : [];
    const repeat = serialiseRepeat((o as unknown as { repeat?: unknown }).repeat);
    // Row growth is read through the same validation as a text object's, then
    // narrowed to the y axis: a column policy here would be stored and then
    // ignored by the renderer, which is worse than not offering it.
    const rawExpansion = readExpansion((o as unknown as { expansion?: unknown }).expansion);
    const rowPolicy = rawExpansion?.y ? { x: { mode: "fixed" as const }, y: rawExpansion.y } : undefined;
  const count = colWidths.length * rowHeights.length;
  const cells: TableCell[] = [];
  for (let i = 0; i < count; i++) {
    const c = rawCells[i];
    cells.push({
      text: str(c?.text, ""),
      textAlign: (c?.textAlign ?? "left") as TableCell["textAlign"],
      fontSize: num(c?.fontSize, 12),
      fontWeight: (c?.fontWeight ?? "normal") as TableCell["fontWeight"],
      ...(typeof c?.color === "string" && c.color.length > 0 ? { color: c.color } : {}),
    });
  }
  return {
    ...base,
    type: "table",
    rows: rowHeights.length,
    columns: colWidths.length,
    colWidths,
    rowHeights,
    cells,
    borderColor: str(o.borderColor, "#000000"),
    borderWidth: num(o.borderWidth, 1),
    cellFill: str(o.cellFill, "transparent"),
    headerRow: o.headerRow !== false,
    headerFill: str(o.headerFill, "transparent"),
    headerTextColor: str(o.headerTextColor, "#000000"),
    cellTextColor: str(o.cellTextColor, "#000000"),
padding: num(o.padding, 4),
      fontFamily: str(o.fontFamily, "Arial"),
      // Same validated shape a text object carries, so one editor control and
      // one validator rule cover both. Only `y` survives: a column that grew
      // would change the table's own width, which no repeat band may do.
      ...(rowPolicy ? { expansion: rowPolicy } : {}),
      ...(repeat ? { repeat } : {}),
    };
  }

function serialiseText(o: SerialisableObject, zIndex: number): TextObject {
  const base = baseFields(o, zIndex);
  const text = str(o.text, "");
  const info = analysePlaceholders(text);
  // Fabric never folds a side/diagonal drag into `fontSize`: the drag only
  // moves `scaleX`/`scaleY` and leaves `width`/`height` at the unscaled text
  // metrics. `baseFields` multiplies the box by that scale, which cannot
  // describe the result on its own — a 2x-wide 1.5x-tall stretch has no font
  // size that reproduces it — so the text branch records the metrics Fabric
  // really holds plus the scale beside them, and the renderer re-applies it.
  const scaleX = num(o.scaleX, 1);
  const scaleY = num(o.scaleY, 1);
  const growth = readExpansion(o.expansion);
  return {
    ...base,
    type: "text",
    text,
    width: Math.round(num(o.width) * 100) / 100,
    height: Math.round(num(o.height) * 100) / 100,
    scaleX,
    scaleY,
    fontFamily: str(o.fontFamily, "Arial"),
    fontSize: num(o.fontSize, 14),
    fontWeight:
      str(o.fontWeight, "normal") === "bold" ||
      num(o.fontWeight, 400) >= 600
        ? "bold"
        : "normal",
    fontStyle: str(o.fontStyle, "normal") === "italic" ? "italic" : "normal",
    textAlign: (str(o.textAlign, "left") as TextObject["textAlign"]),
    lineHeight: num(o.lineHeight, 1.16),
    charSpacing: num(o.charSpacing, 0),
    roleKind: str(o.roleKind) === "variable" ? "variable" : info.roleKind,
    textVerticalAlign: (str(
      o.textVerticalAlign,
      "top",
    ) as TextObject["textVerticalAlign"]),
    // Only a box that actually wraps carries a wrap width, so an auto-width box
    // stays on the long-standing single-line behaviour.
    ...(num(o.wrapWidth) > 0 ? { wrapWidth: num(o.wrapWidth) } : {}),
    ...(growth === undefined ? {} : { expansion: growth }),
  };
}

function serialiseImagePlaceholder(
  o: SerialisableObject,
  zIndex: number,
): ImagePlaceholderObject {
  const out: ImagePlaceholderObject = {
    ...baseFields(o, zIndex),
    type: "image-placeholder",
    placeholderRole: str(
      o.placeholderRole,
      "image",
    ) as ImagePlaceholderObject["placeholderRole"],
    label: str(o.label, "IMAGE"),
  };
  // A filled slot (e.g. after a dynamic-value pass) keeps its bound src so a
  // save/reload cycle does not detach the image from its placeholder.
  if (typeof o.src === "string" && o.src.length > 0) out.src = o.src;
  return out;
}

function serialiseBillPart(
  o: SerialisableObject,
  zIndex: number,
): BillPartObject {
  const sourceRect =
    o.sourceRect &&
    typeof o.sourceRect === "object" &&
    typeof (o.sourceRect as SourceRect).x === "number" &&
    typeof (o.sourceRect as SourceRect).y === "number" &&
    typeof (o.sourceRect as SourceRect).width === "number" &&
    typeof (o.sourceRect as SourceRect).height === "number"
      ? (o.sourceRect as SourceRect)
      : undefined;
  return {
    ...baseFields(o, zIndex),
    type: "bill-part",
    ...(typeof o.src === "string" && o.src.length > 0 ? { src: o.src } : {}),
    normalized: o.normalized === true,
    ...(sourceRect ? { sourceRect } : {}),
  };
}

function serialiseField(o: SerialisableObject, zIndex: number): FieldObject {
  const key = str(o.key, "field");
  const growth = readExpansion(o.expansion);
  return {
    ...baseFields(o, zIndex),
    type: "field",
    // A field's `fill` means two different things: on the canvas it is the tint
    // behind the dashed box, and in a template `renderText` reads it as the
    // value's ink. Copying the tint through would print every value in a
    // 6%-alpha blue, so the ink travels instead and the tint stays in the
    // editor where it belongs.
    fill: str(o.textColor, "#000000") || "#000000",
    key,
    fieldType: str(o.fieldType, "text") as FieldObject["fieldType"],
    text: `{{${key}}}`,
    fontFamily: str(o.fontFamily, "Arial"),
    fontSize: num(o.fontSize, 14),
    fontWeight: str(o.fontWeight, "normal") === "bold" ? "bold" : "normal",
    fontStyle: str(o.fontStyle, "normal") === "italic" ? "italic" : "normal",
    textAlign: (str(o.textAlign, "left") as FieldObject["textAlign"]),
    lineHeight: num(o.lineHeight, 1.16),
    charSpacing: num(o.charSpacing, 0),
    roleKind: "variable",
    textVerticalAlign: "top",
    ...(growth === undefined ? {} : { expansion: growth }),
  };
}

function serialiseLine(o: SerialisableObject, zIndex: number): LineObject {
  const base = baseFields(o, zIndex);
  // Both endpoints come from the object's own geometry, never from
  // `objectBox`. That box is centred on Fabric's stroke-inclusive bounds, and
  // a rule's stroke straddles the line, so the box's centre sits half a
  // stroke off the true endpoints. Reading `x`/`y` from the box while reading
  // `x2`/`y2` off the object therefore tilted a level rule, and the tilt grew
  // by half a stroke on every save/reload cycle.
  const x1 = num(o.left);
  const y1 = num(o.top);
  const x2 = num(o.x2, x1 + base.width);
  const y2 = num(o.y2, y1 + base.height);
  // Fabric has no distinct rule class, so the intended kind is recorded on
  // the object when it is drawn (`ruleKind`, mirrored to `appType`).
  const kind = str(o.ruleKind, "") || str(o.appType, "") || o.type;
  const type: LineObject["type"] =
    kind === "hr" ? "hr" : kind === "vr" ? "vr" : "line";
  // A rule carries an axis as its whole purpose, so the level it was drawn at
  // is restored exactly rather than inferred. `updateDrawing` pins only the far
  // endpoint (`y2 = origin.y` for a horizontal rule) and leaves `top` at
  // whatever Fabric last computed, so the two disagree by up to half a stroke;
  // averaging them would leave a visible tilt. Taking the far endpoint as
  // authoritative makes the stored rule exactly level, which is both what the
  // author drew and a fixed point over repeated saves.
  const endX = type === "vr" ? x1 : x2;
  const endY = type === "hr" ? y1 : y2;
  return {
    ...base,
    x: x1,
    y: y1,
    width: Math.round((endX - x1) * 100) / 100,
    height: Math.round((endY - y1) * 100) / 100,
    type,
    x2: endX,
    y2: endY,
  };
}

function serialisePolygon(
  o: SerialisableObject,
  zIndex: number,
): PolygonObject {
  const base = baseFields(o, zIndex);
  return {
    ...base,
    type: "polygon",
    points: readPoints(o).map(([px, py]) => [
      Math.round((px - base.x) * 100) / 100,
      Math.round((py - base.y) * 100) / 100,
    ]),
  };
}

function serialiseFreehand(
  o: SerialisableObject,
  zIndex: number,
): FreehandObject {
  return {
    ...baseFields(o, zIndex),
    type: "freehand",
    path: pathData(o.path),
  };
}

function serialiseGroup(o: SerialisableObject, zIndex: number): GroupObject {
  return { ...baseFields(o, zIndex), type: "group" };
}

/** Convert one Fabric object into its template representation. */
export function serialiseObject(
  o: SerialisableObject,
  zIndex: number,
): TemplateObject | null {
  // App classes carry an explicit discriminator, which is reliable. Fabric 7
  // lowercases `instance.type` ("IText" becomes "itext"), so everything is
  // matched case-insensitively.
  const type = (str(o.appType, "") || o.type).toLowerCase();
  switch (type) {
    case "table":
      return serialiseTable(o, zIndex);
    case "image-placeholder":
      return serialiseImagePlaceholder(o, zIndex);
    case "bill-part":
      return serialiseBillPart(o, zIndex);
    case "field":
      return serialiseField(o, zIndex);
    case "itext":
    case "textbox":
    case "text":
      return serialiseText(o, zIndex);
    case "line":
    case "hr":
    case "vr":
      return serialiseLine(o, zIndex);
    case "polygon":
    case "polyline":
      return serialisePolygon(o, zIndex);
    case "path":
    case "freehand":
      return serialiseFreehand(o, zIndex);
    case "rect":
    case "rounded-rect":
    case "ellipse":
    case "circle": {
      const base = baseFields(o, zIndex);
      // Shapes persist a *follower* policy only: unlike text/field/table they
      // carry no measurable content, so the solver honours their expansion
      // solely through a linked growth guide (see layout.ts).
      const growth = readExpansion(o.expansion);
      const container = readContainer(o.container);
      return {
        ...base,
        type:
          type === "circle"
            ? "ellipse"
            : type === "rounded-rect"
              ? "rounded-rect"
              : (type as ShapeObject["type"]),
        cornerRadius: num(o.rx, 0),
        ...(growth === undefined ? {} : { expansion: growth }),
        ...(container === undefined ? {} : { container }),
      };
    }
    case "group":
    case "activeselection":
      return serialiseGroup(o, zIndex);
    default:
      return null;
  }
}

/**
 * Convert a bottom-to-top ordered list of Fabric objects into a template.
 * The reference image is not passed in and therefore cannot appear here.
 */
export function serialiseObjects(
  objects: readonly SerialisableObject[],
  doc: { width: number; height: number },
  name: string,
  layout?: LayoutConfig,
): BillTemplate {
  const out: TemplateObject[] = [];
  for (const o of objects) {
    const serialised = serialiseObject(o, out.length);
    if (serialised) out.push(serialised);
  }
  return {
    templateVersion: TEMPLATE_VERSION,
    document: { width: doc.width, height: doc.height },
    meta: { name, modifiedAt: new Date().toISOString() },
    objects: out,
    // Omitted rather than defaulted: the absence of this key is what tells a
    // renderer the template is fixed-layout, so writing `mode: "fixed"` here
    // would make "never configured" indistinguishable from "configured not to
    // grow".
    ...(layout === undefined ? {} : { layout }),
  };
}

export { cellIndex };
