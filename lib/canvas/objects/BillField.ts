import { FabricObject, classRegistry } from "fabric";

import type { FieldType } from "@/lib/template/types";

export interface FieldSpec {
  key: string;
  fieldType: FieldType;
  label: string;
  borderColor: string;
  borderWidth: number;
  fill: string;
  textColor: string;
  fontFamily: string;
  fontSize: number;
  fontWeight: "normal" | "bold";
  fontStyle: "normal" | "italic";
  textAlign: "left" | "center" | "right";
}

export const DEFAULT_FIELD: FieldSpec = {
  key: "field",
  fieldType: "text",
  label: "FIELD",
  borderColor: "#2563eb",
  borderWidth: 1,
  // Editor-only tint behind the dashed box. It is what makes a field
  // recognisable while tracing, and it must never reach the printed bill:
  // `fill` on a serialised field means the ink, so a 6%-alpha blue would print
  // the value almost invisibly.
  fill: "rgba(37,99,235,0.06)",
  // The value's ink, and the marker label's ink. Black, because that is what
  // the answer looks like on the bill; the blue dashed border is what marks the
  // slot as a field.
  textColor: "#000000",
  fontFamily: "Arial",
  // Matches a text box created with the text tool, so a field and a text box
  // dropped side by side agree until either is restyled.
  fontSize: 14,
  fontWeight: "normal",
  fontStyle: "normal",
  textAlign: "left",
};

/**
 * A dashed marker for a dynamic form slot. The renderer substitutes the
 * `{{key}}` value at this position; the canvas shows where the slot lives.
 */
export class FieldObject extends FabricObject {
  static type = "BillField";

  /** See `BillTable.appType`: Fabric lowercases `instance.type`. */
  readonly appType = "field" as const;

  declare key: string;
  declare fieldType: FieldType;
  declare label: string;
  declare borderColor: string;
  declare borderWidth: number;
  declare textColor: string;
  declare fontFamily: string;
  declare fontSize: number;
  declare fontWeight: "normal" | "bold";
  declare fontStyle: "normal" | "italic";
  declare textAlign: "left" | "center" | "right";

  constructor(spec: Partial<FieldSpec> = {}) {
    const merged = { ...DEFAULT_FIELD, ...spec };
    super({
      left: 0,
      top: 0,
      originX: "left",
      originY: "top",
      fill: merged.fill,
      stroke: merged.borderColor,
      strokeWidth: merged.borderWidth,
      objectCaching: false,
    });
    this.key = merged.key;
    this.fieldType = merged.fieldType;
    this.label = merged.label;
    this.borderColor = merged.borderColor;
    this.borderWidth = merged.borderWidth;
    this.textColor = merged.textColor;
    this.fontFamily = merged.fontFamily;
    this.fontSize = merged.fontSize;
    this.fontWeight = merged.fontWeight;
    this.fontStyle = merged.fontStyle;
    this.textAlign = merged.textAlign;
  }

  private esc(s: string): string {
    return s
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  private originOffset(): { x: number; y: number } {
    return { x: -(this.width ?? 0) / 2, y: -(this.height ?? 0) / 2 };
  }

  private labelFont(): string {
    const style = this.fontStyle === "italic" ? "italic " : "";
    const weight = this.fontWeight === "bold" ? "600 " : "400 ";
    const size = this.fontSize > 0 ? this.fontSize : DEFAULT_FIELD.fontSize;
    return `${style}${weight}${size}px ${this.fontFamily || DEFAULT_FIELD.fontFamily}`;
  }

  /** CSS `text-align` maps onto the same three values the panel offers. */
  private labelX(ox: number, w: number): number {
    if (this.textAlign === "left") return ox + 4;
    if (this.textAlign === "right") return ox + w - 4;
    return ox + w / 2;
  }

  private anchorFor(): CanvasTextAlign {
    if (this.textAlign === "left") return "left";
    if (this.textAlign === "right") return "right";
    return "center";
  }

  override _render(ctx: CanvasRenderingContext2D): void {
    const w = this.width ?? 0;
    const h = this.height ?? 0;
    const { x: ox, y: oy } = this.originOffset();

    const fill = this.fill as unknown as string | undefined;
    if (fill && fill !== "transparent") {
      ctx.fillStyle = fill;
      ctx.fillRect(ox, oy, w, h);
    }

    ctx.save();
    ctx.setLineDash([4, 3]);
    ctx.strokeStyle = this.borderColor || "#2563eb";
    ctx.lineWidth = this.borderWidth || 1;
    ctx.strokeRect(
      ox + 0.5,
      oy + 0.5,
      Math.max(0, w - 1),
      Math.max(0, h - 1),
    );
    ctx.restore();

    const label = this.label || this.key;
    ctx.fillStyle = this.textColor || "#2563eb";
    ctx.font = this.labelFont();
    ctx.textAlign = this.anchorFor();
    ctx.textBaseline = "middle";
    // The gutter is symmetric for a centred label and one-sided for the
    // aligned ones, so the text never sits on the dashed border.
    const gutter = this.textAlign === "center" ? 8 : 4;
    const maxWidth = Math.max(0, w - gutter);
    const x = this.labelX(ox, w);
    if (ctx.measureText(label).width <= maxWidth) {
      ctx.fillText(label, x, oy + h / 2, maxWidth);
    } else {
      const clipped = `${label.slice(0, Math.max(1, Math.floor(label.length / 2)))}...`;
      ctx.fillText(clipped, x, oy + h / 2, maxWidth);
    }
  }

  override _toSVG(): string[] {
    const w = this.width ?? 0;
    const h = this.height ?? 0;
    const { x: ox, y: oy } = this.originOffset();
    const label = this.label || this.key;
    const anchor =
      this.textAlign === "left"
        ? "start"
        : this.textAlign === "right"
          ? "end"
          : "middle";
    const tx =
      this.textAlign === "left"
        ? ox + 4
        : this.textAlign === "right"
          ? ox + w - 4
          : ox + w / 2;
    const size = this.fontSize > 0 ? this.fontSize : DEFAULT_FIELD.fontSize;
    return [
      this.fill && this.fill !== "transparent"
        ? `<rect x="${ox}" y="${oy}" width="${w}" height="${h}" fill="${this.fill}" />`
        : "",
      `<rect x="${ox + 0.5}" y="${oy + 0.5}" width="${Math.max(0, w - 1)}" height="${Math.max(0, h - 1)}" fill="none" stroke="${this.borderColor}" stroke-width="${this.borderWidth}" stroke-dasharray="4 3" />`,
      `<text x="${tx}" y="${oy + h / 2}" font-family="${this.fontFamily}" font-size="${size}" font-weight="${this.fontWeight === "bold" ? 600 : 400}" font-style="${this.fontStyle}" text-anchor="${anchor}" dominant-baseline="central" fill="${this.textColor}">${this.esc(label)}</text>`,
    ].filter(Boolean);
  }

  override toObject(
    propertiesToInclude: string[] = [],
  ): Record<string, unknown> {
    return {
      ...super.toObject(propertiesToInclude),
      type: "BillField",
      key: this.key,
      fieldType: this.fieldType,
      label: this.label,
      borderColor: this.borderColor,
      borderWidth: this.borderWidth,
      textColor: this.textColor,
      fontFamily: this.fontFamily,
      fontSize: this.fontSize,
      fontWeight: this.fontWeight,
      fontStyle: this.fontStyle,
      textAlign: this.textAlign,
    };
  }

  static async fromObject(
    object: Record<string, unknown>,
  ): Promise<FieldObject> {
    const {
      key,
      fieldType,
      label,
      borderColor,
      borderWidth,
      textColor,
      fill,
      fontFamily,
      fontSize,
      fontWeight,
      fontStyle,
      textAlign,
      ...fabricProps
    } = object as Record<string, unknown>;
    const field = new FieldObject({
      key: (key as string) ?? "field",
      fieldType: (fieldType as FieldType) ?? "text",
      label: (label as string) ?? "FIELD",
      borderColor: (borderColor as string) ?? DEFAULT_FIELD.borderColor,
      borderWidth: (borderWidth as number) ?? DEFAULT_FIELD.borderWidth,
      textColor: (textColor as string) ?? DEFAULT_FIELD.textColor,
      fill: (fill as string) ?? DEFAULT_FIELD.fill,
      fontFamily: (fontFamily as string) ?? DEFAULT_FIELD.fontFamily,
      fontSize: (fontSize as number) ?? DEFAULT_FIELD.fontSize,
      fontWeight: (fontWeight as "normal" | "bold") ?? DEFAULT_FIELD.fontWeight,
      fontStyle:
        (fontStyle as "normal" | "italic") ?? DEFAULT_FIELD.fontStyle,
      textAlign:
        (textAlign as "left" | "center" | "right") ?? DEFAULT_FIELD.textAlign,
    });
    field.set(fabricProps as never);
    field.setCoords();
    return field;
  }
}

classRegistry.setClass(FieldObject, "BillField");
classRegistry.setClass(FieldObject, "field");
