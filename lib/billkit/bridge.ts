/**
 * The host-drivable half of BillKit.
 *
 * A non-web frontend owns its own form UI and its own file writing, so the only
 * two things it cannot own are *deriving* the form and *rendering* the bill â€”
 * those have to stay here, in the one place that already does them, or the two
 * platforms drift apart.
 *
 * Everything crosses the boundary as JSON strings. A host reads the archive,
 * resolves `pkg://` asset references and hands over plain JSON; this module
 * never sees a file system, so it stays pure and runs in any JS runtime.
 */

import type { ComputedSpec, PackageManifest } from "@/lib/package/format";
import { deriveForm, type FormSchema } from "@/lib/package/form";
import { renderHtml } from "@/lib/render";
import { cellRequests } from "@/lib/render/rowHeights";
import { fillTemplate } from "@/lib/template/dataBinding";
import type { BillTemplate } from "@/lib/template/types";

/** What a host needs to build its form: the schema, as plain JSON. */
export function deriveFormBridge(manifestJson: string, templateJson?: string): FormSchema {
  const manifest = JSON.parse(manifestJson) as PackageManifest;
  const template = templateJson
    ? (JSON.parse(templateJson) as BillTemplate | undefined)
    : undefined;
  return deriveForm(manifest, template);
}

export interface RenderBridgeResult {
  html: string;
  /** Template variables the values did not cover. */
  variables: string[];
  warnings: string[];
  refusals: Array<{ field: string; value: string; reason: string }>;
  /**
   * The page as drawn, which may be taller than the traced sheet.
   *
   * A host that prints needs this: taking the size from the manifest instead
   * would clip a receipt whose rows pushed the bottom off the authored page.
   */
  page: { width: number; height: number };
}

/**
 * One box the host has to measure.
 *
 * Built here and executed there: sizing text needs a font engine, and this
 * package has none. The plan carries the text as it will actually be painted
 * and the typography the renderer will use, so the host's job is arithmetic on
 * a DOM, not another round of template interpretation.
 */
export interface MeasurementRequest {
  id: string;
  /**
   * Why this box is being measured.
   *
   * A `box` is a free text or field object and measures against its own
   * geometry. A `cell` is one cell of a repeating table row: it wraps inside
   * its column and has no box of its own, so the host must be told which width
   * to use rather than left to read it off an object that does not exist.
   */
  kind?: "box" | "cell";
  /** For `kind: "cell"`, horizontal alignment within the column. */
  textAlign?: "left" | "center" | "right";
  /** The filled text. An unfilled token is left in place, so it measures short. */
  text: string;
  fontFamily: string;
  fontSize: number;
  fontWeight: "normal" | "bold";
  fontStyle: "normal" | "italic";
  /** Unitless multiplier, exactly as the template stores it. */
  lineHeight: number;
  /** Hundredths of a point, as the renderer reads it. */
  charSpacing: number;
  /** Width available before wrapping, from the object's base box. */
  width: number;
  /**
   * Whether the box wraps at `width`.
   *
   * A field is rendered with a wrap width equal to its box; a plain text object
   * is not. Measuring both the same way would over-size every text object,
   * because it would count a box the renderer never wraps in.
   */
  wrap: boolean;
}

/** Measured results, keyed by object id, as the renderer expects them. */
export type Measurements = Record<string, { naturalWidth: number; height: number }>;

/**
 * Work out which boxes need measuring.
 *
 * Only objects carrying an expansion policy are asked about, and only on a
 * template that opted into variable layout: everything else renders at its
 * authored size, so measuring it would be cost with no reader.
 */
export function measureBridge(
  templateJson: string,
  valuesJson: string,
  computedJson?: string,
): MeasurementRequest[] {
  const template = JSON.parse(templateJson) as BillTemplate;
  if (!template || template.layout?.mode !== "variable") return [];
  const values = valuesJson ? (JSON.parse(valuesJson) as Record<string, string>) : {};
  const computed = computedJson ? (JSON.parse(computedJson) as ComputedSpec[]) : [];

  // Filled first, for the same reason `renderBridge` does it: the plan must
  // describe the text that will be on the page, not the token standing in for
  // it. Measuring "{{address}}" would size the box to the label.
const filled = fillTemplate(template, values);
  const requests: MeasurementRequest[] = [];

  for (const o of filled.objects) {
    if (o.type !== "text" && o.type !== "field") continue;
    const policy = (o as { expansion?: unknown }).expansion;
    if (typeof policy !== "object" || policy === null) continue;

    const y = (policy as { y?: { strategy?: unknown } }).y;
    // A text object that does not wrap still needs its natural width, so it is
    // still asked about - just about a different thing.
    const wraps = o.type === "field" || y?.strategy === "wrap";

    requests.push({
      id: o.id,
      kind: "box",
      text: typeof o.text === "string" ? o.text : "",
      fontFamily: o.fontFamily,
      fontSize: o.fontSize,
      fontWeight: o.fontWeight,
      fontStyle: o.fontStyle,
      lineHeight: o.lineHeight,
      charSpacing: o.charSpacing,
      width: o.width,
      wrap: wraps,
    });
  }
  // Variable table rows, on the same seam.
  //
  // These carry the *expanded* row indices, so the keys line up with the table
  // the renderer will draw rather than the template it came from. The computed
  // values are folded in first for the same reason the boxes above are filled
  // first: a trailer row reading a computed total must be measured as that
  // total, not as the token that produced it.
  for (const cell of cellRequests(template, values, computed)) {
    requests.push({
      id: cell.id,
      kind: "cell",
      textAlign: cell.textAlign,
      text: cell.text,
      fontFamily: cell.fontFamily,
      fontSize: cell.fontSize,
      fontWeight: cell.fontWeight,
      fontStyle: "normal",
      lineHeight: 1.2,
      charSpacing: 0,
      width: cell.width,
      wrap: cell.wrap,
    });
  }

  return requests;
}

/**
 * Render a filled bill.
 *
 * `fillTemplate` runs first and `renderHtml` is handed the *unfilled* values
 * alongside it, which is deliberate: filling resolves the flat tokens inside
 * every cell, while `renderHtml` still needs the original values so it can
 * expand a repeat band from the `items` array and resolve the band's own
 * column tokens against each item.
 *
 * `measurementsJson` is optional and additive. Without it a variable-layout
 * template still renders, at its authored sizes - an honest fixed bill rather
 * than one padded out by a guess.
 */
export function renderBridge(
  templateJson: string,
  valuesJson: string,
  computedJson?: string,
  measurementsJson?: string,
): RenderBridgeResult {
  const template = JSON.parse(templateJson) as BillTemplate;
  const values = JSON.parse(valuesJson) as Record<string, string>;
  const computed = computedJson ? (JSON.parse(computedJson) as ComputedSpec[]) : [];

  // A host's measurements are input, so they are treated like any other untrusted
  // payload: a malformed blob costs the template its growth, it does not cost
  // the caller their bill.
  let measurements: Measurements | undefined;
  if (measurementsJson) {
    try {
      const parsed = JSON.parse(measurementsJson) as Measurements;
      if (parsed && typeof parsed === "object") measurements = parsed;
    } catch {
      measurements = undefined;
    }
  }

  const filled = fillTemplate(template, values);
  const result = renderHtml(filled, values, { computed, measurements });

return {
    html: result.html,
    variables: result.variables,
    warnings: result.warnings,
    refusals: result.refusals.map((r) => ({
      field: r.field,
      value: r.value,
      reason: r.reason,
    })),
    page: { width: result.page.width, height: result.page.height },
  };
}


