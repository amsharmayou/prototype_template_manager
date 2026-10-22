import { collectDocumentVariables } from "@/lib/template/placeholders";
import type { ComputedSpec, RoundingMode } from "@/lib/package/format";
import {
  A4_HEIGHT,
  A4_WIDTH,
  TEMPLATE_VERSION,
  type BillTemplate,
  type TemplateObject,
} from "@/lib/template/types";

import { canonicalJson } from "./canonical";
import { computeAll, type ComputeOptions } from "./computed";
import { Refusals, safeLength, type Refusal } from "./css";
import { attr, escapeHtml } from "./escape";
import { calculateLayout } from "./layout";
import type { ContentMeasurement } from "./measure";
import { renderObject } from "./primitives";
import { expandRepeats, type RepeatContext } from "./repeat";
import { applyRowHeights, rowsWorthMeasuring } from "./rowHeights";
import { sha256Hex } from "./sha256";
import { stylesheet } from "./style";
import type { Values } from "./values";

export type { Refusal } from "./css";

export interface RenderOptions {
  title?: string;
  /** Evaluated before the page is painted. */
  computed?: readonly ComputedSpec[];
  /** Decimal places money is held in. Defaults to 2. */
  currencyScale?: number;
  /** The written rounding rule every computation follows. */
  rounding?: RoundingMode;
  /** Decimal places a count operand is read at inside products. */
  qtyScale?: number;
  /**
   * Specs evaluated per row of a repeat band (a band's line figure), separate
   * from `computed`: the whole-document pass runs once over every row, the
   * band pass runs once per row, and a caller that pre-applied `computed`
   * still owes the rows their own figures.
   */
  bandSpecs?: readonly ComputedSpec[];
  /**
   * The template's identity digest, precomputed by the caller from the
   * authored template. Supplied so a hash stays constant across values;
   * without it the fingerprint covers the template as handed in.
   */
  templateHash?: string;
  /**
   * Whether an unfilled slot is painted at all.
   *
   * `"hide"` (the default) is what a document wants: a `{{token}}` with no
   * value contributes nothing, and an image slot with no image is not drawn as
   * a dashed box. The author drew those marks for the editor, where they say
   * "put something here"; on paper they are a printing instruction the reader
   * cannot act on.
   *
   * `"show"` keeps them, which is what the editor and a debugging pass want -
   * a half-filled document is then legible as "these three are still missing"
   * rather than as three inexplicable gaps.
   */
  placeholders?: "hide" | "show";
  /**
   * What each growing slot's content needs, keyed by object id.
   *
   * Supplied by the host because measuring needs a font engine, and this
   * renderer has no DOM: the browser measures on web and the WebView measures
   * on Android. Omit it and every object keeps its authored geometry, so a
   * layout template still renders - as a fixed one.
   */
  measurements?: Readonly<Record<string, ContentMeasurement>>;
  /**
   * Re-measure a slot at the width the solver gave it, when it changed.
   *
   * A height measured at the base width is an upper bound for any wider box -
   * widening can only reduce the wrapped line count - so one pass is safe. It is
   * not *accurate*: a field that widens a long line is still sized for the
   * wrapped-out version. A host with a font engine (the browser, the WebView)
   * passes this so the height settles at the width the text will be painted at.
   *
   * Returning `undefined` means "no better number", and the original
   * measurement is kept. Never called for a box whose width did not change.
   */
  remeasure?: (id: string, width: number) => ContentMeasurement | undefined;
}

export interface RenderResult {
  html: string;
  refusals: Refusal[];
  variables: string[];
  warnings: string[];
  /**
   * Template carrying the geometry the document was actually drawn with,
   * so exporters can emit what the preview shows rather than guessing from
   * the authored template.
   */
  objects: TemplateObject[];
  /**
   * The page as it was actually drawn.
   *
   * Not always the authored size: a variable-layout document may have grown
   * to fit its content. A caller printing or exporting needs *these* numbers
   * - sizing a PDF from `template.document` would clip a receipt whose rows
   * pushed the bottom off the authored sheet, which is the one failure a
   * customer would actually notice.
   */
  page: { width: number; height: number };
}

/**
 * The page size is the one number the whole stylesheet multiplies, so a
 * non-numeric one would put `NaNpx` into every rule rather than break a single
 * element. A refused size falls back to A4: it is the only page size this app
 * already declares, a bill that is not A4 will still print scaled onto A4
 * paper, and a caller is told which two numbers were refused so the template
 * can be re-traced rather than silently re-shaped.
 */
function pageLength(v: unknown, field: string, refusals: Refusals, fallback: number): number {
  const n = safeLength(v, 0);
  if (n > 0) return n;
  refusals.add(`page.${field}`, String(v), "not a positive length; the page falls back to A4");
  return fallback;
}

/**
 * The template version is the one template-derived value that reaches an
 * attribute, so it is checked rather than merely escaped. Templates arrive
 * through an unvalidated cast, where a *string* version makes the comparison
 * above `NaN > 1`, which is false, and the raw string would otherwise land in
 * the attribute - a closing quote and an event handler away from running.
 * Escaping alone would still leave the caller reading `data-template-version="2"`
 * on a page that was never rendered for version 2, so an unreadable version is
 * refused and the supported one is emitted in its place.
 */
function sheetVersion(raw: unknown, refusals: Refusals): number {
  const v = safeLength(raw, Number.NaN);
  if (Number.isFinite(v) && v >= 0) return v;
  refusals.add(
    "templateVersion",
    String(raw),
    "not a version number; the supported version is emitted instead",
  );
  return TEMPLATE_VERSION;
}

/**
 * A plain object, or nothing. The `null` and array checks are load-bearing:
 * `typeof null` is `"object"` and both an array and a null carry no field named
 * `width`, so either would reach the dereference this guards.
 */
function record(v: unknown): Record<string, unknown> | undefined {
  return typeof v === "object" && v !== null && !Array.isArray(v)
    ? (v as Record<string, unknown>)
    : undefined;
}

function safeScaleOption(v: unknown, fallback: number): number {
  const n = typeof v === "number" && Number.isInteger(v) && v >= 0 && v <= 6 ? v : Number.NaN;
  return Number.isFinite(n) ? n : fallback;
}

/**
 * The template's identity fingerprint, over the template as authored: the same
 * template yields the same digest whatever values a form later supplies, so a
 * host can bind "the document I ship" to one digest and verify it at open.
 */
export function templateHashOf(
  template: BillTemplate,
  computed?: readonly ComputedSpec[],
): string {
  const hashComputations = computed ?? template.meta?.computed;
  return sha256Hex(
    canonicalJson({
      ...template,
      meta: {
        name: template.meta?.name,
        ...(Array.isArray(hashComputations) ? { computed: hashComputations } : {}),
      },
    }),
  );
}

/**
 * The document's name, as a string, or a refusal and a substitute.
 *
 * `escapeHtml` calls `.replace` on what it is given, so a numeric `meta.name`
 * - which a hand-edited template can carry just as easily as a missing one -
 * would throw from inside the escaper rather than be escaped.
 *
 * An absent name falls back to the default, which is what the old `?? "Document"`
 * did. A name of the *wrong type* is coerced rather than discarded: `42` is a
 * name someone typed, and printing `Document` in its place would overwrite it.
 * Both are refusals, so the caller learns a value was substituted and which.
 */
function docName(meta: Record<string, unknown> | undefined, refusals: Refusals): string {
  const raw = meta?.name;
  if (typeof raw === "string") return raw;
  const substitute = raw === undefined || raw === null ? "Document" : String(raw);
  refusals.add("meta.name", String(raw), `not a string; the document is named ${substitute}`);
  return substitute;
}

/**
 * Render a template to one self-contained, inert HTML page.
 *
 * Pure: no clock, no randomness, no network, no DOM. The same template and
 * the same values always produce the same bytes, which is what lets the result
 * be cached, compared, or sent to a printer.
 *
 * Every field read below is treated as possibly absent. All three template load
 * sites cast `JSON.parse` output straight to `BillTemplate`, so a truncated or
 * hand-edited file arrives with a missing `document`, `meta` or `objects`, and
 * dereferencing one of those would escape the public entry as a raw `TypeError`
 * instead of the refusal a caller can act on.
 */
export function renderHtml(
  template: BillTemplate,
  values: Readonly<Record<string, string>> = {},
  options: RenderOptions = {},
): RenderResult {
  const refusals = new Refusals();

  // A newer template may use object fields this renderer does not know, so a
  // guess would silently drop content. Refuse instead.
  const claimed = safeLength(template.templateVersion, Number.NaN);
  if (claimed > TEMPLATE_VERSION) {
    throw new Error(
      `template version ${claimed} exceeds the renderer's supported ${TEMPLATE_VERSION}`,
    );
  }
  const version = sheetVersion(template.templateVersion, refusals);

  const page = record(template.document);
  const width = pageLength(page?.width, "width", refusals, A4_WIDTH);
  const height = pageLength(page?.height, "height", refusals, A4_HEIGHT);

  const meta = record(template.meta);
  const name = docName(meta, refusals);

  let objects: readonly TemplateObject[];
  if (Array.isArray(template.objects)) {
    objects = template.objects;
  } else {
    refusals.add("objects", String(template.objects), "not an array; the page renders empty");
    objects = [];
  }

  // Repeating bands are expanded before anything is sorted or painted, so the
  // renderer itself stays unaware of them. `values` gains the computed results
  // first, because a band's trailing summary row reads them.
  const scale = safeScaleOption(options.currencyScale, 2);
  const computeOpts: ComputeOptions = {
    ...(options.rounding !== undefined ? { rounding: options.rounding } : {}),
    ...(options.qtyScale !== undefined ? { qtyScale: options.qtyScale } : {}),
  };
  const enriched: Values = {
    ...values,
    ...computeAll(options.computed ?? [], values, scale, computeOpts),
  };

  const bandCtx: RepeatContext = {
    specs: options.bandSpecs ?? options.computed ?? [],
    scale,
    rounding: options.rounding,
    qtyScale: options.qtyScale,
  };

  const { objects: expanded0, warnings: repeatWarnings } = expandRepeats(
    objects,
    enriched,
    height,
    bandCtx,
  );

  // Variable rows, immediately after the band has been expanded and before
  // anything is measured against or solved for.
  //
  // The order is forced. Row heights are indexed against the expanded cell
  // array, so they cannot be decided before [expandRepeats] has run; and they
  // must be settled before [calculateLayout], because a guide below the table
  // is moved by the table's final height, not by the traced one.
  const measurements = options.measurements ?? {};
  const expanded = expanded0.map((o) => {
    if (o.type !== "table") return o;
    const policy = rowsWorthMeasuring(o);
    if (!policy) return o;
    return applyRowHeights(o, measurements, {
      ...(policy.maxGrowth !== undefined ? { maxGrowth: policy.maxGrowth } : {}),
    });
  });

  // Variable layout, after repeats and before anything is sorted or painted.
  //
  // Both sides of this are load-bearing. It has to follow repeat expansion
  // because the row count decides how much room the band needs, and it has to
  // precede the sort because that is the last point at which final geometry is
  // known and nothing has been written yet.
  //
  // Skipped entirely unless the template opted in, so a template without a
  // `layout` block takes the same path it always did.
  const layoutRules = template.layout;
  const layoutMeasurements: Record<string, ContentMeasurement> = { ...measurements };
  for (const o of expanded) {
    if (o.type !== "table") continue;
    if (!rowsWorthMeasuring(o)) continue;
    layoutMeasurements[o.id] = {
      naturalWidth: o.width,
      height: o.height,
    };
  }

  const solve = (m: Readonly<Record<string, ContentMeasurement>>) =>
    calculateLayout({
      objects: expanded,
      measurements: m,
      guides: layoutRules?.guides ?? [],
      attachments: layoutRules?.attachments ?? [],
      documentPolicy: layoutRules?.document ?? { growthX: "fixed", growthY: "fixed" },
      document: { width, height },
      ...(layoutRules?.collision !== undefined ? { collision: layoutRules.collision } : {}),
    });

  let geometry = layoutRules && layoutRules.mode === "variable" ? solve(layoutMeasurements) : null;

  // One re-solve when X growth widened a box, because text measured at the base
  // width is an upper bound for the field's content and not the height the field
  // will actually be painted at: widening a box can only reduce the number of
  // wrapped lines. A host with a font engine passes `remeasure` to settle it.
  //
  // Bounded to a single extra pass, and only for boxes that really changed
  // width, so a pathological template cannot spin the preview. Without a
  // `remeasure` function the first solve stands - safe, because an upper bound
  // never under-allocates.
  if (geometry && options.remeasure) {
    const widened = geometry.objects.filter((o) => {
      const authored = expanded.find((a) => a.id === o.id);
      return authored !== undefined && Math.abs(authored.width - o.width) > 1;
    });
    if (widened.length > 0) {
      const refined = { ...layoutMeasurements };
      let improved = false;
      for (const o of widened) {
        const better = options.remeasure(o.id, o.width);
        if (better && Number.isFinite(better.height) && Number.isFinite(better.naturalWidth)) {
          refined[o.id] = better;
          improved = true;
        }
      }
      if (improved) geometry = solve(refined);
    }
  }

  const placed = geometry ? geometry.objects : expanded;
  const pageWidth = geometry ? geometry.page.width : width;
  const pageHeight = geometry ? geometry.page.height : height;

  // Ordered by z-index as today; layout only moves things, it never repaints
  // them in a different order.
  const ordered = placed
    .map((o, i) => ({ o, i }))
    .sort((a, b) => a.o.zIndex - b.o.zIndex || a.i - b.i);

  const placeholders = options.placeholders ?? "hide";
  const body = ordered
    .map(({ o, i }) => renderObject(o, i, enriched, refusals, placeholders))
    .filter((s): s is string => typeof s === "string")
    .join("\n");

  // The fingerprint covers the whole template with save time removed, while
  // retaining calculation rules because they change rendered output.
  // It answers whether anything that affects rendered output has changed,
  // - and re-saving an unchanged trace keeps the same fingerprint.
  // `meta.modifiedAt` changes on every save, so including it would make the hash
  // meaningless as a way to tell one revision from another. The name is taken
  // raw rather than through `docName`, because a template whose `name` is a
  // number is a different template from one whose name is "42", and that
  // difference should show up in the fingerprint.
  const hash =
    options.templateHash ??
    templateHashOf(template, Array.isArray(options.computed) ? options.computed : undefined);
  const title = escapeHtml(options.title ?? name);

  const html =
    `<!DOCTYPE html>\n<html lang="en">\n<head>\n<meta charset="utf-8">\n` +
    `<title>${title}</title>\n` +
    `<style>\n${stylesheet(pageWidth, pageHeight)}\n</style>\n</head>\n<body>\n` +
    `<div class="sheet" data-template-version="${attr(String(version))}" ` +
    `data-template-hash="${hash}">\n${body}\n</div>\n</body>\n</html>\n`;

  // The same guard `renderObject` applies to the text it paints: templates
  // arrive through an unvalidated cast, so a cell or object `text` may be a
  // number or null, and `collectDocumentVariables` calls `matchAll` on what it
  // is handed - which throws rather than rendering an empty cell.
const texts = objects.flatMap((o) =>
    o.type === "table"
      ? (Array.isArray(o.cells) ? o.cells : []).map((c) => c?.text)
      // `field` carries its token in the same `text` property as `text` does.
      // Leaving it out here reported a document with field placeholders as
      // having nothing outstanding, so a host had no way to tell the user which
      // were still blank.
      : o.type === "text" || o.type === "field"
      ? [o.text]
      : [],
  );
  const variables = collectDocumentVariables(
    texts.filter((t): t is string => typeof t === "string"),
  );

  // Layout diagnostics ride in the same array as repeat warnings: both are
  // "the document is still printable, but here is what you should know", and a
  // caller reading one list should not have to know which pass produced an
  // entry. Repeat warnings come first so their order does not shift.
return {
      html,
      refusals: refusals.list(),
      variables,
      warnings: [...repeatWarnings, ...(geometry?.diagnostics ?? [])],
      objects: placed.map((o) => ({ ...o })),
      page: { width: pageWidth, height: pageHeight },
    };
}
