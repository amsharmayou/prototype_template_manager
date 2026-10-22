import { renderHtml, type RenderOptions } from "@/lib/render";
import { extractTemplateFields } from "@/lib/template/dataBinding";
import { computedSpecsFor } from "@/lib/package/computedSpecs";
import { parseTemplate } from "@/lib/template/parse";
import { collectDocumentVariables, extractVariables } from "@/lib/template/placeholders";
import type { BillTemplate } from "@/lib/template/types";
import { buildPackage } from "@/lib/package/build";
import { validateManifest } from "@/lib/package/validate";

export interface TemplatePreflightIssue {
  severity: "error" | "warning";
  message: string;
  objectId?: string;
  guideId?: string;
}

export interface PreflightOptions {
  /** Fill representative long values and check their real measured layout. */
  sampleValues?: Readonly<Record<string, string>>;
  measurements?: RenderOptions["measurements"];
  remeasure?: RenderOptions["remeasure"];
  /** Fill each repeat band to its declared row cap for a worst-case check. */
  maxRepeatItems?: boolean;
}

/** Representative values used by the editor's explicit sample-layout check. */
export function sampleValuesForTemplate(
  template: BillTemplate,
  options: { maxRepeatItems?: boolean } = {},
): Record<string, string> {
  const values: Record<string, string> = {};
  for (const field of extractTemplateFields(template)) {
    if (field.type === "image") continue;
    if (field.type === "date") values[field.key] = "2026-10-17";
    else if (field.type === "number") values[field.key] = String(field.max ?? Math.max(9876543, field.min ?? 0));
    else if (field.type === "currency") values[field.key] = String(field.max ?? Math.max(9876543.21, field.min ?? 0));
    else if (field.type === "tickmark") values[field.key] = "✓";
    else if (field.type === "checkbox") values[field.key] = "true";
    else values[field.key] = "Northwind Trading Company — Industrial Supplies and Distribution";

    const maxLength = template.meta?.placeholders?.find((spec) => spec.key === field.key)?.maxLength;
    if (field.type === "text" && typeof maxLength === "number" && maxLength > 0) {
      values[field.key] = "W".repeat(Math.min(maxLength, 120));
    }
  }

  for (const table of template.objects) {
    if (table.type !== "table" || !table.repeat) continue;
    const keys = new Set<string>();
    for (let row = table.repeat.startRow; row <= table.repeat.endRow; row += 1) {
      for (let col = 0; col < table.columns; col += 1) {
        for (const key of extractVariables(table.cells[row * table.columns + col]?.text ?? "")) keys.add(key);
      }
    }
    const maxItems = typeof table.repeat.maxItems === "number" ? table.repeat.maxItems : 20;
    const count = Math.max(0, Math.min(options.maxRepeatItems ? 200 : 3, maxItems));
    const rows = Array.from({ length: count }, (_, index) => Object.fromEntries(
      [...keys].map((key) => [key, /amount|price|rate|weight|qty|quantity|count/i.test(key)
        ? (index === 0 ? "9876543.21" : "123456.78")
        : `Industrial equipment and supplies — sample line ${index + 1}`]),
    ));
    values[table.repeat.key] = JSON.stringify(rows);
  }
  return values;
}

/** Run structural and renderer checks on the exact template the editor will save. */
export function preflightTemplate(template: BillTemplate, options: PreflightOptions = {}): TemplatePreflightIssue[] {
  try {
    parseTemplate(template);
  } catch (error) {
    return [{
      severity: "error",
      message: error instanceof Error ? error.message : "The template is not valid.",
    }];
  }

  const issues: TemplatePreflightIssue[] = [];
  for (const object of template.objects) {
    const outside = object.x < 0 || object.y < 0 ||
      object.x + object.width > template.document.width ||
      object.y + object.height > template.document.height;
    if (outside) {
      issues.push({
        severity: "warning",
        objectId: object.id,
        message: `${object.name} extends beyond the page and may be clipped in print.`,
      });
    }
  }

  const fields = extractTemplateFields(template);
  const hasRepeatingTable = template.objects.some((object) => object.type === "table" && object.repeat);
  const hasTaxOrDiscount = fields.some((field) => /^(tax|discount)(_|$)/i.test(field.key));
  if (hasRepeatingTable && hasTaxOrDiscount && !computedSpecsFor(template).some((spec) => spec.key === "total")) {
    issues.push({
      severity: "warning",
      message: "This bill has tax or discount fields. Check the final total manually; those amounts are not included in the automatic subtotal.",
    });
  }
  const usedKeys = new Set(fields.map((field) => field.key));
  for (const spec of template.meta?.placeholders ?? []) {
    if (!usedKeys.has(spec.key)) {
      issues.push({ severity: "warning", message: `Field settings for “${spec.key}” are unused.` });
    }
  }

  const computed = computedSpecsFor(template);
  if (template.meta?.computed?.length) {
    try {
      const candidate = buildPackage(template, { computed });
      for (const problem of validateManifest(candidate.manifest, candidate.files).filter((item) => item.path.startsWith("computed"))) {
        const key = /^computed\[(\d+)\]/.exec(problem.path)?.[1];
        const outputKey = key === undefined ? undefined : computed[Number(key)]?.key;
        const object = outputKey ? template.objects.find((item) =>
          item.type === "text" || item.type === "field"
            ? extractVariables(item.text).includes(outputKey)
            : item.type === "table" && item.cells.some((cell) => extractVariables(cell.text).includes(outputKey)),
        ) : undefined;
        issues.push({
          severity: "error",
          ...(object ? { objectId: object.id } : {}),
          message: `Calculation setup: ${problem.path} — ${problem.message}`,
        });
      }
    } catch (error) {
      issues.push({
        severity: "error",
        message: `Calculations could not be checked: ${error instanceof Error ? error.message : String(error)}`,
      });
    }
  }
  const rendered = renderHtml(template, {}, { placeholders: "show", computed });
  for (const refusal of rendered.refusals) {
    issues.push({
      severity: "warning",
      message: `${refusal.field}: ${refusal.reason} (value “${refusal.value}”).`,
    });
  }
  for (const warning of rendered.warnings) {
    issues.push({ severity: "warning", message: warning });
  }

  const unresolved = collectDocumentVariables(template.objects.flatMap((object) =>
    object.type === "text" || object.type === "field"
      ? [object.text]
      : object.type === "table"
        ? object.cells.map((cell) => cell.text)
        : [],
  ));
  for (const key of unresolved) {
    const object = template.objects.find((candidate) =>
      candidate.type === "text" || candidate.type === "field"
        ? extractVariables(candidate.text).includes(key)
        : candidate.type === "table" && candidate.cells.some((cell) => extractVariables(cell.text).includes(key)),
    );
    issues.push({
      severity: "warning",
      ...(object ? { objectId: object.id } : {}),
      message: `Dynamic field “${key}” needs a sample answer to confirm its final fit.`,
    });
  }

  if (options.sampleValues) {
    const sample = renderHtml(template, options.sampleValues, {
      placeholders: "hide",
      computed,
      measurements: options.measurements,
      remeasure: options.remeasure,
    });
    for (const warning of sample.warnings) {
      const quoted = [...warning.matchAll(/"([^\"]+)"/g)].map((match) => match[1]!);
      const guideId = /guide "([^\"]+)"/.exec(warning)?.[1];
      const objectId = quoted.find((candidate) => template.objects.some((object) => object.id === candidate))
        ?? (quoted[0] && template.layout?.attachments?.find((attachment) => attachment.id === quoted[0])?.objectId);
      issues.push({
        severity: "warning",
        ...(objectId ? { objectId } : {}),
        ...(guideId && template.layout?.guides?.some((guide) => guide.id === guideId) ? { guideId } : {}),
        message: `Sample values: ${warning}`,
      });
    }
    if (sample.page.width !== template.document.width || sample.page.height !== template.document.height) {
      issues.push({
        severity: "warning",
        message: `Sample values grow the printed page to ${Math.round(sample.page.width)} × ${Math.round(sample.page.height)} px. Check that size before printing.`,
      });
    }
  }
  return issues;
}
