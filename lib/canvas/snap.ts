/**
 * Snapping engine for the editor. Pure and Fabric-free, so it can be exercised
 * in the node test environment just like `lib/canvas/groups.ts`.
 *
 * The engine never touches geometry: it answers "how far is the moving object
 * from every candidate level on each axis, and which single level on that axis
 * is the nearest to a moving edge, within tolerance?". The caller applies the
 * correction and shows the returned guides.
 */

export interface Levels {
  x: number[]; // vertical levels in scene coordinates
  y: number[]; // horizontal levels
}

export interface SnapLine {
  // 'y' = a horizontal guide drawn at this scene y; 'x' = vertical at this x.
  axis: "x" | "y";
  pos: number;
}

export interface Edges {
  left: number;
  centreX: number;
  right: number;
  top: number;
  centreY: number;
  bottom: number;
}

/** All centres and edges of each rect, as vertical/horizontal candidate levels. */
export function levelsFromBounds(
  bounds: Array<{ left: number; top: number; right: number; bottom: number }>,
): Levels {
  const x: number[] = [];
  const y: number[] = [];
  for (const b of bounds) {
    x.push(b.left, (b.left + b.right) / 2, b.right);
    y.push(b.top, (b.top + b.bottom) / 2, b.bottom);
  }
  return { x, y };
}

/**
 * Choose, on each axis, the level that a moving edge/centre is closest to. The
 * reported offset moves every edge by the same amount so the whole edge row
 * lands on that level; independently per axis.
 */
export function snapToLevels(
  edges: Edges,
  levels: Levels,
  tolerance: number,
): { dx: number; dy: number; guides: SnapLine[] } {
  const bestX = bestOnAxis([edges.left, edges.centreX, edges.right], levels.x, tolerance);
  const bestY = bestOnAxis([edges.top, edges.centreY, edges.bottom], levels.y, tolerance);
  const guides: SnapLine[] = [];
  if (bestX) guides.push({ axis: "x", pos: bestX.level });
  if (bestY) guides.push({ axis: "y", pos: bestY.level });
  return {
    dx: bestX ? bestX.delta : 0,
    dy: bestY ? bestY.delta : 0,
    guides,
  };
}

interface Best {
  level: number;
  delta: number;
}

/**
 * Among candidate levels, the one that any of the moving segments aligns with
 * by the smallest absolute distance. A level may be matched by several segments
 * (a square corner matches both its left edge and its top edge); the smallest
 * absolute delta wins, and that level is reported once.
 */
function bestOnAxis(moving: number[], candidates: number[], tolerance: number): Best | null {
  let best: Best | null = null;
  for (const m of moving) {
    for (const c of candidates) {
      const delta = c - m;
      if (Math.abs(delta) > tolerance) continue;
      if (!best || Math.abs(delta) < Math.abs(best.delta)) best = { level: c, delta };
    }
  }
  return best;
}
