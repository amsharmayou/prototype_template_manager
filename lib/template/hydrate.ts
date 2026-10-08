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
import { BillPartObject } from "@/lib/canvas/objects/BillPartObject";
import { FieldObject, DEFAULT_FIELD } from "@/lib/canvas/objects/BillField";
import { ImagePlaceholderObject } from "@/lib/canvas/objects/ImagePlaceholder";
import { createId, registerAppProperties } from "@/lib/canvas/fabricSetup";
import { evenSizes } from "@/lib/template/geometry";
import { analysePlaceholders } from "@/lib/template/placeholders";
import type {
  BillTemplate,
  FieldObject as FieldObj,
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
import type { BillPartObject as TemplateBillPart } from "@/lib/template/types";

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

function hydrateText(o: TextObject, zIndex: number): IText | Textbox {
  const info = analysePlaceholders(o.text);
  const common = {
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
    // Re-apply the stretch the serialiser recorded. Without it a reloaded
    // template would come back at its natural aspect, losing the side/down
    // drag the author made.
    scaleX: typeof o.scaleX === "number" && Number.isFinite(o.scaleX) ? o.scaleX : 1,
    scaleY: typeof o.scaleY === "number" && Number.isFinite(o.scaleY) ? o.scaleY : 1,
  };
  // Only a `Textbox` treats `width` as a layout boundary, so a box that wraps
  // has to be that class — an `IText` silently discards it. This is also why
  // the properties panel's Width field did nothing for text, and why a wrap
  // boundary could not survive a save/reload cycle.
  const obj: IText | Textbox =
    typeof o.wrapWidth === "number" && o.wrapWidth > 0
      ? new Textbox(o.text, { ...common, width: o.wrapWidth })
      : new IText(o.text, common);
  (obj as unknown as Record<string, unknown>).roleKind =
    o.roleKind === "variable" ? "variable" : info.roleKind;
  if (o.roleKind === "variable" && info.role && !o.role) {
    (obj as unknown as Record<string, unknown>).role = info.role;
  }
  applyCommon(obj, o, zIndex);
  // A wrapping box keeps its wrap boundary and the traced height as its
  // starting height; Fabric recomputes the height from the wrapped lines as
  // soon as the text or width changes. An auto-width `IText` is left alone:
  // Fabric derives its width and height from the content, so writing them would
  // only be discarded on the next layout pass.
  if (obj instanceof Textbox) {
    obj.set({ width: o.wrapWidth, height: o.height } as never);
    (obj as unknown as Record<string, unknown>).wrapWidth = o.wrapWidth;
  }
  obj.setCoords();
  return obj;
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
      ? new Ellipse({
          ...base,
          // Fabric's Ellipse defaults to rx = ry = 0 and never back-derives
          // them from width/height: it would paint nothing at any size.
          rx: o.width / 2,
          ry: o.height / 2,
        })
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
  images?: Map<string, FabricImage>,
): FabricObject {
  // A bound image replaces the dashed slot. Decoding is asynchronous, so the
  // caller hands us an already-loaded registry: when the image never arrived
  // (bad URL, offline) the placeholder box renders instead of nothing.
  const src = typeof o.src === "string" ? o.src : undefined;
  const loaded = src !== undefined ? images?.get(src) : undefined;
  if (loaded) {
    const obj = new FabricImage(loaded.getElement() as HTMLImageElement, {
      left: o.x,
      top: o.y,
      originX: "left",
      originY: "top",
      scaleX: o.width / (loaded.width || 1),
      scaleY: o.height / (loaded.height || 1),
    });
    // Carry the placeholder's identity on the image object so the serialiser
    // round-trips a filled slot back to an image-placeholder with src.
    const carried = obj as unknown as Record<string, unknown>;
    carried.placeholderRole = o.placeholderRole;
    carried.label = o.label;
    carried.src = src;
    return applyCommon(obj, o, zIndex);
  }
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

function hydrateField(o: FieldObj, zIndex: number): FieldObject {
  const obj = new FieldObject({
    key: o.key,
    fieldType: o.fieldType,
    // The canvas label is the marker the author sees; the template carries the
    // `{{key}}` text it stands for, and the two are not interchangeable.
    label: o.text || `{{${o.key}}}`,
    borderColor: o.stroke,
    borderWidth: o.strokeWidth,
    // A template field's `fill` is its ink, not its background: `renderText`
    // reads it as the printed colour. The canvas tint is restored from the
    // default instead, so reloading a black-inked field does not paint a black
    // box behind the marker.
    textColor: o.fill === "transparent" ? DEFAULT_FIELD.textColor : o.fill,
    fill: DEFAULT_FIELD.fill,
    // Restored so a styled field survives a save/reload cycle; without this the
    // marker reverted to its defaults while the template still claimed the
    // author's font, size and alignment.
    fontFamily: o.fontFamily,
    fontSize: o.fontSize,
    fontWeight: o.fontWeight,
    fontStyle: o.fontStyle,
    textAlign: o.textAlign,
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

function hydrateBillPart(
  o: TemplateBillPart,
  zIndex: number,
  images?: Map<string, FabricImage>,
): FabricObject {
  const src = typeof o.src === "string" ? o.src : undefined;
  const obj = new BillPartObject({
    src,
    normalized: o.normalized === true,
    sourceRect: o.sourceRect,
    // The export path pre-decodes every crop the template carries, so handing
    // the element over is what makes its first `renderAll` paint the real part
    // rather than the placeholder the object would otherwise draw until its own
    // decode landed. The editor passes no registry and gets the self-loading
    // behaviour instead; see `BillPartObject`.
    image: src !== undefined ? (images?.get(src)?.getElement() as HTMLImageElement) : undefined,
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
  images?: Map<string, FabricImage>,
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
      return hydrateImagePlaceholder(o, zIndex, images);
    case "field":
      return hydrateField(o, zIndex);
    case "bill-part":
      return hydrateBillPart(o as TemplateBillPart, zIndex, images);
    case "group":
      return hydrateGroup(o, zIndex);
    default:
      return null;
  }
}

/** Build every object in a template, bottom to top. */
export function hydrateTemplate(
  template: BillTemplate,
  images?: Map<string, FabricImage>,
): FabricObject[] {
  const ordered = [...template.objects].sort((a, b) => a.zIndex - b.zIndex);
  const out: FabricObject[] = [];
  ordered.forEach((o, i) => {
    const obj = hydrateObject(o, i, images);
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
