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

import { extractVariables } from "./placeholders";
import { resolveText } from "../render/values";
import type {
  BillTemplate,
  PlaceholderDisplay,
  PlaceholderSpec,
  TemplateObject,
} from "./types";

export type FieldType =
  | "text"
  | "number"
  | "date"
  | "currency"
  | "tickmark"
  | "checkbox"
  | "image";

export type FieldSource = "text" | "table" | "image-placeholder" | "field" | "cell-field";

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
  required?: boolean;
  defaultValue?: string;
  min?: number;
  max?: number;
  /** How the field prints (date pattern, number grouping). */
  display?: PlaceholderDisplay;
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
  const fields: TemplateField[] = [];
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
    fields.push({
      key,
      label: spec?.label ? spec.label : humanizeKey(key),
      type: spec?.type ?? declaredType ?? declaredByKey.get(key) ?? inferType(key, source),
      source,
      objectName,
      maxLength: typeof spec?.maxLength === "number" && spec.maxLength > 0 ? spec.maxLength : undefined,
      required: spec?.required === true,
      defaultValue: typeof spec?.defaultValue === "string" ? spec.defaultValue : undefined,
      min: typeof spec?.min === "number" ? spec.min : undefined,
      max: typeof spec?.max === "number" ? spec.max : undefined,
      display: spec?.display,
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
    } else if (o.type === "cell-field") {
      // A cell field binds its key to whole-box input, exactly as a field does.
      add(o.key, "cell-field", o.name, declaredFieldType(o.fieldType));
    }
  }
  return fields;
}

/** Validate customer values against the form contract before output is made. */
export function validateTemplateValues(
  fields: readonly TemplateField[],
  values: Readonly<Record<string, string>>,
): string[] {
  const errors: string[] = [];
  for (const field of fields) {
    const value = values[field.key]?.trim() ?? "";
    if (field.required && !value) {
      errors.push(`${field.label} is required.`);
      continue;
    }
    if (!value) continue;
    if (field.maxLength && value.length > field.maxLength) {
      errors.push(`${field.label} must be ${field.maxLength} characters or fewer.`);
    }
    if (field.type === "number" || field.type === "currency") {
      const number = Number(value);
      if (!Number.isFinite(number)) {
        errors.push(`${field.label} must be a valid number.`);
      } else {
        if (field.min !== undefined && number < field.min) errors.push(`${field.label} must be at least ${field.min}.`);
        if (field.max !== undefined && number > field.max) errors.push(`${field.label} must be no more than ${field.max}.`);
      }
    }
    if (field.type === "date") {
      const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
      const year = match ? Number(match[1]) : 0;
      const month = match ? Number(match[2]) : 0;
      const day = match ? Number(match[3]) : 0;
      const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
      const daysInMonth = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
      if (!match || month < 1 || month > 12 || day < 1 || day > daysInMonth[month - 1]!) {
        errors.push(`${field.label} must be a valid date.`);
      }
    }
  }
  return errors;
}

/** Fields a customer fills directly; row-local tokens stay inside their repeater. */
export function extractFillableFields(
  template: BillTemplate,
  computedKeys: readonly string[] = [],
): TemplateField[] {
  const computed = new Set(computedKeys);
  const repeatColumns = new Set<string>();
  const outsideRepeat = new Set<string>();
  for (const object of template.objects) {
    if (object.type === "text" || object.type === "field" || object.type === "cell-field") {
      for (const key of extractVariables(object.text)) outsideRepeat.add(key);
    } else if (object.type === "table") {
      for (let row = 0; row < object.rows; row += 1) {
        for (let col = 0; col < object.columns; col += 1) {
          const text = object.cells[row * object.columns + col]?.text ?? "";
          const inBand = object.repeat && row >= object.repeat.startRow && row <= object.repeat.endRow;
          for (const key of extractVariables(text)) (inBand ? repeatColumns : outsideRepeat).add(key);
        }
      }
    }
  }
  return extractTemplateFields(template).filter((field) =>
    !computed.has(field.key) && !(repeatColumns.has(field.key) && !outsideRepeat.has(field.key)),
  );
}

/** Defaults applied when a customer first opens a template's generated form. */
export function defaultValuesForTemplate(
  template: BillTemplate,
  computedKeys: readonly string[] = [],
): Record<string, string> {
  return Object.fromEntries(
    extractFillableFields(template, computedKeys)
      .filter((field) => field.type !== "image" && field.defaultValue !== undefined)
      .map((field) => [field.key, field.defaultValue!]),
  );
}

/**
 * How every token of a template prints, keyed for `applyDisplayFormats`.
 *
 * An explicit spec wins; without one the field's own inferred type decides:
 * a date-shaped key prints in the conventional pattern, a money-shaped key
 * groups its thousands the Indian way, a counting key groups too, and any key
 * that names an identifier (`_no`, `code`, `hsn`) is left exactly as supplied.
 * The map is what makes the same bundle print the same figures on every
 * runtime without each host re-deriving the rule.
 */
export function displayMapFor(template: BillTemplate): Record<
  string,
  { date?: string; grouping?: "off" | "indian" | "western" }
> {
  const out: Record<string, { date?: string; grouping?: "off" | "indian" | "western" }> = {};
  for (const spec of Array.isArray(template.meta?.placeholders) ? template.meta.placeholders : []) {
    if (!spec || typeof spec.key !== "string" || spec.key.length === 0) continue;
    if (!spec.display) continue;
    const entry: { date?: string; grouping?: "off" | "indian" | "western" } = {};
    if (typeof spec.display.date === "string") entry.date = spec.display.date;
    if (
      spec.display.grouping === "off" ||
      spec.display.grouping === "indian" ||
      spec.display.grouping === "western"
    ) {
      entry.grouping = spec.display.grouping;
    }
    if (entry.date !== undefined || entry.grouping !== undefined) out[spec.key] = entry;
  }

  for (const field of extractTemplateFields(template)) {
    if (field.display) continue;
    const key = field.key;
    if (out[key]) continue;
    if (key in out) continue;
    if (field.type === "date") {
      out[key] = { date: "DD/MM/YYYY" };
      continue;
    }
    if (isIdentifierKey(key)) continue;
    if (field.type === "currency") out[key] = { grouping: "indian" };
  }
  return out;
}

/** Keys whose digits are names, not figures: grouping them lies about them. */
const IDENTIFIER_KEY_RX = /(^|_)(no|nos|hsn|pincode|code|id|gstin|pan|phone|mobile|ifsc|account)$/i;

function isIdentifierKey(key: string): boolean {
  const seg = key.slice(key.lastIndexOf(".") + 1);
  if (IDENTIFIER_KEY_RX.test(seg)) return true;
  return /^s(or|l)\.?$/i.test(seg);
}

/** Validate each item row against the same field contract as ordinary inputs. */
export function validateRepeatingValues(
  template: BillTemplate,
  fields: readonly TemplateField[],
  values: Readonly<Record<string, string>>,
): string[] {
  const errors: string[] = [];
  for (const table of template.objects) {
    if (table.type !== "table" || !table.repeat) continue;
    let rows: unknown;
    try {
      rows = JSON.parse(values[table.repeat.key] ?? "[]") as unknown;
    } catch {
      errors.push(`${table.name} rows could not be read.`);
      continue;
    }
    if (!Array.isArray(rows)) {
      errors.push(`${table.name} rows must be a list.`);
      continue;
    }
    const columns = new Set<string>();
    for (let row = table.repeat.startRow; row <= table.repeat.endRow; row += 1) {
      for (let col = 0; col < table.columns; col += 1) {
        for (const key of extractVariables(table.cells[row * table.columns + col]?.text ?? "")) columns.add(key);
      }
    }
    const rowFields = fields.filter((field) => columns.has(field.key));
    if (rows.length === 0 && rowFields.some((field) => field.required)) {
      errors.push(`${table.name}: add at least one item row.`);
    }
    rows.forEach((row, index) => {
      if (typeof row !== "object" || row === null || Array.isArray(row)) return;
      const rowValues: Record<string, string> = {};
      for (const [key, value] of Object.entries(row)) if (typeof value === "string") rowValues[key] = value;
      for (const issue of validateTemplateValues(rowFields, rowValues)) {
        errors.push(`${table.name}, row ${index + 1}: ${issue}`);
      }
    });
  }
  return errors;
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
    if (o.type === "text" || o.type === "field" || o.type === "cell-field") {
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
        cells: o.cells.map((c, index) => {
          const pure = PURE_TOKEN.exec(typeof c?.text === "string" ? c.text : "");
          const spec = pure ? byKey.get(pure[1]!) : undefined;
          const row = Math.floor(index / o.columns);
          const inRepeatBand = Boolean(
            o.repeat && row >= o.repeat.startRow && row <= o.repeat.endRow,
          );
          // TableCell has no font family or text colour of its own — style a
          // cell by the spec through the two fields it does have.
          return {
            ...c,
            fontSize: typeof spec?.fontSize === "number" && spec.fontSize > 0 ? spec.fontSize : c.fontSize,
            fontWeight: spec?.fontWeight ?? c.fontWeight,
            ...(spec?.color ? { color: spec.color } : {}),
            // Repeat-band values are row-local. Resolving them against the
            // outer form first would replace every row with one global value
            // before the repeat renderer has a chance to bind the row object.
            text: inRepeatBand
              ? (typeof c?.text === "string" ? c.text : "")
              : resolveText(typeof c?.text === "string" ? c.text : "", values),
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
