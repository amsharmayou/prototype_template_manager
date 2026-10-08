/**
 * Pure viewport maths for the editor.
 *
 * Fabric renders both the scene and the reference background image through the
 * same six-element viewport transform [zoom, 0, 0, zoom, tx, ty], so panning
 * and zooming move the canvas and the image as one surface. This module owns
 * every affine question: the fit scale, zoom clamping, pan clamping, zooming
 * about a cursor, and the scene<->screen conversions the inline cell editor
 * and the grid overlay need.
 *
 * Every function is total: a non-finite zoom, a zero-sized pane or a non-finite
 * translation all resolve to a safe centred/identity value rather than
 * propagating NaN into the canvas transform.
 */

export const MAX_ZOOM = 8;

export interface Size {
  width: number;
  height: number;
}

export interface Point {
  x: number;
  y: number;
}

/** The view state: a zoom factor and a screen-space translation. */
export interface Viewport {
  zoom: number;
  tx: number;
  ty: number;
}

function isFiniteNumber(v: number): boolean {
  return typeof v === "number" && Number.isFinite(v);
}

/** The scale at which the whole document fits the pane with nothing cropped. */
export function containScale(pane: Size, doc: Size): number {
  if (
    pane.width <= 0 ||
    pane.height <= 0 ||
    doc.width <= 0 ||
    doc.height <= 0
  ) {
    return 1;
  }
  return Math.min(pane.width / doc.width, pane.height / doc.height);
}

/**
 * Bound a zoom to `[minScale, MAX_ZOOM]`. The lower bound is the fit scale so
 * the user can never zoom out past the whole bill — except when the fit scale
 * itself exceeds MAX_ZOOM (a tiny document in a large pane), in which case the
 * fit scale is the floor, or the document would start clipped with no way to
 * reach the rest of it.
 */
/**
 * Floor well below the fit scale, so zooming out after the user has zoomed in
 * is always meaningful. Zoom-out used to stop at the fit scale, which is
 * exactly why the first wheel while zooming in reported the page "bound" and
 * there was no way further out — this keeps the gesture alive, with a
 * deterministic exit point of roughly half the fitted view.
 */
export function clampZoom(zoom: number, pane: Size, doc: Size): number {
  const fit = containScale(pane, doc);
  const floor = Math.min(MAX_ZOOM, Math.max(fit * 0.5, 0.05));
  if (!isFiniteNumber(zoom)) return floor;
  return Math.min(MAX_ZOOM, Math.max(floor, zoom));
}

/**
 * Free slippage permitted when the page covers the pane. Prevents the page
 * from appearing welded to the pane's edges: whenever the page is panned so
 * that it almost covers the pane, the user must still be able to pull it
 * either direction without it feeling stuck. Never enough to strand the
 * page entirely: one axis always shows at least part of the image.
 */
export const PAN_SLACK = 32;

/**
 * Clamp a screen-space translation on one axis. A page smaller than the pane
 * stays centred; a page that covers the pane may move within both edges of
 * the pane with up to PAN_SLACK px of overhang on each side.
 */
/**
 * Clamp a screen-space translation on one axis.
 *
 * When the page covers the pane (`imgSize > paneSize`), it may move within
 * both edges of the pane with up to PAN_SLACK px of overhang on each side.
 *
 * When the page falls inside the pane, the previous version snapped it to the
 * centre and held it there even though both full-length screen margins are
 * visible — exactly the weld reported after the first zoom. It now gives the
 * page a looser cage that both honours prompts to zoom out and lets the page
 * be nudged to wherever it fits best; it is clamped only to flush against
 * either pane edge with PAN_SLACK overhang, never past it.
 */
export function clampPan(t: number, paneSize: number, imgSize: number): number {
  if (!isFiniteNumber(t) || !(paneSize > 0) || !(imgSize > 0)) {
    return (paneSize - imgSize) / 2;
  }
  if (imgSize <= paneSize) {
    return Math.min(paneSize - imgSize + PAN_SLACK, Math.max(-PAN_SLACK, t));
  }
  return Math.min(PAN_SLACK, Math.max(paneSize - imgSize - PAN_SLACK, t));
}

export function sceneToScreen(point: Point, view: Viewport): Point {
  return {
    x: point.x * view.zoom + view.tx,
    y: point.y * view.zoom + view.ty,
  };
}

export function screenToScene(point: Point, view: Viewport): Point {
  if (!(view.zoom > 0)) return { x: 0, y: 0 };
  return {
    x: (point.x - view.tx) / view.zoom,
    y: (point.y - view.ty) / view.zoom,
  };
}

/** Fabric's affine viewport transform for a view state. */
export function viewportTransform(
  view: Viewport,
): [number, number, number, number, number, number] {
  return [view.zoom, 0, 0, view.zoom, view.tx, view.ty];
}

/**
 * Zoom so that `newZoom` is centred under `cursor`. The scene point beneath the
 * cursor is preserved by construction, then both axes are clamped so the image
 * still covers the pane.
 */
export function zoomAbout(
  cursor: Point,
  newZoom: number,
  view: Viewport,
  pane: Size,
  doc: Size,
): Viewport {
  const zoom = clampZoom(newZoom, pane, doc);
  const scene = screenToScene(cursor, view);
  const tx = cursor.x - scene.x * zoom;
  const ty = cursor.y - scene.y * zoom;
  return {
    zoom,
    tx: clampPan(tx, pane.width, doc.width * zoom),
    ty: clampPan(ty, pane.height, doc.height * zoom),
  };
}

/** The neutral view: the whole document visible, centred, nothing panned. */
/**
 * The neutral view: the whole document visible, centred, nothing panned.
 * The centres are computed rather than clamped: a zero translation clamps to
 * a pane-hugging edge in the axis where the page fits, which is the left/top
 * rather than the middle the user expects to return to.
 */
export function fitView(pane: Size, doc: Size): Viewport {
  const zoom = clampZoom(containScale(pane, doc), pane, doc);
  return {
    zoom,
    tx: clampPan((pane.width - doc.width * zoom) / 2, pane.width, doc.width * zoom),
    ty: clampPan((pane.height - doc.height * zoom) / 2, pane.height, doc.height * zoom),
  };
}

/** Pan by a screen-space delta, re-clamped. */
export function panBy(
  dx: number,
  dy: number,
  view: Viewport,
  pane: Size,
  doc: Size,
): Viewport {
  if (!isFiniteNumber(dx) || !isFiniteNumber(dy)) return view;
  return {
    ...view,
    tx: clampPan(view.tx + dx, pane.width, doc.width * view.zoom),
    ty: clampPan(view.ty + dy, pane.height, doc.height * view.zoom),
  };
}
