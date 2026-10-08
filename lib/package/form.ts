/**
 * Derive the input form from a package manifest.
 *
 * This is the promise the package format makes: a host that can read a manifest
 * can show the right form without knowing anything about this editor. Grouping
 * reuses the `source` discriminator both existing forms already group by, so a
 * derived schema and the app's own forms stay recognisably the same thing.
 */

import type { ComputedSpec, ManifestField, PackageManifest } from "@/lib/package/format";
import { extractVariables } from "@/lib/template/placeholders";
import type { BillTemplate, TableObject } from "@/lib/template/types";
import { DEFAULT_REPEAT_MAX_ITEMS } from "@/lib/template/types";

export interface FormField {
  key: string;
  label: string;
  type: ManifestField["type"];
  source: ManifestField["source"];
  objectName: string;
  maxLength?: number;
  required?: boolean;
  pattern?: string;
  min?: number;
  max?: number;
  options?: string[];
}

export interface RepeatFieldSpec {
  key: string;
  objectName: string;
  /** Column keys, in band order. */
  columns: string[];
  maxItems: number;
}

export interface FormGroup {
  title: string;
  fields: FormField[];
}

export interface FormSchema {
  groups: FormGroup[];
  fields: FormField[];
  repeats: RepeatFieldSpec[];
  computed: ComputedSpec[];
}

const GROUP_TITLES: Record<ManifestField["source"], string> = {
  text: "Text fields",
  field: "Text fields",
  table: "Table cells",
  "image-placeholder": "Images & signatures",
};

/** Column keys inside a repeat band, read from the band's own cell tokens. */
function columnsOf(t: TableObject, startRow: number, endRow: number): string[] {
  const columns = typeof t.columns === "number" && t.columns > 0 ? t.columns : 1;
  const cells = Array.isArray(t.cells) ? t.cells : [];
  const seen: string[] = [];
  for (let r = startRow; r <= endRow; r += 1) {
    for (let c = 0; c < columns; c += 1) {
      const text = cells[r * columns + c]?.text;
      if (typeof text !== "string") continue;
      for (const v of extractVariables(text)) {
        if (!seen.includes(v)) seen.push(v);
      }
    }
  }
  return seen;
}

function repeatsOf(template: BillTemplate | undefined): RepeatFieldSpec[] {
  const out: RepeatFieldSpec[] = [];
  const objects = template && Array.isArray(template.objects) ? template.objects : [];
  for (const o of objects) {
    if (o.type !== "table") continue;
    const band = o.repeat;
    if (!band || typeof band.key !== "string" || band.key.trim().length === 0) continue;
    out.push({
      key: band.key.trim(),
      objectName: o.name,
      columns: columnsOf(o, band.startRow, band.endRow),
      maxItems: typeof band.maxItems === "number" && band.maxItems > 0 ? band.maxItems : DEFAULT_REPEAT_MAX_ITEMS,
    });
  }
  return out;
}

export function deriveForm(manifest: PackageManifest, template?: BillTemplate): FormSchema {
  const declared: FormField[] = Array.isArray(manifest?.fields)
    ? manifest.fields
        .filter((f): f is ManifestField => Boolean(f) && typeof f.key === "string" && f.key.length > 0)
        .map((f) => ({
          key: f.key,
          label: typeof f.label === "string" && f.label.length > 0 ? f.label : f.key,
          type: f.type,
          source: f.source,
          objectName: typeof f.objectName === "string" ? f.objectName : "",
          ...(typeof f.maxLength === "number" ? { maxLength: f.maxLength } : {}),
          ...(f.required === true ? { required: true } : {}),
          ...(typeof f.pattern === "string" ? { pattern: f.pattern } : {}),
          ...(typeof f.min === "number" ? { min: f.min } : {}),
          ...(typeof f.max === "number" ? { max: f.max } : {}),
          ...(Array.isArray(f.options) ? { options: f.options } : {}),
        }))
    : [];

  const repeats = repeatsOf(template);

  // A band always contributes a field of its own unless the manifest already
  // declares one, so a host that renders only the flat list still shows the line
  // items rather than silently dropping them.
  const fields: FormField[] = [
    ...declared.filter((f) => !repeats.some((r) => r.key === f.key)),
    ...repeats.map((r) => ({
      key: r.key,
      label: r.objectName || r.key,
      type: "repeating" as const,
      source: "table" as const,
      objectName: r.objectName,
    })),
  ];

  // Grouped by title rather than by source, because two sources share one title:
  // `DynamicForm` already puts `text` and `field` together under "Text fields",
  // and a derived schema that split them would not look like the app's own form.
  const order: string[] = ["Text fields", "Table cells", "Images & signatures"];
  const byTitle = new Map<string, FormField[]>();
  for (const f of fields) {
    const title = GROUP_TITLES[f.source] ?? "Other fields";
    const bucket = byTitle.get(title);
    if (bucket) bucket.push(f);
    else byTitle.set(title, [f]);
  }

  const groups: FormGroup[] = [];
  for (const title of order) {
    const bucket = byTitle.get(title);
    if (bucket && bucket.length > 0) groups.push({ title, fields: bucket });
  }
  // Anything whose source is outside the known set is still shown, rather than
  // vanishing from the form.
  for (const [title, bucket] of byTitle) {
    if (!order.includes(title) && bucket.length > 0) groups.push({ title, fields: bucket });
  }

  return {
    groups,
    fields,
    repeats,
    computed: Array.isArray(manifest?.computed) ? manifest.computed : [],
  };
}
