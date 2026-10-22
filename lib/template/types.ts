/**
 * Application-level bill template format.
 *
 * This is deliberately NOT Fabric's serialization format. Fabric is the
 * editing engine; the template is a portable contract that a future
 * rendering engine can consume without Fabric being installed.
 */

import type { ComputedSpec } from "@/lib/package/format";

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
  | "cell-field"
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
  /**
   * Layout container membership, distinct from `parentId` (editor groups).
   *
   * Absolute authoring coordinates are kept; the solver normalises to
   * parent-local internally and propagates inner→outer. Null/absent means
   * "no layout parent" — proximity alone never creates membership.
   */
  layoutParentId?: string | null;
  /**
   * Sibling anchoring inside a layout parent. Absent means "preserve the
   * authored top-left offset" (start/start). `end` preserves the
   * bottom/right inset, `stretch` resizes with the parent.
   */
  anchor?: ChildAnchor;
  /**
   * Conditional visibility at print time: an object with one declares that it
   * is part of the story only when a form value satisfies it - an advisory
   * line under a cheque number, say, or a payment-mode block keyed to the
   * field that names it. Absent means "always paints".
   */
  visibleWhen?: VisibleWhen;
  stroke: string;
  strokeWidth: number;
  fill: string;
}

/**
 * One visibility condition, matching the form's own value shape: `notEmpty`
 * reads the value as present-or-absent, `equals` compares the whole value.
 * Both together mean both. A key that no field fills evaluates as absent.
 */
export interface VisibleWhen {
  key: string;
  equals?: string;
  notEmpty?: boolean;
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
  /**
   * Follower growth policy. A shape carries no text of its own, so it never
   * produces a measurement — its `expansion` only takes effect when a
   * `growthGuideId` names a guide whose demand was raised by a measured
   * object (text/field/table). Without that link the policy persists but the
   * solver skips the object, deliberately: an unlinked shape growing on its
   * own would invent geometry no content asked for.
   */
  expansion?: ObjectExpansion;
  /**
   * Opt-in container policy. Absent/disabled means a plain decorative frame;
   * only `container.enabled` makes the solver grow this shape around its
   * `layoutParentId` children. Distinct from Fabric groups (`parentId`).
   */
  container?: ContainerPolicy;
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
  /**
   * Variable-layout growth policy. Absent means "fixed", so a template that
   * never opted in keeps painting its traced box.
   */
  expansion?: ObjectExpansion;
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
  /**
   * Optional row/column growth policy.
   *
   * `y` is the row axis: a row becomes as tall as its tallest cell, subject to
   * `maxGrowth`. This is how a repeat band is made variable, and it is
   * deliberately the same shape a text object uses, so one editor control and
   * one validator rule cover both. `x` is reserved - a column that grew would
   * change the table's own width, which no repeat band is allowed to do.
   */
  expansion?: ObjectExpansion;
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
  /**
   * Variable-layout growth policy. Absent means "fixed", so a template that
   * never opted in keeps painting its traced box.
   */
  expansion?: ObjectExpansion;
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
  | CellFieldObject
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
  /** Whether a customer must provide a value before generating the document. */
  required?: boolean;
  /** Initial form value. Stored as text so every input type shares one contract. */
  defaultValue?: string;
  /** Max length of the form input (text only). */
  maxLength?: number;
  /** Inclusive numeric limits for number and currency inputs. */
  min?: number;
  max?: number;
  /** Style of the rendered value when this key carries the whole text. */
  fontFamily?: string;
  fontSize?: number;
  fontWeight?: "normal" | "bold";
  fontStyle?: "normal" | "italic";
  color?: string;
  /**
   * How the value prints: a date output pattern (`DD`, `MM`, `YYYY` tokens)
   * or thousands grouping for numeric output. Without one, the value prints
   * exactly as the form supplied it.
   */
  display?: PlaceholderDisplay;
}

export interface PlaceholderDisplay {
  /** Date output pattern, e.g. `DD/MM/YYYY`. */
  date?: string;
  /** Thousands grouping for numeric output. */
  grouping?: "off" | "indian" | "western";
}

export interface TemplateMeta {
  name: string;
  /** ISO timestamp. */
  modifiedAt: string;
  /** Per-key placeholder contracts. */
  placeholders?: PlaceholderSpec[];
  /** Explicit safe calculations configured by the template author. */
  computed?: ComputedSpec[];
}

/**
 * How far a dynamic slot's content may push its box along one axis.
 *
 * `fixed` keeps the authored size and reports overflow when content does not
 * fit. `bounded` grows by at most `maxGrowth`. `unbounded` is bounded only by
 * the document policy - "unbounded" is never treated as literally infinite.
 */
export type GrowthMode = "fixed" | "bounded" | "unbounded";

/** Whether content wraps within the final width, or prefers one line. */
export type TextWrapPolicy = "wrap" | "noWrap";

export interface AxisExpansion {
  mode: GrowthMode;
  /**
   * Additional growth beyond the base geometry, never an absolute size.
   * Stated as a delta so resizing the original field afterwards does not
   * silently change the limit the author set.
   */
  maxGrowth?: number;
  /**
   * Guide this axis pushes when its content needs room. A horizontal guide
   * for `y`, a vertical guide for `x`.
   */
  growthGuideId?: string;
  /** How content is laid out within the final width. */
  strategy?: TextWrapPolicy;
}

/** Per-axis expansion policy of one dynamic slot. */
export interface ObjectExpansion {
  x: AxisExpansion;
  y: AxisExpansion;
}

/**
 * A cell field: a dynamic value slot that fills a whole box the way an
 * Excel cell does.
 *
 * The slot is *bounded by the box it belongs to* - it wraps inside the
 * container's inner area (container width minus its own padding) and paints
 * nothing outside it. Growth is the Excel behaviour the author picked: the
 * box is a minimum, data longer than the space grows the box downward
 * (`expansion.y` unbounded under a container with `growthY: "content"`), and
 * the sheet pagination carries the overflow to the next page. A container run
 * in "fixed" mode clips instead, with the overflow reported.
 *
 * Two placements:
 * - `containerId` set: the slot fills that rect/rounded-rect (the box paints
 *   its own stroke and fill; the cell field paints only the value).
 * - No container: the slot is its own Excel cell - it paints its own light
 *   border and fill, and grows itself.
 */
export interface CellFieldObject extends TemplateObjectBase {
  type: "cell-field";
  /** The form key whose value paints here. */
  key: string;
  /** Input kind produced on `/render` and in the share kit. */
  fieldType: FieldType;
  /** Always `{{key}}`; fillTemplate treats it like a text token. */
  text: string;
  fontFamily: string;
  fontSize: number;
  fontWeight: "normal" | "bold";
  fontStyle: "normal" | "italic";
  textAlign: TextAlign;
  lineHeight: number;
  charSpacing: number;
  /** Vertical alignment inside the box - Excel cells default to the middle. */
  textVerticalAlign: "top" | "middle" | "bottom";
  /** Inner padding between the value and the box edges. */
  padding: number;
  /** Excel wrap on/off. Default on: the value wraps inside the box. */
  wrap: boolean;
  /** The box this field fills (null = the field is its own box). */
  containerId: string | null;
  roleKind: "variable";
  /**
   * Growth policy. The tool sets `y: unbounded` so a value longer than the
   * box grows the box downward under a container with `growthY: "content"`;
   * a capped container clips the overflow and the overflow is reported.
   */
  expansion?: ObjectExpansion;
}

/**
 * A marking line: an editor-authored boundary that content growth can move.
 *
 * `position` is a y-coordinate when `orientation` is `horizontal` and an
 * x-coordinate when it is `vertical`. The two are kept apart on purpose -
 * "horizontal" naming both a horizontal line and horizontal movement is the
 * ambiguity this field exists to prevent.
 */
export interface LayoutGuide {
  id: string;
  orientation: "horizontal" | "vertical";
  position: number;
  /** Cap on how far growth may move this guide from its authored position. */
  maxDisplacement?: number;
}

export type AttachmentEdge = "left" | "right" | "top" | "bottom";

/**
 * `move` keeps the object's size and follows the guide with the attached edge.
 * `stretch` keeps the opposite edge anchored and resizes. There is no `fixed`
 * behaviour: an object that should ignore a guide simply has no attachment.
 */
export type AttachmentBehavior = "move" | "stretch";

export interface GuideAttachment {
  id: string;
  objectId: string;
  /** A vertical guide controls `left`/`right`; a horizontal one `top`/`bottom`. */
  edge: AttachmentEdge;
  guideId: string;
  behavior: AttachmentBehavior;
}

export type DocumentGrowth = "fixed" | "expand";

export interface DocumentLayoutPolicy {
  growthX: DocumentGrowth;
  growthY: DocumentGrowth;
  /** Explicit ceilings, honoured before any safety limit. */
  maxWidth?: number;
  maxHeight?: number;
}

/** Which edge of the parent a child holds onto inside a layout container. */
export type AnchorRule = "start" | "end" | "stretch";

/**
 * Sibling anchoring for a child with `layoutParentId`.
 *
 * Stored as explicit pixel offsets so the solver preserves the authored
 * inset: `start` keeps the top/left distance, `end` keeps the bottom/right
 * distance, `stretch` resizes the child with the parent.
 */
export interface ChildAnchor {
  horizontal?: AnchorRule;
  vertical?: AnchorRule;
  leftOffset?: number;
  rightOffset?: number;
  topOffset?: number;
  bottomOffset?: number;
}

export type ContainerGrowth = "fixed" | "content";

export interface ContainerPadding {
  top: number;
  right: number;
  bottom: number;
  left: number;
}

/**
 * Opt-in layout-container policy for a shape (rect/rounded-rect/ellipse).
 *
 * A plain rectangle stays decoration. Only `container.enabled` makes it grow
 * around its `layoutParentId` children, keeping the authored padding between
 * the content and the frame. `growthX/Y: "content"` enables that axis;
 * `"fixed"` keeps the authored size and reports overflow instead.
 */
export interface ContainerPolicy {
  enabled: boolean;
  growthX?: ContainerGrowth;
  growthY?: ContainerGrowth;
  padding?: ContainerPadding;
  minWidth?: number;
  minHeight?: number;
  maxWidth?: number;
  maxHeight?: number;
}

/** How sibling collisions inside one container are handled. */
export type CollisionPolicy = "report" | "allow";

/**
 * Variable-layout configuration for a whole template.
 *
 * Optional and additive: a template without it renders exactly as it did
 * before this existed, and a renderer that does not understand `layout` simply
 * ignores it and paints the traced geometry.
 */
export interface LayoutConfig {
  /** `fixed` is the legacy behaviour. `variable` engages the layout pass. */
  mode: "fixed" | "variable";
  document?: DocumentLayoutPolicy;
  guides?: LayoutGuide[];
  attachments?: GuideAttachment[];
  /**
   * Sibling collision handling inside layout containers.
   * `report` (default) keeps geometry and adds a diagnostic; `allow` stays
   * silent for intentional overlap. No auto-push in v1 — overlap is never
   * resolved by moving a sibling the author did not ask to move.
   */
  collision?: CollisionPolicy;
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
  /**
   * Variable-layout configuration. Absent on every template that does not use
   * it, which is also how a version-2 renderer knows to paint the traced
   * geometry unchanged.
   */
  layout?: LayoutConfig;
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
    meta: { name, modifiedAt: "" },
    objects: [],
  };
}
