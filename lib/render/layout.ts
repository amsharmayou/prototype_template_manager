import type { ContentMeasurement } from "./measure";
import type {
  AnchorRule,
  AxisExpansion,
  ChildAnchor,
  CollisionPolicy,
  ContainerPolicy,
  DocumentLayoutPolicy,
  GuideAttachment,
  LayoutGuide,
  TemplateDocument,
  TemplateObject,
} from "@/lib/template/types";

/**
 * The variable-layout solver.
 *
 * Pure: no DOM, no clock, no randomness. It takes base geometry plus
 * measurements and returns the geometry to paint, which is what lets the Web
 * preview, the Android WebView and a unit test all agree on the same numbers.
 *
 * Six rules shape everything here:
 *
 * 1. **Growth is recomputed from base geometry, never from the previous
 *    render.** Filling a bill shorter than the last one shrinks it back rather
 *    than leaving it stuck at its tallest.
 * 2. **Only a declared relationship changes geometry.** An object that merely
 *    crosses a guide's coordinate is untouched; movement comes from an
 *    attachment or from containing something that grew, never from proximity.
 * 3. **Layout grows, it never teleports.** A guide that has not moved changes
 *    nothing, so a short value renders the traced bill exactly as it was drawn.
 *    An attachment follows the boundary's *travel*, which is what makes a
 *    second section sit at the author's drawn offset instead of snapping onto
 *    the line the moment it is drawn.
 * 4. **A field cannot grow past the boundary that was moved for it.** Growth
 *    and the guide that allows it are solved together, which is what keeps this
 *    single-pass and therefore free of feedback loops. A field whose guide is
 *    capped reports that it no longer fits.
 * 5. **A box set to expand grows around what it contains.** A frame marked
 *    expandable stretches to keep the field inside it, keeping the margin the
 *    author drew - which is what makes a traced bill hold together when a
 *    value is longer than the space traced for it. Only an explicit opt-in
 *    container (`container.enabled` + `layoutParentId` membership) grows this
 *    way; proximity alone never creates membership.
 * 6. **Nothing is unbounded in practice.** Every axis is bounded by the page,
 *    by a cap or by a safety limit, and reaching one is reported rather than
 *    hidden.
 * 7. **Siblings never move each other.** Anchors preserve authored insets
 *    inside a grown parent; collisions are reported, never auto-resolved by
 *    pushing a sibling the author did not ask to move.
 */

/** One render's inputs. Every field is required so a partial call cannot compile. */
export interface LayoutInput {
  /** Post-expansion objects, in base geometry. Never mutated. */
  objects: readonly TemplateObject[];
  /** Keyed by object id. An object with no entry keeps its authored size. */
  measurements: Readonly<Record<string, ContentMeasurement>>;
  guides: readonly LayoutGuide[];
  attachments: readonly GuideAttachment[];
  documentPolicy: DocumentLayoutPolicy;
  document: TemplateDocument;
  /**
   * Sibling collision handling inside layout containers. Defaults to
   * `"report"`: keep geometry, add a diagnostic. `"allow"` stays silent for
   * intentional overlap. The solver never pushes a sibling to resolve one.
   */
  collision?: CollisionPolicy;
}

export interface LayoutOutput {
  /** Copies carrying final geometry. Input objects are left untouched. */
objects: TemplateObject[];
  /**
   * The page size to render at.
   *
   * Named `page` rather than `document` so it cannot be confused with the
   * template's own `document`: that is the page the author traced, this is the
   * one the content ended up needing.
   */
  page: TemplateDocument;
  /** Final guide positions, so an editor can draw the moved boundary. */
  guides: LayoutGuide[];
  /** Prose, in the same shape `RenderResult.warnings` already uses. */
  diagnostics: string[];
}

interface Box {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** Objects that can hold content but carry none of their own to measure. */
function isShape(o: TemplateObject): boolean {
  return (
    o.type === "rect" ||
    o.type === "rounded-rect" ||
    o.type === "ellipse" ||
    o.type === "line" ||
    o.type === "hr" ||
    o.type === "vr" ||
    o.type === "polygon" ||
    o.type === "freehand"
  );
}

/** Only text-like objects carry a growth policy. */
function policyOf(o: TemplateObject): { x: AxisExpansion; y: AxisExpansion } | undefined {
  const e = (o as { expansion?: unknown }).expansion;
  if (typeof e !== "object" || e === null) return undefined;
  const rec = e as { x?: unknown; y?: unknown };
  if (typeof rec.x !== "object" || rec.x === null) return undefined;
  if (typeof rec.y !== "object" || rec.y === null) return undefined;
  return rec as { x: AxisExpansion; y: AxisExpansion };
}

function finite(v: unknown, fallback: number): number {
  return typeof v === "number" && Number.isFinite(v) ? v : fallback;
}

/** An axis result: the final size, and whether the content could not be shown in full. */
interface AxisResult {
  size: number;
  clipped: boolean;
}

/**
 * Allocate one axis.
 *
 * Growth only ever adds, and never past the declared cap. `limit` is what an
 * unbounded axis is really bounded by - the page edge or a safety ceiling - so
 * "unbounded" never means literally unlimited.
 */
function allocateAxis(
  policy: AxisExpansion,
  base: number,
  needed: number,
  limit: number,
): AxisResult {
  const want = Math.max(0, needed);
  if (policy.mode === "fixed") {
    return { size: base, clipped: want > base + TOLERANCE };
  }
  const cap =
    policy.mode === "bounded" ? base + Math.max(0, finite(policy.maxGrowth, 0)) : limit;
  const allowed = Math.min(Math.max(base, want), Math.max(base, cap));
  return { size: allowed, clipped: want > allowed + TOLERANCE };
}

/** One guide's authored position and how far it is allowed to travel. */
interface GuideState {
  guide: LayoutGuide;
  base: number;
  cap: number;
}

/** Sub-pixel noise: layout is px-based, so under half a pixel is not a change. */
const TOLERANCE = 0.5;

/** How many containment passes nested boxes get to settle. */
const CONTAINMENT_PASSES = 4;

/** A box fully inside another, give or take a pixel of authoring slop. */
function contains(outer: Box, inner: Box): boolean {
  return (
    inner.x >= outer.x - TOLERANCE &&
    inner.y >= outer.y - TOLERANCE &&
    inner.x + inner.width <= outer.x + outer.width + TOLERANCE &&
    inner.y + inner.height <= outer.y + outer.height + TOLERANCE
  );
}

/** Two boxes overlapping by more than authoring slop. */
function overlaps(a: Box, b: Box): boolean {
  return (
    a.x < b.x + b.width - TOLERANCE &&
    b.x < a.x + a.width - TOLERANCE &&
    a.y < b.y + b.height - TOLERANCE &&
    b.y < a.y + a.height - TOLERANCE
  );
}

/** The opt-in container policy of a shape, or undefined for decoration. */
function containerOf(o: TemplateObject): ContainerPolicy | undefined {
  const c = (o as { container?: unknown }).container;
  if (typeof c !== "object" || c === null) return undefined;
  const rec = c as ContainerPolicy;
  if (rec.enabled !== true) return undefined;
  if (o.type !== "rect" && o.type !== "rounded-rect" && o.type !== "ellipse") return undefined;
  return rec;
}

/** Explicit layout-parent link; never inferred from proximity. */
function layoutParentOf(o: TemplateObject): string | null {
  const p = (o as { layoutParentId?: unknown }).layoutParentId;
  return typeof p === "string" && p.length > 0 ? p : null;
}

/** Sibling anchor of a child; absent means start/start (keep top-left). */
function anchorOf(o: TemplateObject): { horizontal: AnchorRule; vertical: AnchorRule; offsets: Required<Pick<ChildAnchor, "leftOffset" | "rightOffset" | "topOffset" | "bottomOffset">> } | undefined {
  const a = (o as { anchor?: unknown }).anchor;
  if (typeof a !== "object" || a === null) return undefined;
  const rec = a as ChildAnchor;
  return {
    horizontal: rec.horizontal ?? "start",
    vertical: rec.vertical ?? "start",
    offsets: {
      leftOffset: finite(rec.leftOffset, 0),
      rightOffset: finite(rec.rightOffset, 0),
      topOffset: finite(rec.topOffset, 0),
      bottomOffset: finite(rec.bottomOffset, 0),
    },
  };
}

function paddingOf(policy: ContainerPolicy | undefined): { top: number; right: number; bottom: number; left: number } {
  return {
    top: Math.max(0, finite(policy?.padding?.top, 0)),
    right: Math.max(0, finite(policy?.padding?.right, 0)),
    bottom: Math.max(0, finite(policy?.padding?.bottom, 0)),
    left: Math.max(0, finite(policy?.padding?.left, 0)),
  };
}

export function calculateLayout(input: LayoutInput): LayoutOutput {
  const diagnostics: string[] = [];
  const note = (text: string) => {
    if (!diagnostics.includes(text)) diagnostics.push(text);
  };

  const docW = finite(input.document?.width, 0);
  const docH = finite(input.document?.height, 0);
  const policy = input.documentPolicy ?? FIXED_POLICY;

  /* ---------------------------------------------------------------- */
  /* Guides                                                            */
  /* ---------------------------------------------------------------- */

  const guides = new Map<string, GuideState>();
  for (const g of input.guides) {
    if (!g || typeof g.id !== "string") continue;
    guides.set(g.id, {
      guide: g,
      base: finite(g.position, 0),
      cap: finite(g.maxDisplacement, Number.POSITIVE_INFINITY),
    });
  }

  // Attachments naming a guide that does not exist are reported and skipped. A
  // rule that cannot be honoured must not be half-applied.
  const usable: GuideAttachment[] = [];
  for (const a of input.attachments) {
    if (!a || typeof a.id !== "string") continue;
    if (!guides.has(a.guideId)) {
      note(`attachment "${a.id}" names guide "${String(a.guideId)}", which is not declared`);
      continue;
    }
    usable.push(a);
  }

  const byObject = new Map<string, GuideAttachment[]>();
  for (const a of usable) {
    const list = byObject.get(a.objectId) ?? [];
    list.push(a);
    byObject.set(a.objectId, list);
  }

  /* ---------------------------------------------------------------- */
  /* Dependency order, and the cycle check                             */
  /* ---------------------------------------------------------------- */

  // A guide waits for any guide that moves an object this one measures
  // through: if `g2` sits below a box that `g1` stretches, `g2` waits for `g1`.
  // `fieldEdges` records both a growth demand and an attachment against the
  // same guide, because either one makes a cycle unsatisfiable.
  const dependsOn = new Map<string, Set<string>>();
  const touches = new Map<string, Set<string>>();
  for (const id of guides.keys()) {
    dependsOn.set(id, new Set());
    touches.set(id, new Set());
  }
  for (const o of input.objects) {
    const p = policyOf(o);
    const ids = new Set<string>();
    if (p?.y.growthGuideId && guides.has(p.y.growthGuideId)) ids.add(p.y.growthGuideId);
    if (p?.x.growthGuideId && guides.has(p.x.growthGuideId)) ids.add(p.x.growthGuideId);
    const attached = new Set<string>();
    for (const a of byObject.get(o.id) ?? []) {
      if (attached.has(a.guideId)) continue;
      attached.add(a.guideId);
      // A guide bound to this object cannot be the one that moves it.
      for (const id of ids) {
        if (id !== a.guideId) touches.get(id)?.add(a.guideId);
      }
    }
    for (const id of ids) {
      for (const other of attached) {
        if (other !== id) dependsOn.get(id)?.add(other);
      }
    }
  }

  const ordered = topoOrder([...guides.keys()], dependsOn);
  let cyclic = false;
  if (ordered === null) {
    cyclic = true;
    note(
      "layout guide dependencies contain a cycle; those guides were left at their authored positions",
    );
  }
  const resolveOrder = ordered ?? [...guides.keys()];

  /* ---------------------------------------------------------------- */
  /* Base geometry, and what the content needs                         */
  /* ---------------------------------------------------------------- */

  const base = new Map<string, Box>();
  const byId = new Map<string, TemplateObject>();
  for (const o of input.objects) {
    base.set(o.id, { x: o.x, y: o.y, width: o.width, height: o.height });
    byId.set(o.id, o);
  }

  const solved = new Map<string, Box>();
  const clipped = new Set<string>();

  for (const o of input.objects) {
    const p = policyOf(o);
    if (!p) continue;
    const m = input.measurements?.[o.id];
    if (!m) continue;

    const needW = finite(m.naturalWidth, Number.NaN);
    const needH = finite(m.height, Number.NaN);
    if (Number.isNaN(needW) || Number.isNaN(needH)) {
      note(`"${o.id}" has a measurement that is not a finite size; it keeps its authored box`);
      continue;
    }

    const b = base.get(o.id)!;
    // What an "unbounded" axis is really bounded by. Under a fixed page that is
    // the page edge, so a field cannot silently grow off the sheet. Under an
    // expanding page the page follows the content, so the edge is not a limit -
    // the declared maximum is, and the safety ceiling stands in when there is
    // none. Reading the authored edge either way made `growthX: "expand"` a
    // no-op for the only case that exists: content wider than the traced sheet.
    const xLimit =
      policy.growthX === "expand"
        ? finite(policy.maxWidth, Number.MAX_SAFE_INTEGER)
        : Math.max(docW - b.x, b.width);
    const yLimit = Number.MAX_SAFE_INTEGER;
    const x = allocateAxis(p.x, b.width, needW, xLimit);
    const y = allocateAxis(p.y, b.height, needH, yLimit);

    solved.set(o.id, { x: b.x, y: b.y, width: x.size, height: y.size });
    if (x.clipped || y.clipped) clipped.add(o.id);
  }

  /**
   * The guides an object's own content can push, by content edge.
   *
   * A `growthGuideId` says it outright; a `bottom`/`right` attachment says the
   * same thing in geometry - "this edge runs into that boundary". `top`/`left`
   * attachments do not: growth runs downward and rightward, so an edge the
   * content grows *away from* has nothing to follow and must not drag the
   * boundary back toward the object.
   */
  const pushers = new Map<string, Set<string>>();
  for (const o of input.objects) {
    const s = solved.get(o.id);
    if (!s) continue;
    const p = policyOf(o);
    const links = new Set<string>();
    if (p?.y.growthGuideId && guides.has(p.y.growthGuideId)) links.add(p.y.growthGuideId);
    if (p?.x.growthGuideId && guides.has(p.x.growthGuideId)) links.add(p.x.growthGuideId);
    for (const a of byObject.get(o.id) ?? []) {
      if (a.edge === "bottom" || a.edge === "right") links.add(a.guideId);
    }
    if (links.size > 0) pushers.set(o.id, links);
  }

  // Rule: a guide moves by the largest single demand, never the sum. Two fields
  // sharing one boundary need it to clear both; they do not need it to clear
  // both of them stacked on top of the other.
  //
  // The demand is wherever the content's edge now falls past the boundary -
  // not "how much it grew". Testing the difference instead would make a second
  // render of an already-expanded template ask for nothing, because it is
  // already tall, and the boundary would quietly slide back to where it
  // started.
  const demand = new Map<string, number>();
  for (const o of input.objects) {
    const s = solved.get(o.id);
    if (!s) continue;
    for (const gid of pushers.get(o.id) ?? []) {
      const g = guides.get(gid)!;
      const horizontal = g.guide.orientation === "horizontal";
      const want = horizontal ? s.y + s.height - g.base : s.x + s.width - g.base;
      demand.set(gid, Math.max(demand.get(gid) ?? 0, Math.max(0, want)));
    }
  }

  const position = new Map<string, number>();
  for (const id of resolveOrder) {
    const g = guides.get(id)!;
    const want = cyclic ? 0 : Math.max(0, demand.get(id) ?? 0);
    if (want > g.cap + TOLERANCE) {
      note(`guide "${id}" reached its maximum displacement of ${g.cap} and stopped there`);
    }
    position.set(id, g.base + Math.min(want, g.cap));
  }

  /**
   * Rule 4: content cannot grow past the boundary that was moved for it.
   *
   * Solving the two together is what keeps this single-pass - a field can no
   * longer push a guide further than the guide will allow, so there is nothing
   * left to iterate. The authored size is the floor: a boundary drawn *inside*
   * a box never collapses that box.
   */
  if (!cyclic) {
    for (const o of input.objects) {
      const s = solved.get(o.id);
      if (!s) continue;
      const b = base.get(o.id)!;
      for (const gid of pushers.get(o.id) ?? []) {
        const g = guides.get(gid)!;
        const at = position.get(gid)!;
        const horizontal = g.guide.orientation === "horizontal";
        const reachable = horizontal ? at - s.y : at - s.x;
        const floor = horizontal ? b.height : b.width;
        const wanted = horizontal ? s.height : s.width;
        if (wanted > reachable + TOLERANCE) {
          const allowed = Math.max(floor, reachable);
          if (horizontal) {
            s.height = allowed;
          } else {
            s.width = allowed;
          }
          clipped.add(o.id);
        }
      }
    }
  }

  /* ---------------------------------------------------------------- */
  /* Boxes, starting from content or from the traced geometry           */
  /* ---------------------------------------------------------------- */

  const placed = new Map<string, Box>();
  for (const o of input.objects) {
    const s = solved.get(o.id);
    placed.set(o.id, s ? { ...s } : { ...base.get(o.id)! });
  }

  /**
 * Put one edge of a box on a boundary.
 *
 * Two readings of "this edge follows that guide" both turn up in a traced bill,
   * and the difference between them is a box that quietly moves:
   *
   * - **Drawn on the line** - the author placed this edge *at* the guide, so the
   *   edge is the guide: it sits there and travels with it. This is the common
   *   case, and it is also the steady state after a render, so the rule has to be
   *   idempotent in it or every re-render walks the box further.
   * - **Drawn clear of it** - the author left a margin, and that margin is part
   *   of the design: the edge follows the guide's travel and keeps its offset.
   *   Snapping it flush to the line would reshape a bill nobody asked to
   *   reshape, on the very first render.
   *
   * So the rule is expressed as travel from the authored edge, and the guide's
   * own coordinate is taken only as the destination once the edge was drawn on
   * it. Both cases are then a fixed point: feeding one render's geometry back
   * in produces the same geometry again, which is what stops a preview that
   * re-renders on every keystroke from walking the bill down the page.
   *
   * The content edge is a floor, so a boundary that stopped short of what the
   * text needs does not clip it; the policy cap is a ceiling.
   */
  const placeEdge = (
    box: Box,
    axis: "x" | "y",
    at: number,
    travel: number,
    authoredEdge: number,
    contentEdge: number,
    cap: number,
  ) => {
    // Authored on the guide: the edge is the boundary, now and after it moves.
    const drawnOnGuide = travel > TOLERANCE && at - authoredEdge <= TOLERANCE;
    const followed = drawnOnGuide ? at : authoredEdge + travel;
    const want = Math.min(Math.max(followed, contentEdge), cap);
    if (axis === "y") {
      box.height = Math.max(0, want - box.y);
    } else {
      box.width = Math.max(0, want - box.x);
    }
  };

  /**
   * Carry a whole box by the boundary, keeping its size.
   *
   * The same drawn-on-the-line rule as [placeEdge], read as a translation, so
   * the opposite edge comes along and a row of boxes below a moving line shifts
   * by exactly the line's displacement.
   */
  const carryTo = (box: Box, axis: "x" | "y", at: number, travel: number, authoredEdge: number) => {
    const drawnOnGuide = travel > TOLERANCE && at - authoredEdge <= TOLERANCE;
    const want = drawnOnGuide ? at : authoredEdge + travel;
    if (axis === "y") box.y = want;
    else box.x = want;
  };

  /** A ceiling on how far an object's own policy lets it grow past its base. */
  const growthCap = (o: TemplateObject, axis: "x" | "y", box: Box): number => {
    const p = policyOf(o);
    const piece = p?.[axis];
    if (!piece || piece.mode !== "bounded") return Number.POSITIVE_INFINITY;
    const added = Math.max(0, finite(piece.maxGrowth, 0));
    return axis === "y" ? box.y + box.height + added : box.x + box.width + added;
  };

  /* ---------------------------------------------------------------- */
  /* Attachments                                                       */
  /* ---------------------------------------------------------------- */

  for (const a of usable) {
    const box = placed.get(a.objectId);
    if (!box) continue;
    const g = guides.get(a.guideId)!;
    const at = position.get(a.guideId)!;
    const authored = base.get(a.objectId)!;
    const horizontal = g.guide.orientation === "horizontal";
    const axis = horizontal ? "y" : "x";

    // A horizontal guide controls top/bottom; a vertical one left/right. An
    // edge on the wrong axis is a mis-binding, not a licensed no-op, so it is
    // reported rather than quietly ignored.
    if (horizontal !== (a.edge === "top" || a.edge === "bottom")) {
      note(
        `attachment "${a.id}" binds the ${a.edge} edge to the ${horizontal ? "horizontal" : "vertical"} guide "${a.guideId}", which cannot control it`,
      );
      continue;
    }

    // An object whose own content set the boundary does not also get placed by
    // it: the two statements are the same one, and applying both would let the
    // box fight the guide that exists to make room for it. This is also what
    // keeps the "both edges on one guide" pair a no-op instead of a squash.
    if (pushers.get(a.objectId)?.has(a.guideId)) continue;

    const opposite =
      a.edge === "top" ? "bottom" : a.edge === "bottom" ? "top" : a.edge === "left" ? "right" : "left";
    const twin = (byObject.get(a.objectId) ?? []).find(
      (t) => t.guideId === a.guideId && t.edge === opposite,
    );
    const authoredEdge = horizontal
      ? a.edge === "bottom"
        ? authored.y + authored.height
        : authored.y
      : a.edge === "right"
        ? authored.x + authored.width
        : authored.x;
    const contentEdge = horizontal ? box.y + box.height : box.x + box.width;
    // The box came from `input.objects`, so the object it names is there.
    const cap = growthCap(byId.get(a.objectId)!, axis, box);
    const travel = Math.max(0, at - g.base);

    if (twin) {
      // Both edges on one boundary is a contradiction resolved by carrying the
      // whole box: the pair cannot mean "stretch to zero" and it must not mean
      // "whichever edge came last wins".
      if (twin.id < a.id) continue;
      note(
        `"${a.objectId}" has both ${opposite} and ${a.edge} attached to guide "${a.guideId}"; one box cannot have both edges on one boundary, so it follows the boundary instead`,
      );
      carryTo(box, axis, at, travel, authoredEdge);
      continue;
    }

    if (a.behavior === "move") {
      carryTo(box, axis, at, travel, authoredEdge);
      continue;
    }

    if (a.edge === "bottom" || a.edge === "right") {
      placeEdge(box, axis, at, travel, authoredEdge, contentEdge, cap);
    } else {
      // A top/left edge can only be carried by a boundary that moves down and
      // rightward: holding the opposite edge would squeeze the box, so the
      // attachment behaves as a follow.
      carryTo(box, axis, at, travel, authoredEdge);
    }
  }

  /* ---------------------------------------------------------------- */
  /* Shapes linked to a boundary                                       */
  /* ---------------------------------------------------------------- */

  // A shape carries no text to measure, so the pass above never sized it - but
  // an `expansion` linked to a guide that *did* move means "keep step with
  // that boundary". This is the same follow-and-grow rule an attachment
  // expresses, read off the object's own policy instead of a separate rule, so
  // the two ways of saying "grow with the line" cannot disagree.
  if (!cyclic) {
    for (const o of input.objects) {
      if (!isShape(o)) continue;
      const p = policyOf(o);
      if (!p) continue;
      const box = placed.get(o.id);
      if (!box) continue;
      const authored = base.get(o.id)!;
      for (const axis of ["y", "x"] as const) {
        const gid = p[axis].growthGuideId;
        if (!gid || !guides.has(gid)) continue;
        const g = guides.get(gid)!;
        const at = position.get(gid);
        if (at === undefined) continue;
        const horizontal = axis === "y";
        const authoredEdge = horizontal
          ? authored.y + authored.height
          : authored.x + authored.width;
        placeEdge(
          box,
          horizontal ? "y" : "x",
          at,
          Math.max(0, at - g.base),
          authoredEdge,
          Number.NEGATIVE_INFINITY,
          growthCap(o, axis, box),
        );
      }
    }
  }

  /* ---------------------------------------------------------------- */
  /* Explicit containers + anchors + collisions                      */
  /* ---------------------------------------------------------------- */

  // Membership is explicit (`layoutParentId`), never proximity: a frame with
  // `container.enabled` grows around its declared children, keeping the
  // authored padding. A plain rectangle stays decoration. Anchors then resolve
  // inside the grown parent; collisions are reported, never auto-pushed.
  if (!cyclic) {
    const linked = new Map<string, { y: boolean; x: boolean }>();
    for (const o of input.objects) {
      const p = policyOf(o);
      const onY = p?.y.growthGuideId !== undefined;
      const onX = p?.x.growthGuideId !== undefined;
      const edges = byObject.get(o.id) ?? [];
      linked.set(o.id, {
        y: onY || edges.some((a) => a.edge === "top" || a.edge === "bottom"),
        x: onX || edges.some((a) => a.edge === "left" || a.edge === "right"),
      });
    }

    const childrenOf = new Map<string, string[]>();
    for (const o of input.objects) {
      const parent = layoutParentOf(o);
      if (!parent || !byId.has(parent) || parent === o.id) continue;
      const list = childrenOf.get(parent) ?? [];
      list.push(o.id);
      childrenOf.set(parent, list);
    }

    // Depth inner?outer so a nested panel settles before its outer frame reads
    // it. A parent cycle is refused by validation; here a revisit simply stops
    // descending rather than looping.
    const depthOf = (id: string): number => {
      let depth = 0;
      let current: string | undefined = id;
      const seen = new Set<string>();
      while (current && !seen.has(current)) {
        seen.add(current);
        const parent = layoutParentOf(byId.get(current)!);
        if (!parent || !byId.has(parent)) break;
        depth += 1;
        current = parent;
      }
      return depth;
    };
    const containers = input.objects
      .filter((o) => containerOf(o) !== undefined && (childrenOf.get(o.id) ?? []).length > 0)
      .sort((a, b) => depthOf(b.id) - depthOf(a.id));

    const containerCeiling = (policy: ContainerPolicy, axis: "y" | "x", box: Box): number => {
      const max = axis === "y" ? policy.maxHeight : policy.maxWidth;
      if (max === undefined) return Number.POSITIVE_INFINITY;
      const origin = axis === "y" ? box.y : box.x;
      return origin + Math.max(0, finite(max, 0));
    };

    for (let pass = 0; pass < CONTAINMENT_PASSES; pass += 1) {
      let changed = false;
      for (const o of containers) {
        const box = placed.get(o.id)!;
        const baseBox = base.get(o.id)!;
        const policy = containerOf(o)!;
        const pad = paddingOf(policy);
        const links = linked.get(o.id)!;
        const members = (childrenOf.get(o.id) ?? [])
          .map((id) => byId.get(id)!)
          .filter(Boolean);
        for (const axis of ["y", "x"] as const) {
          const growth = axis === "y" ? policy.growthY ?? "content" : policy.growthX ?? "content";
          if (growth !== "content") continue;
          if (links[axis]) continue;
          const horizontal = axis === "y";
          const origin = horizontal ? baseBox.y : baseBox.x;
          const baseFar = horizontal ? baseBox.y + baseBox.height : baseBox.x + baseBox.width;
          const minSize = Math.max(0, finite(horizontal ? policy.minHeight : policy.minWidth, 0));
          let need = Math.max(baseFar, origin + minSize);
          for (const c of members) {
            const cb = placed.get(c.id)!;
            const far = horizontal ? cb.y + cb.height : cb.x + cb.width;
            need = Math.max(need, far + (horizontal ? pad.bottom : pad.right));
          }
          const wanted = Math.min(need, containerCeiling(policy, axis, box));
          if (wanted > (horizontal ? box.y + box.height : box.x + box.width) + TOLERANCE) {
            if (horizontal) box.height = wanted - box.y;
            else box.width = wanted - box.x;
            changed = true;
          }
        }
      }
      if (!changed) break;

      // Anchors resolve inside the grown parent: `start` keeps the authored
      // top/left offset, `end` keeps the bottom/right inset, `stretch` resizes
      // with the parent. Coordinates stay absolute; the parent's growth is the
      // delta between its placed and base far edges.
      for (const o of input.objects) {
        const parentId = layoutParentOf(o);
        if (!parentId || !byId.has(parentId)) continue;
        const anchor = anchorOf(o);
        if (!anchor) continue;
        const box = placed.get(o.id)!;
        const baseBox = base.get(o.id)!;
        const parentBox = placed.get(parentId)!;
        const parentBase = base.get(parentId)!;
        const grownY = parentBox.y + parentBox.height - (parentBase.y + parentBase.height);
        const grownX = parentBox.x + parentBox.width - (parentBase.x + parentBase.width);
        if (anchor.vertical === "end" && grownY > TOLERANCE) {
          const inset = Math.max(0, parentBase.y + parentBase.height - (baseBox.y + baseBox.height));
          box.y = parentBox.y + parentBox.height - inset - box.height;
        } else if (anchor.vertical === "stretch" && grownY > TOLERANCE) {
          const topInset = Math.max(0, baseBox.y - parentBase.y);
          const bottomInset = Math.max(0, parentBase.y + parentBase.height - (baseBox.y + baseBox.height));
          box.y = parentBox.y + topInset;
          box.height = Math.max(0, parentBox.y + parentBox.height - bottomInset - box.y);
        }
        if (anchor.horizontal === "end" && grownX > TOLERANCE) {
          const inset = Math.max(0, parentBase.x + parentBase.width - (baseBox.x + baseBox.width));
          box.x = parentBox.x + parentBox.width - inset - box.width;
        } else if (anchor.horizontal === "stretch" && grownX > TOLERANCE) {
          const leftInset = Math.max(0, baseBox.x - parentBase.x);
          const rightInset = Math.max(0, parentBase.x + parentBase.width - (baseBox.x + baseBox.width));
          box.x = parentBox.x + leftInset;
          box.width = Math.max(0, parentBox.x + parentBox.width - rightInset - box.x);
        }
      }
    }

    // Legacy fallback: a shape with an expansion policy but no explicit
    // container still grows around what its traced outline contained, so
    // templates authored before containers existed render unchanged.
    const legacyShapes = input.objects.filter(
      (o) => isShape(o) && policyOf(o) !== undefined && containerOf(o) === undefined,
    );
    for (let pass = 0; pass < CONTAINMENT_PASSES; pass += 1) {
      let changed = false;
      for (const o of legacyShapes) {
        const box = placed.get(o.id)!;
        const authored = base.get(o.id)!;
        const p = policyOf(o)!;
        const links = linked.get(o.id)!;
        for (const axis of ["y", "x"] as const) {
          if (p[axis].mode === "fixed") continue;
          if (links[axis]) continue;
          const horizontal = axis === "y";
          const inside = input.objects.filter((c) => c.id !== o.id && contains(authored, base.get(c.id)!));
          let need = horizontal ? box.y + box.height : box.x + box.width;
          for (const c of inside) {
            const cb = placed.get(c.id)!;
            const ca = base.get(c.id)!;
            const slack = horizontal
              ? Math.max(0, authored.y + authored.height - (ca.y + ca.height))
              : Math.max(0, authored.x + authored.width - (ca.x + ca.width));
            const edge = horizontal ? cb.y + cb.height : cb.x + cb.width;
            need = Math.max(need, edge + slack);
          }
          const cap = growthCap(o, axis, box);
          const wanted = Math.min(need, cap);
          if (wanted > (horizontal ? box.y + box.height : box.x + box.width) + TOLERANCE) {
            if (horizontal) box.height = wanted - box.y;
            else box.width = wanted - box.x;
            changed = true;
          }
        }
      }
      if (!changed) break;
    }

    // A frame that cannot grow around content that outgrew it is the one case
    // an author needs told about: the bill still prints, but the text leaves
    // the box it was drawn in. Explicit members report against their declared
    // parent; legacy shapes keep the geometric check.
    for (const o of input.objects) {
      const c = solved.get(o.id);
      if (!c) continue;
      const declared = layoutParentOf(o);
      if (declared && byId.has(declared)) {
        const holder = byId.get(declared)!;
        const policy = containerOf(holder);
        const hb = placed.get(holder.id)!;
        const overY = c.y + c.height > hb.y + hb.height + TOLERANCE;
        const overX = c.x + c.width > hb.x + hb.width + TOLERANCE;
        // Per-axis: a fixed Y reports Y overflow even when X still grows.
        const growsY =
          policy !== undefined
            ? (policy.growthY ?? "content") === "content"
            : (policyOf(holder)?.y.mode ?? "fixed") !== "fixed";
        const growsX =
          policy !== undefined
            ? (policy.growthX ?? "content") === "content"
            : (policyOf(holder)?.x.mode ?? "fixed") !== "fixed";
        if ((overY && !growsY) || (overX && !growsX)) {
          note(
            `"${o.id}" grew past "${holder.id}", which is set to a fixed size; enlarge that box or let it expand`,
          );
        }
        continue;
      }
      for (const holder of input.objects) {
        if (holder.id === o.id || !isShape(holder)) continue;
        const hp = policyOf(holder);
        if (hp && hp.y.mode !== "fixed") continue;
        if (!contains(base.get(holder.id)!, base.get(o.id)!)) continue;
        const hb = placed.get(holder.id)!;
        if (c.y + c.height > hb.y + hb.height + TOLERANCE || c.x + c.width > hb.x + hb.width + TOLERANCE) {
          note(
            `"${o.id}" grew past "${holder.id}", which is set to a fixed size; enlarge that box or let it expand`,
          );
        }
      }
    }

    // Collisions: siblings sharing one layout parent that overlap after all
    // growth. Reported by default; `collision: "allow"` stays silent for
    // intentional overlay. Never auto-resolved � moving a sibling the author
    // did not ask to move would invent layout.
    const collisionMode: CollisionPolicy = input.collision ?? "report";
    if (collisionMode === "report") {
      for (const [parentId, members] of childrenOf) {
        for (let i = 0; i < members.length; i += 1) {
          for (let j = i + 1; j < members.length; j += 1) {
            const a = placed.get(members[i]!)!;
            const b = placed.get(members[j]!)!;
            if (overlaps(a, b)) {
              note(
                `"${members[i]}" overlaps "${members[j]}" inside "${parentId}"; move one of them or set collision to allow`,
              );
            }
          }
        }
      }
    }
  }

  /* ---------------------------------------------------------------- */
  /* What could not be shown in full                                  */
  /* ---------------------------------------------------------------- */

  // Every way a slot ends up short of its content - its own cap, a boundary
  // that stopped early - funnels into this one set, so an author reading the
  // warnings hears about each field once and in the same words.
  for (const id of clipped) {
    note(`"${id}" could not be given the room its content needs; the text was not shrunk to fit`);
  }

  /* ---------------------------------------------------------------- */
  /* Page bounds                                                       */
  /* ---------------------------------------------------------------- */

  const objects = input.objects.map((o) => {
    const box = placed.get(o.id)!;
    return { ...o, x: box.x, y: box.y, width: box.width, height: box.height };
  });

  let lowest = 0;
  let rightmost = 0;
  for (const o of objects) {
    lowest = Math.max(lowest, o.y + o.height);
    rightmost = Math.max(rightmost, o.x + o.width);
  }

  let width = docW;
  let height = docH;

  if (policy.growthY === "expand") {
    const cap = finite(policy.maxHeight, Number.POSITIVE_INFINITY);
    height = Math.min(Math.max(height, lowest), cap);
    if (lowest > cap + TOLERANCE) {
      note(`the bill grew past the page height limit of ${cap} and was cut off there`);
    }
  } else if (lowest > height + TOLERANCE) {
    note(`content reaches ${Math.round(lowest)}px but the page is ${Math.round(height)}px tall`);
  }

  if (policy.growthX === "expand") {
    const cap = finite(policy.maxWidth, Number.POSITIVE_INFINITY);
    width = Math.min(Math.max(width, rightmost), cap);
  } else if (rightmost > width + TOLERANCE) {
    note(`content reaches ${Math.round(rightmost)}px but the page is ${Math.round(width)}px wide`);
  }

  return {
    objects,
    page: { width, height },
    guides: input.guides.map((g) => ({ ...g, position: position.get(g.id) ?? g.position })),
    diagnostics,
  };
}

/**
 * Kahn's algorithm over the guide graph.
 *
 * Returns `null` when the graph has a cycle, which is the signal the caller
 * uses to stop resolving rather than resolve in an arbitrary order.
 */
function topoOrder(ids: string[], deps: Map<string, Set<string>>): string[] | null {
  const state = new Map<string, 0 | 1 | 2>();
  const order: string[] = [];
  const visit = (id: string): boolean => {
    const s = state.get(id) ?? 0;
    if (s === 1) return false;
    if (s === 2) return true;
    state.set(id, 1);
    for (const dep of deps.get(id) ?? []) {
      if (!visit(dep)) return false;
    }
    state.set(id, 2);
    order.push(id);
    return true;
  };
  for (const id of ids) if (!visit(id)) return null;
  return order;
}

const FIXED_POLICY: DocumentLayoutPolicy = { growthX: "fixed", growthY: "fixed" };
