"use client";

import {
  ActiveSelection,
  Canvas,
  Ellipse,
  FabricImage,
  FabricObject,
  IText,
  Line,
  Path,
  PencilBrush,
  Point,
  Polygon,
  Rect,
  type TPointerEventInfo,
} from "fabric";

import { BillTable } from "@/lib/canvas/objects/BillTable";
import { ImagePlaceholderObject } from "@/lib/canvas/objects/ImagePlaceholder";
import { createId, registerAppProperties } from "@/lib/canvas/fabricSetup";
import { HistoryStack } from "@/lib/canvas/history";
import { evenSizes, MIN_COL_WIDTH, MIN_ROW_HEIGHT } from "@/lib/template/geometry";
import { hydrateTemplate } from "@/lib/template/hydrate";
import { serialiseObjects, defaultName } from "@/lib/template/serialize";
import type { BillTemplate, TemplateObject } from "@/lib/template/types";
import { A4_HEIGHT, A4_WIDTH } from "@/lib/template/types";

registerAppProperties();

export type ToolId =
  | "select"
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
  | "image-placeholder";

export const TOOL_LABELS: Record<ToolId, string> = {
  select: "Select",
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
  document: { width: number; height: number };
  selection: string[];
  layers: LayerEntry[];
  hasReference: boolean;
  referenceVisible: boolean;
  referenceOpacity: number;
  referenceLocked: boolean;
  referenceName: string;
  gridVisible: boolean;
  snapToGrid: boolean;
  gridSize: number;
  canUndo: boolean;
  canRedo: boolean;
  /** Cell currently open for inline editing, if any. */
  editingCell: { tableId: string; index: number } | null;
  /** Rows/columns requested by the table tool, awaiting confirmation. */
  pendingTable: { x: number; y: number; width: number; height: number } | null;
  documentName: string;
  objectCount: number;
}

type Listener = () => void;

const REFERENCE_ID = "__reference__";

/** Tool id -> value stored on an object's `appType` field. */
const APP_TYPE_FOR: Record<string, string> = {
  "rounded-rect": "rounded-rect",
  rect: "rect",
  ellipse: "ellipse",
  polygon: "polygon",
  freehand: "path",
  text: "text",
  table: "table",
  "image-placeholder": "image-placeholder",
  line: "line",
  hr: "hr",
  vr: "vr",
};

/** Snap a value to the nearest grid multiple. */
export function snap(value: number, size: number): number {
  if (size <= 0) return Math.round(value);
  return Math.round(value / size) * size;
}

export class EditorController {
  private canvas: Canvas | null = null;
  private listeners = new Set<Listener>();
  private history = new HistoryStack<string>();
  private state: EditorState = {
    ready: false,
    tool: "select",
    zoom: 1,
    document: { width: A4_WIDTH, height: A4_HEIGHT },
    selection: [],
    layers: [],
    hasReference: false,
    referenceVisible: true,
    referenceOpacity: 0.25,
    referenceLocked: true,
    referenceName: "Bill reference",
    gridVisible: false,
    snapToGrid: false,
    gridSize: 10,
    canUndo: false,
    canRedo: false,
    editingCell: null,
    pendingTable: null,
    documentName: "Untitled bill template",
    objectCount: 0,
  };

  private reference: FabricImage | null = null;
  private drawing: FabricObject | null = null;
  private drawOrigin: { x: number; y: number } | null = null;
  private polygonPoints: Array<{ x: number; y: number }> = [];
  private polygonPreview: Polygon | null = null;
  private pencil: PencilBrush | null = null;
  /** Position of the object being transformed, captured on mouse down. */
  private gestureAnchor: { left: number; top: number } | null = null;
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
      width: this.state.document.width,
      height: this.state.document.height,
      backgroundColor: "#ffffff",
      preserveObjectStacking: true,
      selection: true,
      stopContextMenu: true,
      fireRightClick: false,
    });
    this.canvas = canvas;

    canvas.on("mouse:down", this.onMouseDown);
    canvas.on("mouse:move", this.onMouseMove);
    canvas.on("mouse:up", this.onMouseUp);
    canvas.on("mouse:wheel", this.onWheel);
    canvas.on("object:moving", this.onObjectMoving);
    canvas.on("object:scaling", this.onObjectScaling);
    canvas.on("object:modified", this.onObjectModified);
    canvas.on("text:changed", this.onTextChanged);
    canvas.on("selection:created", this.onSelectionChanged);
    canvas.on("selection:updated", this.onSelectionChanged);
    canvas.on("selection:cleared", this.onSelectionChanged);

    this.pencil = new PencilBrush(canvas);
    this.pencil.color = "#000000";
    this.pencil.width = 1.5;

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
      canvas.off("mouse:move", this.onMouseMove);
      canvas.off("mouse:up", this.onMouseUp);
      canvas.off("mouse:wheel", this.onWheel);
      canvas.off("object:moving", this.onObjectMoving);
      canvas.off("object:scaling", this.onObjectScaling);
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
   * Keep the reference image exactly covering the document.
   *
   * The image is the authoring underlay, so the canvas and the image must
   * always coincide: the page boundary *is* the image boundary. Whenever the
   * document size changes (a new bill, a loaded template, a blank page) the
   * image is re-fitted to the new page rather than being left stranded at its
   * own natural size.
   */
  private lockReferenceToDocument(): void {
    const img = this.reference;
    if (!img) return;
    const { width, height } = this.state.document;
    const naturalWidth = img.width || 1;
    const naturalHeight = img.height || 1;
    img.set({
      left: 0,
      top: 0,
      originX: "left",
      originY: "top",
      scaleX: width / naturalWidth,
      scaleY: height / naturalHeight,
    } as never);
    img.setCoords();
  }

  setDocument(width: number, height: number): void {
    const canvas = this.canvas;
    if (!canvas) return;
    this.setState({ document: { width, height } });
    this.lockReferenceToDocument();
    this.applyCanvasSize();
  }

  /**
   * The element is sized to `document * zoom` so the whole page is visible
   * and there is no dead space around the content.
   */
  private applyCanvasSize(): void {
    const canvas = this.canvas;
    if (!canvas) return;
    const { width, height } = this.state.document;
    const z = canvas.getZoom();
    canvas.setDimensions({
      width: Math.max(1, Math.round(width * z)),
      height: Math.max(1, Math.round(height * z)),
    });
  }

  setZoom(zoom: number, anchor?: { x: number; y: number }): void {
    const canvas = this.canvas;
    if (!canvas) return;
    const next = Math.min(4, Math.max(0.1, zoom));
    if (anchor) {
      canvas.zoomToPoint(new Point(anchor.x, anchor.y), next);
    } else {
      canvas.setZoom(next);
    }
    // An explicit zoom means the user has taken control of the view.
    this.userHasZoomed = true;
    this.setState({ zoom: next });
    this.applyCanvasSize();
  }

  zoomIn(): void {
    this.setZoom(this.state.zoom * 1.2);
  }

  zoomOut(): void {
    this.setZoom(this.state.zoom / 1.2);
  }

  resetZoom(): void {
    this.setZoom(1);
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
    // The pane can settle after the document loads, so refit while the user
    // has not taken control of the zoom.
    if (changed && !this.userHasZoomed) this.fit();
  }

  getViewportSize(): { width: number; height: number } {
    return this.viewport;
  }

  /**
   * Scale so the whole document is visible, and reset any pan offset so the
   * page's top-left corner sits at the canvas origin.
   */
  fit(): void {
    // Measure the live pane so the result is correct regardless of when the
    // layout settled relative to the document load.
    const stage = this.stageEl;
    if (stage) {
      this.viewport = {
        width: Math.max(120, stage.clientWidth - 48),
        height: Math.max(120, stage.clientHeight - 48),
      };
    }
    const { width, height } = this.state.document;
    const pad = 24;
    const scale = Math.min(
      (this.viewport.width - pad) / width,
      (this.viewport.height - pad) / height,
      4,
    );
    const next = Math.max(0.1, scale);
    const canvas = this.canvas;
    if (canvas) {
      canvas.setViewportTransform([next, 0, 0, next, 0, 0]);
    }
    this.userHasZoomed = false;
    this.setState({ zoom: next });
    this.applyCanvasSize();
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
   * Attach the bill image as a locked underlay. It is deliberately kept out
   * of the template: exports are built from the template, never from here.
   */
  async addReference(dataUrl: string): Promise<{ width: number; height: number }> {
    const canvas = this.canvas;
    if (!canvas) throw new Error("Canvas not ready");
    const img = await FabricImage.fromURL(dataUrl, { crossOrigin: "anonymous" });

    const docWidth = Math.round(img.width ?? A4_WIDTH);
    const docHeight = Math.round(img.height ?? A4_HEIGHT);

    this.reference?.dispose();
    img.set({
      left: 0,
      top: 0,
      originX: "left",
      originY: "top",
      selectable: false,
      evented: false,
      opacity: this.state.referenceOpacity,
      hoverCursor: "default",
    } as never);
    img.set({ id: REFERENCE_ID, name: "Bill reference" } as never);
    for (const key of [
      "lockMovementX",
      "lockMovementY",
      "lockScalingX",
      "lockScalingY",
      "lockRotation",
      "hasControls",
    ] as const) {
      (img as unknown as Record<string, unknown>)[key] = true;
    }

    this.reference = img;
    canvas.add(img);
    canvas.sendObjectToBack(img);
    this.setState({
      document: { width: docWidth, height: docHeight },
      hasReference: true,
      referenceVisible: true,
      referenceLocked: true,
    });
    this.lockReferenceToDocument();
    this.applyCanvasSize();
    // The page just changed size, so show all of it.
    this.fit();
    this.markBaseline();
    this.refresh();
    return { width: docWidth, height: docHeight };
  }

  setReferenceOpacity(value: number): void {
    const opacity = Math.min(1, Math.max(0, value));
    this.reference?.set({ opacity } as never);
    this.canvas?.requestRenderAll();
    this.setState({ referenceOpacity: opacity });
  }

  setReferenceVisible(visible: boolean): void {
    this.reference?.set({ visible } as never);
    this.canvas?.requestRenderAll();
    this.setState({ referenceVisible: visible });
  }

  setReferenceLocked(locked: boolean): void {
    const img = this.reference;
    if (img) {
      (img as unknown as Record<string, unknown>).lockMovementX = locked;
      (img as unknown as Record<string, unknown>).lockMovementY = locked;
      (img as unknown as Record<string, unknown>).lockScalingX = locked;
      (img as unknown as Record<string, unknown>).lockScalingY = locked;
      (img as unknown as Record<string, unknown>).lockRotation = locked;
      (img as unknown as Record<string, unknown>).hasControls = locked;
    }
    this.setState({ referenceLocked: locked });
  }

  removeReference(): void {
    const canvas = this.canvas;
    if (!canvas || !this.reference) return;
    canvas.remove(this.reference);
    this.reference.dispose();
    this.reference = null;
    this.setState({ hasReference: false, referenceVisible: false });
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
      o.evented = tool === "select" ? !this.isReference(o) : false;
    });
    canvas.discardActiveObject();
    canvas.requestRenderAll();
    this.refresh();
  }

  private isReference(o: FabricObject): boolean {
    return (o as unknown as { id?: string }).id === REFERENCE_ID;
  }

  private isLocked(o: FabricObject): boolean {
    return (o as unknown as { locked?: boolean }).locked === true;
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
  private onMouseDown = (opt: TPointerEventInfo): void => {
    const canvas = this.canvas;
    if (!canvas) return;
    const p = opt.scenePoint;

    if (this.spaceHeld || opt.e?.altKey) return;

    // Remember where the object sat before the gesture, so a resize can pin
    // its top-left corner instead of letting it drift.
    this.gestureAnchor = opt.target
      ? { left: opt.target.left ?? 0, top: opt.target.top ?? 0 }
      : null;

    const tool = this.state.tool;
    if (tool === "select") return;

    this.drawOrigin = { x: p.x, y: p.y };

    switch (tool) {
      case "line":
      case "hr":
      case "vr":
        this.beginLine(tool);
        break;
      case "rect":
      case "rounded-rect":
      case "ellipse":
        this.beginShape(tool);
        break;
      case "image-placeholder":
        this.beginImagePlaceholder();
        break;
      case "table":
        this.setState({
          pendingTable: { x: p.x, y: p.y, width: 0, height: 0 },
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
        canvas.setActiveObject(obj);
        this.commit("Add text");
        this.setTool("select");
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

    if (this.drawOrigin && this.drawing) {
      const dx = p.x - this.drawOrigin.x;
      const dy = p.y - this.drawOrigin.y;
      this.updateDrawing(dx, dy);
    }
  };

  private onMouseUp = (): void => {
    if (this.state.tool === "freehand" && this.canvas?.isDrawingMode) {
      // PencilBrush appends a path; normalise it so it exports cleanly.
      const paths = this.canvas.getObjects().filter(
        (o) => o.type === "path" && !this.isReference(o),
      );
      const last = paths[paths.length - 1];
      if (last) {
        this.tag(last, "freehand");
        this.normaliseFreehand(last);
        this.commit("Freehand");
      }
      return;
    }

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
    if (isTable) {
      this.setState({
        pendingTable: {
          x: box.x,
          y: box.y,
          width: box.width,
          height: box.height,
        },
      });
    }
    this.commit(isTable ? "Add table" : "Add shape");
    this.setTool("select");
  };

  private beginLine(tool: "line" | "hr" | "vr"): void {
    const canvas = this.canvas;
    if (!canvas || !this.drawOrigin) return;
    const o = this.drawOrigin;
    const line = new Line([o.x, o.y, o.x, o.y], {
      stroke: "#000000",
      strokeWidth: 1,
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
      strokeWidth: 1,
      selectable: false,
      evented: false,
      // Fabric 7 positions objects from their centre by default; the whole
      // app uses top-left document coordinates, so be explicit.
      originX: "left" as const,
      originY: "top" as const,
    };
    const obj =
      tool === "ellipse"
        ? new Ellipse(common)
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
    this.tag(table, "table", "Table 1", "items");
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
      let x2 = origin.x + dx;
      let y2 = origin.y + dy;
      if (ruleKind === "hr") y2 = origin.y;
      if (ruleKind === "vr") x2 = origin.x;
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

  private addPolygonVertex(x: number, y: number): void {
    const canvas = this.canvas;
    if (!canvas) return;
    this.polygonPoints.push({ x, y });

    if (this.polygonPreview) {
      this.polygonPreview.set({ points: [...this.polygonPoints] } as never);
      this.polygonPreview.setCoords();
    } else {
      this.polygonPreview = new Polygon([...this.polygonPoints], {
        fill: "transparent",
        stroke: "#000000",
        strokeWidth: 1,
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
    this.polygonPoints = [];
    this.polygonPreview = null;
    this.setTool("select");
  }

  cancelPolygon(): void {
    if (this.polygonPreview) {
      this.canvas?.remove(this.polygonPreview);
      this.polygonPreview = null;
    }
    this.polygonPoints = [];
    this.canvas?.requestRenderAll();
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
      strokeWidth: (path.strokeWidth as number) || 1.5,
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
    if (this.state.snapToGrid && opt.target) {
      const size = this.state.gridSize;
      opt.target.set({
        left: snap(opt.target.left ?? 0, size),
        top: snap(opt.target.top ?? 0, size),
      } as never);
      opt.target.setCoords();
    }
  };

  private onObjectScaling = (opt: { target?: FabricObject }): void => {
    const target = opt.target;
    if (!target) return;

    const appType = (target as unknown as { appType?: string }).appType;
    if (appType === "table") {
      // A table is resized by changing its column widths, never by scaling,
      // so that the grid stays exact. Convert the drag into real geometry and
      // pin the top-left corner, so the table only ever grows right and down.
      const table = target as BillTable;
      // Read both factors first: converting one axis resets the object's
      // scale, which would otherwise swallow the other axis.
      const factorX = table.scaleX;
      const factorY = table.scaleY;
      table.scaleColumns(factorX);
      table.scaleRows(factorY);
      table.set({ scaleX: 1, scaleY: 1 } as never);
      if (this.gestureAnchor) {
        table.set({
          left: this.gestureAnchor.left,
          top: this.gestureAnchor.top,
        } as never);
      }
      table.setCoords();
      this.canvas?.requestRenderAll();
      return;
    }

    if (this.state.snapToGrid) {
      const size = this.state.gridSize;
      target.set({
        left: snap(target.left ?? 0, size),
        top: snap(target.top ?? 0, size),
      } as never);
    }
    target.setCoords();
  };

  private onObjectModified = (): void => {
    // One history entry per completed gesture.
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
    this.refresh();
  };

  private onWheel = (opt: TPointerEventInfo<WheelEvent>): void => {
    const canvas = this.canvas;
    if (!canvas) return;
    const e = opt.e;
    // A plain wheel scrolls the stage so a page taller than the pane stays
    // reachable. Zoom is opt-in via Ctrl/⌘ + wheel, which is the convention
    // every design tool uses.
    if (!e.ctrlKey && !e.metaKey) return;
    e.preventDefault();
    e.stopPropagation();
    const delta = e.deltaY;
    const factor = 0.999 ** delta;
    this.setZoom(
      Math.min(4, Math.max(0.1, canvas.getZoom() * factor)),
      { x: opt.viewportPoint.x, y: opt.viewportPoint.y },
    );
  };

  /* ---------------------------------------------------------------- */
  /* History                                                           */
  /* ---------------------------------------------------------------- */

  private tracedObjects(): FabricObject[] {
    const canvas = this.canvas;
    if (!canvas) return [];
    return canvas.getObjects().filter((o) => !this.isReference(o));
  }

  private snapshot(): string {
    const canvas = this.canvas;
    if (!canvas) return "";
    return JSON.stringify(
      serialiseObjects(
        this.tracedObjects() as never,
        this.state.document,
        this.state.documentName,
      ),
    );
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
    const template = JSON.parse(raw) as BillTemplate;
    this.suppressHistory = true;
    canvas.discardActiveObject();
    for (const o of this.tracedObjects()) canvas.remove(o);
    const objects = hydrateTemplate(template);
    for (const o of objects) canvas.add(o);
    canvas.requestRenderAll();
    this.suppressHistory = false;
    this.setState({
      editingCell: null,
      pendingTable: null,
      document: { ...template.document },
    });
    this.lockReferenceToDocument();
    this.applyCanvasSize();
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
    const targets = this.getActiveObjects().filter((o) => !this.isLocked(o));
    if (targets.length === 0) return;
    canvas.discardActiveObject();
    for (const o of targets) {
      this.removeRecursive(o);
    }
    canvas.requestRenderAll();
    this.commit(targets.length > 1 ? "Delete objects" : "Delete object");
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
      (o) => !this.isReference(o) && !this.isLocked(o),
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
    if (objs.length === 1) canvas.setActiveObject(objs[0]!);
    else canvas.setActiveObject(new ActiveSelection(objs, { canvas }));
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
    const objects = this.getActiveObjects().filter((o) => !this.isReference(o));
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
    const objects = this.getActiveObjects().filter((o) => !this.isReference(o));
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
    const objects = this.getActiveObjects().filter((o) => !this.isReference(o));
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
      if (this.reference) canvas.sendObjectToBack(this.reference);
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

    const table = canvas
      .getObjects()
      .find((o): o is BillTable => o instanceof BillTable);

    const r = Math.max(1, Math.min(60, Math.round(rows)));
    const c = Math.max(1, Math.min(30, Math.round(columns)));

    let target: BillTable;
    if (table) {
      table.colWidths = evenSizes(c, pending.width, MIN_COL_WIDTH);
      table.rowHeights = evenSizes(r, pending.height, MIN_ROW_HEIGHT);
      table.headerRow = r > 1;
      table.syncDimensions();
      target = table;
    } else {
      target = new BillTable({
        colWidths: evenSizes(c, Math.max(120, pending.width), MIN_COL_WIDTH),
        rowHeights: evenSizes(r, Math.max(80, pending.height), MIN_ROW_HEIGHT),
      });
      target.set({ left: pending.x, top: pending.y, selectable: true, evented: true } as never);
      this.tag(target, "table", "Table 1", "items");
      canvas.add(target);
    }

    this.setState({ pendingTable: null });
    canvas.setActiveObject(target);
    canvas.requestRenderAll();
    this.commit("Create table");
    return target;
  }

  cancelPendingTable(): void {
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
    const objects = this.getActiveObjects().filter((o) => !this.isReference(o));
    if (objects.length === 0) return;
    for (const o of objects) {
      fn(o);
      o.setCoords();
    }
    this.canvas?.requestRenderAll();
    this.commit(label);
  }

  /** Live update during a slider drag: no history entry per frame. */
  previewSelection(fn: (o: FabricObject) => void): void {
    const objects = this.getActiveObjects().filter((o) => !this.isReference(o));
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
    return serialiseObjects(
      this.tracedObjects() as never,
      this.state.document,
      this.state.documentName,
    );
  }

  setDocumentName(name: string): void {
    this.setState({ documentName: name });
  }

  loadTemplate(template: BillTemplate): void {
    const canvas = this.canvas;
    if (!canvas) return;
    this.history.clear();
    canvas.discardActiveObject();
    for (const o of this.tracedObjects()) canvas.remove(o);
    for (const o of hydrateTemplate(template)) canvas.add(o);
    canvas.requestRenderAll();
    this.setState({
      document: { ...template.document },
      documentName: template.meta?.name ?? "Untitled bill template",
      canUndo: false,
      canRedo: false,
      pendingTable: null,
      editingCell: null,
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
      .filter((o) => !this.isReference(o))
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

    this.setState({
      selection,
      layers,
      objectCount: traced.length,
      canUndo: this.history.canUndo,
      canRedo: this.history.canRedo,
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

  /** Serialise the current selection for the properties panel. */
  getSelectedTemplates(): TemplateObject[] {
    const objects = this.getActiveObjects().filter((o) => !this.isReference(o));
    return objects
      .map((o) => {
        const all = this.getTemplate().objects;
        return all.find((t) => t.id === this.getId(o)) ?? null;
      })
      .filter((t): t is TemplateObject => t !== null);
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
