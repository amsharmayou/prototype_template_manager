/**
 * Build the demo package the Android host ships with, and stage the assets it
 * loads.
 *
 * The demo is a real traced bill rather than a synthetic one: `2.json` is a
 * lorry receipt traced in the editor and `2.png` is the page it was traced from.
 * Two things are authored on top, because the trace alone would not show what
 * the host is for:
 *
 *   1. `2.png` is bound into the empty image slot, so the package carries a real
 *      asset and the host has a `pkg://` reference to resolve.
 *   2. The traced table is an empty grid, so it becomes a repeating band with a
 *      computed total — the one feature a host cannot show without it.
 *
 * Run: npm run prepare:android-assets
 */

import { copyFileSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { buildPackage, writePackage } from "@/lib/package/build";
import type { BillTemplate, TableCell, TableObject } from "@/lib/template/types";

const here = dirname(fileURLToPath(import.meta.url));
const webRoot = resolve(here, "..");
const prototypeRoot = resolve(webRoot, "..");

const OUTPUTS = join(prototypeRoot, "outputs");
const ASSETS = join(prototypeRoot, "Android", "app", "src", "main", "assets");

const DEMO_NAME = "Lucky Cargo Movers — Lorry Receipt";

/** The band's columns, in the order the traced table laid them out. */
const BAND_COLUMNS = ["{{description}}", "{{packages}}", "{{weight}}", "{{amount}}"] as const;
const BAND_KEY = "items";
const BAND_START_ROW = 1;
const BAND_END_ROW = 3;
const BAND_MAX_ITEMS = 20;

function cell(
  text: string,
  column: number,
  row: number,
): TableCell {
  return {
    text,
    textAlign: column === 3 ? "right" : "left",
    fontSize: 12,
    fontWeight: row === 0 ? "bold" : "normal",
  };
}

/** Replace the traced empty grid with a band, a header and a totals row. */
function authorBand(table: TableObject): TableObject {
  const columns = table.columns;
  const rowHeights = [20, 19, 19, 19, 19];
  const cells: TableCell[] = [];

  for (let row = 0; row < rowHeights.length; row += 1) {
    for (let column = 0; column < columns; column += 1) {
      if (row === 0) {
        const labels = ["Description", "Pkgs", "Weight", "Amount"];
        cells.push(cell(labels[column] ?? "", column, row));
      } else if (row >= BAND_START_ROW && row <= BAND_END_ROW) {
        cells.push(cell(BAND_COLUMNS[column] ?? "", column, row));
      } else {
        // The trailer row: a label in the last-but-one column, the total beside it.
        const isTotal = column === 2 || column === 3;
        cells.push(cell(isTotal ? (column === 2 ? "Total" : "{{total}}") : "", column, row));
      }
    }
  }

  return {
    ...table,
    rows: rowHeights.length,
    rowHeights,
    height: rowHeights.reduce((a, b) => a + b, 0),
    cells,
    repeat: {
      startRow: BAND_START_ROW,
      endRow: BAND_END_ROW,
      key: BAND_KEY,
      repeatHeader: false,
      maxItems: BAND_MAX_ITEMS,
    },
  };
}

function main(): void {
  const template = JSON.parse(
    readFileSync(join(OUTPUTS, "2.json"), "utf8"),
  ) as BillTemplate;

  const png = readFileSync(join(OUTPUTS, "2.png"));
  const dataUri = `data:image/png;base64,${png.toString("base64")}`;

  const objects = template.objects.map((o) => {
    // The traced slot is empty; binding the page gives the package a real asset
    // to resolve rather than a dashed box.
    if (o.type === "image-placeholder") {
      return { ...o, src: dataUri };
    }
    if (o.type === "table") {
      return authorBand(o as TableObject);
    }
    return o;
  });

  const demo: BillTemplate = {
    ...template,
    meta: { ...template.meta, name: DEMO_NAME },
    objects,
  };

  const pkg = buildPackage(demo, {
    computed: [
      { key: "subtotal", op: "sum", args: [`${BAND_KEY}.amount`] },
      { key: "total", op: "add", args: ["subtotal"] },
    ],
  });

  mkdirSync(ASSETS, { recursive: true });

  const bytes = writePackage(pkg);
  writeFileSync(join(ASSETS, "sample.btpkg"), bytes);

  copyFileSync(join(webRoot, "public", "billkit.js"), join(ASSETS, "billkit.js"));

  const manifest = pkg.manifest;
  const band = objects.find((o) => o.type === "table") as TableObject;

  console.log(`demo package written to ${ASSETS}`);
  console.log(`  name          ${manifest.name}`);
  console.log(`  page          ${manifest.document.width}x${manifest.document.height}`);
  console.log(`  objects       ${objects.length}`);
  console.log(`  fields        ${manifest.fields.length}`);
  console.log(`  assets        ${manifest.assets.length}`);
  console.log(`  band          ${band.repeat?.key} rows ${band.repeat?.startRow}-${band.repeat?.endRow}`);
  console.log(`  computed      ${manifest.computed.map((c) => c.key).join(", ")}`);
  console.log(`  btpkg size    ${(bytes.length / 1024).toFixed(1)} KB`);
}

main();
