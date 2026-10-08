import { collectDocumentVariables } from "@/lib/template/placeholders";
import type { ComputedSpec } from "@/lib/package/format";
import {
  A4_HEIGHT,
  A4_WIDTH,
  TEMPLATE_VERSION,
  type BillTemplate,
  type TemplateObject,
} from "@/lib/template/types";

import { canonicalJson } from "./canonical";
import { computeAll } from "./computed";
import { Refusals, safeLength, type Refusal } from "./css";
import { attr, escapeHtml } from "./escape";
import { renderObject } from "./primitives";
import { expandRepeats } from "./repeat";
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
}

export interface RenderResult {
  html: string;
  refusals: Refusal[];
  variables: string[];
  warnings: string[];
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
  const enriched: Values = {
    ...values,
    ...computeAll(options.computed ?? [], values, options.currencyScale ?? 2),
  };

  const { objects: expanded, warnings } = expandRepeats(objects, enriched, height);

  // The array index breaks zIndex ties, so objects that share a zIndex keep
  // their order from one run to the next.
  const ordered = expanded
    .map((o, i) => ({ o, i }))
    .sort((a, b) => a.o.zIndex - b.o.zIndex || a.i - b.i);

  const body = ordered
    .map(({ o, i }) => renderObject(o, i, enriched, refusals))
    .filter((s): s is string => typeof s === "string")
    .join("\n");

  // The fingerprint covers the whole template with `meta` reduced to its `name`,
  // so it answers the question a caller actually asks - has the layout changed?
  // - and re-saving an unchanged trace keeps the same fingerprint.
  // `meta.modifiedAt` changes on every save, so including it would make the hash
  // meaningless as a way to tell one revision from another. The name is taken
  // raw rather than through `docName`, because a template whose `name` is a
  // number is a different template from one whose name is "42", and that
  // difference should show up in the fingerprint.
  const hash = sha256Hex(canonicalJson({ ...template, meta: { name: meta?.name } }));
  const title = escapeHtml(options.title ?? name);

  const html =
    `<!DOCTYPE html>\n<html lang="en">\n<head>\n<meta charset="utf-8">\n` +
    `<title>${title}</title>\n` +
    `<style>\n${stylesheet(width, height)}\n</style>\n</head>\n<body>\n` +
    `<div class="sheet" data-template-version="${attr(String(version))}" ` +
    `data-template-hash="${hash}">\n${body}\n</div>\n</body>\n</html>\n`;

  // The same guard `renderObject` applies to the text it paints: templates
  // arrive through an unvalidated cast, so a cell or object `text` may be a
  // number or null, and `collectDocumentVariables` calls `matchAll` on what it
  // is handed - which throws rather than rendering an empty cell.
  const texts = objects.flatMap((o) =>
    o.type === "table"
      ? (Array.isArray(o.cells) ? o.cells : []).map((c) => c?.text)
      : o.type === "text"
        ? [o.text]
        : [],
  );
  const variables = collectDocumentVariables(
    texts.filter((t): t is string => typeof t === "string"),
  );

  return { html, refusals: refusals.list(), variables, warnings };
}