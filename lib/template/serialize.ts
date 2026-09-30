/**
 * Fabric objects -> application template.
 *
 * Deliberately duck-typed and free of Fabric imports so it can be unit tested
 * and so the template format never becomes a Fabric dump. Every field of the
 * exported JSON is written explicitly here.
 */
import { cellIndex } from "@/lib/template/geometry";
import { analysePlaceholders } from "@/lib/template/placeholders";
import type {
  BillTemplate,
  FreehandObject,
  GroupObject,
  ImagePlaceholderObject,
  LineObject,
  PolygonObject,
  ShapeObject,
  TableCell,
  TableObject,
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
  getObjects?: () => SerialisableObject[];
  readonly [key: string]: unknown;
}

const num = (v: unknown, fallback = 0): number =>
  typeof v === "number" && Number.isFinite(v) ? v : fallback;

const str = (v: unknown, fallback = ""): string =>
  typeof v === "string" ? v : fallback;

/** Normalised, unrotated box for an object, in document coordinates. */
export function objectBox(o: SerialisableObject): {
  x: number;
  y: number;
  width: number;
  height: number;
} {
  const w =
    o.getScaledWidth?.() ?? num(o.width) * num(o.scaleX, 1);
  const h =
    o.getScaledHeight?.() ?? num(o.height) * num(o.scaleY, 1);
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
    parentId: null,
    stroke: str(o.stroke, "#000000") || "#000000",
    strokeWidth: num(o.strokeWidth, 1),
    fill: str(o.fill, "transparent") || "transparent",
  };
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
  const count = colWidths.length * rowHeights.length;
  const cells: TableCell[] = [];
  for (let i = 0; i < count; i++) {
    const c = rawCells[i];
    cells.push({
      text: str(c?.text, ""),
      textAlign: (c?.textAlign ?? "left") as TableCell["textAlign"],
      fontSize: num(c?.fontSize, 12),
      fontWeight: (c?.fontWeight ?? "normal") as TableCell["fontWeight"],
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
  };
}

function serialiseText(o: SerialisableObject, zIndex: number): TextObject {
  const base = baseFields(o, zIndex);
  const text = str(o.text, "");
  const info = analysePlaceholders(text);
  return {
    ...base,
    type: "text",
    text,
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
    textVerticalAlign: "top",
  };
}

function serialiseImagePlaceholder(
  o: SerialisableObject,
  zIndex: number,
): ImagePlaceholderObject {
  return {
    ...baseFields(o, zIndex),
    type: "image-placeholder",
    placeholderRole: str(
      o.placeholderRole,
      "image",
    ) as ImagePlaceholderObject["placeholderRole"],
    label: str(o.label, "IMAGE"),
  };
}

function serialiseLine(o: SerialisableObject, zIndex: number): LineObject {
  const base = baseFields(o, zIndex);
  const x1 = base.x;
  const y1 = base.y;
  const x2 = num(o.x2, x1 + base.width);
  const y2 = num(o.y2, y1 + base.height);
  // Fabric has no distinct rule class, so the intended kind is recorded on
  // the object when it is drawn (`ruleKind`, mirrored to `appType`).
  const kind = str(o.ruleKind, "") || str(o.appType, "") || o.type;
  const type: LineObject["type"] =
    kind === "hr" ? "hr" : kind === "vr" ? "vr" : "line";
  return { ...base, type, x2, y2 };
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
    path: str(o.path, ""),
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
      return {
        ...base,
        type:
          type === "circle"
            ? "ellipse"
            : type === "rounded-rect"
              ? "rounded-rect"
              : (type as ShapeObject["type"]),
        cornerRadius: num(o.rx, 0),
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
): BillTemplate {
  const out: TemplateObject[] = [];
  for (const o of objects) {
    const serialised = serialiseObject(o, out.length);
    if (serialised) out.push(serialised);
  }
  return {
    templateVersion: 1,
    document: { width: doc.width, height: doc.height },
    meta: { name, modifiedAt: new Date().toISOString() },
    objects: out,
  };
}

export { cellIndex };
