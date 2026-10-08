/**
 * One stroke width for every outline tool, and the floor that keeps a thin
 * stroke visible when the page is zoomed out.
 *
 * Stroke widths are stored in **document units**, never screen pixels. That is
 * what makes a traced template reproducible: a rule drawn at 25% zoom and the
 * same rule drawn at 400% both record the same number, so the saved template
 * does not depend on the zoom the author happened to be working at.
 *
 * The consequence is that a 1px document stroke paints as 0.25 device pixels at
 * 25% zoom, which browsers render inconsistently — a 1px outline measured 1256
 * dark pixels at 100% zoom and 99 at 25%, so the same template looks like a
 * different line depending on how far out it is viewed. `renderedStrokeWidth`
 * is the floor that fixes that, and it is deliberately a *rendering* concern:
 * the stored value is never changed, so exports and saved files are identical
 * whatever the zoom was.
 */

/**
 * The shared default, in document units.
 *
 * 1.5 rather than the 1 the line and shape tools used to hardcode: freehand
 * already drew at 1.5 (it is `PencilBrush`'s own default), and one value for
 * every tool is the point. A hairline 1 also falls below a device pixel sooner
 * as the page shrinks. An author who wants something else still sets it per
 * object in the Appearance panel, and that explicit value always wins.
 */
export const DEFAULT_STROKE_WIDTH = 1.5;

/**
 * The thinnest a stroke is ever allowed to *paint*, in device pixels.
 *
 * Below this the browser's anti-aliasing spreads a sub-pixel line unevenly
 * across neighbouring pixels, which is the banding a zoomed-out page shows. At
 * or above it, the stroke is either a whole device pixel or genuinely scaled,
 * so it reads as a clean line.
 */
export const MIN_STROKE_DEVICE_PX = 1;

/**
 * The document-unit width to paint for `strokeWidth` at `zoom`.
 *
 * Above 100% zoom this is just `strokeWidth`, so the stroke keeps growing with
 * the page and stays in proportion with the reference it was traced against.
 * Below it, the width is raised until it would cover at least one device pixel,
 * which is the floor that makes a zoomed-out page even.
 *
 * A `strokeWidth` of 0 is returned untouched: no stroke is a legitimate choice
 * (an author may want an invisible outline), and inventing a visible one would
 * be the tool overruling them.
 */
export function renderedStrokeWidth(strokeWidth: number, zoom: number): number {
  if (!Number.isFinite(strokeWidth) || strokeWidth <= 0) return strokeWidth;
  const z = Number.isFinite(zoom) && zoom > 0 ? zoom : 1;
  return Math.max(strokeWidth, MIN_STROKE_DEVICE_PX / z);
}

/**
 * Outline tools that draw their own stroke: the ones whose default comes from
 * `DEFAULT_STROKE_WIDTH`.
 *
 * Text, tables, fields and image slots are excluded. A table's borders and a
 * field's box are structure rather than a traced line — they have their own
 * border settings, and a uniform floor on them would misrepresent what the
 * author drew.
 */
export function usesDefaultStroke(obj: {
  appType?: string;
  type?: string;
}): boolean {
  const kind = obj.appType ?? obj.type ?? "";
  return (
    kind === "line" ||
    kind === "hr" ||
    kind === "vr" ||
    kind === "rect" ||
    kind === "rounded-rect" ||
    kind === "ellipse" ||
    kind === "polygon" ||
    kind === "freehand"
  );
}

/**
 * Give an outline object the floor at the current zoom, without touching the
 * width it stores.
 *
 * Fabric has no "minimum rendered stroke" option: `strokeUniform` is the only
 * related flag and it makes the stroke *screen*-constant instead, which is a
 * different behaviour and also stops the width scaling with the page. So the
 * floor is applied by overriding the object's render, where the context is
 * already scaled by the viewport.
 *
 * `objectCaching` has to be off, because a cached object renders once into an
 * offscreen canvas and would keep the width it was cached at instead of picking
 * up a later zoom change.
 *
 * The override restores `strokeWidth` immediately after the paint, so the
 * stored value is what serialisation and the Appearance panel both read, and a
 * save at any zoom is identical.
 */
export function applyStrokeFloor(
  obj: {
    strokeWidth?: number;
    set?: (v: unknown, o?: unknown) => void;
  } & Record<string, unknown>,
  getZoom: () => number,
): void {
  const target = obj as {
    _render?: (ctx: CanvasRenderingContext2D) => void;
    strokeWidth?: number;
    set?: (v: unknown) => void;
    __strokeFloorInstalled?: boolean;
  };
  if (target.__strokeFloorInstalled || typeof target._render !== "function") return;
  target.__strokeFloorInstalled = true;
  target.set?.({ objectCaching: false } as never);

  const inner = target._render.bind(obj) as (ctx: CanvasRenderingContext2D) => void;
  target._render = (ctx: CanvasRenderingContext2D): void => {
    const stored = (obj.strokeWidth ?? 0) as number;
    const painted = renderedStrokeWidth(stored, getZoom());
    if (painted === stored) {
      inner(ctx);
      return;
    }
    // Fabric reads `strokeWidth` while painting, so the floor is applied for
    // the duration of the render and taken back out immediately afterwards.
    target.strokeWidth = painted;
    try {
      inner(ctx);
    } finally {
      target.strokeWidth = stored;
    }
  };
}