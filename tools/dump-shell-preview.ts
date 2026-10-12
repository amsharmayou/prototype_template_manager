/**
 * Reproduce the Android host's preview, outside Android.
 *
 * The shell the app inlines is Kotlin string-building, so a preview bug (a page
 * that does not fit, an offset, a bad scale) is only observable on a device,
 * where the loop is slow and the numbers are invisible. This writes the same
 * shell plus a real rendered bill to disk so it can be opened in a browser and
 * measured.
 *
 * Run: npx tsx tools/dump-shell-preview.ts
 */

import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { buildPackage } from "@/lib/package/build";
import { deriveFormBridge, renderBridge } from "@/lib/billkit/bridge";
import type { BillTemplate, TableCell, TableObject } from "@/lib/template/types";

const here = dirname(fileURLToPath(import.meta.url));
const webRoot = resolve(here, "..");
const prototypeRoot = resolve(webRoot, "..");
const OUT = join(webRoot, ".shell-preview");

const DEMO_NAME = "Lucky Cargo Movers — Lorry Receipt";
const BAND_COLUMNS = ["{{description}}", "{{packages}}", "{{weight}}", "{{amount}}"] as const;
const BAND_KEY = "items";

function cell(text: string, column: number, row: number): TableCell {
  return {
    text,
    textAlign: column === 3 ? "right" : "left",
    fontSize: 12,
    fontWeight: row === 0 ? "bold" : "normal",
  };
}

function authorBand(table: TableObject): TableObject {
  const rowHeights = [20, 19, 19, 19, 19];
  const cells: TableCell[] = [];
  for (let row = 0; row < rowHeights.length; row += 1) {
    for (let column = 0; column < table.columns; column += 1) {
      if (row === 0) cells.push(cell(["Description", "Pkgs", "Weight", "Amount"][column] ?? "", column, row));
      else if (row >= 1 && row <= 3) cells.push(cell(BAND_COLUMNS[column] ?? "", column, row));
      else cells.push(cell(column === 2 ? "Total" : column === 3 ? "{{total}}" : "", column, row));
    }
  }
  return {
    ...table,
    rows: rowHeights.length,
    rowHeights,
    height: rowHeights.reduce((a, b) => a + b, 0),
    cells,
    repeat: { startRow: 1, endRow: 3, key: BAND_KEY, repeatHeader: false, maxItems: 20 },
  };
}

function main(): void {
  const template = JSON.parse(
    readFileSync(join(prototypeRoot, "outputs", "2.json"), "utf8"),
  ) as BillTemplate;

  const png = readFileSync(join(prototypeRoot, "outputs", "2.png"));
  const dataUri = `data:image/png;base64,${png.toString("base64")}`;

  const objects = template.objects.map((o) => {
    if (o.type === "image-placeholder") return { ...o, src: dataUri };
    if (o.type === "table") return authorBand(o as TableObject);
    return o;
  });

  const demo: BillTemplate = { ...template, meta: { ...template.meta, name: DEMO_NAME }, objects };
  const pkg = buildPackage(demo, {
    computed: [
      { key: "subtotal", op: "sum", args: [`${BAND_KEY}.amount`] },
      { key: "total", op: "add", args: ["subtotal"] },
    ],
  });

  // Same shape the Kotlin host hands the runtime: assets already inlined.
  const templateJson = JSON.stringify(demo).replaceAll("pkg://", "");
  const manifestJson = JSON.stringify(pkg.manifest);

  const schema = deriveFormBridge(manifestJson, templateJson);

  const values: Record<string, string> = {};
  for (const field of schema.fields) values[field.key] = "Sample";
  values[BAND_KEY] = JSON.stringify([
    { description: "Cartons", packages: "10", weight: "20", amount: "150.50" },
    { description: "Pallets", packages: "4", weight: "8", amount: "200.00" },
  ]);
  values.subtotal = "";
  values.total = "";

  const rendered = renderBridge(
    templateJson,
    JSON.stringify(values),
    JSON.stringify(pkg.manifest.computed),
  );

  const runtime = readFileSync(join(webRoot, "public", "billkit.js"), "utf8");
  const width = pkg.manifest.document.width;
  const height = pkg.manifest.document.height;

  const shell = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<style>
  html, body { margin: 0; padding: 0; background: #fff; overflow: hidden; }
  #stage { position: absolute; top: 0; left: 0; width: 100%; }
  #out { display: block; width: 100%; border: 0; background: #fff; }
</style>
</head>
<body>
<div id="stage"><iframe id="out"></iframe></div>
<script>${runtime.replaceAll("</script", "<\\/script")}</script>
<script>
window.billkitMount = function (html, pageWidth, pageHeight) {
    var out = document.getElementById('out');
    out.style.aspectRatio = pageWidth + ' / ' + (pageHeight > 0 ? pageHeight : pageWidth);
    out.srcdoc = html;
  };
  window.__mount = function () {
    billkitMount(${JSON.stringify(rendered.html)}, ${width}, ${height});
  };
  window.__measure = function () {
    var out = document.getElementById('out');
    var stage = document.getElementById('stage');
    return {
      innerWidth: window.innerWidth,
      bodyClientWidth: document.body.clientWidth,
      stageRect: stage.getBoundingClientRect().toJSON(),
      outRect: out.getBoundingClientRect().toJSON(),
      pageWidth: ${width},
      pageHeight: ${height},
    };
  };
</script>
</body>
</html>`;

  mkdirSync(OUT, { recursive: true });
  writeFileSync(join(OUT, "shell.html"), shell);
  writeFileSync(join(OUT, "rendered.html"), rendered.html);
  console.log(`wrote ${OUT}\\shell.html and rendered.html (page ${width}x${height})`);
  console.log(`unresolved tokens left in output: ${(rendered.html.match(/\{\{/g) ?? []).length}`);
  console.log(`warnings: ${rendered.warnings.join("; ") || "none"}`);
  console.log(`variables: ${rendered.variables.join(", ")}`);
}

main();