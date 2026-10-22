"use client";

import {
  ActiveSelection,
  Canvas,
  Circle,
  Ellipse,
  FabricObject,
  IText,
  Line,
  Path,
  PencilBrush,
  Polygon,
  Rect,
  Textbox,
  type TPointerEvent,
  type TPointerEventInfo,
} from "fabric";

import { BillTable } from "@/lib/canvas/objects/BillTable";
import {
  GUIDE_APP_TYPE,
  guidesFromObjects,
  isGuide,
  nextGuideId,
  withLayoutMode,
} from "@/lib/canvas/guides";
import type {
  AttachmentBehavior,
  AttachmentEdge,
  BillTemplate,
  ChildAnchor,
  ContainerPolicy,
  ObjectExpansion,
  PlaceholderSpec,
  LayoutConfig,
  TableObject,
  TableRepeat,
  TemplateObject,
} from "@/lib/template/types";
import { normaliseRepeat } from "@/lib/canvas/tableRepeat";
import { interiorGridLevels } from "@/lib/canvas/tableGrid";
import { FieldObject } from "@/lib/canvas/objects/BillField";
import { CellFieldObject } from "@/lib/canvas/objects/BillCellField";
import {
  groupObjects as groupObjectsIn,
  pruneGroups,
  ungroup as ungroupIn,
  subtreeIds,
  type GroupNode,
} from "@/lib/canvas/groups";
import { ImagePlaceholderObject } from "@/lib/canvas/objects/ImagePlaceholder";
import { cropBillPart, type BillPartCrop } from "@/lib/canvas/billPartCrop";
import { BillPartObject } from "@/lib/canvas/objects/BillPartObject";
import {
  levelsFromBounds,
  snapToLevels,
  type Levels,
  type SnapLine,
} from "@/lib/canvas/snap";
import {
  DEFAULT_STROKE_WIDTH,
  applyStrokeFloor,
  usesDefaultStroke,
} from "@/lib/canvas/strokeDefaults";
import { extractVariables, isDataFieldObject } from "@/lib/template/placeholders";
import {
  acceptsSharedPaint,
  acceptsVisibility,
  sharedSelection,
  type SharedKey,
  type SharedSelection,
} from "@/lib/canvas/sharedSelection";
import { createId, registerAppProperties } from "@/lib/canvas/fabricSetup";
import { HistoryStack } from "@/lib/canvas/history";
import {
  buildAdjustedReference,
  cropForPage,
  EMPTY_REFERENCE_CROP,
  fitTo,
  install,
  remove,
  sampleBorderColor,
  setOpacity,
  setVisible,
  type ReferenceCrop,
  type ReferenceHandle,
} from "@/lib/canvas/referenceBackground";
import {
  clampZoom,
  containScale,
  panBy as panViewBy,
  sceneToScreen,
  screenToScene,
  viewportTransform,
  zoomAbout,
  type Viewport,
} from "@/lib/canvas/viewport";
import { evenSizes, MIN_COL_WIDTH, MIN_ROW_HEIGHT } from "@/lib/template/geometry";
import { hydrateTemplate } from "@/lib/template/hydrate";
import { serialiseObjects, defaultName } from "@/lib/template/serialize";
import { buildPackage, writePackage } from "@/lib/package/build";
import { parsePackage } from "@/lib/package/parse";
import { resolvePackage } from "@/lib/package/resolve";
import { computedSpecsFor } from "@/lib/package/computedSpecs";
import type { ComputedSpec } from "@/lib/package/format";
import { renderHtml } from "@/lib/render";
import type { LayoutGuide } from "@/lib/template/types";
import { A4_HEIGHT, A4_WIDTH } from "@/lib/template/types";

registerAppProperties();

export type ToolId =
  | "select"
  | "guide-h"
  | "guide-v"
  | "line"
  | "rect"
  | "rounded-rect"
  | "ellipse"
  | "polygon"
  | "freehand"
  | "text"
  | "table"
  | "hr"
  | "vr"
  | "image-placeholder"
  | "bill-part"
  | "field"
  | "cell-field"
  | "eyedropper";

export const TOOL_LABELS: Record<ToolId, string> = {
  select: "Select",
  "guide-h": "Guide H",
  "guide-v": "Guide V",
  line: "Line",
  rect: "Rectangle",
  "rounded-rect": "Rounded Rect",
  ellipse: "Ellipse",
  polygon: "Polygon",
  freehand: "Freehand",
  text: "Text",
  table: "Table",
  hr: "Horizontal Rule",
  vr: "Vertical Rule",
  "image-placeholder": "Image Placeholder",
  "bill-part": "Bill Part",
  field: "Field",
  "cell-field": "Cell Field",
  eyedropper: "Eyedropper",
};

export interface LayerEntry {
  id: string;
  type: string;
  name: string;
  role: string | null;
  visible: boolean;
  locked: boolean;
  isReference: boolean;
}

export interface EditorState {
  ready: boolean;
  tool: ToolId;
  zoom: number;
  /** Screen-space translation of the viewport, in CSS pixels. */
  tx: number;
  ty: number;
  document: { width: number; height: number };
  selection: string[];
  layers: LayerEntry[];
  hasReference: boolean;
  referenceVisible: boolean;
  referenceOpacity: number;
  referenceCrop: ReferenceCrop;
  referenceRotation: 0 | 90 | 180 | 270;
  referenceName: string;
  gridVisible: boolean;
  snapToGrid: boolean;
  gridSize: number;
  canUndo: boolean;
  canRedo: boolean;
  /** Cell currently open for inline editing, if any. */
  editingCell: { tableId: string; index: number } | null;
  /**
   * The selected table with its repeat band, or null when none is selected.
   *
   * A plain template object rather than the live Fabric instance: `rows` and
   * `columns` are class getters there, so spreading one silently drops them.
   */
  selectedTable: (TableObject & { repeat?: TableRepeat }) | null;
  /** Rows/columns requested by the table tool, awaiting confirmation. */
  /**
   * The table box the user has just dragged out and not yet given a shape.
   *
   * `id` identifies which table the rows/columns prompt is configuring. Without
   * it the prompt could only look for "a table" on the canvas, and it would find
   * the first one — so drawing a second table reconfigured the first.
   */
  pendingTable: {
    id: string;
    x: number;
    y: number;
    width: number;
    height: number;
  } | null;
  documentName: string;
  objectCount: number;
  /**
   * Traced objects that make the document dynamic: data-field boxes, image
   * slots and text tokens, plus a repeating band on the selected table. Counted
   * from the objects themselves, so re-typing a field is an edit, not progress.
   */
  dataFieldCount: number;
  /** Per-key contracts for dynamic placeholders, editable in the panel. */
  placeholders: PlaceholderSpec[];
  computedSpecs: ComputedSpec[];
  /**
   * Variable-layout configuration for the document, or `undefined` for a
   * fixed-layout template.
   *
   * Optional rather than defaulted to `{ mode: "fixed" }` on purpose: the
   * absence of the block is what a renderer reads as "this template is a
   * fixed-layout one", so the two states must not collapse into each other.
   */
  layout?: LayoutConfig;
  /** Hex colour sampled with the eyedropper tool, kept for reference. */
  sampledColour: string | null;
  /** Whether the traced structure is locked (fields remain editable). */
  structureLocked: boolean;
  /**
   * Nestable groups. Authoring-only: the renderer absolutely-positions every
   * object, so a group has no representation in the exported bill.
   */
  groups: GroupNode[];
  /** Object-to-object snapping on drawing, moving and resizing. */
  snapToObjects: boolean;
  /** A rule drag started inside a rect spans that rect; opposed to freehand rules. */
  fullSpanRules: boolean;
  /**
   * Whether a new bill part whitens its border-connected paper. Off cuts the
   * reference's own pixels. This is the default for new captures only; each
   * part records what was actually done in its own `normalized` flag.
   */
  normaliseBillParts: boolean;
  /** Active guide lines, painted by the stage overlay; reset on mouse:up. */
  snaps: SnapLine[];
}

type Listener = () => void;

/** Tool id -> value stored on an object's `appType` field. */const APP_TYPE_FOR: Record<string, string> = {
  "rounded-rect": "rounded-rect",
  rect: "rect",
  ellipse: "ellipse",
  polygon: "polygon",
  freehand: "path",
  text: "text",
  table: "table",
  "image-placeholder": "image-placeholder",
  "bill-part": "bill-part",
  field: "field",
  line: "line",
  hr: "hr",
  vr: "vr",
};

/** Snap a value to the nearest grid multiple. */
export function snap(value: number, size: number): number {
  if (size <= 0) return Math.round(value);
  return Math.round(value / size) * size;
}

/** Keep only well-formed contracts from an untrusted template file. */
export function normalisePlaceholderSpecs(
  specs: PlaceholderSpec[] | undefined,
): PlaceholderSpec[] {
  if (!Array.isArray(specs)) return [];
  const seen = new Set<string>();
  const out: PlaceholderSpec[] = [];
  for (const spec of specs) {
    if (!spec || typeof spec.key !== "string") continue;
    const key = spec.key.trim();
    if (!key || seen.has(key)) continue;
    seen.add(key);
    const clean: PlaceholderSpec = { key };
    if (spec.label) clean.label = spec.label;
    if (spec.type) clean.type = spec.type;
    if (typeof spec.required === "boolean") clean.required = spec.required;
    if (typeof spec.defaultValue === "string") clean.defaultValue = spec.defaultValue;
    if (typeof spec.maxLength === "number" && spec.maxLength > 0) {
      clean.maxLength = spec.maxLength;
    }
    if (typeof spec.min === "number" && Number.isFinite(spec.min)) clean.min = spec.min;
    if (typeof spec.max === "number" && Number.isFinite(spec.max)) clean.max = spec.max;
    if (spec.fontFamily) clean.fontFamily = spec.fontFamily;
    if (typeof spec.fontSize === "number" && spec.fontSize > 0) {
      clean.fontSize = spec.fontSize;
    }
    if (spec.fontWeight) clean.fontWeight = spec.fontWeight;
    if (spec.fontStyle) clean.fontStyle = spec.fontStyle;
    if (spec.color) clean.color = spec.color;
    out.push(clean);
  }
  return out;
}

export class EditorController {
  private canvas: Canvas | null = null;
  private listeners = new Set<Listener>();
  private history = new HistoryStack<string>();
  private state: EditorState = {
    ready: false,
    tool: "select",
    zoom: 1,
    tx: 0,
    ty: 0,
    document: { width: A4_WIDTH, height: A4_HEIGHT },
    selection: [],
    layers: [],
    hasReference: false,
    referenceVisible: true,
    referenceOpacity: 0.25,
    referenceCrop: { ...EMPTY_REFERENCE_CROP },
    referenceRotation: 0,
    referenceName: "Bill reference",
    gridVisible: false,
    snapToGrid: false,
    gridSize: 10,
    canUndo: false,
    canRedo: false,
    editingCell: null,
    selectedTable: null,
    pendingTable: null,
    documentName: "Untitled bill template",
    objectCount: 0,
    dataFieldCount: 0,
    placeholders: [],
    computedSpecs: [],
    sampledColour: null,
    structureLocked: false,
    groups: [],
    snapToObjects: true,
    fullSpanRules: false,
    normaliseBillParts: true,
    snaps: [],
  };

  private reference: ReferenceHandle | null = null;
  private drawing: FabricObject | null = null;
  private drawOrigin: { x: number; y: number } | null = null;
  private polygonPoints: Array<{ x: number; y: number }> = [];
  private polygonPreview: Polygon | null = null;
  /** Vertex dots and the rubber band shown while a polygon is being placed. */
  private polygonMarkers: FabricObject[] = [];
  private polygonGuide: Line | null = null;
  private pencil: PencilBrush | null = null;
  /**
   * A rect or rounded rect the current rule drag started inside. When set, the
   * rule spans that shape edge to edge instead of free-following the pointer.
   */
  private spanTarget: FabricObject | null = null;
  /** Position of the object being transformed, captured on mouse down. */
  private gestureAnchor: { left: number; top: number } | null = null;
  /** Latest scene-space pointer position, for events that do not carry one. */
  private lastKnownScenePoint: { x: number; y: number } | null = null;
  /**
   * The selection from just before a tool switch wiped it. Tools like the
   * eyedropper must act on what was selected *before* the user picked them.
   */
  private lastSelected: FabricObject[] = [];
  private isPanning = false;
  private spaceHeld = false;
  private lastPan: { x: number; y: number } | null = null;
  private suppressHistory = false;
  private disposed = false;

  /* ---------------------------------------------------------------- */
  /* Store plumbing                                                    */
  /* ---------------------------------------------------------------- */

  subscribe = (listener: Listener): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  getSnapshot = (): EditorState => this.state;

  /**
   * Give every outline object the minimum painted thickness at the current
   * zoom, leaving the width each one stores alone.
   *
   * Called after anything that can add or replace objects — a tool, an undo, a
   * template load — and again after a zoom change, since the floor depends on
   * the zoom. An object that does not draw its own stroke is skipped, so a
   * table's borders and a field's box keep whatever the author set.
   */
  private refreshStrokeFloors(): void {
    const canvas = this.canvas;
    if (!canvas) return;
    const zoom = () => canvas.getZoom();
    for (const obj of canvas.getObjects()) {
      if (!usesDefaultStroke(obj as unknown as { appType?: string })) continue;
      applyStrokeFloor(obj as unknown as Record<string, unknown> & { strokeWidth?: number }, zoom);
    }
  }

  private setState(patch: Partial<EditorState>): void {
    this.state = { ...this.state, ...patch };
    for (const l of this.listeners) l();
  }

  /* ---------------------------------------------------------------- */
  /* Lifecycle                                                         */
  /* ---------------------------------------------------------------- */

  /**
   * Resolves once a canvas element is attached. The editor switches from the
   * upload screen to the workspace, so callers that need to touch Fabric
   * immediately after a state change must wait for this rather than guessing
   * with a timeout.
   */
  whenReady(): Promise<void> {
    if (this.canvas) return Promise.resolve();
    if (!this.readyPromise) {
      this.readyPromise = new Promise<void>((resolve) => {
        this.readyResolvers.push(resolve);
      });
    }
    return this.readyPromise;
  }

  private markReady(): void {
    const resolvers = this.readyResolvers;
    this.readyResolvers = [];
    this.readyPromise = null;
    for (const r of resolvers) r();
  }

  attach(element: HTMLCanvasElement): void {
    registerAppProperties();
    const canvas = new Canvas(element, {
      width: Math.max(1, Math.round(this.viewport.width)),
      height: Math.max(1, Math.round(this.viewport.height)),
      backgroundColor: "#ffffff",
      preserveObjectStacking: true,
      selection: true,
      stopContextMenu: true,
      fireRightClick: false,
    });
    this.canvas = canvas;

    canvas.on("mouse:down", this.onMouseDown);
    canvas.on("mouse:dblclick", this.onMouseDblClick);
    canvas.on("mouse:move", this.onMouseMove);
    canvas.on("mouse:up", this.onMouseUp);
    canvas.on("mouse:wheel", this.onWheel);
    canvas.on("object:moving", this.onObjectMoving);
    canvas.on("object:scaling", this.onObjectScaling);
    canvas.on("object:skewing", this.onObjectSkewing);
    canvas.on("object:modified", this.onObjectModified);
    canvas.on("text:changed", this.onTextChanged);
    canvas.on("selection:created", this.onSelectionChanged);
    canvas.on("selection:updated", this.onSelectionChanged);
    canvas.on("selection:cleared", this.onSelectionChanged);
    // Objects reach the scene through a tool, an undo, a template load or the
    // table tool, and only the first three are covered explicitly. Installing
    // the floor on add covers every path, including an object that is later
    // resized or restyled by the panel.
    canvas.on("object:added", () => {
      this.refreshStrokeFloors();
    });

    this.pencil = new PencilBrush(canvas);
    this.pencil.color = "#000000";
    // The same document-unit width every other outline tool draws with, so a
    // pencil stroke and a rule are the same line on the page.
    this.pencil.width = DEFAULT_STROKE_WIDTH;

    // A template loaded into an already-populated canvas brings its own
    // objects, so the floor is installed for them here as well as on load.
    this.refreshStrokeFloors();

    this.markBaseline();
    this.refresh();
    this.setState({ ready: true });
    this.markReady();
  }

  detach(): void {
    this.disposed = true;
    const canvas = this.canvas;
    if (canvas) {
      canvas.off("mouse:down", this.onMouseDown);
      canvas.off("mouse:dblclick", this.onMouseDblClick);
      canvas.off("mouse:move", this.onMouseMove);
      canvas.off("mouse:up", this.onMouseUp);
      canvas.off("mouse:wheel", this.onWheel);
      canvas.off("object:moving", this.onObjectMoving);
      canvas.off("object:scaling", this.onObjectScaling);
      canvas.off("object:skewing", this.onObjectSkewing);
      canvas.off("object:modified", this.onObjectModified);
      canvas.off("text:changed", this.onTextChanged);
      canvas.off("selection:created", this.onSelectionChanged);
      canvas.off("selection:updated", this.onSelectionChanged);
      canvas.off("selection:cleared", this.onSelectionChanged);
      canvas.dispose();
    }
    this.canvas = null;
    this.reference = null;
  }

  dispose(): void {
    this.detach();
    this.listeners.clear();
  }

  get isDisposed(): boolean {
    return this.disposed;
  }

  /** The raw canvas, used by the overlay cell editor for positioning. */
  getCanvas(): Canvas | null {
    return this.canvas;
  }

  /* ---------------------------------------------------------------- */
  /* Document / zoom                                                   */
  /* ---------------------------------------------------------------- */

  /**
   * Keep the full reference image centred on the document without distortion.
   *
   * The image is the authoring underlay, so the canvas and the image must
   * always coincide: the page boundary *is* the image boundary. Whenever the
   * document size changes (a new bill, a loaded template, a blank page) the
   * image is re-fitted to the new page rather than being left stranded at its
   * own natural size.
   */
  private lockReferenceToDocument(): void {
    if (this.reference) fitTo(this.reference, this.state.document);
    this.canvas?.requestRenderAll();
  }

  setDocument(width: number, height: number): void {
    const canvas = this.canvas;
    if (!canvas) return;
    if (
      !Number.isFinite(width) || !Number.isFinite(height) ||
      width < 100 || height < 100 || width > 20000 || height > 20000
    ) return;
    if (width === this.state.document.width && height === this.state.document.height) return;
    this.setState({ document: { width, height } });
    this.lockReferenceToDocument();
    this.applyCanvasSize();
    this.fit();
    this.commit("Change page size");
  }

  /**
   * The canvas element is sized to the pane itself, never to the document.
   * The viewport transform — a single affine [zoom, 0, 0, zoom, tx, ty] —
   * is what lays the document and the reference background over the pane.
   */
  private applyCanvasSize(): void {
    const canvas = this.canvas;
    if (!canvas) return;
    canvas.setDimensions({
      width: Math.max(1, Math.round(this.viewport.width)),
      height: Math.max(1, Math.round(this.viewport.height)),
    });
  }

  get view(): Viewport {
    return { zoom: this.state.zoom, tx: this.state.tx, ty: this.state.ty };
  }

  /** Project a document-space point to canvas CSS-pixel coordinates. */
  projectToScreen(point: { x: number; y: number }): { x: number; y: number } {
    return sceneToScreen(point, this.view);
  }

  /** Invert the projection: a canvas-relative point's document coordinates. */
  screenToScenePoint(point: { x: number; y: number }): {
    x: number;
    y: number;
  } {
    return screenToScene(point, this.view);
  }

  /** Write a view state into Fabric and into the reactive state. */
  private applyView(view: Viewport): void {
    const canvas = this.canvas;
    if (!canvas) return;
    canvas.setViewportTransform(viewportTransform(view));
    this.setState({ zoom: view.zoom, tx: view.tx, ty: view.ty });
    // The minimum painted thickness is a function of the zoom, so it has to be
    // re-evaluated whenever the zoom moves.
    this.refreshStrokeFloors();
    canvas.requestRenderAll();
  }

  /** Zoom, keeping the scene point under `anchor` fixed (default: pane centre). */
  setZoom(zoom: number, anchor?: { x: number; y: number }): void {
    const canvas = this.canvas;
    if (!canvas) return;
    const centre = {
      x: this.viewport.width / 2,
      y: this.viewport.height / 2,
    };
    const next = zoomAbout(
      anchor ?? centre,
      zoom,
      this.view,
      this.viewport,
      this.state.document,
    );
    this.userHasZoomed = true;
    this.applyView(next);
  }

  /** Zoom anchored at a screen point — used by the wheel handler. */
  zoomAt(anchor: { x: number; y: number }, zoom: number): void {
    const canvas = this.canvas;
    if (!canvas) return;
    const next = zoomAbout(
      anchor,
      zoom,
      this.view,
      this.viewport,
      this.state.document,
    );
    this.userHasZoomed = true;
    this.applyView(next);
  }

  zoomIn(): void {
    this.setZoom(this.state.zoom * 1.2);
  }

  zoomOut(): void {
    this.setZoom(this.state.zoom / 1.2);
  }

  resetZoom(): void {
    this.fit();
  }

  /** Pan by a screen-space delta, re-clamped to the document. */
  panBy(dx: number, dy: number): void {
    const next = panViewBy(
      dx,
      dy,
      this.view,
      this.viewport,
      this.state.document,
    );
    this.applyView(next);
  }

  /**
   * The scrollable element the canvas lives in. Kept so `fit` can measure the
   * live pane instead of a cached size, which goes stale while the layout
   * settles after a document loads.
   */
  private stageEl: HTMLElement | null = null;

  setStageElement(el: HTMLElement | null): void {
    this.stageEl = el;
    if (el) this.setViewportSize(el.clientWidth, el.clientHeight);
  }

  /** Size of the area the document is drawn into, in CSS pixels. */
  private viewport = { width: 800, height: 1000 };
  /**
   * Once the user zooms deliberately we stop refitting on resize, so a window
   * change never yanks the view away from the level they chose.
   */
  private userHasZoomed = false;

  setViewportSize(width: number, height: number): void {
    const changed =
      Math.abs(width - this.viewport.width) > 1 ||
      Math.abs(height - this.viewport.height) > 1;
    this.viewport = { width, height };
    this.applyCanvasSize();
    // The pane can settle after the document loads, so refit while the user
    // has not taken control of the zoom.
    if (changed && !this.userHasZoomed) this.fit();
  }

  getViewportSize(): { width: number; height: number } {
    return this.viewport;
  }

  /**
   * Scale so the whole document is visible with a small even margin, and
   * centre any leftover room on the axes where the page is narrower/shorter
   * than the pane. Equal to "contain + centre", and both the initial view and
   * the reset action.
   */
  fit(): void {
    const { width, height } = this.state.document;
    const margin = 24;
    const fitted = {
      width: Math.max(120, this.viewport.width - margin * 2),
      height: Math.max(120, this.viewport.height - margin * 2),
    };
    const zoom = clampZoom(
      containScale(fitted, { width, height }),
      fitted,
      { width, height },
    );
    this.userHasZoomed = false;
    this.applyView({
      zoom,
      tx: (this.viewport.width - width * zoom) / 2,
      ty: (this.viewport.height - height * zoom) / 2,
    });
  }

  /** Fit the document into the available viewport area. */
  fitToView(viewportWidth: number, viewportHeight: number): void {
    this.setViewportSize(viewportWidth, viewportHeight);
    this.fit();
  }

  setSpaceHeld(held: boolean): void {
    this.spaceHeld = held;
    const canvas = this.canvas;
    if (!canvas) return;
    canvas.defaultCursor = held ? "grab" : "default";
    canvas.selection = !held && this.state.tool === "select";
  }

  isSpaceHeld(): boolean {
    return this.spaceHeld;
  }

  /* ---------------------------------------------------------------- */
  /* Reference image                                                   */
  /* ---------------------------------------------------------------- */

  /**
   * Attach the bill image as the canvas background. It is deliberately kept
   * out of the template and out of the scene's object list: exports are built
   * from the template, and the reference can never be selected or serialised.
   */
  async addReference(dataUrl: string): Promise<{ width: number; height: number }> {
    const canvas = this.canvas;
    if (!canvas) throw new Error("Canvas not ready");
    const ref = await install(canvas, dataUrl, this.state.referenceOpacity);
    this.reference?.image.dispose();
    this.reference = ref;

    const docWidth = ref.width || A4_WIDTH;
    const docHeight = ref.height || A4_HEIGHT;
    this.setState({
      document: { width: docWidth, height: docHeight },
      hasReference: true,
      referenceVisible: true,
      referenceCrop: { ...EMPTY_REFERENCE_CROP },
      referenceRotation: 0,
    });
    fitTo(ref, { width: docWidth, height: docHeight });
    this.applyCanvasSize();
    // The page just changed size, so show all of it.
    this.fit();
    this.markBaseline();
    this.refresh();
    return { width: docWidth, height: docHeight };
  }

  setReferenceOpacity(value: number): void {
    const opacity = Math.min(1, Math.max(0, value));
    setOpacity(this.reference, opacity);
    this.canvas?.requestRenderAll();
    this.setState({ referenceOpacity: opacity });
  }

  setReferenceVisible(visible: boolean): void {
    if (this.canvas) setVisible(this.canvas, this.reference, visible);
    this.setState({ referenceVisible: visible });
  }

  /** Rotate or crop the reference image only; bill objects and exports are untouched. */
  async setReferenceAdjustments(
    crop: ReferenceCrop,
    rotation: 0 | 90 | 180 | 270,
  ): Promise<void> {
    const canvas = this.canvas;
    const current = this.reference;
    if (!canvas || !current) return;
    const next = await buildAdjustedReference(current, crop, rotation, this.state.referenceOpacity);
    next.image.set({ selectable: false, evented: false } as never);
    canvas.backgroundImage = this.state.referenceVisible ? next.image : undefined;
    canvas.backgroundColor = sampleBorderColor(next.image);
    fitTo(next, this.state.document);
    canvas.requestRenderAll();
    current.image.dispose();
    this.reference = next;
    this.setState({ referenceCrop: next.crop, referenceRotation: next.rotation });
  }

  /** Rotate the reference in 90-degree increments without changing its source file. */
  async rotateReference(direction: "left" | "right"): Promise<void> {
    const turn = direction === "right" ? 90 : 270;
    const rotation = ((this.state.referenceRotation + turn) % 360) as 0 | 90 | 180 | 270;
    await this.setReferenceAdjustments(this.state.referenceCrop, rotation);
  }

  /** Centre-crop the reference to the current page's aspect ratio. */
  async fitReferenceToPage(): Promise<void> {
    const current = this.reference;
    if (!current) return;
    const crop = cropForPage(current.sourceWidth, current.sourceHeight, this.state.document, this.state.referenceRotation);
    await this.setReferenceAdjustments(crop, this.state.referenceRotation);
  }

  async resetReferenceAdjustments(): Promise<void> {
    await this.setReferenceAdjustments({ ...EMPTY_REFERENCE_CROP }, 0);
  }

  /** Focus an editor-only layout guide from a preflight result. */
  selectGuide(guideId: string): boolean {
    const canvas = this.canvas;
    const guide = canvas?.getObjects().find((object) => isGuide(object) && (object as { guideId?: string }).guideId === guideId);
    if (!canvas || !guide) return false;
    this.setTool("select");
    canvas.setActiveObject(guide);
    canvas.requestRenderAll();
    this.refresh();
    return true;
  }

  removeReference(): void {
    const canvas = this.canvas;
    if (!canvas || !this.reference) return;
    this.reference.image.dispose();
    this.reference = null;
    remove(canvas);
    this.setState({
      hasReference: false,
      referenceVisible: false,
      referenceCrop: { ...EMPTY_REFERENCE_CROP },
      referenceRotation: 0,
    });
    this.refresh();
  }

  /* ---------------------------------------------------------------- */
  /* Tools                                                             */
  /* ---------------------------------------------------------------- */

  setTool(tool: ToolId): void {
    const canvas = this.canvas;
    if (!canvas) return;
    this.cancelPolygon();
    // `pendingTable` is deliberately preserved: it is raised on mouse-up and
    // the tool resets to select immediately afterwards.
    this.setState({ tool, editingCell: null });
    if (tool === "freehand" && this.pencil) {
      canvas.isDrawingMode = true;
      canvas.freeDrawingBrush = this.pencil;
    } else {
      canvas.isDrawingMode = false;
    }
    canvas.selection = tool === "select";
    canvas.defaultCursor = tool === "select" ? "default" : "crosshair";
    canvas.forEachObject((o) => {
      o.selectable = tool === "select" && !this.isLocked(o);
      o.evented = tool === "select";
    });
    canvas.discardActiveObject();
    canvas.requestRenderAll();
    this.spanTarget = null;
    this.setSnaps([]);
    this.refresh();
  }

  private isLocked(o: FabricObject): boolean {
    return (o as unknown as { locked?: boolean }).locked === true;
  }

  /**
   * Leave a finished object selected, so the properties panel opens on
   * whatever was just drawn or typed.
   *
   * Both creation paths switch the tool back to `select`, and `setTool` ends
   * with `discardActiveObject()` plus a pass that clears `selectable` on every
   * object. Selecting before the switch therefore selected nothing: the text
   * box and each drawn shape came back deselected, and the panel that carries
   * the font, size and alignment controls was unreachable without a second
   * click somewhere else. `selectable`/`evented` are restored here because
   * `setTool` has just turned them off on this object too.
   */
  private selectFinished(o: FabricObject): void {
    const canvas = this.canvas;
    if (!canvas) return;
    o.set({ selectable: true, evented: true } as never);
    canvas.setActiveObject(o);
    canvas.requestRenderAll();
  }

  private getId(o: FabricObject): string {
    const id = (o as unknown as { id?: string }).id;
    return typeof id === "string" && id ? id : createId();
  }

  private tag(
    o: FabricObject,
    type: string,
    name?: string,
    role: string | null = null,
  ): void {
    o.set({
      id: createId(type.replace(/[^a-z]/gi, "")),
      name: name || defaultName(type, this.canvas?.getObjects().length ?? 0),
      role,
      // Stable discriminator: Fabric 7 lowercases `instance.type`, so a
      // rounded rect would otherwise be indistinguishable from a rect.
      appType: APP_TYPE_FOR[type] ?? type,
    } as never);
  }

  /* ---------------------------------------------------------------- */
  /* Pointer handling                                                  */
  /* ---------------------------------------------------------------- */

  // Panning is handled by the stage (a plain DOM scroll concern) rather than
  // here, so it can never be confused with Fabric's scene coordinates.
  /**
   * Sample the colour under the pointer and optionally paint the active
   * selection with it. The canvas's own lower layer carries the reference
   * image, so the sample matches what the user sees regardless of whether
   * anything has been traced yet.
   */
  private sampleColourAt(p: { x: number; y: number }): void {
    const canvas = this.canvas;
    if (!canvas) return;
    const vpt = canvas.viewportTransform;
    const el = canvas.lowerCanvasEl;
    const pxScaleX = el.width / Math.max(1, canvas.width);
    const pxScaleY = el.height / Math.max(1, canvas.height);
    const px = Math.round((p.x * vpt[0] + vpt[4]) * pxScaleX);
    const py = Math.round((p.y * vpt[3] + vpt[5]) * pxScaleY);
    try {
      const data = el
        .getContext("2d")!
        .getImageData(px, py, 1, 1).data;
      const hex = `#${[data[0], data[1], data[2]]
        .map((v) => v.toString(16).padStart(2, "0"))
        .join("")}`;
      const alive = this.lastSelected.filter((o) =>
        canvas.getObjects().includes(o),
      );
      if (alive.length === 1) {
        alive[0]!.set({ fill: hex } as never);
        this.commit("Set colour");
      }
      this.setState({ sampledColour: hex });
    } catch {
      /* reading pixels can fail in tainted-canvas setups; ignore */
    }
  }

  /**
   * Double-clicking a table cell opens it for editing in place.
   *
   * The inspector has always told the author to "double click a cell on the
   * canvas to edit it in place", but nothing listened for the double click: the
   * inline editor was mounted and unreachable. Only the select tool opens a
   * cell - a double click while drawing must not start editing text, or the
   * next stroke lands in a textarea.
   */
  private onMouseDblClick = (opt: TPointerEventInfo): void => {
    const table = opt.target;
    if (!(table instanceof BillTable)) return;
    if (this.state.tool !== "select") return;
    if (this.spaceHeld) return;

    const p = opt.scenePoint;
    const cell = table.cellAtCanvasPoint(p.x, p.y);
    if (!cell) return;

    this.beginCellEdit(table, cell.row * table.columns + cell.column);
  };

  private onMouseDown = (opt: TPointerEventInfo): void => {
    const canvas = this.canvas;
    if (!canvas) return;
    const p = opt.scenePoint;

    // A resize gesture and the anchor that pins it are armed together, above
    // the pan bail, because Fabric's Alt gesture is a *centred* scale that still
    // fires `object:scaling`: without a gesture the table falls back to
    // multiplying its already-resized widths by Fabric's scale, which compounds
    // every event, and without the anchor the handler has nothing to re-pin, so
    // the table walks off-canvas instead of growing from its top-left.
    // Arming on *every* table mouse-down rather than only a handle grab is safe
    // only because `resizeColumnsTo`/`resizeRowsTo` have a single production
    // caller and every real scaling event re-arms before using them. A caller
    // outside a scaling event would resize the grid during marquee selection,
    // moves and cell clicks, where nothing re-arms it.
    if (opt.target instanceof BillTable) {
      opt.target.beginResizeGesture({ x: p.x, y: p.y });
    }
    // Remember where the object sat before the gesture, so a resize can pin
    // its top-left corner instead of letting it drift.
    this.gestureAnchor = opt.target
      ? { left: opt.target.left ?? 0, top: opt.target.top ?? 0 }
      : null;
    this.lastKnownScenePoint = { x: p.x, y: p.y };

    // Clicking a grouped object selects the whole group, so a structure moves as
    // one the way it does in Word. Alt selects just that one member, which is
    // what keeps a single shape inside a group reachable; the explicit
    // re-selection is needed because Fabric would otherwise leave a standing
    // multi-selection untouched. Fabric moves and scales an `ActiveSelection`
    // as a unit, and no group geometry is stored anywhere.
    if (
      this.state.tool === "select" &&
      opt.target &&
      !(opt.target instanceof BillTable)
    ) {
      const group = this.state.groups.find((g) =>
        g.members.includes(this.getId(opt.target!)),
      );
      if (group) {
        const members = opt.e?.altKey
          ? [opt.target]
          : this.groupObjectsOf(group.id);
        if (members.length > 0) {
          canvas.discardActiveObject();
          canvas.setActiveObject(
            members.length === 1
              ? members[0]!
              : new ActiveSelection(members, { canvas }),
          );
          canvas.requestRenderAll();
          this.refresh();
          return;
        }
      }
    }

    if (this.spaceHeld || opt.e?.altKey) return;

    const tool = this.state.tool;
    if (tool === "select") return;

    if (tool === "eyedropper") {
      this.sampleColourAt(p);
      return;
    }

    this.drawOrigin = { x: p.x, y: p.y };
    this.spanTarget = null;

    switch (tool) {
      case "line":
      case "hr":
      case "vr": {
        // If the drag begins on a rect or rounded rect, the rule will be a
        // full-span divider of that shape — the editing apps (Word, Figma)
        // place a divider this way rather than asking for a freehand line at
        // the right length. Always every interception surface is tested, but
        // the innermost containing shape wins.
        if (this.state.fullSpanRules) {
          const hits = canvas
            .getObjects()
            .filter((o) => {
              const at = (o as unknown as { appType?: string }).appType;
              if (at !== "rect" && at !== "rounded-rect") return false;
              const b = o.getBoundingRect();
              return (
                p.x >= b.left &&
                p.x <= b.left + b.width &&
                p.y >= b.top &&
                p.y <= b.top + b.height
              );
            })
            .sort((a, b) => {
              const ra = a.getBoundingRect();
              const rb = b.getBoundingRect();
              return ra.width * ra.height - rb.width * rb.height;
            });
          this.spanTarget = hits[0] ?? null;
        }
        this.beginLine(tool);
        break;
      }
      case "rect":
      case "rounded-rect":
      case "ellipse":
        this.beginShape(tool);
        break;
      case "image-placeholder":
        this.beginImagePlaceholder();
        break;
      case "guide-h":
      case "guide-v":
        this.addGuide(tool === "guide-h" ? "horizontal" : "vertical", p);
        break;
      case "bill-part":
        this.beginBillPart();
        break;
      case "field":
        this.beginField();
        break;
      case "cell-field":
        this.beginCellField();
        break;
      case "table":
        // A zero-size sentinel raised on mouse-down so the canvas has
        // something to drag. `beginTableBox` then creates the real table, and
        // mouse-up replaces this with the box and the table's own id. The empty
        // id can never match a table, so an id-less prompt configures nothing
        // rather than the wrong object.
        this.setState({
          pendingTable: { id: "", x: p.x, y: p.y, width: 0, height: 0 },
        });
        this.beginTableBox();
        break;
      case "text": {
        const obj = new IText("Text", {
          left: p.x,
          top: p.y,
          fontFamily: "Arial",
          fontSize: 14,
          fill: "#000000",
        });
        this.tag(obj, "text");
        canvas.add(obj);
        this.commit("Add text");
        // Tool first, selection second: `setTool` clears the active object, so
        // selecting before the switch left the new box deselected and its font
        // and alignment controls out of reach.
        this.setTool("select");
        this.selectFinished(obj);
        break;
      }
      case "polygon":
        this.addPolygonVertex(p.x, p.y);
        break;
      case "freehand":
        // Handled by PencilBrush; recorded on mouse:up.
        break;
      default:
        break;
    }
  };

  private onMouseMove = (opt: TPointerEventInfo): void => {
    const canvas = this.canvas;
    if (!canvas) return;
    const p = opt.scenePoint;
    this.lastKnownScenePoint = { x: p.x, y: p.y };

    if (this.drawOrigin && this.drawing) {
      const dx = p.x - this.drawOrigin.x;
      const dy = p.y - this.drawOrigin.y;
      this.updateDrawing(dx, dy);
    } else if (this.state.tool === "polygon" && this.polygonPoints.length > 0) {
      this.updatePolygonGuide(p.x, p.y);
    }
  };

  private onMouseUp = (): void => {
    if (this.state.tool === "freehand" && this.canvas?.isDrawingMode) {
      // PencilBrush appends a path; normalise it so it exports cleanly.
      const paths = this.canvas.getObjects().filter(
        (o) => o.type === "path",
      );
      const last = paths[paths.length - 1];
      if (last) {
        this.tag(last, "freehand");
        this.normaliseFreehand(last);
        this.commit("Freehand");
      }
      return;
    }

    // Clearing moves and guides applies to every mouse-up, so it happens before
    // the drawing check — a selection move leaves no transient anything behind.
    this.spanTarget = null;
    this.setSnaps([]);

    if (!this.drawing) return;
    const obj = this.drawing;
    const box = this.finaliseDrawing();
    this.drawing = null;
    this.drawOrigin = null;

    if (!box) return;
    if (box.width < 2 && box.height < 2) {
      this.canvas?.remove(obj);
      this.canvas?.requestRenderAll();
      this.setState({ pendingTable: null });
      return;
    }

    const isTable =
      (obj as unknown as { appType?: string }).appType === "table";
    if ((obj as unknown as { appType?: string }).appType === "bill-part") {
      this.setTool("select");
      this.finishBillPart(obj, box);
      return;
    }
    if ((obj as unknown as { appType?: string }).appType === "cell-field") {
      this.setTool("select");
      this.finishCellField(obj, box);
      return;
    }
    if (isTable) {
      this.setState({
        pendingTable: {
          // The box drawn just now is what this prompt configures, so its id is
          // carried with it rather than left to be guessed from the canvas.
          id: this.getId(obj),
          x: box.x,
          y: box.y,
          width: box.width,
          height: box.height,
        },
      });
    }
    this.commit(isTable ? "Add table" : "Add shape");
    this.setTool("select");
    // Same reason as the text tool: the tool switch discards the selection, so
    // a freshly drawn rule, field or image slot has to be re-selected for its
    // panel to appear. A table still opens its rows/columns prompt instead.
    if (!isTable) this.selectFinished(obj);
  };

  private beginLine(tool: "line" | "hr" | "vr"): void {
    const canvas = this.canvas;
    if (!canvas || !this.drawOrigin) return;
    const o = this.drawOrigin;
    const line = new Line([o.x, o.y, o.x, o.y], {
      stroke: "#000000",
      strokeWidth: DEFAULT_STROKE_WIDTH,
      selectable: false,
      evented: false,
      originX: "left",
      originY: "top",
    });
    line.set({ x2: o.x, y2: o.y, ruleKind: tool } as never);
    this.tag(line, tool);
    canvas.add(line);
    this.drawing = line;
  }

  private beginShape(tool: "rect" | "rounded-rect" | "ellipse"): void {
    const canvas = this.canvas;
    if (!canvas || !this.drawOrigin) return;
    const o = this.drawOrigin;
    const common = {
      left: o.x,
      top: o.y,
      width: 1,
      height: 1,
      fill: "transparent",
      stroke: "#000000",
      strokeWidth: DEFAULT_STROKE_WIDTH,
      selectable: false,
      evented: false,
      // Fabric 7 positions objects from their centre by default; the whole
      // app uses top-left document coordinates, so be explicit.
      originX: "left" as const,
      originY: "top" as const,
    };
    const obj =
      tool === "ellipse"
        ? new Ellipse({ ...common, rx: 0.5, ry: 0.5 })
        : new Rect({
            ...common,
            rx: tool === "rounded-rect" ? 8 : 0,
            ry: tool === "rounded-rect" ? 8 : 0,
          });
    this.tag(obj, tool);
    canvas.add(obj);
    this.drawing = obj;
  }

  private beginImagePlaceholder(): void {
    const canvas = this.canvas;
    if (!canvas || !this.drawOrigin) return;
    const o = this.drawOrigin;
    const obj = new ImagePlaceholderObject({
      placeholderRole: "image",
      label: "IMAGE",
    });
    obj.set({
      left: o.x,
      top: o.y,
      width: 1,
      height: 1,
      selectable: false,
      evented: false,
    } as never);
    this.tag(obj, "image-placeholder", "Image Placeholder 1");
    canvas.add(obj);
    this.drawing = obj;
  }

  private beginBillPart(): void {
    const canvas = this.canvas;
    if (!canvas || !this.drawOrigin) return;
    const o = this.drawOrigin;
    const count = this.tracedObjects().filter(
      (x) => (x as unknown as { appType?: string }).appType === "bill-part",
    ).length;
    const obj = new BillPartObject();
    obj.set({
      left: o.x,
      top: o.y,
      width: 1,
      height: 1,
      selectable: false,
      evented: false,
    } as never);
    this.tag(obj, "bill-part", `Bill Part ${count + 1}`);
    canvas.add(obj);
    this.drawing = obj;
  }

  private beginField(): void {
    const canvas = this.canvas;
    if (!canvas || !this.drawOrigin) return;
    const o = this.drawOrigin;
    const count = this.tracedObjects().filter(
      (x) => (x as unknown as { appType?: string }).appType === "field",
    ).length;
    const key = `field_${count + 1}`;
    const obj = new FieldObject({
      key,
      fieldType: "text",
      label: `{{${key}}}`,
    });
    obj.set({
      left: o.x,
      top: o.y,
      width: 1,
      height: 1,
      selectable: false,
      evented: false,
    } as never);
    this.tag(obj, "field", `Field ${count + 1}`);
    canvas.add(obj);
    this.drawing = obj;
  }

  /**
   * The cell-field marker doubles as the Excel cell the author drew: draw it
   * empty and the tool creates the container box in the same gesture; draw it
   * inside an existing box and it binds there; draw it over a table cell and
   * the cell itself becomes the field.
   */
  private beginCellField(): void {
    const canvas = this.canvas;
    if (!canvas || !this.drawOrigin) return;
    const o = this.drawOrigin;
    const count = this.tracedObjects().filter(
      (x) => (x as unknown as { appType?: string }).appType === "cell-field",
    ).length;
    const key = `cell_${count + 1}`;
    const obj = new CellFieldObject({
      key,
      fieldType: "text",
      label: `{{${key}}}`,
    });
    obj.set({
      left: o.x,
      top: o.y,
      width: 1,
      height: 1,
      selectable: false,
      evented: false,
      // Growth opt-in: the slot grows downward with its value, bounded by the
      // page (the paginator carries the overflow to the next sheet).
      expansion: { y: { mode: "unbounded" } },
    } as never);
    this.tag(obj, "cell-field", `Cell field ${count + 1}`);
    canvas.add(obj);
    this.drawing = obj;
  }

  private beginTableBox(): void {
    const canvas = this.canvas;
    if (!canvas || !this.drawOrigin) return;
    const o = this.drawOrigin;
    const table = new BillTable({
      colWidths: [MIN_COL_WIDTH * 4, MIN_COL_WIDTH * 4],
      rowHeights: [MIN_ROW_HEIGHT * 3, MIN_ROW_HEIGHT * 3],
    });
    table.set({
      left: o.x,
      top: o.y,
      selectable: false,
      evented: false,
    } as never);
    // Named by how many tables already exist, so a second table does not start
    // life as a second "Table 1".
    this.tag(table, "table", this.nextTableName(), "items");
    canvas.add(table);
    this.drawing = table;
  }

  private updateDrawing(dx: number, dy: number): void {
    const obj = this.drawing;
    const origin = this.drawOrigin;
    if (!obj || !origin) return;
    const canvas = this.canvas;
    if (!canvas) return;

    const appType = (obj as unknown as { appType?: string }).appType;
    const ruleKind = (obj as unknown as { ruleKind?: string }).ruleKind;

    if (ruleKind === "line" || ruleKind === "hr" || ruleKind === "vr") {
      // A full-span rule: the drag started inside a rect or rounded rect, so
      // the line is drawn cleanly edge to edge of that shape, in whichever
      // direction the drag leans. Fabric recomputes width/height/position from
      // the coordinates on `.set`, so only the endpoints need writing.
      if (this.spanTarget) {
        const b = this.spanTarget.getBoundingRect();
        // Rule kinds force their axis; a plain "line" picks the dominant drag
        // direction.
        const horizontal =
          ruleKind === "hr" ||
          (ruleKind === "line" && Math.abs(dy) <= Math.abs(dx));
        if (horizontal) {
          // Full-span divider: from the shape's left edge to its right edge,
          // on the row where the drag began. Any drag horizontality just
          // confirms the axis; the span is always the whole width.
          obj.set({
            x1: b.left,
            y1: origin.y,
            x2: b.left + b.width,
            y2: origin.y,
          } as never);
          this.setSnaps([{ axis: "y", pos: origin.y }]);
        } else {
          obj.set({
            x1: origin.x,
            y1: b.top,
            x2: origin.x,
            y2: b.top + b.height,
          } as never);
          this.setSnaps([{ axis: "x", pos: origin.x }]);
        }
        obj.setCoords();
        canvas.requestRenderAll();
        return;
      }

      let x2 = origin.x + dx;
      let y2 = origin.y + dy;
      if (ruleKind === "hr") y2 = origin.y;
      if (ruleKind === "vr") x2 = origin.x;

      if (this.state.snapToObjects) {
        const tol = 6 / (this.state.zoom || 1);
        const levels = this.levelsForSnapTargets(obj);
        if (ruleKind === "hr") {
          const hit = snapToLevels(
            { left: origin.x, centreX: (origin.x + x2) / 2, right: x2, top: y2, centreY: y2, bottom: y2 },
            levels, tol,
          );
          if (hit.dy !== 0) y2 += hit.dy;
          if (hit.dx !== 0) x2 += hit.dx;
          this.setSnaps(hit.guides);
        } else if (ruleKind === "vr") {
          const hit = snapToLevels(
            { left: x2, centreX: x2, right: x2, top: origin.y, centreY: (origin.y + y2) / 2, bottom: y2 },
            levels, tol,
          );
          if (hit.dx !== 0) x2 += hit.dx;
          if (hit.dy !== 0) y2 += hit.dy;
          this.setSnaps(hit.guides);
        } else {
          const hit = snapToLevels(
            {
              left: Math.min(origin.x, x2),
              centreX: (origin.x + x2) / 2,
              right: Math.max(origin.x, x2),
              top: Math.min(origin.y, y2),
              centreY: (origin.y + y2) / 2,
              bottom: Math.max(origin.y, y2),
            },
            levels, tol,
          );
          if (hit.dx !== 0) x2 += hit.dx;
          if (hit.dy !== 0) y2 += hit.dy;
          this.setSnaps(hit.guides);
        }
      } else if (this.state.snaps.length > 0) {
        this.setSnaps([]);
      }
      obj.set({ x2, y2 } as never);
      obj.setCoords();
    } else if (appType === "table") {
      const table = obj as BillTable;
      const w = Math.abs(dx);
      const h = Math.abs(dy);
      table.colWidths = evenSizes(
        table.columns,
        Math.max(MIN_COL_WIDTH * 2, w),
        MIN_COL_WIDTH,
      );
      table.rowHeights = evenSizes(
        table.rows,
        Math.max(MIN_ROW_HEIGHT * 2, h),
        MIN_ROW_HEIGHT,
      );
      table.syncDimensions();
    } else {
      const w = Math.abs(dx);
      const h = Math.abs(dy);
      const left = dx < 0 ? origin.x + dx : origin.x;
      const top = dy < 0 ? origin.y + dy : origin.y;
      obj.set({ left, top, width: w, height: h } as never);
      // Fabric's Ellipse never back-derives rx/ry from width/height, so an
      // ellipse drawn here would keep rx = ry = 0 and paint nothing. Mirror
      // it explicitly on every resize, including the property-panel path
      // which reuses this logic.
      if (appType === "ellipse") {
        obj.set({ rx: w / 2, ry: h / 2 } as never);
      }
      obj.setCoords();
    }
    canvas.requestRenderAll();
  }

  /** Snap a newly drawn object to a sensible box and return it. */
  private finaliseDrawing(): { x: number; y: number; width: number; height: number } | null {
    const obj = this.drawing;
    if (!obj) return null;
    obj.set({ selectable: true, evented: true } as never);
    obj.setCoords();
    if (ruleKindOf(obj)) {
      const x2 = (obj as unknown as { x2?: number }).x2 ?? obj.left ?? 0;
      const y2 = (obj as unknown as { y2?: number }).y2 ?? obj.top ?? 0;
      const x1 = obj.left ?? 0;
      const y1 = obj.top ?? 0;
      return {
        x: Math.min(x1, x2),
        y: Math.min(y1, y2),
        width: Math.abs(x2 - x1),
        height: Math.abs(y2 - y1),
      };
    }
    return {
      x: obj.left ?? 0,
      y: obj.top ?? 0,
      width: obj.width ?? 0,
      height: obj.height ?? 0,
    };
  }

  /* ---------------------------------------------------------------- */
  /* Polygon                                                           */
  /* ---------------------------------------------------------------- */

  private finishCellField(
    obj: FabricObject,
    box: { x: number; y: number; width: number; height: number },
  ): void {
    const key = (obj as unknown as { key?: string }).key ?? "cell";
    const canvas = this.canvas;

    // 1. Bind to an enclosing rect/rounded-rect when the slot was drawn
    // inside one (containment with a small tolerance, innermost wins).
    const container = this.findEnclosingBoxContainer(obj, box, 12);
    if (container) {
      const rectId = this.getId(container);
      const existing = (container as unknown as { container?: unknown }).container;
      if (existing === undefined) {
        container.set({
          container: {
            enabled: true,
            growthX: "fixed",
            growthY: "content",
            padding: { top: 4, right: 4, bottom: 4, left: 4 },
          },
        } as never);
      }
      obj.set({
        containerId: rectId,
        layoutParentId: rectId,
        left: container.left + 4,
        top: container.top + 4,
        width: container.width - 8,
        height: container.height - 8,
      } as never);
      obj.setCoords();
      this.commit("Add cell field");
      this.selectFinished(obj);
      return;
    }

    // 2. Apply to the table cell under the slot's centre: the cell carries
    // the token, the table gains its growth policy, and the drawn marker is
    // consumed - a bound table cell needs no marker object of its own.
    const centreX = box.x + box.width / 2;
    const centreY = box.y + box.height / 2;
    if (this.applyCellFieldToTable(key, centreX, centreY)) {
      canvas?.remove(obj);
      this.commit("Add cell field");
      this.setTool("select");
      return;
    }

    // 3. Nothing underneath: the slot becomes its own Excel cell - the
    // container box is drawn in the same gesture and the two are bound.
    if (canvas) {
      const count = this.tracedObjects().filter(
        (x) => (x as unknown as { appType?: string }).appType === "cell-field",
      ).length;
      const rect = new Rect({
        left: box.x,
        top: box.y,
        width: box.width,
        height: box.height,
        fill: "transparent",
        stroke: "#000000",
        strokeWidth: DEFAULT_STROKE_WIDTH,
        rx: 0,
        ry: 0,
        originX: "left",
        originY: "top",
      });
      rect.set({
        container: {
          enabled: true,
          growthX: "fixed",
          growthY: "content",
          padding: { top: 4, right: 4, bottom: 4, left: 4 },
        },
      } as never);
      this.tag(rect, "rect", `Box ${count + 1}`);
      canvas.add(rect);
      obj.set({
        containerId: this.getId(rect),
        layoutParentId: this.getId(rect),
      } as never);
      obj.setCoords();
      canvas.requestRenderAll();
      this.commit("Add cell field");
      this.selectFinished(obj);
      return;
    }
    this.commit("Add cell field");
  }

  /**
   * The innermost rect/rounded-rect whose bounds contain the drawn box.
   *
   * Tolerance forgives a slot drawn hard against the frame; innermost wins
   * so nested boxes resolve to the box the author actually drew inside.
   */
  private findEnclosingBoxContainer(
    drawn: FabricObject,
    box: { x: number; y: number; width: number; height: number },
    tolerance: number,
  ): FabricObject | undefined {
    const canvas = this.canvas;
    if (!canvas) return undefined;
    const contains = (b: { left: number; top: number; width: number; height: number }): boolean =>
      box.x >= b.left - tolerance &&
      box.y >= b.top - tolerance &&
      box.x + box.width <= b.left + b.width + tolerance &&
      box.y + box.height <= b.top + b.height + tolerance;
    let best: FabricObject | undefined;
    let bestArea = Number.POSITIVE_INFINITY;
    for (const o of canvas.getObjects()) {
      if (o === drawn) continue;
      const kind = (o as unknown as { appType?: string }).appType ?? o.type;
      const kindName = typeof kind === "string" ? kind.toLowerCase() : "";
      if (kindName !== "rect" && kindName !== "rounded-rect") continue;
      const b = {
        left: o.left ?? 0,
        top: o.top ?? 0,
        width: o.width ?? 0,
        height: o.height ?? 0,
      };
      if (!contains(b)) continue;
      const area = b.width * b.height;
      if (area < bestArea) {
        best = o;
        bestArea = area;
      }
    }
    return best;
  }

  /**
   * Apply a cell field to the table cell containing (`cx`, `cy`).
   *
   * The band's data row carries the repeated value, so a drop inside a band
   * data row writes the band-prefixed token (`items.cell_1`); anywhere else
   * writes the plain token (`cell_1`). Either way the table opts into row
   * growth, which is what makes the cell behave like Excel's: the row grows
   * when the filled value wraps past the traced height.
   */
  private applyCellFieldToTable(key: string, cx: number, cy: number): boolean {
    const canvas = this.canvas;
    if (!canvas) return false;
    for (const o of canvas.getObjects()) {
      const appType = (o as unknown as { appType?: string }).appType;
      if (appType !== "table") continue;
      const left = o.left ?? 0;
      const top = o.top ?? 0;
      const width = o.width ?? 0;
      const height = o.height ?? 0;
      if (cx < left || cx > left + width || cy < top || cy > top + height) continue;

      const table = o as unknown as {
        columns: number;
        colWidths: number[];
        rowHeights: number[];
        cells: Array<{ text: string }>;
        repeat?: { key: string; startRow: number; endRow: number };
      };
      const columns = Math.max(1, table.columns);
      const colWidths = Array.isArray(table.colWidths) ? table.colWidths : [];
      const rowHeights = Array.isArray(table.rowHeights) ? table.rowHeights : [];

      let col = 0;
      let acc = left;
      for (const w of colWidths) {
        if (cx <= acc + w) break;
        acc += w;
        col += 1;
      }
      let row = 0;
      acc = top;
      for (const h of rowHeights) {
        if (cy <= acc + h) break;
        acc += h;
        row += 1;
      }
      row = Math.min(row, Math.max(0, rowHeights.length - 1));
      col = Math.min(col, Math.max(0, columns - 1));

      const band = table.repeat;
      const isBandDataRow = band !== undefined && row >= band.startRow;
      const token = isBandDataRow ? `{{${band.key}.${key}}}` : `{{${key}}}`;
      const index = row * columns + col;
      const cells = Array.isArray(table.cells) ? [...table.cells] : [];
      if (index < cells.length) {
        cells[index] = { ...cells[index]!, text: token };
      } else {
        cells[index] = { text: token };
      }
      o.set({
        cells,
        expansion: { y: { mode: "unbounded" } },
      } as never);
      o.setCoords();
      canvas.requestRenderAll();
      return true;
    }
    return false;
  }

  /* ---------------------------------------------------------------- */

  private finishBillPart(
    obj: FabricObject,
    box: { x: number; y: number; width: number; height: number },
  ): void {
    const canvas = this.canvas;
    if (!canvas || !this.reference) {
      canvas?.remove(obj);
      canvas?.requestRenderAll();
      this.refresh();
      return;
    }
    // Every canvas API below can throw — `getImageData` and `toDataURL` both
    // reject a canvas large enough to exhaust memory, and the browser can throw
    // from `drawImage` on a decoded-but-unpaintable source. A capture that
    // fails is a no-op, so it must take the placeholder down with it: the
    // alternative is a live 1x1 part the author believes they cut out. The
    // removal therefore happens after the capture, on the shared cleanup path.
    let crop: BillPartCrop | null = null;
    try {
      crop = cropBillPart(
        this.reference,
        this.state.document,
        {
          left: box.x,
          top: box.y,
          width: box.width,
          height: box.height,
        },
        { normalise: this.state.normaliseBillParts },
      );
    } catch {
      crop = null;
    }
    canvas.remove(obj);
    if (!crop) {
      canvas.requestRenderAll();
      this.refresh();
      return;
    }
    const next = new BillPartObject({
      src: crop.src,
      normalized: crop.normalized,
      sourceRect: crop.sourceRect,
      image: crop.image,
    });
    next.set({
      id: (obj as unknown as { id?: string }).id,
      name: (obj as unknown as { name?: string }).name,
      role: (obj as unknown as { role?: string }).role,
      // The crop is placed on the box the crop actually covers, which is the
      // drawn box clipped to the reference — not the raw drag, which can hang
      // off the edge. Scaling onto the unclipped box would stretch the crop.
      left: crop.rect.left,
      top: crop.rect.top,
      width: crop.width,
      height: crop.height,
      scaleX: crop.rect.width / crop.width,
      scaleY: crop.rect.height / crop.height,
      selectable: true,
      evented: true,
    } as never);
    canvas.add(next);
    this.commit("Add bill part");
    this.selectFinished(next);
  }

  private addPolygonVertex(x: number, y: number): void {
    const canvas = this.canvas;
    if (!canvas) return;
    this.polygonPoints.push({ x, y });
    this.addPolygonMarker(x, y);

    if (this.polygonPreview) {
      this.polygonPreview.set({ points: [...this.polygonPoints] } as never);
      this.polygonPreview.setCoords();
    } else {
      this.polygonPreview = new Polygon([...this.polygonPoints], {
        fill: "transparent",
        stroke: "#000000",
        strokeWidth: DEFAULT_STROKE_WIDTH,
        selectable: false,
        evented: false,
      });
      canvas.add(this.polygonPreview);
    }
    canvas.requestRenderAll();
  }

  /** Finish the polygon (Enter, double click, or the toolbar button). */
  finishPolygon(): void {
    const canvas = this.canvas;
    if (!canvas || this.polygonPoints.length < 2) {
      this.cancelPolygon();
      return;
    }
    const preview = this.polygonPreview;
    if (preview) {
      preview.set({ points: [...this.polygonPoints] } as never);
      preview.set({ fill: "rgba(0,0,0,0.05)" } as never);
      this.tag(preview, "polygon");
      preview.set({ selectable: true, evented: true } as never);
      preview.setCoords();
      this.commit("Add polygon");
    }
    this.clearPolygonMarkers();
    this.polygonPoints = [];
    this.polygonPreview = null;
    this.setTool("select");
  }

  cancelPolygon(): void {
    this.clearPolygonMarkers();
    if (this.polygonPreview) {
      this.canvas?.remove(this.polygonPreview);
      this.polygonPreview = null;
    }
    this.polygonPoints = [];
    this.canvas?.requestRenderAll();
  }

  /**
   * The overlays a polygon gesture needs to read as progress: a dot per placed
   * vertex and a dashed rubber band to the pointer. Without them a single
   * click draws one invisible point, so the tool looks like it did nothing.
   */
  private addPolygonMarker(x: number, y: number): void {
    const canvas = this.canvas;
    if (!canvas) return;
    const dot = new Circle({
      left: x,
      top: y,
      radius: 4 / this.state.zoom,
      originX: "center",
      originY: "center",
      fill: "#000000",
      strokeWidth: 0,
      selectable: false,
      evented: false,
    });
    dot.set({ appType: POLYGON_MARKER_APP_TYPE } as never);
    canvas.add(dot);
    this.polygonMarkers.push(dot);
  }

  /** Rubber band from the last placed vertex to the pointer. */
  private updatePolygonGuide(x: number, y: number): void {
    const canvas = this.canvas;
    const from = this.polygonPoints[this.polygonPoints.length - 1];
    if (!canvas || !from) return;
    if (this.polygonGuide) {
      this.polygonGuide.set({ x1: from.x, y1: from.y, x2: x, y2: y } as never);
      this.polygonGuide.setCoords();
    } else {
      this.polygonGuide = new Line([from.x, from.y, x, y], {
        stroke: "#000000",
        strokeWidth: 1 / this.state.zoom,
        strokeDashArray: [6 / this.state.zoom, 4 / this.state.zoom],
        selectable: false,
        evented: false,
      });
      this.polygonGuide.set({ appType: POLYGON_MARKER_APP_TYPE } as never);
      canvas.add(this.polygonGuide);
    }
    canvas.requestRenderAll();
  }

  private clearPolygonMarkers(): void {
    const canvas = this.canvas;
    for (const marker of this.polygonMarkers) canvas?.remove(marker);
    this.polygonMarkers = [];
    if (this.polygonGuide) {
      canvas?.remove(this.polygonGuide);
      this.polygonGuide = null;
    }
    canvas?.requestRenderAll();
  }

  get isDrawingPolygon(): boolean {
    return this.polygonPoints.length > 0;
  }

  /* ---------------------------------------------------------------- */
  /* Freehand                                                          */
  /* ---------------------------------------------------------------- */

  /**
   * PencilBrush emits absolute path coordinates. Shift them so the object's
   * own origin is its top-left, which is what the template format expects.
   */
  private normaliseFreehand(path: FabricObject): void {
    const raw = (path as unknown as { path?: Array<[number, number]> }).path;
    if (!Array.isArray(raw) || raw.length === 0) return;
    let minX = Infinity;
    let minY = Infinity;
    for (const [px, py] of raw) {
      minX = Math.min(minX, px);
      minY = Math.min(minY, py);
    }
    const shifted = raw.map(
      ([px, py], i) => (i === 0 ? ["M", px - minX, py - minY] : ["L", px - minX, py - minY]) as ["M" | "L", number, number],
    );
    const p = new Path(shifted, {
      fill: "",
      stroke: (path.stroke as string) || "#000000",
      strokeWidth: (path.strokeWidth as number) || DEFAULT_STROKE_WIDTH,
      strokeLineCap: "round",
      strokeLineJoin: "round",
    });
    p.set({ left: minX, top: minY } as never);
    (p as unknown as Record<string, unknown>).id = this.getId(path);
    (p as unknown as Record<string, unknown>).name = (
      path as unknown as { name?: string }
    ).name;
    (p as unknown as Record<string, unknown>).role = (
      path as unknown as { role?: string }
    ).role;
    p.setCoords();
    this.canvas?.remove(path);
    this.canvas?.add(p);
    this.canvas?.requestRenderAll();
  }

  /* ---------------------------------------------------------------- */
  /* Object events                                                     */
  /* ---------------------------------------------------------------- */

  private onObjectMoving = (opt: { target?: FabricObject }): void => {
    const target = opt.target;
    if (!target) return;
    if (this.state.snapToGrid) {
      const size = this.state.gridSize;
      target.set({
        left: snap(target.left ?? 0, size),
        top: snap(target.top ?? 0, size),
      } as never);
      target.setCoords();
    }
    // Object-to-object snapping: edges and centres of the moving object catch
    // nearby edges and centres of everything else, and the matching level is
    // announced as a guide line. A table is included: moving one only changes
    // `left`/`top`, which is ordinary Fabric geometry, and its columns and rows
    // are untouched.
    if (this.state.snapToObjects) {
      const b = target.getBoundingRect();
      const hit = snapToLevels(
        {
          left: b.left,
          centreX: b.left + b.width / 2,
          right: b.left + b.width,
          top: b.top,
          centreY: b.top + b.height / 2,
          bottom: b.top + b.height,
        },
        this.levelsForSnapTargets(target),
        6 / (this.state.zoom || 1),
      );
      if (hit.dx !== 0 || hit.dy !== 0) {
        target.set({
          left: (target.left ?? 0) + hit.dx,
          top: (target.top ?? 0) + hit.dy,
        } as never);
        target.setCoords();
      }
      this.setSnaps(hit.guides);
      this.canvas?.requestRenderAll();
    } else if (this.state.snaps.length > 0) {
      this.setSnaps([]);
      this.canvas?.requestRenderAll();
    }
  };

  /**
   * Collect the snap target levels for a scene point: the edges and centres of
   * every object except `exclude`. For an in-flight full-span rule the level
   * set is the same; the caller excludes the transient line.
   */
  private levelsForSnapTargets(exclude: FabricObject | null): Levels {
    const canvas = this.canvas;
    if (!canvas) return { x: [], y: [] };
    const boxes: Array<{
      left: number;
      top: number;
      right: number;
      bottom: number;
    }> = [];
    for (const o of canvas.getObjects()) {
      if (o === exclude) continue;
      const b = o.getBoundingRect();
      boxes.push({
        left: b.left,
        top: b.top,
        right: b.left + b.width,
        bottom: b.top + b.height,
      });
    }
    // Lines contribute their axis level rather than four edges, so a vertical
    // rule is a candidate x-level and a horizontal rule a candidate y-level.
    const ruleX: number[] = [];
    const ruleY: number[] = [];
    for (const o of canvas.getObjects()) {
      if (o === exclude) continue;
      const kind =
        (o as unknown as { appType?: string }).appType ?? o.type ?? "";
      if (kind === "hr") {
        const b = o.getBoundingRect();
        ruleY.push(b.top);
      } else if (kind === "vr") {
        const b = o.getBoundingRect();
        ruleX.push(b.left);
      }
    }
    const levels = levelsFromBounds(boxes);
    levels.x.push(...ruleX);
    levels.y.push(...ruleY);

    // A table's interior grid is a set of alignment lines like any other, so
    // its cell dividers join the candidate levels. Only the dividers are added:
    // the outer box already contributed its edges and centre above, and
    // repeating them would only widen the search. This is what lets a text box
    // or a rule line up with a column boundary instead of only the table's
    // outside.
    for (const o of canvas.getObjects()) {
      if (o === exclude || !(o instanceof BillTable)) continue;
      const b = o.getBoundingRect();
      const inner = interiorGridLevels(o.colWidths, o.rowHeights, {
        x: b.left,
        y: b.top,
      });
      levels.x.push(...inner.x);
      levels.y.push(...inner.y);
    }
    return levels;
  }

  /** Publishes active guide lines; no-op when the set is unchanged. */
  private setSnaps(snaps: SnapLine[]): void {
    const current = this.state.snaps;
    const unchanged =
      snaps.length === current.length &&
      snaps.every(
        (s, i) => s.axis === current[i]!.axis && s.pos === current[i]!.pos,
      );
    if (unchanged) return;
    this.setState({ snaps });
  }

  setSnapToObjects(on: boolean): void {
    this.setState({ snapToObjects: on });
  }

  setFullSpanRules(on: boolean): void {
    this.setState({ fullSpanRules: on });
  }

  setNormaliseBillParts(on: boolean): void {
    this.setState({ normaliseBillParts: on });
  }


  /**
   * `object:scaling` carries the raw DOM event rather than a scene point, and
   * `lastKnownScenePoint` can lag a frame behind on a fast drag, so the event is
   * the authority and the cached value is only a fallback.
   */
  private resolveScenePoint(
    e: TPointerEvent | undefined,
  ): { x: number; y: number } | null {
    const canvas = this.canvas;
    if (canvas && e) {
      const p = canvas.getScenePoint(e);
      if (Number.isFinite(p.x) && Number.isFinite(p.y)) {
        this.lastKnownScenePoint = { x: p.x, y: p.y };
        return this.lastKnownScenePoint;
      }
    }
    return this.lastKnownScenePoint;
  }

  private onObjectScaling = (opt: {
    target?: FabricObject;
    e?: TPointerEvent;
  }): void => {
    const target = opt.target;
    if (!target) return;

    const appType = (target as unknown as { appType?: string }).appType;
    if (appType === "table") {
      // A table is resized by changing its column widths, never by scaling,
      // so that the grid stays exact. The target size comes from the pointer's
      // displacement since mouse-down rather than from Fabric's scaleX: fabric
      // rebuilds that scale on every event as the live pointer position read
      // against the mouse-down origin, over the object's live transformed size,
      // so a table that grows its own width mid-drag hands fabric a different
      // divisor every event, and multiplying the current widths by the result
      // compounds.
      const table = target as BillTable;
      const gesture = table.resizeGesture;
      const p = this.resolveScenePoint(opt.e);
      if (gesture && p) {
        // Both target sizes are read off the gesture snapshot before either
        // axis is written, because each resize re-syncs the table's dimensions.
        const width = gesture.width + (p.x - gesture.startX) * gesture.signX;
        const height = gesture.height + (p.y - gesture.startY) * gesture.signY;
        table.set({
          left: this.gestureAnchor?.left ?? table.left,
          top: this.gestureAnchor?.top ?? table.top,
        } as never);
        table.resizeColumnsTo(width);
        table.resizeRowsTo(height);
      } else {
        // No gesture: fall back to the scale Fabric reports.
        const factorX = table.scaleX;
        const factorY = table.scaleY;
        table.scaleColumns(factorX);
        table.scaleRows(factorY);
      }
      // A table is never scaled, so both branches must leave the scale at 1.
      table.set({ scaleX: 1, scaleY: 1 } as never);
      table.setCoords();
      this.canvas?.requestRenderAll();
      return;
    }

    if (target instanceof BillPartObject) {
      const xFactor = target.scaleX ?? 1;
      const yFactor = target.scaleY ?? 1;
      const factor =
        Math.abs(xFactor - 1) >= Math.abs(yFactor - 1) ? xFactor : yFactor;
      target.set({ scaleX: factor, scaleY: factor } as never);
      target.setCoords();
    }

    if (this.state.snapToGrid) {
      const size = this.state.gridSize;
      target.set({
        left: snap(target.left ?? 0, size),
        top: snap(target.top ?? 0, size),
      } as never);
    }
    target.setCoords();
    // Resizing indicates alignment through guides but never forces the
    // geometry: fabric's own scale math and the table's column-resize path own
    // the correction. Matching levels are still announced. A table is included
    // because this branch only reads its bounding box to place the guides —
    // nothing below moves the object — so a table's resize shows the same
    // advisory guides as everything else without being nudged out from under
    // the pointer.
    if (this.state.snapToObjects) {
      const b = target.getBoundingRect();
      const hit = snapToLevels(
        {
          left: b.left,
          centreX: b.left + b.width / 2,
          right: b.left + b.width,
          top: b.top,
          centreY: b.top + b.height / 2,
          bottom: b.top + b.height,
        },
        this.levelsForSnapTargets(target),
        6 / (this.state.zoom || 1),
      );
      this.setSnaps(hit.guides);
      this.canvas?.requestRenderAll();
    } else if (this.state.snaps.length > 0) {
      this.setSnaps([]);
      this.canvas?.requestRenderAll();
    }
  };

  /**
   * A table cannot carry skew, so refuse it.
   *
   * Fabric's `altActionKey` is `shiftKey`, so Shift on a side handle routes to
   * the skew handlers and `object:scaling` never fires. The serialiser stores
   * `angle` but not `skewX`/`skewY`, so the skew would vanish on save and the
   * table would silently un-skew on reload; `skewObject` also inflates `scaleX`
   * to compensate for a skewed `skewX`, and a table must never carry a scale.
   * Undoing both leaves the drag resizing nothing, which is the honest outcome
   * until skew is either blocked upstream or supported end to end.
   */
  private onObjectSkewing = (opt: { target?: FabricObject }): void => {
    const target = opt.target;
    if (!(target instanceof BillTable)) return;
    target.set({ skewX: 0, skewY: 0, scaleX: 1, scaleY: 1 } as never);
    target.setCoords();
    this.canvas?.requestRenderAll();
  };

  private onObjectModified = (opt: { target?: FabricObject }): void => {
    // Close the resize gesture on the object that was actually transformed,
    // then write one history entry, so a whole drag is a single undo step.
if (opt.target instanceof BillTable) opt.target.endResizeGesture();
      else this.getTable()?.endResizeGesture();
      // A dragged guide is new template state, so it has to be read off the
      // canvas before the snapshot is taken - otherwise the undo entry records
      // the guide's old position and redoing it loses the move.
      if (opt.target && isGuide(opt.target)) this.syncGuides();
      this.lastKnownScenePoint = null;
      this.commit("Transform");
    };

  private onTextChanged = (opt: { target?: FabricObject }): void => {
    const target = opt.target;
    if (!target) return;
    const text = (target as unknown as { text?: string }).text ?? "";
    const info = analysePlaceholdersSafe(text);
    (target as unknown as Record<string, unknown>).roleKind = info.roleKind;
    if (info.role) {
      (target as unknown as Record<string, unknown>).role = info.role;
    }
  };

  private onSelectionChanged = (): void => {
    const active = this.canvas?.getActiveObjects();
    if (active && active.length > 0) {
      this.lastSelected = [...active];
    }
    this.refresh();
  };

  private onWheel = (opt: TPointerEventInfo<WheelEvent>): void => {
    const canvas = this.canvas;
    if (!canvas) return;
    const e = opt.e;
    // The stage is not a scroll container: panning is a drag gesture, so the
    // wheel is free to zoom like a photo editor, anchored at the cursor.
    // Ctrl/⌘ is accepted too, so browser page-zoom shortcuts do the same thing.
    e.preventDefault();
    e.stopPropagation();
    const delta = e.deltaY;
    const factor = 0.999 ** delta;
    this.zoomAt(
      { x: opt.viewportPoint.x, y: opt.viewportPoint.y },
      this.state.zoom * factor,
    );
  };

  /* ---------------------------------------------------------------- */
  /* History                                                           */
  /* ---------------------------------------------------------------- */

  /**
   * Drop a marking line at the click.
   *
   * The line spans the page rather than being dragged to a length, because a
   * boundary is not artwork: it is an infinite rule the bill is allowed to
   * push, and its length is a property of the page, not of the author.
   */
  private addGuide(
    orientation: "horizontal" | "vertical",
    at: { x: number; y: number },
  ): void {
    const canvas = this.canvas;
    if (!canvas) return;
    const existing = guidesFromObjects(canvas.getObjects());
    const guide: LayoutGuide = {
      id: nextGuideId(existing),
      orientation,
      position: orientation === "horizontal" ? at.y : at.x,
    };

    canvas.add(this.makeGuideOverlay(guide));
    this.syncGuides();
    this.commit("Add guide");
    this.setTool("select");
  }

  /**
   * Build the canvas line for a guide.
   *
   * Drawn across the page rather than dragged to a length, because a boundary
   * is not artwork: it is a rule the bill is allowed to push, and its extent is
   * a property of the page, not of the author.
   */
  private makeGuideOverlay(guide: LayoutGuide): Line {
    const { width, height } = this.state.document;
    const points: [number, number, number, number] =
      guide.orientation === "horizontal"
        ? [0, 0, width, 0]
        : [0, 0, 0, height];
    const line = new Line(points, {
      left: 0,
      top: guide.position,
      stroke: "#2563eb",
      strokeWidth: 1,
      strokeDashArray: [6, 4],
      strokeUniform: true,
      originX: "left",
      originY: "top",
      selectable: true,
      evented: true,
      hasControls: false,
      excludeFromExport: true,
    });
    this.tag(line, GUIDE_APP_TYPE, `Guide ${guide.id}`);
    line.set({
      guideId: guide.id,
      guideOrientation: guide.orientation,
      ...(guide.maxDisplacement !== undefined
        ? { guideMaxDisplacement: guide.maxDisplacement }
        : {}),
    } as never);
    return line;
  }

  /**
   * Put a template's guides back on the canvas when it is opened.
   *
   * No history entry and no state write: the layout already in `state` is the
   * authoritative record, and the overlays are its on-screen form.
   */
  private restoreGuides(guides: readonly LayoutGuide[]): void {
    const canvas = this.canvas;
    if (!canvas) return;
    for (const g of guides) canvas.add(this.makeGuideOverlay(g));
  }

  /**
   * Read the guides off the canvas into the template's layout block.
   *
   * Called after anything that could move one, so what a save writes is always
   * what the author can see.
   */
  private syncGuides(): void {
    const canvas = this.canvas;
    if (!canvas) return;
    const guides = guidesFromObjects(canvas.getObjects());
    this.setState({ layout: withLayoutMode(this.state.layout, guides) ?? undefined });
  }

  /**
   * Bill artwork only.
   *
   * A guide overlay is filtered out here rather than at the serialiser,
   * because this is also what undo snapshots and the render preview read: one
   * filter at the source of the list means every consumer downstream gets bill
   * artwork and cannot accidentally include a layout boundary.
   */
  private tracedObjects(): FabricObject[] {
    const canvas = this.canvas;
    if (!canvas) return [];
    return canvas.getObjects().filter((o) => !isGuide(o) && !isPolygonMarker(o));
  }

  /**
   * The undo payload. Groups ride along because a snapshot of geometry alone
   * would make a grouping change look like no change at all: `commit` would
   * record no history entry and `undo` would drop the grouping.
   */
  private snapshot(): string {
    const canvas = this.canvas;
    if (!canvas) return "";
    const template = serialiseObjects(
      this.tracedObjects() as never,
      this.state.document,
      this.state.documentName,
      this.state.layout,
    );
    if (this.state.placeholders.length > 0) {
      template.meta.placeholders = this.state.placeholders;
    }
    if (this.state.computedSpecs.length > 0) {
      template.meta.computed = this.state.computedSpecs;
    }
    return JSON.stringify({
      template,
      groups: this.state.groups,
    });
  }

  /**
   * State prior to the change currently being built. Set whenever the
   * document is (re)loaded and after every undo or redo.
   */
  private baseline: string | null = null;

  private markBaseline(): void {
    this.baseline = this.snapshot();
  }

  private restoreSnapshot(raw: string): void {
    const canvas = this.canvas;
    if (!canvas || !raw) return;
    let template: BillTemplate;
    let groups: GroupNode[] = [];
    try {
      const parsed = JSON.parse(raw) as {
        template?: BillTemplate;
        groups?: GroupNode[];
      } & BillTemplate;
      // A history entry written before groups existed is a bare template.
      template = (parsed.template ?? parsed) as BillTemplate;
      groups = Array.isArray(parsed.groups) ? parsed.groups : [];
      if (
        !template ||
        typeof template !== "object" ||
        !Array.isArray(template.objects) ||
        !template.document ||
        typeof template.document.width !== "number" ||
        typeof template.document.height !== "number"
      ) {
        return;
      }
    } catch {
      // A corrupted history entry must not take the undo/redo pass down.
      return;
    }
    this.suppressHistory = true;
    canvas.discardActiveObject();
    for (const o of this.tracedObjects()) canvas.remove(o);
    const objects = hydrateTemplate(template);
    for (const o of objects) canvas.add(o);
    this.refreshStrokeFloors();
    canvas.requestRenderAll();
    this.suppressHistory = false;
    this.setState({
      editingCell: null,
      pendingTable: null,
      document: { ...template.document },
      placeholders: normalisePlaceholderSpecs(template.meta?.placeholders),
      computedSpecs: Array.isArray(template.meta?.computed) ? template.meta.computed : [],
      groups,
      // The snapshot carries the layout block, so undo and redo restore it
      // along with the geometry. Without this an undo would leave the rules on
      // the objects but drop them from the document, and the next save would
      // write a template whose guides no longer match its fields.
      layout: template.layout,
    });
    this.lockReferenceToDocument();
    this.applyCanvasSize();
    // The document size may have changed, so re-clamp the view to the page.
    this.panBy(0, 0);
    this.refresh();
  }

  /** Record the change that was just made and make it undoable. */
  commit(label: string): void {
    if (this.suppressHistory) return;
    const canvas = this.canvas;
    if (!canvas) return;
    const after = this.snapshot();
    const before = this.baseline;
    this.baseline = after;
    // The very first commit has nothing to undo to yet.
    if (before !== null && before !== after) {
      this.history.push({ label, before, after });
    }
    this.setState({ canUndo: this.history.canUndo, canRedo: this.history.canRedo });
    this.refresh();
  }

  undo(): void {
    const entry = this.history.undo();
    if (!entry) return;
    this.restoreSnapshot(entry.before);
    this.baseline = this.snapshot();
    this.setState({
      canUndo: this.history.canUndo,
      canRedo: this.history.canRedo,
    });
  }

  redo(): void {
    const entry = this.history.redo();
    if (!entry) return;
    this.restoreSnapshot(entry.after);
    this.baseline = this.snapshot();
    this.setState({
      canUndo: this.history.canUndo,
      canRedo: this.history.canRedo,
    });
  }

  /* ---------------------------------------------------------------- */
  /* Selection operations                                              */
  /* ---------------------------------------------------------------- */

  getGroups(): GroupNode[] {
    return this.state.groups;
  }

  /**
   * Converts the selected text object between auto-width and wrapping.
   *
   * Fabric's `IText` has no wrap boundary — `width` is not one of its layout
   * properties and is discarded on the next layout pass — so this is a real
   * object swap rather than a flag. Identity, styling and scale are carried
   * across, and the swap is one undoable step.
   */
  setTextWrap(on: boolean): void {
    const canvas = this.canvas;
    if (!canvas) return;
    const source = this.getActiveObjects().find(
      (o): o is IText | Textbox =>
        !this.isLocked(o) && (o instanceof IText || o instanceof Textbox),
    );
    if (!source) return;
    const asTextbox = on && !(source instanceof Textbox);
    const asText = !on && source instanceof Textbox;
    if (!asTextbox && !asText) return;

    const shared = {
      left: source.left,
      top: source.top,
      fontFamily: source.fontFamily,
      fontSize: source.fontSize,
      fontWeight: source.fontWeight,
      fontStyle: source.fontStyle,
      textAlign: source.textAlign,
      lineHeight: source.lineHeight,
      charSpacing: source.charSpacing,
      fill: source.fill,
      stroke: source.stroke,
      strokeWidth: source.strokeWidth,
      scaleX: source.scaleX,
      scaleY: source.scaleY,
    };
    const next: IText | Textbox = asTextbox
      ? new Textbox(source.text, {
          ...shared,
          // Start at the natural single-line width so nothing reflows at the
          // moment of the toggle; the author then narrows it to wrap.
          width: source.width,
        })
      : new IText(source.text, shared);

    const carried = source as unknown as Record<string, unknown>;
    const nextCarried = next as unknown as Record<string, unknown>;
    for (const key of [
      "id",
      "name",
      "role",
      "roleKind",
      "locked",
      "zIndex",
      "parentId",
      "visible",
      "opacity",
    ]) {
      nextCarried[key] = carried[key];
    }
    nextCarried.appType = "text";
    nextCarried.wrapWidth = asTextbox ? source.width : undefined;
    next.set({
      selectable: true,
      evented: true,
      angle: source.angle,
    } as never);

    canvas.remove(source);
    canvas.add(next);
    next.setCoords();
    canvas.setActiveObject(next);
    canvas.requestRenderAll();
    this.commit(on ? "Wrap text" : "Stop wrapping");
    this.refresh();
  }

  /** Fabric objects in `groupId`'s subtree, including nested groups. */
  groupObjectsOf(groupId: string): FabricObject[] {
    const canvas = this.canvas;
    if (!canvas) return [];
    const ids = new Set(subtreeIds(groupId, this.state.groups));
    const wanted = new Set<string>();
    for (const g of this.state.groups) {
      if (!ids.has(g.id)) continue;
      for (const m of g.members) wanted.add(m);
    }
    return canvas.getObjects().filter((o) => wanted.has(this.getId(o)));
  }

  groupSelection(): void {
    if (!this.canvas) return;
    const targets = this.getActiveObjects().filter((o) => !this.isLocked(o));
    if (targets.length < 2) return;
    const ids = targets.map((o) => this.getId(o));
    const name = `Group ${this.state.groups.length + 1}`;
    const next = groupObjectsIn(ids, createId("grp"), name, this.state.groups);
    this.setState({ groups: next });
    this.commit("Group");
  }

  ungroupSelection(): void {
    if (!this.canvas) return;
    const target = this.state.groups.find((g) =>
      this.getActiveObjects().some((o) => g.members.includes(this.getId(o))),
    );
    if (!target) return;
    this.setState({ groups: ungroupIn(target.id, this.state.groups) });
    this.commit("Ungroup");
  }

  getActiveObjects(): FabricObject[] {
    const canvas = this.canvas;
    if (!canvas) return [];
    const active = canvas.getActiveObject();
    if (!active) return [];
    if (active instanceof ActiveSelection) return active.getObjects();
    return [active];
  }

  deleteSelection(): void {
    const canvas = this.canvas;
    if (!canvas) return;
    // A group node is authoring state, so deleting one removes the group and
    // leaves its objects on the canvas. Word deletes the contents too, but
    // silently destroying traced geometry on a mis-click is the wrong default
    // for a tracing tool.
    const groupIds = new Set<string>();
    const objects: FabricObject[] = [];
    const droppedGuides = new Set<string>();
    for (const o of this.getActiveObjects()) {
      const id = this.getId(o);
      for (const g of this.state.groups) {
        if (g.members.includes(id)) groupIds.add(g.id);
      }
      if (isGuide(o)) {
        // Removing a boundary must also drop what hung off it. An attachment
        // pointing at a guide that no longer exists is a dangling reference the
        // solver would have to guess about, and the object's edge would silently
        // stop following anything.
        const guideId = (o as unknown as { guideId?: string }).guideId;
        if (typeof guideId === "string") droppedGuides.add(guideId);
      }
      if (!this.isLocked(o)) objects.push(o);
    }
    if (groupIds.size === 0 && objects.length === 0) return;
    canvas.discardActiveObject();
    // Children naming a deleted container must not keep pointing at it: a
    // `layoutParentId` with no object behind it fails validation on the next
    // save, so the link is cleared while the intent (anchor) is kept.
    const removedIds = new Set(objects.map((o) => this.getId(o)));
    for (const o of canvas.getObjects()) {
      const rec = o as unknown as { layoutParentId?: unknown };
      if (typeof rec.layoutParentId === "string" && removedIds.has(rec.layoutParentId)) {
        o.set({ layoutParentId: null } as never);
      }
    }
    for (const o of objects) this.removeRecursive(o);
    const survivors = this.state.groups.filter((g) => !groupIds.has(g.id));
    this.setState({
      groups: pruneGroups(
        canvas.getObjects().map((o) => this.getId(o)),
        survivors,
      ),
    });
    // Read the surviving guides back rather than subtracting the deleted ones:
    // the canvas already knows what is left, and this keeps a mixed delete of
    // artwork and guides from having two sources of truth.
    if (objects.some(isGuide)) {
      const guides = guidesFromObjects(canvas.getObjects());
      const attachments = (this.state.layout?.attachments ?? []).filter(
        (a) => !droppedGuides.has(a.guideId),
      );
      const next = withLayoutMode(this.state.layout, guides);
      this.setState({
        layout:
          next && attachments.length > 0 ? { ...next, attachments } : next,
      });
    }
    canvas.requestRenderAll();
    this.commit(
      objects.length > 1 ? "Delete objects" : "Delete object",
    );
  }

  private removeRecursive(o: FabricObject): void {
    const canvas = this.canvas;
    if (!canvas) return;
    if (o instanceof BillTable || o instanceof ImagePlaceholderObject) {
      canvas.remove(o);
      return;
    }
    const group = o as unknown as { getObjects?: () => FabricObject[] };
    if (typeof group.getObjects === "function") {
      for (const child of group.getObjects()) this.removeRecursive(child);
    }
    canvas.remove(o);
  }

  duplicateSelection(): void {
    const canvas = this.canvas;
    if (!canvas) return;
    const targets = this.getActiveObjects().filter(
      (o) => !this.isLocked(o),
    );
    if (targets.length === 0) return;
    const clones: FabricObject[] = [];
    for (const o of targets) {
      o.clone().then((clone) => {
        if (!clone) return;
        clone.set({
          left: (clone.left ?? 0) + 12,
          top: (clone.top ?? 0) + 12,
        } as never);
        (clone as unknown as Record<string, unknown>).id = createId();
        (clone as unknown as Record<string, unknown>).name = `${(o as unknown as { name?: string }).name ?? "Object"} copy`;
        canvas.add(clone);
        clones.push(clone);
        canvas.requestRenderAll();
        if (clones.length === targets.length) {
          if (clones.length === 1) {
            canvas.setActiveObject(clones[0]!);
          } else {
            canvas.setActiveObject(
              new ActiveSelection(clones, { canvas }),
            );
          }
          this.commit("Duplicate");
        }
      });
    }
  }

  selectAll(): void {
    const canvas = this.canvas;
    if (!canvas) return;
    const objs = this.tracedObjects().filter((o) => !this.isLocked(o));
    if (objs.length === 0) return;
    if (objs.length === 1) {
      canvas.setActiveObject(objs[0]!);
      canvas.requestRenderAll();
      this.refresh();
      return;
    }
    // Fabric's multi-selection layout rebases every child transform into the
    // selection's own space, and that rebase reads through the viewport: with
    // the page panned or zoomed, entering a multi-selection rewrites each
    // child's left/top with screen-space numbers, so the saved template (and
    // the print) inherit coordinates the sheet never had. Grouping here is
    // metadata - the selection is transient - so each child's transform is
    // saved before selection and restored after, keeping scene coordinates
    // exactly as authored.
    const before = objs.map((o) => ({
      o,
      left: o.left,
      top: o.top,
      scaleX: o.scaleX,
      scaleY: o.scaleY,
      angle: o.angle,
    }));
    canvas.setActiveObject(new ActiveSelection(objs, { canvas }));
    for (const saved of before) {
      const o = saved.o;
      if (
        o.left !== saved.left ||
        o.top !== saved.top ||
        o.scaleX !== saved.scaleX ||
        o.scaleY !== saved.scaleY ||
        o.angle !== saved.angle
      ) {
        o.set({
          left: saved.left,
          top: saved.top,
          scaleX: saved.scaleX,
          scaleY: saved.scaleY,
          angle: saved.angle,
        });
        o.setCoords();
      }
    }
    canvas.requestRenderAll();
    this.refresh();
  }

  /* ---------------------------------------------------------------- */
  /* Alignment                                                         */
  /* ---------------------------------------------------------------- */

  private selectionBounds(): {
    left: number;
    top: number;
    width: number;
    height: number;
  } | null {
    const objects = this.getActiveObjects();
    if (objects.length === 0) return null;
    if (objects.length === 1) {
      const o = objects[0]!;
      return {
        left: o.left ?? 0,
        top: o.top ?? 0,
        width: o.getScaledWidth(),
        height: o.getScaledHeight(),
      };
    }
    let left = Infinity;
    let top = Infinity;
    let right = -Infinity;
    let bottom = -Infinity;
    for (const o of objects) {
      const b = o.getBoundingRect();
      left = Math.min(left, b.left);
      top = Math.min(top, b.top);
      right = Math.max(right, b.left + b.width);
      bottom = Math.max(bottom, b.top + b.height);
    }
    return { left, top, width: right - left, height: bottom - top };
  }

  align(kind: "left" | "center" | "right" | "top" | "middle" | "bottom"): void {
    const objects = this.getActiveObjects();
    if (objects.length === 0) return;
    const bounds = this.selectionBounds();
    if (!bounds) return;
    for (const o of objects) {
      const w = o.getScaledWidth();
      const h = o.getScaledHeight();
      switch (kind) {
        case "left":
          o.set({ left: bounds.left } as never);
          break;
        case "center":
          o.set({ left: bounds.left + (bounds.width - w) / 2 } as never);
          break;
        case "right":
          o.set({ left: bounds.left + bounds.width - w } as never);
          break;
        case "top":
          o.set({ top: bounds.top } as never);
          break;
        case "middle":
          o.set({ top: bounds.top + (bounds.height - h) / 2 } as never);
          break;
        case "bottom":
          o.set({ top: bounds.top + bounds.height - h } as never);
          break;
      }
      o.setCoords();
    }
    this.canvas?.requestRenderAll();
    this.commit(`Align ${kind}`);
  }

  distribute(axis: "horizontal" | "vertical"): void {
    const objects = this.getActiveObjects();
    if (objects.length < 3) return;
    const horizontal = axis === "horizontal";
    const key = horizontal ? "left" : "top";
    const sizeKey = horizontal ? "getScaledWidth" : "getScaledHeight";

    const sorted = [...objects].sort(
      (a, b) => (a[key] ?? 0) - (b[key] ?? 0),
    );
    const first = sorted[0]!;
    const last = sorted[sorted.length - 1]!;
    const start = first[key] ?? 0;
    const end = (last[key] ?? 0) + last[sizeKey]();
    const totalSize = sorted.reduce((acc, o) => acc + o[sizeKey](), 0);
    const gap = (end - start - totalSize) / (sorted.length - 1);

    let cursor = start;
    for (const o of sorted) {
      o.set({ [key]: cursor } as never);
      cursor += o[sizeKey]() + gap;
      o.setCoords();
    }
    this.canvas?.requestRenderAll();
    this.commit(`Distribute ${axis}`);
  }

  /* ---------------------------------------------------------------- */
  /* Layer ordering                                                    */
  /* ---------------------------------------------------------------- */

  moveLayer(id: string, direction: "up" | "down" | "front" | "back"): void {
    const canvas = this.canvas;
    if (!canvas) return;
    const target = canvas
      .getObjects()
      .find((o) => this.getId(o) === id);
    if (!target) return;
    if (direction === "up") canvas.bringObjectForward(target);
    if (direction === "down") canvas.sendObjectBackwards(target);
    if (direction === "front") canvas.bringObjectToFront(target);
    if (direction === "back") {
      canvas.sendObjectToBack(target);
    }
    canvas.requestRenderAll();
    this.commit("Reorder");
  }

  /* ---------------------------------------------------------------- */
  /* Table specifics                                                   */
  /* ---------------------------------------------------------------- */

  /** Create the table once the user confirms rows/columns. */
  confirmTable(rows: number, columns: number): BillTable | null {
    const pending = this.state.pendingTable;
    const canvas = this.canvas;
    if (!pending || !canvas) return null;

    // The table that was dragged out, identified by the id captured on mouse-up.
    // This used to be "the first BillTable on the canvas", which meant a second
    // table's prompt reconfigured the first table instead of the new one.
    const table = canvas.getObjects().find(
      (o): o is BillTable => o instanceof BillTable && this.getId(o) === pending.id,
    );

    const r = Math.max(1, Math.min(60, Math.round(rows)));
    const c = Math.max(1, Math.min(30, Math.round(columns)));

    let target: BillTable;
    if (table) {
      // Reshaped: keep this table's identity, name and position.
      table.colWidths = evenSizes(c, pending.width, MIN_COL_WIDTH);
      table.rowHeights = evenSizes(r, pending.height, MIN_ROW_HEIGHT);
      table.headerRow = r > 1;
      table.syncDimensions();
      target = table;
    } else {
      // The placeholder is gone — undo, a template load or a resize removed it
      // while the prompt was open. Build a fresh table rather than adopting an
      // unrelated one, which would silently reconfigure whatever was found.
      target = new BillTable({
        colWidths: evenSizes(c, Math.max(120, pending.width), MIN_COL_WIDTH),
        rowHeights: evenSizes(r, Math.max(80, pending.height), MIN_ROW_HEIGHT),
      });
      target.set({
        left: pending.x,
        top: pending.y,
        selectable: true,
        evented: true,
      } as never);
      this.tag(target, "table", this.nextTableName(), "items");
      canvas.add(target);
    }

    this.setState({ pendingTable: null });
    canvas.setActiveObject(target);
    canvas.requestRenderAll();
    this.commit("Create table");
    return target;
  }

  /**
   * The next table's default name.
   *
   * Numbered by how many tables already exist, so a second table is not also
   * called "Table 1" — the layers panel and the template both list names, and
   * two identical ones make either unusable.
   */
  private nextTableName(): string {
    const existing = (
      this.canvas?.getObjects() ?? []
    ).filter((o) => o instanceof BillTable).length;
    return `Table ${existing + 1}`;
  }

  cancelPendingTable(): void {
    const canvas = this.canvas;
    const pending = this.state.pendingTable;
    // The dragged box is discarded with the prompt. Leaving the placeholder on
    // the canvas would be a default-sized table the user never asked for, and it
    // would still be in the template.
    if (canvas && pending?.id) {
      const stale = canvas
        .getObjects()
        .find(
          (o): o is BillTable =>
            o instanceof BillTable && this.getId(o) === pending.id,
        );
      if (stale) {
        canvas.remove(stale);
        canvas.requestRenderAll();
        this.commit("Cancel table");
      }
    }
    this.setState({ pendingTable: null });
  }

  /** Begin inline cell editing on the given table. */
  beginCellEdit(table: BillTable, index: number): void {
    table.editingCell = index;
    this.setState({
      editingCell: { tableId: this.getId(table), index },
    });
    this.canvas?.requestRenderAll();
  }

  updateCell(table: BillTable, index: number, text: string): void {
    const cols = table.columns;
    const row = Math.floor(index / cols);
    const column = index % cols;
    table.setCellText(row, column, text);
    table.editingCell = index;
    this.canvas?.requestRenderAll();
    this.markCellDirty(table);
  }

  endCellEdit(table: BillTable): void {
    table.editingCell = -1;
    this.setState({ editingCell: null });
    this.canvas?.requestRenderAll();
    this.markCellDirty(table);
  }

  private cellDirty = new WeakSet<FabricObject>();
  private cellDirtyTimer: ReturnType<typeof setTimeout> | null = null;
  private readyPromise: Promise<void> | null = null;
  private readyResolvers: Array<() => void> = [];

  /** Coalesce rapid keystrokes into a single undo entry. */
  private markCellDirty(table: BillTable): void {
    if (this.cellDirty.has(table)) return;
    this.cellDirty.add(table);
    if (this.cellDirtyTimer) clearTimeout(this.cellDirtyTimer);
    this.cellDirtyTimer = setTimeout(() => {
      this.cellDirty.delete(table);
      this.cellDirtyTimer = null;
      this.commit("Edit cell");
    }, 600);
  }

  /* ---------------------------------------------------------------- */
  /* Property updates                                                  */
  /* ---------------------------------------------------------------- */

  applyToSelection(fn: (o: FabricObject) => void, label = "Edit object"): void {
    const objects = this.getActiveObjects();
    if (objects.length === 0) return;
    for (const o of objects) {
      fn(o);
      o.setCoords();
    }
    this.canvas?.requestRenderAll();
    this.commit(label);
  }

  /**
   * Edit the template's layout block.
   *
   * Separate from `applyToSelection` because guides and attachments are template
   * -level facts, not per-object Fabric properties: a guide is not an object you
   * can select, and an attachment names two things at once. Kept as one
   * mutate-and-commit so every layout edit lands in history like any other.
   */
  updateLayout(
    mutate: (layout: LayoutConfig | undefined) => LayoutConfig | undefined,
    label = "Edit layout",
  ): void {
    this.setState({ layout: mutate(this.state.layout) });
    this.commit(label);
  }

  /** Record an object's per-axis growth policy. */
  setExpansion(
    objectId: string,
    expansion: ObjectExpansion | undefined,
    label = "Expansion",
  ): void {
    const target = this.canvas?.getObjects().find((o) => this.getId(o) === objectId);
    if (!target) return;
    target.set({ expansion } as never);
    target.setCoords();
    this.canvas?.requestRenderAll();
    this.commit(label);
  }

  /**
   * Name the layout container an object belongs to, or clear it with `null`.
   *
   * Distinct from editor groups: this is the `layoutParentId` the solver
   * reads, not `parentId`. Refuses self-parenting and unknown ids rather than
   * writing a link the validator would reject on the next save.
   */
  setLayoutParent(objectId: string, parentId: string | null, label = "Layout parent"): void {
    const target = this.canvas?.getObjects().find((o) => this.getId(o) === objectId);
    if (!target) return;
    if (parentId !== null) {
      if (parentId === objectId) return;
      const exists = this.canvas?.getObjects().some((o) => this.getId(o) === parentId);
      if (!exists) return;
    }
    target.set({ layoutParentId: parentId } as never);
    target.setCoords();
    this.canvas?.requestRenderAll();
    this.commit(label);
  }

  /** Record a child's anchor inside its layout parent. */
  setAnchor(
    objectId: string,
    anchor: ChildAnchor | undefined,
    label = "Anchor",
  ): void {
    const target = this.canvas?.getObjects().find((o) => this.getId(o) === objectId);
    if (!target) return;
    target.set({ anchor } as never);
    target.setCoords();
    this.canvas?.requestRenderAll();
    this.commit(label);
  }

  /** Record a shape's opt-in container policy. */
  setContainer(
    objectId: string,
    container: ContainerPolicy | undefined,
    label = "Container",
  ): void {
    const target = this.canvas?.getObjects().find((o) => this.getId(o) === objectId);
    if (!target) return;
    target.set({ container } as never);
    target.setCoords();
    this.canvas?.requestRenderAll();
    this.commit(label);
  }

  /**
   * Candidate layout parents for the hierarchy picker: every traced object
   * except guides, so a child can name any frame including a nested one.
   * The picker filters out the object itself; validation rejects the rest.
   */
  listLayoutParents(exceptId?: string): { id: string; name: string }[] {
    const canvas = this.canvas;
    if (!canvas) return [];
    const out: { id: string; name: string }[] = [];
    for (const o of canvas.getObjects()) {
      if (isGuide(o)) continue;
      const id = this.getId(o);
      if (!id || id === exceptId) continue;
      const rec = o as unknown as { name?: unknown };
      out.push({ id, name: typeof rec.name === "string" && rec.name ? rec.name : id });
    }
    return out.sort((a, b) => a.name.localeCompare(b.name));
  }

  /**
   * Attach one edge of an object to a guide, or detach it with `null`.
   *
   * `behaviorOrLabel` accepts either the follow behavior or, for callers
   * written before the behavior control existed, a history label — so an old
   * `setAttachment(id, edge, guide, "My label")` keeps labelling history
   * instead of being read as a behavior.
   */
  setAttachment(
    objectId: string,
    edge: AttachmentEdge,
    guideId: string | null,
    behaviorOrLabel: AttachmentBehavior | string = "move",
    label = "Attachment",
  ): void {
    const behavior: AttachmentBehavior =
      behaviorOrLabel === "stretch" ? "stretch" : "move";
    const historyLabel =
      behaviorOrLabel === "move" || behaviorOrLabel === "stretch"
        ? label
        : behaviorOrLabel;
    this.updateLayout((layout) => {
      const guides = layout?.guides ?? [];
      // Re-targeting an edge replaces whatever it pointed at: one edge can
      // only follow one guide, and leaving the old row behind would let the
      // same edge be claimed twice with no way to tell which wins.
      const others = (layout?.attachments ?? []).filter(
        (a) => !(a.objectId === objectId && a.edge === edge),
      );
      const attachments = guideId
        ? [
            ...others,
            {
              id: `att-${objectId}-${edge}`,
              objectId,
              edge,
              guideId,
              behavior: behavior === "stretch" ? ("stretch" as const) : ("move" as const),
            },
          ]
        : others;
      const base = withLayoutMode(layout, guides);
      if (!base) return undefined;
      // No attachments left means no layout block: a template that grew a guide
      // and then detached from it should close back up to fixed layout rather
      // than carry an empty list that a renderer has to special-case.
      return attachments.length > 0 ? { ...base, attachments } : undefined;
    }, historyLabel);
  }

  /** Live update during a slider drag: no history entry per frame. */
  previewSelection(fn: (o: FabricObject) => void): void {
    const objects = this.getActiveObjects();
    for (const o of objects) {
      fn(o);
      o.setCoords();
    }
    this.canvas?.requestRenderAll();
  }

  /** The table on the canvas, if one exists. */
  getTable(): BillTable | null {
    return (
      this.canvas?.getObjects().find(
        (o): o is BillTable =>
          (o as unknown as { appType?: string }).appType === "table",
      ) ?? null
    );
  }

  /**
   * The table an id names.
   *
   * Cell editing addresses a cell by `{ tableId, index }`, so every consumer of
   * that pair has to resolve the table it belongs to. Taking the *first* table
   * on the canvas instead would edit the wrong one as soon as a page carried
   * two tables - and it fails silently, because the text the author typed does
   * appear, just in the wrong row.
   */
  getTableById(tableId: string): BillTable | null {
    return (
      this.canvas
        ?.getObjects()
        .find(
          (o): o is BillTable =>
            (o as unknown as { appType?: string }).appType === "table" &&
            (o as unknown as { id?: string }).id === tableId,
        ) ?? null
    );
  }

  /**
   * Mutate the document's table through a callback. The properties panel
   * uses this so the canvas object is never mutated directly from React.
   */
   updateTable(mutate: (table: BillTable) => void, label = "Edit table"): void {
     const table = this.getTable();
     if (!table) return;
     mutate(table);
     table.syncDimensions();
     this.canvas?.requestRenderAll();
     this.commit(label);
   }

  setTableRepeat(tableId: string, repeat: Partial<TableRepeat> | null): void {
    const canvas = this.canvas;
    if (!canvas) return;
    const target = canvas.getObjects().find((o) => o instanceof BillTable && this.getId(o) === tableId);
    if (!(target instanceof BillTable)) return;

    if (repeat === null) {
      target.repeat = undefined;
      this.commit("Clear repeating rows");
      canvas.requestRenderAll();
      return;
    }
    const rowCount = Array.isArray(target.rowHeights) ? target.rowHeights.length : 0;
    const next = normaliseRepeat(repeat, rowCount);
    if (!next) return;
    target.repeat = next;
    this.commit("Set repeating rows");
    canvas.requestRenderAll();
  }

  /** Focus the first canvas object containing a dynamic key. */
  selectDynamicKey(key: string): boolean {
    const canvas = this.canvas;
    if (!canvas) return false;
    const token = new RegExp(`\\{\\{\\s*${escapeRegExp(key)}\\s*\\}\\}`);
    const target = canvas.getObjects().find((object) => {
      const type = (object as unknown as { appType?: string }).appType;
      if (type === "field") return (object as unknown as { key?: string }).key === key;
      if (type === "text") return token.test(String((object as unknown as { text?: string }).text ?? ""));
      if (object instanceof BillTable) {
        for (let row = 0; row < object.rows; row += 1) {
          for (let column = 0; column < object.columns; column += 1) {
            if (token.test(object.getCell(row, column).text)) return true;
          }
        }
      }
      return type === "image-placeholder" && (object as unknown as { placeholderRole?: string }).placeholderRole === key;
    });
    if (!target) return false;
    this.setTool("select");
    canvas.setActiveObject(target);
    canvas.requestRenderAll();
    this.refresh();
    return true;
  }

  /**
   * Render a template the way the app does, with the totals a band's trailing
   * row needs. Reached through `window.__btm`, which only exists in development,
   * so the E2E suite can read the renderer's output without a second browser
   * round trip.
   */
  renderHtmlForTest(template: BillTemplate, values: Record<string, string> = {}): string {
    return renderHtml(template, values, { computed: computedSpecsFor(template) }).html;
  }

  /** Build, write, parse and resolve a package, then render what comes back. */
  packageRoundTripHtml(template: BillTemplate): string {
    const pkg = buildPackage(template);
    const { template: resolved } = resolvePackage(parsePackage(writePackage(pkg)));
    return renderHtml(resolved, {}, { computed: computedSpecsFor(template) }).html;
  }

   /**
 * Re-cut a part from wherever it currently sits.
 *
 * `normalise` overrides the whitening for this one operation. Left undefined —
 * which is what the Recapture button does — the part is re-cut at its own
 * current setting, so the button is idempotent and cannot quietly undo the
 * panel's whitening checkbox.
 */
  recaptureBillPart(id: string, normalise?: boolean): void {
    const canvas = this.canvas;
    const target = canvas?.getObjects().find(
      (o) =>
        (o as unknown as { id?: string }).id === id &&
        (o as unknown as { appType?: string }).appType === "bill-part",
    );
    if (!canvas || !this.reference || !target) return;
    const old = target as BillPartObject;
    const box = target.getBoundingRect();
    // Same failure handling as a fresh capture: a canvas API that throws is a
    // no-op, so the existing object — the one holding the embedded image — is
    // left exactly as it was.
    let crop: BillPartCrop | null = null;
    try {
      crop = cropBillPart(
        this.reference,
        this.state.document,
        {
          left: box.left,
          top: box.top,
          width: box.width,
          height: box.height,
        },
        // The panel's whitening checkbox passes an explicit value; the Recapture
        // button passes nothing and so re-cuts at the part's own current setting.
        // Following the editor default here instead would let the button undo
        // whatever the checkbox just did.
        { normalise: normalise ?? old.normalized },
      );
    } catch {
      return;
    }
    if (!crop) return;
    const next = new BillPartObject({
      src: crop.src,
      normalized: crop.normalized,
      sourceRect: crop.sourceRect,
      image: crop.image,
    });
    next.set({
      id: (target as unknown as { id?: string }).id,
      name: (target as unknown as { name?: string }).name,
      role: (target as unknown as { role?: string }).role,
      left: crop.rect.left,
      top: crop.rect.top,
      width: crop.width,
      height: crop.height,
      scaleX: crop.rect.width / crop.width,
      scaleY: crop.rect.height / crop.height,
      angle: target.angle ?? 0,
      opacity: target.opacity ?? 1,
      visible: target.visible !== false,
      selectable: true,
      evented: true,
    } as never);
    canvas.remove(old);
    canvas.add(next);
    canvas.setActiveObject(next);
    this.commit("Recapture bill part");
  }

  /* ---------------------------------------------------------------- */
  /* Grid                                                              */
  /* ---------------------------------------------------------------- */

  setGridVisible(visible: boolean): void {
    this.setState({ gridVisible: visible });
  }

  setSnapEnabled(enabled: boolean): void {
    this.setState({ snapToGrid: enabled });
  }

  setGridSize(size: number): void {
    this.setState({ gridSize: Math.max(2, size) });
  }

  /* ---------------------------------------------------------------- */
  /* Template import / export                                          */
  /* ---------------------------------------------------------------- */

  /** Build the template. The reference image is structurally excluded. */
  getTemplate(): BillTemplate {
    const template = serialiseObjects(
      this.tracedObjects() as never,
      this.state.document,
      this.state.documentName,
      this.state.layout,
    );
    if (this.state.placeholders.length > 0) {
      template.meta.placeholders = this.state.placeholders;
    }
    if (this.state.computedSpecs.length > 0) {
      template.meta.computed = this.state.computedSpecs;
    }
    return template;
  }

  setDocumentName(name: string): void {
    this.setState({ documentName: name });
  }

  /**
   * Create or merge a placeholder contract. Values are last-write-wins and an
   * empty contract is dropped so untouched keys keep falling back to inference.
   */
  updatePlaceholder(key: string, patch: Partial<PlaceholderSpec>): void {
    const current = this.state.placeholders.find((p) => p.key === key);
    const merged: PlaceholderSpec = { ...(current ?? { key }), ...patch, key };
    const isEmpty = Object.entries(merged).every(
      ([k, v]) => k === "key" || v === undefined,
    );
    const next = isEmpty
      ? this.state.placeholders.filter((p) => p.key !== key)
      : current
        ? this.state.placeholders.map((p) => (p.key === key ? merged : p))
        : [...this.state.placeholders, merged];
    this.setState({ placeholders: next });
    this.commit("Edit data field");
  }

  setComputedSpecs(specs: ComputedSpec[]): void {
    this.setState({ computedSpecs: specs.map((spec) => ({ ...spec, args: [...spec.args] })) });
    this.commit("Edit calculations");
  }

  /** Rename one dynamic key everywhere it appears, as one undoable edit. */
  renamePlaceholderKey(oldKey: string, newKey: string): string | null {
    const next = newKey.trim();
    if (!/^[A-Za-z0-9_.-]+$/.test(next)) {
      return "Use letters, numbers, dots, dashes, or underscores for a field key.";
    }
    if (next === oldKey) return null;
    const template = this.getTemplate();
    const alreadyUsed = template.objects.some((object) => {
      if (object.type === "field") return object.key === next;
      if (object.type === "text") return extractVariables(object.text).includes(next);
      if (object.type === "table") return object.cells.some((cell) => extractVariables(cell.text).includes(next));
      return object.type === "image-placeholder" && object.placeholderRole === next;
    });
    if (alreadyUsed) return `The key “${next}” is already used.`;

    const token = new RegExp(`\\{\\{\\s*${escapeRegExp(oldKey)}\\s*\\}\\}`, "g");
    const canvas = this.canvas;
    if (!canvas) return "The editor is not ready.";
    for (const object of canvas.getObjects()) {
      const appType = (object as unknown as { appType?: string }).appType;
      if (appType === "text" || appType === "field") {
        const textObject = object as unknown as {
          text: string;
          set: (props: Record<string, unknown>) => void;
        } & { key?: string };
        const text = textObject.text.replace(token, `{{${next}}}`);
        textObject.set({ text, ...(appType === "field" ? { key: next } : {}) });
      } else if (appType === "table") {
        const table = object as BillTable;
        for (let row = 0; row < table.rows; row += 1) {
          for (let column = 0; column < table.columns; column += 1) {
            const cell = table.getCell(row, column);
            const text = cell.text.replace(token, `{{${next}}}`);
            if (text !== cell.text) table.setCellText(row, column, text);
          }
        }
      }
    }
    this.setState({
      placeholders: this.state.placeholders.map((spec) =>
        spec.key === oldKey ? { ...spec, key: next } : spec,
      ),
      computedSpecs: this.state.computedSpecs.map((spec) => ({
        ...spec,
        args: spec.args.map((arg) => arg === oldKey ? next : arg.endsWith(`.${oldKey}`) ? `${arg.slice(0, -oldKey.length)}${next}` : arg),
        ...(spec.rateKey ? { rateKey: spec.rateKey === oldKey ? next : spec.rateKey.endsWith(`.${oldKey}`) ? `${spec.rateKey.slice(0, -oldKey.length)}${next}` : spec.rateKey } : {}),
      })),
    });
    canvas.requestRenderAll();
    this.refresh();
    this.commit("Rename data field");
    return null;
  }

  /**
   * Lock or unlock every traced object except fields. Fields stay editable so
   * the author can keep adding them after freezing the structure.
   */
  setStructureLocked(locked: boolean): void {
    const canvas = this.canvas;
    if (!canvas) return;
    canvas.forEachObject((o) => {
      const appType = (o as unknown as { appType?: string }).appType;
      if (appType === "field") return;
      o.set({ locked, selectable: !locked, evented: !locked } as never);
    });
    canvas.requestRenderAll();
    this.setState({ structureLocked: locked });
    this.commit(locked ? "Lock structure" : "Unlock structure");
  }

  loadTemplate(template: BillTemplate): void {
    const canvas = this.canvas;
    if (!canvas) return;
    if (
      !template ||
      typeof template !== "object" ||
      !Array.isArray(template.objects) ||
      !template.document ||
      typeof template.document.width !== "number" ||
      typeof template.document.height !== "number"
    ) {
      return;
    }
    this.history.clear();
    canvas.discardActiveObject();
    // Everything, not just `tracedObjects()`: guides are filtered out of that
    // list, so clearing only the artwork would leave the previous document's
    // boundaries on the canvas behind the newly opened bill.
    for (const o of canvas.getObjects()) canvas.remove(o);
    for (const o of hydrateTemplate(template)) canvas.add(o);
    this.restoreGuides(template.layout?.guides ?? []);
    this.refreshStrokeFloors();
    canvas.requestRenderAll();
    this.setState({
      document: { ...template.document },
      documentName: template.meta?.name ?? "Untitled bill template",
placeholders: normalisePlaceholderSpecs(template.meta?.placeholders),
      computedSpecs: Array.isArray(template.meta?.computed) ? template.meta.computed : [],
    // Adopted from the opened file so a layout template re-opens as one. The
    // key is left undefined for a template that never had it, which is the
    // state that keeps a fixed-layout bill rendering as it always has.
    layout: template.layout,
    canUndo: false,
      canRedo: false,
      pendingTable: null,
      editingCell: null,
      structureLocked: false,
      // Groups are authoring state and never travel in a template file, so
      // opening one starts from no grouping.
      groups: [],
    });
    this.lockReferenceToDocument();
    this.applyCanvasSize();
    this.fit();
    this.history.clear();
    this.markBaseline();
    this.refresh();
  }

  /* ---------------------------------------------------------------- */
  /* Derived state                                                     */
  /* ---------------------------------------------------------------- */

  /** Recompute selection + layer list from the canvas. */
  refresh(): void {
    const canvas = this.canvas;
    if (!canvas) return;
    const selection = this.getActiveObjects()
      .map((o) => this.getId(o));

    const traced = this.tracedObjects();
    const layers: LayerEntry[] = [...traced].reverse().map((o) => ({
      id: this.getId(o),
      type: o.type,
      name: (o as unknown as { name?: string }).name ?? "Object",
      role: (o as unknown as { role?: string | null }).role ?? null,
      visible: o.visible !== false,
      locked: this.isLocked(o),
      isReference: false,
    }));

    // The selected table as a plain template object, not the live Fabric
    // instance: `rows` and `columns` are class getters there, so a spread of it
    // silently drops them and the panel would read `undefined` for the row
    // count. Serialising also keeps the canvas reference out of React state.
    const selectedTemplates = this.getSelectedTemplates();
    const selectedTable =
      selectedTemplates.length === 1 && selectedTemplates[0]!.type === "table"
        ? (selectedTemplates[0] as TableObject & { repeat?: TableRepeat })
        : null;

    // Counted from the objects themselves, not from the panel's contract list,
    // so editing a field's properties never reads as new progress.
    const dataFieldCount =
      traced.filter((o) =>
        isDataFieldObject({
          appType: (o as unknown as { appType?: string }).appType,
        }),
      ).length + (selectedTable?.repeat ? 1 : 0);

    this.setState({
      selection,
      layers,
      objectCount: traced.length,
      dataFieldCount,
      canUndo: this.history.canUndo,
      canRedo: this.history.canRedo,
      selectedTable,
    });
  }

  /** Ids of all traced objects, in paint order. Used by the layers panel. */
  getObjectIds(): string[] {
    return this.tracedObjects().map((o) => this.getId(o));
  }

  getObjectById(id: string): FabricObject | null {
    return (
      this.canvas?.getObjects().find((o) => this.getId(o) === id) ?? null
    );
  }

  selectObjectById(id: string): boolean {
    const canvas = this.canvas;
    const object = this.getObjectById(id);
    if (!canvas || !object) return false;
    this.setTool("select");
    canvas.setActiveObject(object);
    canvas.requestRenderAll();
    this.refresh();
    return true;
  }

  /** Serialise the current selection for the properties panel. */
  getSelectedTemplates(): TemplateObject[] {
    const objects = this.getActiveObjects();
    return objects
      .map((o) => {
        const all = this.getTemplate().objects;
        return all.find((t) => t.id === this.getId(o)) ?? null;
      })
      .filter((t): t is TemplateObject => t !== null);
  }

  /**
   * The values a multi-selection agrees on, for the panel to edit at once.
   *
   * A field is `undefined` when the selection disagrees, which the panel shows
   * as a dash rather than guessing one object's value for the rest.
   */
  getSharedSelection(): SharedSelection {
    return sharedSelection(this.getSelectedTemplates());
  }

  /**
   * Write one shared property across the whole selection as a single edit.
   *
   * Objects that cannot carry the property are skipped rather than forced: a
   * table's borders, a field's box and a bill part's crop all have their own
   * meaning for paint, and a shared colour must not invent an outline on them.
   * Locked objects are skipped too, matching `deleteSelection` and
   * `duplicateSelection` — otherwise "unlock everything" could not be undone
   * through this path.
   */
  applyShared(key: SharedKey, value: unknown, label: string): void {
    this.applyToSelection((o) => {
      const t = this.getTemplate().objects.find((x) => x.id === this.getId(o));
      if (!t) return;
      if (this.isLocked(o) && key !== "locked") return;
      if ((key === "stroke" || key === "strokeWidth" || key === "fill") && !acceptsSharedPaint(t)) {
        return;
      }
      if (key === "visible" && !acceptsVisibility(t)) return;
      o.set({ [key]: value } as never);
    }, label);
  }
}

/** True when the object is a drawn line / horizontal or vertical rule. */
function ruleKindOf(
  o: FabricObject,
): "line" | "hr" | "vr" | null {
  const kind = (o as unknown as { ruleKind?: string }).ruleKind;
  if (kind === "hr" || kind === "vr" || kind === "line") return kind;
  return o.type === "line" ? "line" : null;
}
function analysePlaceholdersSafe(text: string): {  role: string | null;
  roleKind: "static" | "variable";
} {
  const m = /^\s*\{\{\s*([a-zA-Z0-9_.-]+)\s*\}\}\s*$/.exec(text);
  if (m && m[1]) return { role: m[1], roleKind: "variable" };
  return {
    role: null,
    roleKind: /\{\{[^}]*\}\}/.test(text) ? "variable" : "static",
  };
}

/** appType stamped on the polygon overlays, so they never become artwork. */
const POLYGON_MARKER_APP_TYPE = "polygon-marker";

function isPolygonMarker(o: unknown): boolean {
  return (
    typeof o === "object" &&
    o !== null &&
    (o as { appType?: string }).appType === POLYGON_MARKER_APP_TYPE
  );
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
