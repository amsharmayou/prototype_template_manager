import { readFileSync, writeFileSync } from "node:fs";

import { parsePackage } from "@/lib/package/parse";
import { resolvePackage } from "@/lib/package/resolve";
import { buildPackage, writePackage } from "@/lib/package/build";
import type { BillTemplate, LayoutConfig, TemplateObject } from "@/lib/template/types";

/**
 * Builds a variable-layout variant of a package, for proving the solver and the
 * measurer work on a real bill rather than only in a unit test.
 *
 * Every growing slot is pushed onto one horizontal guide, so the guide has to
 * travel far enough for the tallest field and everything attached below it has
 * to follow.
 */

const src = process.argv[2]!;
const out = process.argv[3]!;
const guideY = Number(process.argv[4] ?? 300);

const pkg = parsePackage(new Uint8Array(readFileSync(src)));
const { template: resolved } = resolvePackage(pkg);

const layout: LayoutConfig = {
  mode: "variable",
  document: { growthX: "fixed", growthY: "expand", maxHeight: 4000 },
  guides: [
    { id: "lower-boundary", orientation: "horizontal", position: guideY, maxDisplacement: 600 },
  ],
  attachments: [],
};

let grown = 0;
const objects: TemplateObject[] = resolved.objects.map((o) => {
  if (o.type !== "text" && o.type !== "field") return o;
  // Only a slot that carries a token can change size when it is filled.
  if (typeof o.text !== "string" || !o.text.includes("{{")) return o;
  grown += 1;
  return {
    ...o,
    expansion: {
      x: { mode: "fixed" as const },
      y: {
        mode: "unbounded" as const,
        strategy: "wrap" as const,
        growthGuideId: "lower-boundary",
      },
    },
  };
});

const template: BillTemplate = { ...resolved, meta: { ...resolved.meta, name: "LAYOUT DEMO" }, objects, layout };

// A rectangle below the guide, to show it being pushed rather than ignored.
const mover: TemplateObject = {
  id: "layout-mover",
  type: "rect",
  name: "Lower section",
  role: null,
  x: 40,
  y: guideY + 10,
  width: 400,
  height: 60,
  rotation: 0,
  opacity: 1,
  visible: true,
  locked: false,
  zIndex: 5,
  parentId: null,
  stroke: "#c00",
  strokeWidth: 2,
  fill: "transparent",
  cornerRadius: 0,
};

const withMover: BillTemplate = {
  ...template,
  objects: [...template.objects, mover],
  layout: {
    ...layout,
    attachments: [
      { id: "lower-att", objectId: mover.id, edge: "top", guideId: "lower-boundary", behavior: "move" },
    ],
  },
};

const rebuilt = writePackage(buildPackage(withMover, { computed: pkg.manifest.computed }));
writeFileSync(out, rebuilt);

console.log(`wrote ${out}`);
console.log(`  slots grown   ${grown}`);
console.log(`  guide         lower-boundary @ ${guideY} (max +600)`);
console.log(`  bytes         ${rebuilt.length}`);