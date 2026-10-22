/**
 * The one entry a host uses to turn a template and values into output-ready
 * state.
 *
 * Everything that must agree across runtimes happens here, in this order, and
 * nowhere else: computed values from raw inputs, display shaping (date and
 * number output), binding values into the structure, repeat-band lines
 * computed per row by the engine, and the identity fingerprint of the authored
 * template. `renderHtml` below stays a pure function of the already-bound
 * state; callers that go through this module cannot resolve tokens twice,
 * measure unformatted text, or hash a filled state
 */

import type { ComputedSpec, RoundingMode } from "@/lib/package/format";
import type { BillTemplate } from "@/lib/template/types";
import { fillTemplate } from "@/lib/template/dataBinding";

import { computeAll, withRowsComputed, type ComputeOptions } from "./computed";
import { applyDisplayFormats, type DisplayMap } from "./formats";
import { renderHtml, templateHashOf, type RenderOptions, type RenderResult } from "./index";

export interface RenderDocumentOptions {
  /** Optional title for the output page. */
  title?: string;
  /** Whole-document computed rules, in declaration order. */
  computed?: readonly ComputedSpec[];
  /** Decimal places money is held in. Defaults to 2. */
  currencyScale?: number;
  /** The written rounding rule every computation follows. */
  rounding?: RoundingMode;
  /** Decimal places a count operand is read at inside products. */
  qtyScale?: number;
  /** Output shaping per key; the caller's map wins over template defaults. */
  display?: DisplayMap;
  /** Measured sizes keyed by object id, from the host's font engine. */
  measurements?: RenderOptions["measurements"];
  /** Re-measure a slot at the width the solver gave it. */
  remeasure?: RenderOptions["remeasure"];
  /** Whether unfilled slots paint at all. Default "hide". */
  placeholders?: "hide" | "show";
}

/**
 * Bind, compute, shape and render in one call.
 *
 * The same template and the same values always produce the same result: the
 * computation is integer arithmetic, the shaping is a written rule, and the
 * fingerprint covers the authored template rather than the filled state.
 */
export function renderDocument(
  template: BillTemplate,
  values: Readonly<Record<string, string>>,
  options: RenderDocumentOptions = {},
): RenderResult {
  const scale = options.currencyScale ?? 2;
  const computeOpts: ComputeOptions = {
    ...(options.rounding !== undefined ? { rounding: options.rounding } : {}),
    ...(options.qtyScale !== undefined ? { qtyScale: options.qtyScale } : {}),
  };

  // Per-row figures first, so the whole-document rules read what the rows
  // print: a grand figure that sums the band's line figure sums the engine's
  // `count x rate`, and a hand-typed line figure can no longer disagree with
  // the sum under it.
  const augmented = withRowsComputed(template, options.computed ?? [], values, scale, computeOpts);
  const derived = computeAll(options.computed ?? [], augmented, scale, computeOpts);
  const shown = applyDisplayFormats({ ...values, ...derived }, options.display ?? {});
  const bound = fillTemplate(template, shown);

  return renderHtml(bound, shown, {
    ...(options.title !== undefined ? { title: options.title } : {}),
    bandSpecs: options.computed ?? [],
    currencyScale: scale,
    ...(options.rounding !== undefined ? { rounding: options.rounding } : {}),
    ...(options.qtyScale !== undefined ? { qtyScale: options.qtyScale } : {}),
    ...(options.measurements !== undefined ? { measurements: options.measurements } : {}),
    ...(options.remeasure !== undefined ? { remeasure: options.remeasure } : {}),
    ...(options.placeholders !== undefined ? { placeholders: options.placeholders } : {}),
    templateHash: templateHashOf(
      template,
      Array.isArray(options.computed) ? options.computed : undefined,
    ),
  });
}
