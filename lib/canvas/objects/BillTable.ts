import { FabricObject, classRegistry } from "fabric";

import {
  MIN_COL_WIDTH,
  MIN_ROW_HEIGHT,
  cellRect,
  cellIndex,
  columnLines,
  hitTestCell,
  normaliseSizes,
  rowLines,
  scaleColWidths,
  scaleRowHeights,
  sum,
  totalHeight,
  totalWidth,
  type CellRect,
} from "@/lib/template/geometry";
import { gridSegments } from "@/lib/canvas/tableGrid";
import { DEFAULT_STROKE_WIDTH } from "@/lib/canvas/strokeDefaults";
import type { TableCell, TextAlign } from "@/lib/template/types";

export interface BillTableSpec {
  colWidths: number[];
  rowHeights: number[];
  cells: TableCell[];
  borderColor: string;
  borderWidth: number;
  cellFill: string;
  headerRow: boolean;
  headerFill: string;
  headerTextColor: string;
  cellTextColor: string;
  padding: number;
  fontFamily: string;
}

export interface TableResizeGesture {
  colWidths: number[];
  rowHeights: number[];
  width: number;
  height: number;
  startX: number;
  startY: number;
  signX: 1 | -1;
  signY: 1 | -1;
}

export const DEFAULT_TABLE_SPEC: BillTableSpec = {
  colWidths: [120, 120],
  rowHeights: [30, 30],
  cells: [],
  borderColor: "#000000",
  // The same width every outline tool draws with, so a traced table's grid
  // matches the lines traced around it. See `strokeDefaults`.
  borderWidth: DEFAULT_STROKE_WIDTH,
  cellFill: "transparent",
  headerRow: true,
  headerFill: "transparent",
  headerTextColor: "#000000",
  cellTextColor: "#000000",
  padding: 4,
  fontFamily: "Arial",
};

function makeCells(rows: number, cols: number, template?: TableCell[]): TableCell[] {
  const out: TableCell[] = [];
  for (let i = 0; i < rows * cols; i++) {
    out.push(
      template?.[i] ?? {
        text: "",
        textAlign: "left",
        fontSize: 12,
        fontWeight: "normal",
      },
    );
  }
  return out;
}

/**
 * A bill data table.
 *
 * Fabric 7's `Group` owns child layout through an internal layout manager and
 * silently reverts manual child coordinates, so a group of rects cannot
 * represent an exact grid. This object therefore keeps the grid as data and
 * paints it itself. Every geometric question is answered by
 * `lib/template/geometry`, which stays pure and testable.
 */
export class BillTable extends FabricObject {
  static type = "BillTable";

  /**
   * Fabric 7 lowercases `instance.type` ("billtable"), so the app tags its
   * own classes with an explicit, stable discriminator instead.
   */
  readonly appType = "table" as const;

  declare colWidths: number[];
  declare rowHeights: number[];
  declare cells: TableCell[];
  declare borderColor: string;
  declare borderWidth: number;
  declare cellFill: string;
  declare headerRow: boolean;
  declare headerFill: string;
  declare headerTextColor: string;
  declare cellTextColor: string;
  declare padding: number;
  declare fontFamily: string;

  /** Cell currently being edited, as a flat index. -1 when none. */
  editingCell = -1;

  /**
   * State captured when a resize handle is grabbed. `BillTable` keeps scale at
   * 1, so the only record of a drag is this snapshot.
   */
  resizeGesture: TableResizeGesture | null = null;

  constructor(spec: Partial<BillTableSpec> = {}) {
    const merged = { ...DEFAULT_TABLE_SPEC, ...spec };
    const colWidths = normaliseSizes(merged.colWidths, 8);
    const rowHeights = normaliseSizes(merged.rowHeights, 8);

    super({
      left: 0,
      top: 0,
      originX: "left",
      originY: "top",
      fill: "transparent",
      strokeWidth: 0,
      objectCaching: false,
    });

    this.colWidths = colWidths;
    this.rowHeights = rowHeights;
    this.cells = makeCells(
      rowHeights.length,
      colWidths.length,
      merged.cells,
    );
    this.borderColor = merged.borderColor;
    this.borderWidth = merged.borderWidth;
    this.cellFill = merged.cellFill;
    this.headerRow = merged.headerRow;
    this.headerFill = merged.headerFill;
    this.headerTextColor = merged.headerTextColor;
    this.cellTextColor = merged.cellTextColor;
    this.padding = merged.padding;
    this.fontFamily = merged.fontFamily;

    this.syncDimensions();
  }

  /* ---------------------------------------------------------------- */
  /* Geometry                                                          */
  /* ---------------------------------------------------------------- */

  get rows(): number {
    return this.rowHeights.length;
  }

  get columns(): number {
    return this.colWidths.length;
  }

  /**
   * Tables are resized by editing column widths, never by scaling. Keeping
   * scale at 1 is what makes the geometry exact and exportable.
   */
  get isResizableByScaling(): boolean {
    return false;
  }

  /** Recompute `width`/`height` from the grid. */
  syncDimensions(): void {
    this.set({
      width: totalWidth(this.colWidths),
      height: totalHeight(this.rowHeights),
      scaleX: 1,
      scaleY: 1,
    } as never);
    this.setCoords();
  }

  /**
   * Which cell holds a point given in document coordinates?
   *
   * The table keeps `scaleX/scaleY` at 1 and positions from its top-left, so
   * the mapping is a plain rotation about the centre. Doing it directly avoids
   * inverting Fabric's full transform, which also carries the viewport zoom
   * and would corrupt document-space input.
   */
  cellAtCanvasPoint(x: number, y: number): CellRect | null {
    const w = this.width ?? 0;
    const h = this.height ?? 0;
    const cx = (this.left ?? 0) + w / 2;
    const cy = (this.top ?? 0) + h / 2;
    const angle = ((this.angle ?? 0) * Math.PI) / 180;
    const cos = Math.cos(-angle);
    const sin = Math.sin(-angle);
    const dx = x - cx;
    const dy = y - cy;
    // Rotate into the table's own frame, then back to top-left origin.
    const lx = dx * cos - dy * sin + w / 2;
    const ly = dx * sin + dy * cos + h / 2;
    return this.cellAtLocalPoint(lx, ly);
  }

  /** Hit test in the table's own coordinate space. */
  cellAtLocalPoint(x: number, y: number): CellRect | null {
    return hitTestCell(this.colWidths, this.rowHeights, x, y);
  }

  /* ---------------------------------------------------------------- */
  /* Editing                                                           */
  /* ---------------------------------------------------------------- */

  private ensureSize(): void {
    const needed = this.rows * this.columns;
    while (this.cells.length < needed) {
      this.cells.push({
        text: "",
        textAlign: "left",
        fontSize: 12,
        fontWeight: "normal",
      });
    }
    if (this.cells.length > needed) this.cells.length = needed;
  }

  getCell(row: number, column: number): TableCell {
    this.ensureSize();
    return this.cells[cellIndex(this.colWidths, this.rowHeights, row, column)]!;
  }

  setCellText(row: number, column: number, text: string): void {
    this.getCell(row, column).text = text;
  }

  setCellAlign(row: number, column: number, textAlign: TextAlign): void {
    this.getCell(row, column).textAlign = textAlign;
  }

  setAllCellsAlign(textAlign: TextAlign): void {
    for (const c of this.cells) c.textAlign = textAlign;
  }

  setColumnWidth(index: number, value: number): void {
    if (index < 0 || index >= this.columns) return;
    const next = [...this.colWidths];
    next[index] = Math.max(8, Math.round(value));
    this.colWidths = normaliseSizes(next, 8);
    this.syncDimensions();
  }

  /**
   * Snapshot the grid at the start of a gesture.
   *
   * Armed on every table mouse-down, not only a handle grab, so the snapshot is
   * always available when a scaling event arrives. The sign per axis records
   * which side of the table the pointer started on, so every handle resizes
   * away from this object's top-left. Deriving it from the pointer position
   * avoids depending on which control Fabric considers active.
   */
  beginResizeGesture(startPointer: { x: number; y: number }): void {
    const w = totalWidth(this.colWidths);
    const h = totalHeight(this.rowHeights);
    const cx = (this.left ?? 0) + w / 2;
    const cy = (this.top ?? 0) + h / 2;
    this.resizeGesture = {
      colWidths: [...this.colWidths],
      rowHeights: [...this.rowHeights],
      width: w,
      height: h,
      startX: startPointer.x,
      startY: startPointer.y,
      signX: startPointer.x >= cx ? 1 : -1,
      signY: startPointer.y >= cy ? 1 : -1,
    };
  }

  /**
   * Resize columns to `targetWidth`, always scaling from the gesture snapshot.
   *
   * Resolving from the snapshot rather than the current sizes is what makes a
   * drag idempotent: a long drag applies the same ratio repeatedly instead of
   * compounding. Without an active gesture the live sizes are used, so the
   * properties panel can call this directly.
   */
  resizeColumnsTo(targetWidth: number): void {
    if (!Number.isFinite(targetWidth)) return;
    const base = this.resizeGesture?.colWidths ?? this.colWidths;
    this.colWidths = scaleColWidths(base, targetWidth, MIN_COL_WIDTH);
    this.syncDimensions();
  }

  resizeRowsTo(targetHeight: number): void {
    if (!Number.isFinite(targetHeight)) return;
    const base = this.resizeGesture?.rowHeights ?? this.rowHeights;
    this.rowHeights = scaleRowHeights(base, targetHeight, MIN_ROW_HEIGHT);
    this.syncDimensions();
  }

  endResizeGesture(): void {
    this.resizeGesture = null;
  }

  /**
   * Multiply every column width by `factor`. Used to turn a corner-drag into
   * real column geometry, so the table's top-left corner never moves.
   */
  scaleColumns(factor: number): void {
    if (!Number.isFinite(factor) || Math.abs(factor - 1) < 1e-6) return;
    const current = totalWidth(this.colWidths);
    const next = current * factor;
    if (next < MIN_COL_WIDTH * this.columns) return;
    this.colWidths = scaleColWidths(this.colWidths, next, MIN_COL_WIDTH);
    this.syncDimensions();
  }

  scaleRows(factor: number): void {
    if (!Number.isFinite(factor) || Math.abs(factor - 1) < 1e-6) return;
    const current = totalHeight(this.rowHeights);
    const next = current * factor;
    if (next < MIN_ROW_HEIGHT * this.rows) return;
    this.rowHeights = scaleRowHeights(this.rowHeights, next, MIN_ROW_HEIGHT);
    this.syncDimensions();
  }

  setRowHeight(index: number, value: number): void {
    if (index < 0 || index >= this.rows) return;
    const next = [...this.rowHeights];
    next[index] = Math.max(8, Math.round(value));
    this.rowHeights = normaliseSizes(next, 8);
    this.syncDimensions();
  }

  addColumn(at = this.columns, width?: number): void {
    const snapshot = { rows: this.rows, cols: this.columns, cells: this.cells.map((c) => ({ ...c })) };
    const w = width ?? Math.max(24, Math.round(totalWidth(this.colWidths) / this.columns));
    const next = [...this.colWidths];
    next.splice(Math.max(0, Math.min(at, next.length)), 0, w);
    this.colWidths = next;
    this.syncDimensions();
    this.ensureSize();
    this.relocateCells(snapshot, (r, c) => ({ row: r, col: c >= at ? c + 1 : c }));
  }

  addRow(at = this.rows, height?: number): void {
    const snapshot = { rows: this.rows, cols: this.columns, cells: this.cells.map((c) => ({ ...c })) };
    const h = height ?? Math.max(20, Math.round(totalHeight(this.rowHeights) / this.rows));
    const next = [...this.rowHeights];
    next.splice(Math.max(0, Math.min(at, next.length)), 0, h);
    this.rowHeights = next;
    this.syncDimensions();
    this.relocateCells(snapshot, (r, c) => ({ row: r >= at ? r + 1 : r, col: c }));
  }

  removeColumn(index: number): void {
    if (this.columns <= 1 || index < 0 || index >= this.columns) return;
    const snapshot = { rows: this.rows, cols: this.columns, cells: this.cells.map((c) => ({ ...c })) };
    this.colWidths = this.colWidths.filter((_, i) => i !== index);
    this.syncDimensions();
    this.relocateCells(snapshot, (r, c) =>
      c === index ? null : { row: r, col: c > index ? c - 1 : c },
    );
  }

  removeRow(index: number): void {
    if (this.rows <= 1 || index < 0 || index >= this.rows) return;
    const snapshot = { rows: this.rows, cols: this.columns, cells: this.cells.map((c) => ({ ...c })) };
    this.rowHeights = this.rowHeights.filter((_, i) => i !== index);
    this.syncDimensions();
    this.relocateCells(snapshot, (r, c) =>
      r === index ? null : { row: r > index ? r - 1 : r, col: c },
    );
  }

  /**
   * After a column/row count change, carry existing cell content over by
   * absolute (row, column) wherever the new grid still has a slot.
   */
  private relocateCells(
    snapshot: { rows: number; cols: number; cells: TableCell[] },
    mapPosition: (r: number, c: number) => { row: number; col: number } | null,
  ): void {
    const next = makeCells(this.rows, this.columns);
    const expected = snapshot.rows * snapshot.cols;
    for (let i = 0; i < expected && i < snapshot.cells.length; i++) {
      const r = Math.floor(i / snapshot.cols);
      const c = i % snapshot.cols;
      const target = mapPosition(r, c);
      if (
        target &&
        target.row >= 0 &&
        target.row < this.rows &&
        target.col >= 0 &&
        target.col < this.columns
      ) {
        next[target.row * this.columns + target.col] = { ...snapshot.cells[i]! };
      }
    }
    this.cells = next;
  }

  resizeTo(width: number, height: number): void {
    this.colWidths = scaleColWidths(this.colWidths, width);
    this.rowHeights = scaleRowHeights(this.rowHeights, height);
    this.syncDimensions();
  }

  /* ---------------------------------------------------------------- */
  /* Serialisation                                                     */
  /* ---------------------------------------------------------------- */

  override toObject(
    propertiesToInclude: string[] = [],
  ): Record<string, unknown> {
    return {
      ...super.toObject(propertiesToInclude),
      type: "BillTable",
      resizeGesture: null,
      colWidths: [...this.colWidths],
      rowHeights: [...this.rowHeights],
      cells: this.cells.map((c) => ({ ...c })),
      borderColor: this.borderColor,
      borderWidth: this.borderWidth,
      cellFill: this.cellFill,
      headerRow: this.headerRow,
      headerFill: this.headerFill,
      headerTextColor: this.headerTextColor,
      cellTextColor: this.cellTextColor,
      padding: this.padding,
      fontFamily: this.fontFamily,
    };
  }

  static async fromObject(object: Record<string, unknown>): Promise<BillTable> {
    const {
      colWidths,
      rowHeights,
      cells,
      borderColor,
      borderWidth,
      cellFill,
      headerRow,
      headerFill,
      headerTextColor,
      cellTextColor,
      padding,
      fontFamily,
      ...fabricProps
    } = object as Record<string, unknown> & Partial<BillTableSpec>;

    const table = new BillTable({
      colWidths: (colWidths as number[]) ?? DEFAULT_TABLE_SPEC.colWidths,
      rowHeights: (rowHeights as number[]) ?? DEFAULT_TABLE_SPEC.rowHeights,
      cells: (cells as TableCell[]) ?? [],
      borderColor: (borderColor as string) ?? DEFAULT_TABLE_SPEC.borderColor,
      borderWidth: (borderWidth as number) ?? DEFAULT_TABLE_SPEC.borderWidth,
      cellFill: (cellFill as string) ?? DEFAULT_TABLE_SPEC.cellFill,
      headerRow: (headerRow as boolean) ?? DEFAULT_TABLE_SPEC.headerRow,
      headerFill: (headerFill as string) ?? DEFAULT_TABLE_SPEC.headerFill,
      headerTextColor:
        (headerTextColor as string) ?? DEFAULT_TABLE_SPEC.headerTextColor,
      cellTextColor:
        (cellTextColor as string) ?? DEFAULT_TABLE_SPEC.cellTextColor,
      padding: (padding as number) ?? DEFAULT_TABLE_SPEC.padding,
      fontFamily: (fontFamily as string) ?? DEFAULT_TABLE_SPEC.fontFamily,
    });

    // `enlivenObjects` reads `type` to choose the class before it calls this,
    // so the value is spent by the time we get here. Passing it on would make
    // Fabric's `set` log "Setting type has no effect" on every template load.
    delete fabricProps.type;
    table.set(fabricProps as never);
    table.resizeGesture = null;
    table.setCoords();
    return table;
  }

  /* ---------------------------------------------------------------- */
  /* Rendering                                                         */
  /* ---------------------------------------------------------------- */

  private isHeader(row: number): boolean {
    return this.headerRow && row === 0;
  }

  private paintCell(
    ctx: CanvasRenderingContext2D,
    row: number,
    column: number,
    ox: number,
    oy: number,
  ): void {
    const r = cellRect(this.colWidths, this.rowHeights, row, column);
    const x = r.x + ox;
    const y = r.y + oy;
    const cell = this.getCell(row, column);
    const header = this.isHeader(row);

    const fill = header ? this.headerFill : this.cellFill;
    if (fill && fill !== "transparent") {
      ctx.fillStyle = fill;
      ctx.fillRect(x, y, r.width, r.height);
    }

    // The grid's own lines are not drawn here. They belong to the whole table
    // rather than to any one cell, and painting them per cell stroked every
    // interior edge twice; see `paintGrid` and `gridSegments`.

    const text = cell.text;
    if (!text) return;

    ctx.fillStyle = header ? this.headerTextColor : this.cellTextColor;
    ctx.font = `${cell.fontWeight === "bold" ? "bold " : ""}${cell.fontSize}px ${this.fontFamily}`;
    ctx.textBaseline = "middle";

    const pad = this.padding;
    const maxTextWidth = Math.max(0, r.width - pad * 2);
    let tx = x + pad;
    if (cell.textAlign === "center") {
      ctx.textAlign = "center";
      tx = x + r.width / 2;
    } else if (cell.textAlign === "right") {
      ctx.textAlign = "right";
      tx = x + r.width - pad;
    } else {
      ctx.textAlign = "left";
    }
    const ty = y + r.height / 2;

    // Ellipsise rather than overflow the cell.
    let display = text;
    if (ctx.measureText(display).width > maxTextWidth) {
      while (display.length > 1 && ctx.measureText(`${display}...`).width > maxTextWidth) {
        display = display.slice(0, -1);
      }
      display = `${display}...`;
    }
    ctx.fillText(display, tx, ty, maxTextWidth);
  }

  /**
   * Fabric renders a custom object's content with the local origin at the
   * object's centre, so the grid is painted from `(-w/2, -h/2)`. Painting from
   * `(0, 0)` would draw the table half its size down and right of the position
   * Fabric reports, which is what the selection handles follow.
   */
  private originOffset(): { x: number; y: number } {
    return { x: -(this.width ?? 0) / 2, y: -(this.height ?? 0) / 2 };
  }

  /**
   * Stroke every grid line exactly once.
   *
   * The grid used to come from one `strokeRect` per cell, which stroked each
   * interior edge twice — once from each neighbouring cell — while the outer
   * frame was stroked once. Two strokes over the same pixels darken the line and
   * thicken it through anti-aliasing, so the inside of the grid looked heavier
   * than its own border. Walking `gridSegments` instead strokes every edge
   * once, which is what makes a table's lines all identical.
   *
   * Half the stroke is inset so the grid stays inside the object's box and
   * lines meet cleanly at the corners rather than overshooting.
   */
  private paintGrid(ctx: CanvasRenderingContext2D, ox: number, oy: number): void {
    if (this.borderWidth <= 0 || !this.borderColor) return;
    const half = this.borderWidth / 2;
    ctx.save();
    ctx.strokeStyle = this.borderColor;
    ctx.lineWidth = this.borderWidth;
    ctx.beginPath();
    for (const seg of gridSegments(this.colWidths, this.rowHeights)) {
      if (seg.vertical) {
        // Inset from both ends so the line's caps stay within the grid.
        ctx.moveTo(ox + seg.at + half, oy + half);
        ctx.lineTo(ox + seg.at + half, oy + seg.length - half);
      } else {
        ctx.moveTo(ox + half, oy + seg.at + half);
        ctx.lineTo(ox + seg.length - half, oy + seg.at + half);
      }
    }
    ctx.stroke();
    ctx.restore();
  }

  override _render(ctx: CanvasRenderingContext2D): void {
    const { x: ox, y: oy } = this.originOffset();
    for (let r = 0; r < this.rows; r++) {
      for (let c = 0; c < this.columns; c++) {
        this.paintCell(ctx, r, c, ox, oy);
      }
    }
    // After the cells, so a cell fill or text can never paint over a line.
    this.paintGrid(ctx, ox, oy);
    this.paintActiveCell(ctx, ox, oy);
  }

  /** Highlight the cell being edited. */
  private paintActiveCell(
    ctx: CanvasRenderingContext2D,
    ox: number,
    oy: number,
  ): void {
    if (this.editingCell < 0 || this.editingCell >= this.cells.length) return;
    const cols = this.columns;
    const row = Math.floor(this.editingCell / cols);
    const col = this.editingCell % cols;
    const r = cellRect(this.colWidths, this.rowHeights, row, col);
    ctx.save();
    ctx.strokeStyle = "#2563eb";
    ctx.lineWidth = 2;
    ctx.strokeRect(r.x + ox, r.y + oy, r.width, r.height);
    ctx.restore();
  }

  /* ---------------------------------------------------------------- */
  /* SVG                                                               */
  /* ---------------------------------------------------------------- */

  private esc(s: string): string {
    return s
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  /**
   * Custom objects must implement this: `FabricObject._createBaseSVGMarkup`
   * calls it, and the default implementation does not exist.
   *
   * Fabric already wraps the returned markup in the object's SVG transform, so
   * no manual translate is emitted here. Coordinates follow the same centred
   * local origin used by `_render`.
   */
  override _toSVG(): string[] {
    const parts: string[] = [];
    const { x: ox, y: oy } = this.originOffset();

    for (let r = 0; r < this.rows; r++) {
      for (let c = 0; c < this.columns; c++) {
        const rect = cellRect(this.colWidths, this.rowHeights, r, c);
        const x = rect.x + ox;
        const y = rect.y + oy;
        const cell = this.getCell(r, c);
        const header = this.isHeader(r);
        const fill = header ? this.headerFill : this.cellFill;

        if (fill && fill !== "transparent") {
          parts.push(
            `<rect x="${x}" y="${y}" width="${rect.width}" height="${rect.height}" fill="${fill}" />`,
          );
        }
        // No per-cell stroke here: it is emitted once for the whole grid
        // below, so every line has the same weight in the exported SVG too.
        if (cell.text) {
          const pad = this.padding;
          let anchor = "start";
          let tx = x + pad;
          if (cell.textAlign === "center") {
            anchor = "middle";
            tx = x + rect.width / 2;
          } else if (cell.textAlign === "right") {
            anchor = "end";
            tx = x + rect.width - pad;
          }
          const ty = y + rect.height / 2;
          parts.push(
            `<text x="${tx}" y="${ty}" font-family="${this.fontFamily}" font-size="${cell.fontSize}" font-weight="${cell.fontWeight}" text-anchor="${anchor}" dominant-baseline="central" fill="${header ? this.headerTextColor : this.cellTextColor}">${this.esc(cell.text)}</text>`,
          );
        }
      }
    }

    // One stroke per grid line, mirroring `paintGrid`. A `<rect>` per cell would
    // stroke every interior edge twice and make the exported grid's inside
    // darker than its frame.
    if (this.borderWidth > 0 && this.borderColor) {
      const half = this.borderWidth / 2;
      const shared =
        `fill="none" stroke="${this.borderColor}" stroke-width="${this.borderWidth}"`;
      for (const seg of gridSegments(this.colWidths, this.rowHeights)) {
        if (seg.vertical) {
          parts.push(
            `<line x1="${ox + seg.at + half}" y1="${oy + half}" x2="${ox + seg.at + half}" y2="${oy + seg.length - half}" ${shared} />`,
          );
        } else {
          parts.push(
            `<line x1="${ox + half}" y1="${oy + seg.at + half}" x2="${ox + seg.length - half}" y2="${oy + seg.at + half}" ${shared} />`,
          );
        }
      }
    }

    return parts;
  }

  /** Column edge positions, used by the resize handles in the UI. */
  getColumnEdges(): number[] {
    return columnLines(this.colWidths);
  }

  getRowEdges(): number[] {
    return rowLines(this.rowHeights);
  }

  getColumnSpan(index: number): number {
    return this.colWidths[index] ?? 0;
  }

  getRowSpan(index: number): number {
    return this.rowHeights[index] ?? 0;
  }

  getGridTotal(): { width: number; height: number } {
    return {
      width: sum(this.colWidths),
      height: sum(this.rowHeights),
    };
  }
}

classRegistry.setClass(BillTable, "BillTable");
classRegistry.setClass(BillTable, "table");

export { cellRect };
