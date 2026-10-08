import type { TemplateObject } from "@/lib/template/types";

/**
 * The properties a multi-selection can edit at once.
 *
 * Every field is optional, and `undefined` means **the selection disagrees** —
 * not "the property is absent". The distinction matters: a stroke width of 0 is
 * a real shared value (an author who deliberately hid the outline), while
 * `undefined` is what makes the panel show a dash and refuse to pretend the
 * objects already agree.
 */
export interface SharedSelection {
  stroke?: string;
  strokeWidth?: number;
  fill?: string;
  /** The mean of the selection's opacities, so a slider starts somewhere real. */
  opacity?: number;
  visible?: boolean;
  locked?: boolean;
}

/** The properties a multi-selection may write, and which objects accept them. */
export type SharedKey = "stroke" | "strokeWidth" | "fill" | "visible" | "locked";

/**
 * Objects that own a stroke and a fill of their own.
 *
 * A table's grid lines, a field's box and an image slot's dashed border are
 * structure rather than a traced outline, and they carry that in their own
 * `borderColor`/`borderWidth` (or their own cell properties). Writing a shared
 * `stroke` at them would invent an outline the author never drew, so a shared
 * stroke is applied only to the objects that genuinely have one.
 *
 * Bill parts are excluded for a different reason: their "stroke" is nothing at
 * all — the crop is drawn as an image — so a stroke on one is meaningless.
 */
export function acceptsSharedPaint(o: TemplateObject): boolean {
  return (
    o.type === "rect" ||
    o.type === "rounded-rect" ||
    o.type === "ellipse" ||
    o.type === "line" ||
    o.type === "hr" ||
    o.type === "vr" ||
    o.type === "polygon" ||
    o.type === "freehand" ||
    o.type === "text" ||
    o.type === "field"
  );
}

/**
 * Objects whose visibility can be flipped. A bill part's crop is the content,
 * so hiding it is legitimate, but a table is the structure of a section and
 * every other object type in the template assumes it is there.
 */
export function acceptsVisibility(o: TemplateObject): boolean {
  return o.type !== "table";
}

function agree<T>(values: readonly T[]): T | undefined {
  if (values.length === 0) return undefined;
  const first = values[0]!;
  return values.every((v) => v === first) ? first : undefined;
}

/**
 * Reduce a selection to the values every member agrees on.
 *
 * A field is `undefined` when the members disagree, or when none of them can
 * carry it at all — so a selection of one table reports no stroke instead of
 * inventing one from the table's border width.
 */
export function sharedSelection(
  objects: readonly TemplateObject[],
): SharedSelection {
  if (objects.length === 0) return {};

  const paintable = objects.filter(acceptsSharedPaint);
  const out: SharedSelection = {};

  if (paintable.length > 0) {
    out.stroke = agree(paintable.map((o) => o.stroke));
    out.strokeWidth = agree(paintable.map((o) => o.strokeWidth));
    // A fill nobody has is not a shared value; it is an absent one.
    const fills = paintable.map((o) => o.fill).filter((f) => f !== undefined);
    out.fill = agree(fills);
  }

  const opacities = objects.map((o) => o.opacity).filter((n) => typeof n === "number");
  if (opacities.length > 0) {
    // Mean rather than a shared-or-undefined test: a slider showing nothing
    // because three objects sit at 100%/50%/20% is useless, and averaging is
    // the one number that makes dragging it do something predictable.
    out.opacity = opacities.reduce((a, b) => a + b, 0) / opacities.length;
  }

  const visible = objects.filter(acceptsVisibility);
  if (visible.length > 0) out.visible = agree(visible.map((o) => o.visible));

  out.locked = agree(objects.map((o) => o.locked));

  return out;
}