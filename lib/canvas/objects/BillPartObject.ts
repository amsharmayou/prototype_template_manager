import { FabricObject, classRegistry } from "fabric";

import type { SourceRect } from "@/lib/template/types";

export class BillPartObject extends FabricObject {
  static type = "BillPart";
  readonly appType = "bill-part";
  readonly src: string;
  readonly normalized: boolean;
  readonly sourceRect?: SourceRect;
  private element: HTMLCanvasElement | HTMLImageElement;

  constructor(options: {
    src?: string;
    normalized?: boolean;
    sourceRect?: SourceRect;
    image?: HTMLCanvasElement | HTMLImageElement;
  } = {}) {
    super({
      // Fabric renders custom content with the local origin at the object's
      // centre, so `_render` paints from `(-w/2, -h/2)` whatever this says —
      // see `ImagePlaceholderObject.originOffset`. What the origin decides is
      // what `left`/`top` *mean*: with Fabric's default centred origin `left`
      // would be the middle of the crop, and every caller here stores a
      // top-left corner (the serialiser's `getCenterPoint() - w/2`, the
      // properties panel, snapping), so the part would sit displaced by half
      // its own size.
      originX: "left",
      originY: "top",
    });
    this.src = options.src ?? "";
    this.normalized = options.normalized === true;
    this.sourceRect = options.sourceRect;
    this.element = options.image ?? BillPartObject.blank();
    if (!options.image && this.src) {
      // Nothing decoded to adopt, so fetch our own crop. This is the editor's
      // path: it hydrates a template with no image registry, and an object that
      // never loads its `src` would sit on the canvas as a placeholder for the
      // rest of the session. The export path pre-decodes instead, so there the
      // first paint is already the real crop and this never runs.
      this.selfLoad();
    }
    this.width ??= 1;
    this.height ??= 1;
    /**
     * Force the corner handles, and the rotation handle, on.
     *
     * This is an allowlist, not a denylist: Fabric 7's
     * `createObjectDefaultControls` also includes `ml/mr/mb/mt`, and
     * `getVisibility` falls back to `control.visible` for any handle missing
     * here, so the four side handles stay visible. That is deliberate — the
     * spec permits them for editor manipulation, and the controller's
     * uniform-scale clamp is what keeps the crop's aspect ratio from
     * drifting when one of them is dragged.
     */
    (this as unknown as { _controlsVisibility: Record<string, boolean> })._controlsVisibility = {
      tl: true,
      tr: true,
      bl: true,
      br: true,
      mtr: true,
    };
    this.set({ objectCaching: false } as never);
  }

  /**
   * Whether the element holds pixels a context is allowed to draw.
   *
   * `drawImage` with an image whose decode has not finished is a no-op rather
   * than an error, so handing it an undecoded element would paint nothing at
   * all — a blank that looks like a lost crop rather than a pending one. A
   * failed decode lands in the same state: `complete` goes true, `naturalWidth`
   * stays 0, so both are checked.
   */
  private get decoded(): boolean {
    const el = this.element as HTMLCanvasElement & { complete?: boolean; naturalWidth?: number };
    if (typeof el.complete === "boolean") {
      return el.complete && (el.naturalWidth ?? 0) > 0;
    }
    // A crop canvas is fully painted by the time `cropBillPart` returns it.
    return el.width > 0 && el.height > 0;
  }

  /**
   * Decode `src` into a fresh `Image` and ask for a repaint when it lands.
   *
   * The element is swapped in before the `src` is assigned, so every paint in
   * between sees a pending image — which `_render` draws as the placeholder —
   * rather than the 1x1 blank that would stretch over the box.
   */
  private selfLoad(): void {
    const img = new Image();
    this.element = img;
    img.onload = () => {
      this.dirty = true;
      // The object may not have reached a canvas yet (hydration builds the
      // whole list before anything is added), and there is nothing to repaint
      // until it has.
      this.canvas?.requestRenderAll();
    };
    img.src = this.src;
  }

  override _render(ctx: CanvasRenderingContext2D): void {
    const width = this.width ?? 1;
    const height = this.height ?? 1;
    // A crop that has not decoded yet paints the slot rather than nothing, so a
    // part on its way in reads as "not here yet" and not as a crop that went
    // missing. A decode that fails outright leaves it on the slot too, which is
    // the only honest thing to show for it.
    if (this.src && this.decoded) {
      ctx.drawImage(this.element, -width / 2, -height / 2, width, height);
      return;
    }
    ctx.fillStyle = "rgba(147,51,234,0.06)";
    ctx.fillRect(-width / 2, -height / 2, width, height);
    ctx.strokeStyle = "#9333ea";
    ctx.setLineDash([5, 5]);
    ctx.lineWidth = 1;
    ctx.strokeRect(-width / 2, -height / 2, width, height);
    ctx.setLineDash([]);
  }

  override _toSVG(): string[] {
    const { width = 0, height = 0 } = this;
    // `&` first: escaping it after the quotes would double-escape the `&` of
    // the entities this line emits. `Load Template` parses templates with a
    // bare `JSON.parse`, so an `&`-bearing src is a legal input, and one
    // unescaped ampersand makes the whole document — SVG *and* PDF, which
    // serialise the same string — invalid.
    const src = this.src.replaceAll("&", "&amp;").replaceAll('"', "&quot;");
    return [
      `<image x="${-width / 2}" y="${-height / 2}" width="${width}" height="${height}" href="${src}" preserveAspectRatio="none" />`,
    ];
  }

  override toObject(props: string[] = []): Record<string, unknown> {
    return {
      ...super.toObject(props),
      type: BillPartObject.type,
      appType: this.appType,
      src: this.src,
      normalized: this.normalized,
      ...(this.sourceRect ? { sourceRect: this.sourceRect } : {}),
    };
  }

  /**
   * Rebuild from `toObject`, keeping every Fabric property.
   *
   * `clone()` is `this.constructor.fromObject(this.toObject())`, and the
   * inherited `FabricObject._fromObject` just calls `new this(serialized)`. The
   * constructor above only reads its own four options and forwards nothing else
   * to `super`, so every positional property was dropped: duplicating a part
   * produced a 0x0 ghost in the corner rather than a second copy. Splitting the
   * app fields off and `set`ting the rest is what makes the duplicate a real
   * object, and it is the same shape `ImagePlaceholderObject.fromObject` uses.
   */
  static async fromObject(object: Record<string, unknown>): Promise<BillPartObject> {
    const { src, normalized, sourceRect, ...fabricProps } = object as {
      src?: unknown;
      normalized?: unknown;
      sourceRect?: SourceRect;
    } & Record<string, unknown>;
    // Both are fixed by the class itself, and `set`ting `type` only makes
    // Fabric log that the assignment has no effect.
    delete fabricProps.type;
    delete fabricProps.appType;
    const part = new BillPartObject({
      src: typeof src === "string" ? src : "",
      normalized: normalized === true,
      sourceRect,
    });
    part.set(fabricProps as never);
    part.setCoords();
    return part;
  }

  private static blank(): HTMLCanvasElement {
    const c = document.createElement("canvas");
    c.width = 1;
    c.height = 1;
    c.getContext("2d")?.fillRect(0, 0, 1, 1);
    return c;
  }
}

classRegistry.setClass(BillPartObject, "BillPart");
classRegistry.setClass(BillPartObject, "bill-part");
