/**
 * Application-level bill template format.
 *
 * This is deliberately NOT Fabric's serialization format. Fabric is the
 * editing engine; the template is a portable contract that a future
 * rendering engine can consume without Fabric being installed.
 */

export const TEMPLATE_VERSION = 2 as const;

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
  | "field"
  | "group"
  | "bill-part";

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
  /** SVG path data, e.g. "M 0 0 L 100 50". Relative to the object origin. */
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
  /**
   * When present the box wraps at this width and grows downward; absent means
   * the auto-width single-line behaviour a plain text box has always had.
   *
   * Only Fabric's `Textbox` can wrap — on an `IText`, `width` is not a layout
   * property and is discarded on the next layout pass — so a wrapped box is a
   * different canvas class. This is the unscaled width, matching `scaleX`.
   */
  wrapWidth?: number;
  /**
   * The stretch a side or diagonal drag left on the object. Fabric never folds
   * it into `fontSize`: the drag only moves `scaleX`/`scaleY` and leaves
   * `width`/`height` at the unscaled text metrics. Both default to 1, so a
   * template written before these existed renders unchanged.
   *
   * The renderer applies them as a CSS `transform: scale()` about the box's
   * top-left, which is what Fabric scales about, so glyphs stretch exactly as
   * they did on the canvas. `width`/`height` therefore stay the *unscaled*
   * metrics and describe the text's own layout box, not its painted size.
   */
  scaleX?: number;
  scaleY?: number;
}

export interface TableCell {
  text: string;
  textAlign: TextAlign;
  fontSize: number;
  fontWeight: "normal" | "bold";
  /** Optional per-cell ink. Falls back to the table's cell/header text colour. */
  color?: string;
}

/**
 * A band of rows inside a table that is repeated once per item at render time.
 *
 * Rows `startRow`..`endRow` inclusive (0-based) are the template band: they are
 * cloned, never drawn as they stand, and every `{{token}}` inside them resolves
 * against the current item before the flat values. A band may span more than one
 * row so a two-row-per-item layout is expressible.
 *
 * Optional on purpose: its absence is a v1 template, which is why v1 and v2
 * describe the same bytes.
 */
export interface TableRepeat {
  /** 0-based, inclusive: first row of the template band. */
  startRow: number;
  /** 0-based, inclusive: last row of the template band. */
  endRow: number;
  /** Values key holding the JSON array of items. */
  key: string;
  /** Repeat `headerRow` when the expanded table splits across pages. */
  repeatHeader?: boolean;
  /** Hard cap on generated rows; a larger input is refused, not silently truncated. */
  maxItems?: number;
}

/**
 * The cap a band falls back to when its own `maxItems` is absent or unusable.
 *
 * It is the single default every layer shares: the serialiser that writes the
 * field, the renderer that applies the band, the form derivation and the
 * normaliser all read this one number rather than each carrying its own copy,
 * so a template cannot mean two different caps depending on which layer asked.
 */
export const DEFAULT_REPEAT_MAX_ITEMS = 200;

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
  repeat?: TableRepeat;
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
  /**
   * Data URL (or remote URL the runtime can load) injected when a dynamic
   * value is bound to this placeholder. Absent for an empty traced slot.
   */
  src?: string;
}

export interface SourceRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface BillPartObject extends TemplateObjectBase {
  type: "bill-part";
  /** Embedded crop, normalised for white paper. */
  src?: string;
  normalized?: boolean;
  sourceRect?: SourceRect;
}

export interface GroupObject extends TemplateObjectBase {
  type: "group";
}

export type FieldType =
  | "text"
  | "number"
  | "date"
  | "currency"
  | "tickmark"
  | "checkbox";

/**
 * A standalone dynamic slot placed with the field tool. Unlike a `{{token}}`
 * inside a text box, a field carries its own identity (key + input type) and
 * renders as a dashed marker on the canvas. The renderer paints it as the
 * `{{key}}` text it stands for, so filling works exactly like a text token.
 */
export interface FieldObject extends TemplateObjectBase {
  type: "field";
  /** Form key, e.g. `invoice_date`. */
  key: string;
  /** Input kind produced on `/render` and in the share kit. */
  fieldType: FieldType;
  /** Always `{{key}}`; kept so fillTemplate treats it like a text token. */
  text: string;
  fontFamily: string;
  fontSize: number;
  fontWeight: "normal" | "bold";
  fontStyle: "normal" | "italic";
  textAlign: TextAlign;
  lineHeight: number;
  charSpacing: number;
  roleKind: "variable";
  textVerticalAlign: "top";
}

export type TemplateObject =
  | LineObject
  | ShapeObject
  | PolygonObject
  | FreehandObject
  | TextObject
  | TableObject
  | ImagePlaceholderObject
  | BillPartObject
  | FieldObject
  | GroupObject;

export interface TemplateDocument {
  width: number;
  height: number;
}

export type PlaceholderType =
  | "text"
  | "number"
  | "date"
  | "currency"
  | "tickmark"
  | "checkbox";

/**
 * Per-key contract for a dynamic slot. Lives in the template itself, so a
 * generated form and a styled rendered document travel together. All fields
 * are optional: anything the template author skips falls back to the
 * renderer's default inference (label from the key, type from token name,
 * no max-length, style inherited from the host text box / table).
 */
export interface PlaceholderSpec {
  /** The `{{token}}` key, or the image slot's placeholderRole. */
  key: string;
  /** Form-side label. */
  label?: string;
  /** Input kind produced on `/render` and in the share kit. */
  type?: PlaceholderType;
  /** Max length of the form input (text only). */
  maxLength?: number;
  /** Style of the rendered value when this key carries the whole text. */
  fontFamily?: string;
  fontSize?: number;
  fontWeight?: "normal" | "bold";
  fontStyle?: "normal" | "italic";
  color?: string;
}

export interface TemplateMeta {
  name: string;
  /** ISO timestamp. */
  modifiedAt: string;
  /** Per-key placeholder contracts. */
  placeholders?: PlaceholderSpec[];
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

export function isFieldObject(o: TemplateObject): o is FieldObject {
  return o.type === "field";
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
