/**
 * Application-level bill template format.
 *
 * This is deliberately NOT Fabric's serialization format. Fabric is the
 * editing engine; the template is a portable contract that a future
 * rendering engine can consume without Fabric being installed.
 */

export const TEMPLATE_VERSION = 1 as const;

export type ObjectType =
  | "line"
  | "rect"
  | "rounded-rect"
  | "ellipse"
  | "polygon"
  | "freehand"
  | "text"
  | "hr"
  | "vr"
  | "table"
  | "image-placeholder"
  | "group";

/** Fields shared by every template object. */
export interface TemplateObjectBase {
  id: string;
  type: ObjectType;
  /** Human label shown in the layers panel. User editable. */
  name: string;
  /** Semantic tag, e.g. "header", "title", "customer_name", "logo". */
  role: string | null;
  /** Top-left corner in document coordinates (origin at document top-left). */
  x: number;
  y: number;
  width: number;
  height: number;
  rotation: number;
  opacity: number;
  visible: boolean;
  locked: boolean;
  /** Paint order. Higher is closer to the viewer. */
  zIndex: number;
  /** Set when this object is inside a group. Keeps the array flat. */
  parentId: string | null;
  stroke: string;
  strokeWidth: number;
  fill: string;
}

export interface LineObject extends TemplateObjectBase {
  type: "line" | "hr" | "vr";
  /** End point in absolute document coordinates. */
  x2: number;
  y2: number;
}

export interface ShapeObject extends TemplateObjectBase {
  type: "rect" | "rounded-rect" | "ellipse";
  /** Corner radius, only meaningful for "rounded-rect". */
  cornerRadius: number;
}

export interface PolygonObject extends TemplateObjectBase {
  type: "polygon";
  /** Absolute document-space points, relative to the object origin. */
  points: Array<[number, number]>;
}

export interface FreehandObject extends TemplateObjectBase {
  type: "freehand";
  /** Absolute document-space path, relative to the object origin. */
  path: string;
}

export type TextAlign = "left" | "center" | "right";
export type TextRoleKind = "static" | "variable";

export interface TextObject extends TemplateObjectBase {
  type: "text";
  /** May contain {{placeholders}}. */
  text: string;
  fontFamily: string;
  fontSize: number;
  fontWeight: "normal" | "bold";
  fontStyle: "normal" | "italic";
  textAlign: TextAlign;
  lineHeight: number;
  charSpacing: number;
  /** "variable" when the text contains at least one {{placeholder}}. */
  roleKind: TextRoleKind;
  /** Vertical alignment within the text box. */
  textVerticalAlign: "top" | "middle" | "bottom";
}

export interface TableCell {
  text: string;
  textAlign: TextAlign;
  fontSize: number;
  fontWeight: "normal" | "bold";
}

export interface TableObject extends TemplateObjectBase {
  type: "table";
  rows: number;
  columns: number;
  /** Length equals `columns`. Authoritative geometry. */
  colWidths: number[];
  /** Length equals `rows`. Authoritative geometry. */
  rowHeights: number[];
  /** Row-major cell data, length rows * columns. */
  cells: TableCell[];
  borderColor: string;
  borderWidth: number;
  /** Fill for non-header rows. */
  cellFill: string;
  headerRow: boolean;
  headerFill: string;
  headerTextColor: string;
  cellTextColor: string;
  padding: number;
  fontFamily: string;
}

export type ImagePlaceholderRole =
  | "logo"
  | "qr"
  | "stamp"
  | "signature"
  | "product"
  | "image";

export interface ImagePlaceholderObject extends TemplateObjectBase {
  type: "image-placeholder";
  placeholderRole: ImagePlaceholderRole;
  label: string;
}

export interface GroupObject extends TemplateObjectBase {
  type: "group";
}

export type TemplateObject =
  | LineObject
  | ShapeObject
  | PolygonObject
  | FreehandObject
  | TextObject
  | TableObject
  | ImagePlaceholderObject
  | GroupObject;

export interface TemplateDocument {
  width: number;
  height: number;
}

export interface TemplateMeta {
  name: string;
  /** ISO timestamp. */
  modifiedAt: string;
}

export interface BillTemplate {
  templateVersion: typeof TEMPLATE_VERSION;
  document: TemplateDocument;
  meta: TemplateMeta;
  /**
   * Traced structure only. The reference bill image is an authoring aid and
   * is never written here.
   */
  objects: TemplateObject[];
}

/* ------------------------------------------------------------------ */
/* Helpers                                                             */
/* ------------------------------------------------------------------ */

export const A4_WIDTH = 794;
export const A4_HEIGHT = 1123;

export function isTextObject(o: TemplateObject): o is TextObject {
  return o.type === "text";
}

export function isTableObject(o: TemplateObject): o is TableObject {
  return o.type === "table";
}

export function isImagePlaceholder(
  o: TemplateObject,
): o is ImagePlaceholderObject {
  return o.type === "image-placeholder";
}

export function isLineLike(
  o: TemplateObject,
): o is LineObject {
  return o.type === "line" || o.type === "hr" || o.type === "vr";
}

export function emptyTemplate(
  width = A4_WIDTH,
  height = A4_HEIGHT,
  name = "Untitled bill template",
): BillTemplate {
  return {
    templateVersion: TEMPLATE_VERSION,
    document: { width, height },
    meta: { name, modifiedAt: new Date().toISOString() },
    objects: [],
  };
}
