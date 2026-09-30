import { FabricObject, classRegistry } from "fabric";

import type { ImagePlaceholderRole } from "@/lib/template/types";

export interface ImagePlaceholderSpec {
  placeholderRole: ImagePlaceholderRole;
  label: string;
  borderColor: string;
  borderWidth: number;
  fill: string;
  textColor: string;
}

export const DEFAULT_IMAGE_PLACEHOLDER: ImagePlaceholderSpec = {
  placeholderRole: "image",
  label: "IMAGE",
  borderColor: "#6b7280",
  borderWidth: 1,
  fill: "rgba(107,114,128,0.06)",
  textColor: "#6b7280",
};

/**
 * A labelled box standing in for a logo, QR code, stamp or signature.
 * The future renderer substitutes a real image at this position.
 */
export class ImagePlaceholderObject extends FabricObject {
  static type = "BillImagePlaceholder";

  /** See `BillTable.appType`: Fabric lowercases `instance.type`. */
  readonly appType = "image-placeholder" as const;

  declare placeholderRole: ImagePlaceholderRole;
  declare label: string;
  declare borderColor: string;
  declare borderWidth: number;
  declare textColor: string;

  constructor(spec: Partial<ImagePlaceholderSpec> = {}) {
    const merged = { ...DEFAULT_IMAGE_PLACEHOLDER, ...spec };
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
    this.placeholderRole = merged.placeholderRole;
    this.label = merged.label;
    this.borderColor = merged.borderColor;
    this.borderWidth = merged.borderWidth;
    this.textColor = merged.textColor;
  }

  private esc(s: string): string {
    return s
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  /**
   * Fabric renders custom content with the local origin at the object's
   * centre, so the box is painted from `(-w/2, -h/2)` to line up with the
   * position Fabric reports and the selection handles follow.
   */
  private originOffset(): { x: number; y: number } {
    return { x: -(this.width ?? 0) / 2, y: -(this.height ?? 0) / 2 };
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

    // Dashed outline reads as "placeholder" rather than "content".
    ctx.save();
    ctx.setLineDash([6, 4]);
    ctx.strokeStyle = this.borderColor || "#6b7280";
    ctx.lineWidth = this.borderWidth || 1;
    ctx.strokeRect(
      ox + 0.5,
      oy + 0.5,
      Math.max(0, w - 1),
      Math.max(0, h - 1),
    );
    ctx.restore();

    const label = this.label || this.placeholderRole.toUpperCase();
    ctx.fillStyle = this.textColor || "#6b7280";
    ctx.font = `600 11px Arial, sans-serif`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    const maxWidth = Math.max(0, w - 12);
    if (ctx.measureText(label).width <= maxWidth) {
      ctx.fillText(label, ox + w / 2, oy + h / 2, maxWidth);
    } else {
      const clipped = `${label.slice(0, Math.max(1, Math.floor(label.length / 2)))}...`;
      ctx.fillText(clipped, ox + w / 2, oy + h / 2, maxWidth);
    }
  }

  override _toSVG(): string[] {
    const w = this.width ?? 0;
    const h = this.height ?? 0;
    const { x: ox, y: oy } = this.originOffset();
    const label = this.label || this.placeholderRole.toUpperCase();
    return [
      this.fill && this.fill !== "transparent"
        ? `<rect x="${ox}" y="${oy}" width="${w}" height="${h}" fill="${this.fill}" />`
        : "",
      `<rect x="${ox + 0.5}" y="${oy + 0.5}" width="${Math.max(0, w - 1)}" height="${Math.max(0, h - 1)}" fill="none" stroke="${this.borderColor}" stroke-width="${this.borderWidth}" stroke-dasharray="6 4" />`,
      `<text x="${ox + w / 2}" y="${oy + h / 2}" font-family="Arial, sans-serif" font-size="11" font-weight="600" text-anchor="middle" dominant-baseline="central" fill="${this.textColor}">${this.esc(label)}</text>`,
    ].filter(Boolean);
  }

  override toObject(
    propertiesToInclude: string[] = [],
  ): Record<string, unknown> {
    return {
      ...super.toObject(propertiesToInclude),
      type: "BillImagePlaceholder",
      placeholderRole: this.placeholderRole,
      label: this.label,
      borderColor: this.borderColor,
      borderWidth: this.borderWidth,
      textColor: this.textColor,
    };
  }

  static async fromObject(
    object: Record<string, unknown>,
  ): Promise<ImagePlaceholderObject> {
    const {
      placeholderRole,
      label,
      borderColor,
      borderWidth,
      textColor,
      fill,
      ...fabricProps
    } = object as Record<string, unknown>;
    const ph = new ImagePlaceholderObject({
      placeholderRole: (placeholderRole as ImagePlaceholderRole) ?? "image",
      label: (label as string) ?? "IMAGE",
      borderColor: (borderColor as string) ?? DEFAULT_IMAGE_PLACEHOLDER.borderColor,
      borderWidth: (borderWidth as number) ?? DEFAULT_IMAGE_PLACEHOLDER.borderWidth,
      textColor: (textColor as string) ?? DEFAULT_IMAGE_PLACEHOLDER.textColor,
      fill: (fill as string) ?? DEFAULT_IMAGE_PLACEHOLDER.fill,
    });
    ph.set(fabricProps as never);
    ph.setCoords();
    return ph;
  }
}

classRegistry.setClass(ImagePlaceholderObject, "BillImagePlaceholder");
classRegistry.setClass(ImagePlaceholderObject, "image-placeholder");
