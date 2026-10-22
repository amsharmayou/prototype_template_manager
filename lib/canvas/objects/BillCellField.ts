import { FabricObject, classRegistry } from "fabric";

import type { FieldType } from "@/lib/template/types";

/**
 * The editor marker for a cell field: a dynamic value slot that fills a whole
 * box the way an Excel cell does.
 *
 * The marker shows the slot's key and the box it is bound to. The printed
 * output is different from the marker: the bound box paints its own stroke
 * and fill, and the cell field paints only the value inside it, clipped to
 * the box and growing the box downward when the value is longer than the
 * space (`expansion.y` unbounded under a container with `growthY: "content"`).
 */
export interface CellFieldSpec {
  key: string;
  fieldType: FieldType;
  label: string;
  fontFamily: string;
  fontSize: number;
  fontWeight: "normal" | "bold";
  fontStyle: "normal" | "italic";
  textAlign: "left" | "center" | "right";
  textVerticalAlign: "top" | "middle" | "bottom";
  padding: number;
  wrap: boolean;
  /** The box this field fills, or null while it is unbound. */
  containerId: string | null;
  /** The value's ink on the canvas marker. */
  textColor: string;
}

export const DEFAULT_CELL_FIELD: CellFieldSpec = {
  key: "cell",
  fieldType: "text",
  label: "CELL",
  fontFamily: "Arial",
  fontSize: 14,
  fontWeight: "normal",
  fontStyle: "normal",
  textAlign: "left",
  textVerticalAlign: "middle",
  padding: 6,
  wrap: true,
  containerId: null,
  textColor: "#047857",
};

/** Editor-only tints: recognisable while tracing, never printed. */
const TINT = "rgba(5,150,105,0.07)";
const BORDER = "#059669";

/**
 * A cell field slot. The printed value is rendered by the renderer at the
 * bound box's geometry (or the slot's own box when unbound); the canvas shows
 * the slot with a tint and a dashed border, which both stay in the editor.
 */
export class CellFieldObject extends FabricObject {
  static type = "BillCellField";

  /** Fabric lowercases `instance.type`. */
  readonly appType = "cell-field" as const;

  declare key: string;
  declare fieldType: FieldType;
  declare label: string;
  declare textColor: string;
  declare fontFamily: string;
  declare fontSize: number;
  declare fontWeight: "normal" | "bold";
  declare fontStyle: "normal" | "italic";
  declare textAlign: "left" | "center" | "right";
  declare textVerticalAlign: "top" | "middle" | "bottom";
  declare padding: number;
  declare wrap: boolean;
  declare containerId: string | null;

  constructor(spec: Partial<CellFieldSpec> = {}) {
    const merged = { ...DEFAULT_CELL_FIELD, ...spec };
    super({
      left: 0,
      top: 0,
      originX: "left",
      originY: "top",
      fill: TINT,
      stroke: BORDER,
      strokeWidth: 1,
      objectCaching: false,
    });
    this.key = merged.key;
    this.fieldType = merged.fieldType;
    this.label = merged.label;
    this.textColor = merged.textColor;
    this.fontFamily = merged.fontFamily;
    this.fontSize = merged.fontSize;
    this.fontWeight = merged.fontWeight;
    this.fontStyle = merged.fontStyle;
    this.textAlign = merged.textAlign;
    this.textVerticalAlign = merged.textVerticalAlign;
    this.padding = merged.padding;
    this.wrap = merged.wrap;
    this.containerId = merged.containerId;
  }

  private labelFont(): string {
    const style = this.fontStyle === "italic" ? "italic " : "";
    const weight = this.fontWeight === "bold" ? "600 " : "400 ";
    const size = this.fontSize > 0 ? this.fontSize : DEFAULT_CELL_FIELD.fontSize;
    return `${style}${weight}${size}px ${this.fontFamily || DEFAULT_CELL_FIELD.fontFamily}`;
  }

  private anchorFor(): CanvasTextAlign {
    if (this.textAlign === "left") return "left";
    if (this.textAlign === "right") return "right";
    return "center";
  }

  override _render(ctx: CanvasRenderingContext2D): void {
    const w = this.width ?? 0;
    const h = this.height ?? 0;
    const { x: ox, y: oy } = {
      x: -(this.width ?? 0) / 2,
      y: -(this.height ?? 0) / 2,
    };

    // The tint marks the slot; the bound box paints its own stroke over it in
    // the editor stack, so the cell reads as part of the box it fills.
    ctx.fillStyle = TINT;
    ctx.fillRect(ox, oy, w, h);

    ctx.save();
    ctx.setLineDash([5, 3]);
    ctx.strokeStyle = this.containerId ? BORDER : BORDER;
    ctx.lineWidth = 1;
    ctx.strokeRect(ox + 0.5, oy + 0.5, Math.max(0, w - 1), Math.max(0, h - 1));
    ctx.restore();

    const label = this.label || this.key;
    ctx.fillStyle = this.textColor;
    ctx.font = this.labelFont();
    ctx.textAlign = this.anchorFor();
    const gutter = 6;
    const maxWidth = Math.max(0, w - this.padding - gutter);
    const tx =
      this.textAlign === "left"
        ? ox + this.padding
        : this.textAlign === "right"
          ? ox + w - this.padding
          : ox + w / 2;
    const ty =
      this.textVerticalAlign === "top"
        ? oy + this.padding + this.fontSize * 0.9
        : this.textVerticalAlign === "bottom"
          ? oy + h - this.padding - 2
          : oy + h / 2;
    ctx.fillText(label, tx, ty, maxWidth);
  }

  override toObject(propertiesToInclude: string[] = []): Record<string, unknown> {
    return {
      ...super.toObject(propertiesToInclude),
      type: "BillCellField",
      key: this.key,
      fieldType: this.fieldType,
      label: this.label,
      textColor: this.textColor,
      fontFamily: this.fontFamily,
      fontSize: this.fontSize,
      fontWeight: this.fontWeight,
      fontStyle: this.fontStyle,
      textAlign: this.textAlign,
      textVerticalAlign: this.textVerticalAlign,
      padding: this.padding,
      wrap: this.wrap,
      containerId: this.containerId,
    };
  }

  static async fromObject(
    object: Record<string, unknown>,
  ): Promise<CellFieldObject> {
    const {
      key,
      fieldType,
      label,
      fontFamily,
      fontSize,
      fontWeight,
      fontStyle,
      textAlign,
      textVerticalAlign,
      padding,
      wrap,
      containerId,
      textColor,
      ...fabricProps
    } = object as Record<string, unknown>;
    const cell = new CellFieldObject({
      key: (key as string) ?? DEFAULT_CELL_FIELD.key,
      fieldType: (fieldType as FieldType) ?? DEFAULT_CELL_FIELD.fieldType,
      label: (label as string) ?? DEFAULT_CELL_FIELD.label,
      fontFamily: (fontFamily as string) ?? DEFAULT_CELL_FIELD.fontFamily,
      fontSize: (fontSize as number) ?? DEFAULT_CELL_FIELD.fontSize,
      fontWeight: (fontWeight as "normal" | "bold") ?? DEFAULT_CELL_FIELD.fontWeight,
      fontStyle: (fontStyle as "normal" | "italic") ?? DEFAULT_CELL_FIELD.fontStyle,
      textAlign: (textAlign as "left" | "center" | "right") ?? DEFAULT_CELL_FIELD.textAlign,
      textVerticalAlign:
        (textVerticalAlign as "top" | "middle" | "bottom") ?? DEFAULT_CELL_FIELD.textVerticalAlign,
      padding: (padding as number) ?? DEFAULT_CELL_FIELD.padding,
      wrap: (wrap as boolean) ?? DEFAULT_CELL_FIELD.wrap,
      containerId: (containerId as string | null) ?? DEFAULT_CELL_FIELD.containerId,
      textColor: (textColor as string) ?? DEFAULT_CELL_FIELD.textColor,
    });
    cell.set(fabricProps as never);
    cell.setCoords();
    return cell;
  }
}

classRegistry.setClass(CellFieldObject, "BillCellField");
classRegistry.setClass(CellFieldObject, "cell-field");
