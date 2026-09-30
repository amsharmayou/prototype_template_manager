/**
 * Application template -> Fabric objects.
 *
 * This is the exact inverse of `serialize.ts`. Together they form the contract
 * the future rendering engine will rely on: neither direction depends on
 * Fabric's own serialization format.
 */
import {
  Ellipse,
  FabricImage,
  FabricObject,
  IText,
  Line,
  Path,
  Polygon,
  Polyline,
  Rect,
  Textbox,
} from "fabric";

import { BillTable } from "@/lib/canvas/objects/BillTable";
import { ImagePlaceholderObject } from "@/lib/canvas/objects/ImagePlaceholder";
import { createId, registerAppProperties } from "@/lib/canvas/fabricSetup";
import { evenSizes } from "@/lib/template/geometry";
import { analysePlaceholders } from "@/lib/template/placeholders";
import type {
  BillTemplate,
  FreehandObject,
  GroupObject,
  ImagePlaceholderObject as PHObject,
  LineObject,
  PolygonObject,
  ShapeObject,
  TableObject,
  TemplateObject,
  TextObject,
} from "@/lib/template/types";

registerAppProperties();

/** Attach the app-level metadata every object carries. */
function applyCommon<T extends FabricObject>(
  obj: T,
  o: TemplateObject,
  zIndex: number,
): T {
  obj.set({
    left: o.x,
    top: o.y,
    originX: "left",
    originY: "top",
    angle: o.rotation,
    opacity: o.opacity,
    visible: o.visible,
    stroke: o.stroke,
    strokeWidth: o.strokeWidth,
  } as never);
  obj.set({
    id: o.id || createId(),
    name: o.name,
    role: o.role,
    zIndex,
    parentId: o.parentId,
    locked: o.locked,
    // Discriminator the serialiser relies on; see `BillTable.appType`.
    appType: o.type,
  } as never);
  if (o.locked) {
    (obj as { lockMovementX?: boolean }).lockMovementX = true;
    (obj as { lockMovementY?: boolean }).lockMovementY = true;
    (obj as { lockScalingX?: boolean }).lockScalingX = true;
    (obj as { lockScalingY?: boolean }).lockScalingY = true;
    (obj as { lockRotation?: boolean }).lockRotation = true;
  } else {
    obj.set({ selectable: true, evented: true } as never);
  }
  obj.setCoords();
  return obj;
}

function hydrateText(o: TextObject, zIndex: number): IText {
  const info = analysePlaceholders(o.text);
  const obj = new IText(o.text, {
    left: o.x,
    top: o.y,
    fontFamily: o.fontFamily,
    fontSize: o.fontSize,
    fontWeight: o.fontWeight,
    fontStyle: o.fontStyle,
    textAlign: o.textAlign,
    lineHeight: o.lineHeight,
    charSpacing: o.charSpacing,
    fill: o.fill === "transparent" ? "#000000" : o.fill,
    stroke: o.stroke,
    strokeWidth: o.strokeWidth,
  });
  (obj as unknown as Record<string, unknown>).roleKind =
    o.roleKind === "variable" ? "variable" : info.roleKind;
  if (o.roleKind === "variable" && info.role && !o.role) {
    (obj as unknown as Record<string, unknown>).role = info.role;
  }
  return applyCommon(obj, o, zIndex);
}

function hydrateShape(o: ShapeObject, zIndex: number): Rect | Ellipse {
  const base = {
    left: o.x,
    top: o.y,
    width: o.width,
    height: o.height,
    fill: o.fill,
    stroke: o.stroke,
    strokeWidth: o.strokeWidth,
  };
  // `rx`/`ry` are only meaningful for a rounded rect. Passing them as
  // `undefined` would overwrite the radii Fabric derives for an ellipse and
  // then break SVG export.
  const obj =
    o.type === "ellipse"
      ? new Ellipse(base)
      : new Rect({
          ...base,
          rx: o.type === "rounded-rect" ? o.cornerRadius || 8 : 0,
          ry: o.type === "rounded-rect" ? o.cornerRadius || 8 : 0,
        });
  return applyCommon(obj, o, zIndex);
}

function hydrateLine(o: LineObject, zIndex: number): Line {
  const obj = new Line([o.x, o.y, o.x2, o.y2], {
    stroke: o.stroke,
    strokeWidth: o.strokeWidth,
    fill: "transparent",
    originX: "left",
    originY: "top",
  });
  obj.set({ x2: o.x2, y2: o.y2, ruleKind: o.type } as never);
  return applyCommon(obj, o, zIndex);
}

function hydratePolygon(o: PolygonObject, zIndex: number): Polygon | Polyline {
  const points = o.points.map(([px, py]) => ({ x: px, y: py }));
  const obj =
    o.type === "polygon" ? new Polygon(points, {}) : new Polyline(points, {});
  obj.set({
    fill: o.fill === "transparent" ? "rgba(0,0,0,0)" : o.fill,
    stroke: o.stroke,
    strokeWidth: o.strokeWidth,
  } as never);
  return applyCommon(obj, o, zIndex);
}

function hydrateFreehand(o: FreehandObject, zIndex: number): Path | null {
  if (!o.path) return null;
  const path = new Path(o.path);
  applyCommon(path, o, zIndex);
  // Paths are positioned via their own coordinates; normalise to the box.
  const br = path.getBoundingRect();
  const dx = o.x - br.left;
  const dy = o.y - br.top;
  if (Math.abs(dx) > 0.01 || Math.abs(dy) > 0.01) {
    path.set({ left: (path.left ?? 0) + dx, top: (path.top ?? 0) + dy } as never);
  }
  path.setCoords();
  return path;
}

function hydrateTable(o: TableObject, zIndex: number): BillTable {
  const colWidths = o.colWidths?.length
    ? o.colWidths
    : evenSizes(Math.max(1, o.columns), o.width, 8);
  const rowHeights = o.rowHeights?.length
    ? o.rowHeights
    : evenSizes(Math.max(1, o.rows), o.height, 8);
  const table = new BillTable({
    colWidths,
    rowHeights,
    cells: o.cells ?? [],
    borderColor: o.borderColor,
    borderWidth: o.borderWidth,
    cellFill: o.cellFill,
    headerRow: o.headerRow,
    headerFill: o.headerFill,
    headerTextColor: o.headerTextColor,
    cellTextColor: o.cellTextColor,
    padding: o.padding,
    fontFamily: o.fontFamily,
  });
  table.set({
    left: o.x,
    top: o.y,
    angle: o.rotation,
    opacity: o.opacity,
    visible: o.visible,
  } as never);
  return applyCommon(table, o, zIndex);
}

function hydrateImagePlaceholder(
  o: PHObject,
  zIndex: number,
): ImagePlaceholderObject {
  const obj = new ImagePlaceholderObject({
    placeholderRole: o.placeholderRole,
    label: o.label,
    borderColor: o.stroke,
    borderWidth: o.strokeWidth,
    fill: o.fill,
  });
  obj.set({
    left: o.x,
    top: o.y,
    width: o.width,
    height: o.height,
    angle: o.rotation,
    opacity: o.opacity,
    visible: o.visible,
  } as never);
  return applyCommon(obj, o, zIndex);
}

function hydrateGroup(o: GroupObject, zIndex: number): null {
  // Groups are represented by `parentId` on children rather than a Fabric
  // Group, because Fabric 7 groups cannot hold an exact layout.
  void o;
  void zIndex;
  return null;
}

/** Build a single Fabric object from a template entry. */
export function hydrateObject(
  o: TemplateObject,
  zIndex: number,
): FabricObject | null {
  switch (o.type) {
    case "text":
      return hydrateText(o, zIndex);
    case "rect":
    case "rounded-rect":
    case "ellipse":
      return hydrateShape(o, zIndex);
    case "line":
    case "hr":
    case "vr":
      return hydrateLine(o, zIndex);
    case "polygon":
      return hydratePolygon(o, zIndex);
    case "freehand":
      return hydrateFreehand(o, zIndex);
    case "table":
      return hydrateTable(o, zIndex);
    case "image-placeholder":
      return hydrateImagePlaceholder(o, zIndex);
    case "group":
      return hydrateGroup(o, zIndex);
    default:
      return null;
  }
}

/** Build every object in a template, bottom to top. */
export function hydrateTemplate(template: BillTemplate): FabricObject[] {
  const ordered = [...template.objects].sort((a, b) => a.zIndex - b.zIndex);
  const out: FabricObject[] = [];
  ordered.forEach((o, i) => {
    const obj = hydrateObject(o, i);
    if (obj) out.push(obj);
  });
  return out;
}

/** An empty text box, used by the text tool. */
export function makeTextbox(text: string, left: number, top: number): IText {
  return new IText(text, {
    left,
    top,
    fontFamily: "Arial",
    fontSize: 14,
    fill: "#000000",
    stroke: "transparent",
    strokeWidth: 0,
  });
}

export { FabricImage, Textbox };
