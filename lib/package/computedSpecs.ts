/**
 * The derived money values a template implies.
 *
 * Lives in the package layer rather than in the editor because three callers now
 * need the same rule: the editor's own preview, the export button, and the E2E
 * suite. A second copy would drift, and a total that differs between the preview
 * and the exported package is the kind of bug nobody reports because both look
 * plausible.
 */

import type { ComputedSpec } from "./format";
import type { BillTemplate, TableObject, TableRepeat, TemplateObject } from "../template/types";
import { extractTemplateFields } from "../template/dataBinding";
import { extractVariables } from "../template/placeholders";

/** A table carrying a repeat band, which is what a total row is summed from. */
type BandedTable = TableObject & { repeat: TableRepeat };

function isBandedTable(o: TemplateObject): o is BandedTable {
  // `repeat` is optional on a table, and an unvalidated template can carry
  // anything, so the check is a runtime one rather than a cast.
  return (
    o.type === "table" &&
    typeof (o as TableObject).repeat === "object" &&
    (o as TableObject).repeat !== null
  );
}

/**
 * The distinct `{{token}}` names inside a repeat band, in band order.
 *
 * The same rule `bandColumns` in `build.ts` and `columnsOf` in `form.ts` apply,
 * repeated here because this module sits between them and must not be the third
 * place that guesses.
 */
function bandColumns(t: BandedTable): string[] {
  const width = typeof t.columns === "number" && t.columns > 0 ? t.columns : 1;
  const cells = Array.isArray(t.cells) ? t.cells : [];
  const seen: string[] = [];
  for (let r = t.repeat.startRow; r <= t.repeat.endRow; r += 1) {
    for (let c = 0; c < width; c += 1) {
      const text = cells[r * width + c]?.text;
      if (typeof text !== "string") continue;
      for (const v of extractVariables(text)) {
        if (!seen.includes(v)) seen.push(v);
      }
    }
  }
  return seen;
}

/** Names a money column is conventionally given, most specific first. */
const MONEY_COLUMN_NAMES = [
  "amount",
  "line_total",
  "linetotal",
  "total",
  "price",
  "rate",
  "value",
  "cost",
  "sum",
];

/**
 * Which of a band's columns a total should sum.
 *
 * The column is found by name rather than assumed, because an arg naming a
 * column the band does not declare resolves against nothing: `validateManifest`
 * refuses it, and the export button fails on exactly the bills that renamed
 * their column. Falls back to the last column, which is where a money column
 * sits by convention in a line-item table.
 */
function moneyColumnOf(table: BandedTable): string | null {
  const columns = bandColumns(table);
  if (columns.length === 0) return null;
  for (const candidate of MONEY_COLUMN_NAMES) {
    const found = columns.find((column) => column.toLowerCase() === candidate);
    if (found) return found;
  }
  for (const candidate of MONEY_COLUMN_NAMES) {
    const found = columns.find((column) => column.toLowerCase().includes(candidate));
    if (found) return found;
  }
  return columns[columns.length - 1]!;
}

/**
 * Every band's amount column, summed into one `subtotal`, and a safe default
 * `total` when the template has no tax/discount inputs.
 *
 * A band with a trailing summary row can read `{{subtotal}}` and, when no tax or
 * discount inputs exist, `{{total}}`.
 *
 * A template with no band returns nothing at all. Emitting `total` anyway would
 * read a `subtotal` that no spec produces, which is a reference to a value that
 * does not exist — and `validateManifest` correctly refuses it, so the export
 * button would be unusable on exactly the simplest bills there are.
 *
 * Several bands fold into the *one* `subtotal` rather than one each: `sum`
 * accepts several args and adds them, and a second spec keyed `subtotal` would
 * collide with the first and be silently overwritten at render time.
 */
export function computedSpecsFor(template: BillTemplate): ComputedSpec[] {
  const bands = template.objects.filter(isBandedTable);
  const declared = Array.isArray(template.meta?.computed) ? template.meta.computed : [];
  const declaredKeys = new Set(declared.map((spec) => spec.key));

  const taxOrDiscountKeys = new Set([
    "tax", "tax_amount", "tax_rate", "discount", "discount_amount", "discount_rate",
  ]);
  const hasTaxOrDiscount = extractTemplateFields(template).some((field) => taxOrDiscountKeys.has(field.key));

  const specs: ComputedSpec[] = [];
  if (bands.length > 0 && !declaredKeys.has("subtotal")) {
    // A band with no token at all cannot contribute a column to sum, so it is
    // left out rather than guessed at: an arg pointing at nothing is refused
    // by `validateManifest`, which would make the whole package unexportable.
    const args = bands
      .map((table) => {
        const column = moneyColumnOf(table);
        return column ? `${table.repeat.key}.${column}` : null;
      })
      .filter((arg): arg is string => arg !== null);
    if (args.length > 0) {
      specs.push({ key: "subtotal", op: "sum", args });
    }
  }
  // A subtotal is safe to derive from repeated line amounts. A final total is
  // not safe to guess once the template has tax/discount inputs; leave it as a
  // fillable value until the owner defines those calculations explicitly.
  if (bands.length > 0 && !hasTaxOrDiscount && !declaredKeys.has("total")) {
    specs.push({ key: "total", op: "add", args: ["subtotal"] });
  }
  return [...specs, ...declared];
}
