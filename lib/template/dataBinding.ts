/**
 * Binding between a template's dynamic slots and the values a form supplies.
 *
 * The template itself stays a pure structural artifact: placeholders are
 * `{{token}}` occurrences in text and cell text, and image slots are
 * `image-placeholder` objects keyed by their `placeholderRole`. This module
 * knows how to *describe* those slots for a form generator and how to *fill*
 * the template with the submitted values, in both directions pure and total:
 * the input template is never mutated, unknown tokens stay literal, and an
 * empty values map returns the template effectively unchanged.
 */

import { extractVariables } from "@/lib/template/placeholders";
import { resolveText } from "@/lib/render/values";
import type {
  BillTemplate,
  PlaceholderSpec,
  TemplateObject,
} from "@/lib/template/types";

export type FieldType =
  | "text"
  | "number"
  | "date"
  | "currency"
  | "tickmark"
  | "checkbox"
  | "image";

export type FieldSource = "text" | "table" | "image-placeholder" | "field";

export interface TemplateField {
  /** Form key, e.g. `customer_name` or `logo`. */
  key: string;
  /** Human-readable label for the form. */
  label: string;
  type: FieldType;
  source: FieldSource;
  /** Name of the traced object this field belongs to, for grouping. */
  objectName: string;
  /** Max length of the generated input, when the spec sets one. */
  maxLength?: number;
}

/** Tokens that unmistakably stand for a date. */
const DATE_RE = /date/i;
/** Tokens that stand for money. */
const CURRENCY_RE = /(total|amount|amt|subtotal|tax|charge|discount|balance|price|rate|fee)/i;
/** Tokens that stand for a plain count or quantity. `_number` / `inum` and
 * everything else stays text: an "invoice_number" is an identifier, not a
 * quantity, and a count belongs in a number field. */
const NUMBER_RE = /(qty|quantity|count|_no$|^no$|hsn|pincode)/i;

const ACRONYMS: Record<string, string> = {
  qr: "QR Code",
  gstin: "GSTIN",
  id: "ID",
  no: "No.",
  sku: "SKU",
  hsn: "HSN",
  pan: "PAN",
  msme: "MSME",
  ifsc: "IFSC",
};

export function humanizeKey(key: string): string {
  return key
    .split(/[_\-.]+/)
    .filter(Boolean)
    .map((part) => {
      const lower = part.toLowerCase();
      return ACRONYMS[lower] ?? lower.charAt(0).toUpperCase() + lower.slice(1);
    })
    .join(" ");
}

function inferType(key: string, source: FieldSource): FieldType {
  if (source === "image-placeholder") return "image";
  if (DATE_RE.test(key)) return "date";
  if (CURRENCY_RE.test(key)) return "currency";
  if (NUMBER_RE.test(key)) return "number";
  return "text";
}

/**
 * Every dynamic slot in the template, deduplicated by key, in first-appearance
 * order: tokens found in text boxes first, then table cells, then image slots
 * in object order.
 */
export function extractTemplateFields(template: BillTemplate): TemplateField[] {
  const out: TemplateField[] = [];
  const seen = new Set<string>();

  const specByKey = new Map<string, PlaceholderSpec>();
  for (const spec of Array.isArray(template.meta?.placeholders) ? template.meta.placeholders : []) {
    if (spec && typeof spec.key === "string") specByKey.set(spec.key, spec);
  }

  /**
   * `declaredType` is the type the object itself states — only a `field`
   * carries one. Precedence is spec, then the object's own declaration, then
   * inference from the key name.
   *
   * A field placed with the field tool and then set to "tickmark" has to reach
   * the form as a tickmark. `inferType` can only ever answer date, currency,
   * number or text, so before `declaredType` existed the choice was silently
   * overwritten by key-name guessing and every tickmark and checkbox fell
   * through to a plain text input.
   */
  const add = (
    key: string,
    source: FieldSource,
    objectName: string,
    declaredType?: FieldType,
  ): void => {
    if (seen.has(key)) return;
    seen.add(key);
    const spec = specByKey.get(key);
    out.push({
      key,
      label: spec?.label ? spec.label : humanizeKey(key),
      type: spec?.type ?? declaredType ?? declaredByKey.get(key) ?? inferType(key, source),
      source,
      objectName,
      maxLength: typeof spec?.maxLength === "number" && spec.maxLength > 0 ? spec.maxLength : undefined,
    });
  };

  /** Only a value the field type union actually allows is trusted. */
  const declaredFieldType = (v: unknown): FieldType | undefined =>
    v === "text" ||
    v === "number" ||
    v === "date" ||
    v === "currency" ||
    v === "tickmark" ||
    v === "checkbox"
      ? v
      : undefined;

  // Collected up front so a field's declared type survives regardless of where
  // it sits in the object order. A `{{paid_status}}` token sitting in a text
  // box above the field object used to win the dedup and contribute only its
  // guessed type, silently discarding what the author chose on the field.
  const declaredByKey = new Map<string, FieldType>();
  for (const o of template.objects) {
    if (o.type !== "field") continue;
    const declared = declaredFieldType(o.fieldType);
    if (declared) declaredByKey.set(o.key, declared);
  }

  for (const o of template.objects) {
    if (o.type === "text") {
      for (const v of extractVariables(typeof o.text === "string" ? o.text : "")) {
        add(v, "text", o.name);
      }
    } else if (o.type === "table") {
      for (const cell of Array.isArray(o.cells) ? o.cells : []) {
        for (const v of extractVariables(
          cell && typeof cell.text === "string" ? cell.text : "",
        )) {
          add(v, "table", o.name);
        }
      }
    } else if (o.type === "image-placeholder") {
      add(o.placeholderRole, "image-placeholder", o.name);
    } else if (o.type === "field") {
      add(o.key, "field", o.name, declaredFieldType(o.fieldType));
    }
  }
  return out;
}

/** Match a text that is exactly one `{{key}}` token. */
const PURE_TOKEN = /^\s*\{\{\s*([A-Za-z0-9_.-]+)\s*\}\}\s*$/;

/**
 * A copy of the template with the given values spliced in. A text or cell
 * token that has no value keeps its literal `{{token}}`, so a partially
 * filled form still renders a legible, debuggable document. An image slot is
 * filled by writing its `src`; the slot falls back to the dashed placeholder
 * box when unset or when the runtime cannot load it.
 *
 * The placeholder spec is applied here as the style of the slot it owns: a
 * pure `{{token}}` text box speaks with the spec's font, size, weight, style
 * and colour, and a pure `{{token}}` table cell does the same through the
 * cell-level properties a table can carry (font size and weight).
 */
export function fillTemplate(
  template: BillTemplate,
  values: Readonly<Record<string, string>>,
): BillTemplate {
  const byKey = new Map<string, PlaceholderSpec>();
  for (const spec of Array.isArray(template.meta?.placeholders) ? template.meta.placeholders : []) {
    if (spec && typeof spec.key === "string") byKey.set(spec.key, spec);
  }

  const objects = template.objects.map((o): TemplateObject => {
    if (o.type === "text" || o.type === "field") {
      const pure = PURE_TOKEN.exec(typeof o.text === "string" ? o.text : "");
      const spec = pure ? byKey.get(pure[1]!) : undefined;
      return {
        ...o,
        fontFamily: spec?.fontFamily ?? o.fontFamily,
        fontSize: typeof spec?.fontSize === "number" && spec.fontSize > 0 ? spec.fontSize : o.fontSize,
        fontWeight: spec?.fontWeight ?? o.fontWeight,
        fontStyle: spec?.fontStyle ?? o.fontStyle,
        fill: spec?.color ?? o.fill,
        text: resolveText(o.text, values),
      };
    }
    if (o.type === "table") {
      return {
        ...o,
        cells: o.cells.map((c) => {
          const pure = PURE_TOKEN.exec(typeof c?.text === "string" ? c.text : "");
          const spec = pure ? byKey.get(pure[1]!) : undefined;
          // TableCell has no font family or text colour of its own — style a
          // cell by the spec through the two fields it does have.
          return {
            ...c,
            fontSize: typeof spec?.fontSize === "number" && spec.fontSize > 0 ? spec.fontSize : c.fontSize,
            fontWeight: spec?.fontWeight ?? c.fontWeight,
            ...(spec?.color ? { color: spec.color } : {}),
            text: resolveText(typeof c?.text === "string" ? c.text : "", values),
          };
        }),
      };
    }
    if (o.type === "image-placeholder") {
      const src = values[o.placeholderRole];
      return typeof src === "string" && src.length > 0
        ? { ...o, src }
        : { ...o };
    }
    return { ...o };
  });
  return { ...template, objects };
}
