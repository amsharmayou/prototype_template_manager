/**
 * The derived money values a template implies.
 *
 * Lives in the package layer rather than in the editor because three callers now
 * need the same rule: the editor's own preview, the export button, and the E2E
 * suite. A second copy would drift, and a total that differs between the preview
 * and the exported package is the kind of bug nobody reports because both look
 * plausible.
 */

import type { ComputedSpec } from "@/lib/package/format";
import type { BillTemplate, TableObject, TableRepeat, TemplateObject } from "@/lib/template/types";

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
 * Every band's amount column, summed into one `subtotal`, added into `total`.
 *
 * A band with a trailing total row reads `{{total}}`; this is what puts a figure
 * there.
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
  if (bands.length === 0) return [];

  return [
    {
      key: "subtotal",
      op: "sum" as const,
      args: bands.map((o) => `${o.repeat.key}.amount`),
    },
    { key: "total", op: "add", args: ["subtotal"] },
  ];
}