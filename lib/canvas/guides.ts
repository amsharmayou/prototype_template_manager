import type { GuideAttachment, LayoutConfig, LayoutGuide } from "@/lib/template/types";

/**
 * Marking lines: editor furniture that must never become bill artwork.
 *
 * A guide is a boundary a growing field can push. It is drawn on the canvas so
 * it can be grabbed and dragged, and it is stored in the template so the layout
 * solver can find it - but the moment it reaches the rendered page it is a line
 * printed across a customer's invoice.
 *
 * The separation is the whole difficulty, so it is kept in one place: the
 * canvas object carries `appType: "guide"`, [isGuide] recognises it, and the
 * serialiser is only ever handed what is left after that filter.
 */

/** Discriminator stamped on a guide overlay, matching the other object kinds. */
export const GUIDE_APP_TYPE = "guide";

/** A canvas object, seen only as far as this module needs it. */
export interface GuideOverlay {
  appType?: string;
  guideId?: string;
  guideOrientation?: string;
  guideMaxDisplacement?: number;
  left?: number;
  top?: number;
}

export function isGuide(o: unknown): boolean {
  return (
    typeof o === "object" &&
    o !== null &&
    (o as GuideOverlay).appType === GUIDE_APP_TYPE
  );
}

/**
 * A guide id that is not already taken.
 *
 * Numbered rather than random so two authors drawing guides in the same order
 * produce the same ids, which keeps saved templates diffable.
 */
export function nextGuideId(existing: readonly LayoutGuide[]): string {
  const taken = new Set(existing.map((g) => g.id));
  let n = existing.length + 1;
  while (taken.has(`guide-${n}`)) n += 1;
  return `guide-${n}`;
}

/**
 * Read the guides back off the canvas.
 *
 * The canvas is the source of truth while editing - dragging the line is the
 * entire point of having it there - so this is what a save reads, not what an
 * earlier edit recorded.
 */
export function guidesFromObjects(objects: readonly unknown[]): LayoutGuide[] {
  const out: LayoutGuide[] = [];
  for (const raw of objects) {
    if (!isGuide(raw)) continue;
    const o = raw as GuideOverlay;
    if (typeof o.guideId !== "string" || o.guideId.length === 0) continue;
    const orientation =
      o.guideOrientation === "horizontal" || o.guideOrientation === "vertical"
        ? o.guideOrientation
        : null;
    if (!orientation) continue;
    // A horizontal guide carries a y, a vertical one an x. Reading the wrong
    // coordinate would put it at the origin, which is the one place a
    // boundary must never be.
    const position = orientation === "horizontal" ? o.top : o.left;
    if (typeof position !== "number" || !Number.isFinite(position)) continue;

    const guide: LayoutGuide = { id: o.guideId, orientation, position };
    if (typeof o.guideMaxDisplacement === "number" && Number.isFinite(o.guideMaxDisplacement)) {
      guide.maxDisplacement = o.guideMaxDisplacement;
    }
    out.push(guide);
  }
  return out;
}

export function guideAt(guides: readonly LayoutGuide[], id: string): LayoutGuide | undefined {
  return guides.find((g) => g.id === id);
}

/**
 * Set or clear a guide's displacement cap.
 *
 * Zero is treated as "no cap" because it reads like a number the author typed
 * into a box, while "this guide may never move" is a very different thing to
 * ask for and is not something this control offers.
 */
export function setGuideCap(
  guides: readonly LayoutGuide[],
  id: string,
  cap: number,
): LayoutGuide[] {
  return guides.map((g) => {
    if (g.id !== id) return g;
    if (!Number.isFinite(cap) || cap <= 0) {
      return { id: g.id, orientation: g.orientation, position: g.position };
    }
    return { ...g, maxDisplacement: cap };
  });
}

export function removeGuide(guides: readonly LayoutGuide[], id: string): LayoutGuide[] {
  return guides.filter((g) => g.id !== id);
}

export function attachmentsFor(
  attachments: readonly GuideAttachment[],
  guideId: string,
): GuideAttachment[] {
  return attachments.filter((a) => a.guideId === guideId);
}

/**
 * The layout block for a set of guides.
 *
 * Kept separate from the guides themselves so a document policy the author set
 * once is not reset by drawing another line, and so a template with no layout
 * block stays without one - that absence is what a renderer reads as "this is a
 * fixed-layout bill".
 */
export function withLayoutMode(
  existing: LayoutConfig | undefined,
  guides: readonly LayoutGuide[],
): LayoutConfig | undefined {
  const attached = existing?.attachments ?? [];
  if (!existing && guides.length === 0) return undefined;
  return {
    mode: "variable",
    ...(existing?.document ? { document: existing.document } : {}),
    guides: [...guides],
    ...(attached.length > 0 ? { attachments: [...attached] } : {}),
    // A collision policy the author chose must survive guide add/remove:
    // dropping it here would silently flip report→default on every drag.
    ...(existing?.collision !== undefined ? { collision: existing.collision } : {}),
  };
}

/** The canvas properties a new guide is created with. */
export function createGuide(guide: LayoutGuide): GuideOverlay & Record<string, unknown> {
  const common = {
    appType: GUIDE_APP_TYPE,
    guideId: guide.id,
    guideOrientation: guide.orientation,
    ...(guide.maxDisplacement !== undefined
      ? { guideMaxDisplacement: guide.maxDisplacement }
      : {}),
  };
  return guide.orientation === "horizontal"
    ? { ...common, left: 0, top: guide.position, width: 0, height: 0 }
    : { ...common, left: guide.position, top: 0, width: 0, height: 0 };
}