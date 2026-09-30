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

export const DEFAULT_TABLE_SPEC: BillTableSpec = {
  colWidths: [120, 120],
  rowHeights: [30, 30],
  cells: [],
  borderColor: "#000000",
  borderWidth: 1,
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
    const w = width ?? Math.max(24, Math.round(totalWidth(this.colWidths) / this.columns));
    const next = [...this.colWidths];
    next.splice(Math.max(0, Math.min(at, next.length)), 0, w);
    this.colWidths = next;
    this.syncDimensions();
    this.ensureSize();
    this.reindexCellsForShapeChange();
  }

  addRow(at = this.rows, height?: number): void {
    const h = height ?? Math.max(20, Math.round(totalHeight(this.rowHeights) / this.rows));
    const next = [...this.rowHeights];
    next.splice(Math.max(0, Math.min(at, next.length)), 0, h);
    this.rowHeights = next;
    this.syncDimensions();
    this.reindexCellsForShapeChange();
  }

  removeColumn(index: number): void {
    if (this.columns <= 1 || index < 0 || index >= this.columns) return;
    this.colWidths = this.colWidths.filter((_, i) => i !== index);
    this.syncDimensions();
    this.reindexCellsForShapeChange();
  }

  removeRow(index: number): void {
    if (this.rows <= 1 || index < 0 || index >= this.rows) return;
    this.rowHeights = this.rowHeights.filter((_, i) => i !== index);
    this.syncDimensions();
    this.reindexCellsForShapeChange();
  }

  /**
   * After a column/row count change, carry existing cell content over by
   * absolute (row, column) wherever the new grid still has a slot.
   */
  private reindexCellsForShapeChange(): void {
    const previous = this.cells.map((c) => ({ ...c }));
    const previousCols = Math.max(1, Math.round(Math.sqrt(previous.length)) || 1);
    const next = makeCells(this.rows, this.columns);
    const limit = Math.min(previous.length, next.length);
    for (let i = 0; i < limit; i++) {
      const row = Math.floor(i / previousCols);
      const column = i % previousCols;
      if (row < this.rows && column < this.columns) {
        next[row * this.columns + column] = { ...previous[i]! };
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

    table.set(fabricProps as never);
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

    if (this.borderWidth > 0 && this.borderColor) {
      ctx.strokeStyle = this.borderColor;
      ctx.lineWidth = this.borderWidth;
      // Inset by half the stroke so the grid stays inside the object box.
      const h = this.borderWidth / 2;
      ctx.strokeRect(
        x + h,
        y + h,
        Math.max(0, r.width - this.borderWidth),
        Math.max(0, r.height - this.borderWidth),
      );
    }

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

  override _render(ctx: CanvasRenderingContext2D): void {
    const { x: ox, y: oy } = this.originOffset();
    for (let r = 0; r < this.rows; r++) {
      for (let c = 0; c < this.columns; c++) {
        this.paintCell(ctx, r, c, ox, oy);
      }
    }
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
        if (this.borderWidth > 0 && this.borderColor) {
          parts.push(
            `<rect x="${x}" y="${y}" width="${rect.width}" height="${rect.height}" fill="none" stroke="${this.borderColor}" stroke-width="${this.borderWidth}" />`,
          );
        }
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
