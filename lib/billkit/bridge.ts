/**
 * The host-drivable half of BillKit.
 *
 * A non-web frontend owns its own form UI and its own file writing, so the only
 * two things it cannot own are *deriving* the form and *rendering* the bill —
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
}

/**
 * Render a filled bill.
 *
 * `fillTemplate` runs first and `renderHtml` is handed the *unfilled* values
 * alongside it, which is deliberate: filling resolves the flat tokens inside
 * every cell, while `renderHtml` still needs the original values so it can
 * expand a repeat band from the `items` array and resolve the band's own
 * column tokens against each item.
 */
export function renderBridge(
  templateJson: string,
  valuesJson: string,
  computedJson?: string,
): RenderBridgeResult {
  const template = JSON.parse(templateJson) as BillTemplate;
  const values = JSON.parse(valuesJson) as Record<string, string>;
  const computed = computedJson ? (JSON.parse(computedJson) as ComputedSpec[]) : [];

  const filled = fillTemplate(template, values);
  const result = renderHtml(filled, values, { computed });

  return {
    html: result.html,
    variables: result.variables,
    warnings: result.warnings,
    refusals: result.refusals.map((r) => ({
      field: r.field,
      value: r.value,
      reason: r.reason,
    })),
  };
}
