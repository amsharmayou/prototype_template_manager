import { describe, expect, it } from "vitest";

import { buildPackage, writePackage } from "@/lib/package/build";
import { sha256HexBytes } from "@/lib/render/sha256";
import type { BillTemplate, TableCell, TableObject } from "@/lib/template/types";

/**
 * Longer than the coarsest timestamp fflate can write.
 *
 * The DOS time it stamps into each header and the central directory keeps
 * seconds at two-second resolution (`dt.getSeconds() >> 1`), so two builds
 * under two seconds apart can fall in the same bucket and come out byte
 * identical even with the bug present. 1.1s does that often enough to matter:
 * a shorter delay makes this test pass vacuously, which is the same failure the
 * purity guard's "scans more than one real source file" assertion exists to
 * rule out.
 */
const APART_MS = 2_100;

const PNG =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";

function cell(text: string, row = 0): TableCell {
  return { text, textAlign: "left", fontSize: 12, fontWeight: row === 0 ? "bold" : "normal" };
}

/**
 * A template with more than one archive member: a binary asset extracted out of
 * the JSON, a repeat band, and a plain text object. Determinism has to hold for
 * the extracted bytes too, not just the serialised template.
 */
function bandedTemplate(modifiedAt = "2026-10-10T00:00:00.000Z"): BillTemplate {
  const columns = 4;
  const rowHeights = [20, 19, 19, 19];
  const cells: TableCell[] = [];
  for (let row = 0; row < rowHeights.length; row += 1) {
    for (let column = 0; column < columns; column += 1) {
      if (row === 0) cells.push(cell(["Description", "Pkgs", "Weight", "Amount"][column]!, row));
      else if (row <= 2) {
        cells.push(cell(["{{description}}", "{{packages}}", "{{weight}}", "{{amount}}"][column]!, row));
      } else cells.push(cell(column === 2 ? "Total" : column === 3 ? "{{total}}" : "", row));
    }
  }

  const table: TableObject = {
    id: "t1",
    type: "table",
    name: "Table 1",
    role: null,
    x: 10,
    y: 10,
    width: 400,
    height: rowHeights.reduce((a, b) => a + b, 0),
    rotation: 0,
    opacity: 1,
    visible: true,
    locked: false,
    zIndex: 1,
    parentId: null,
    stroke: "",
    strokeWidth: 0,
    fill: "",
    rows: rowHeights.length,
    columns,
    colWidths: Array.from({ length: columns }, () => 100),
    rowHeights,
    cells,
    borderColor: "#000000",
    borderWidth: 1,
    cellFill: "#ffffff",
    headerRow: true,
    headerFill: "#ffffff",
    headerTextColor: "#000000",
    cellTextColor: "#000000",
    padding: 2,
    fontFamily: "Arial",
    repeat: { startRow: 1, endRow: 2, key: "items", maxItems: 20 },
  };

  return {
    templateVersion: 2,
    document: { width: 794, height: 1123 },
    meta: { name: "Lorry Receipt", modifiedAt },
    objects: [
      {
        id: "img1",
        type: "image-placeholder",
        name: "Logo",
        role: null,
        placeholderRole: "logo",
        label: "Logo",
        src: PNG,
        x: 0,
        y: 0,
        width: 40,
        height: 40,
        rotation: 0,
        opacity: 1,
        visible: true,
        locked: false,
        zIndex: 0,
        parentId: null,
        stroke: "",
        strokeWidth: 0,
        fill: "",
      },
      table,
      {
        id: "tx1",
        type: "text",
        name: "Reference",
        role: null,
        x: 60,
        y: 200,
        width: 300,
        height: 24,
        rotation: 0,
        opacity: 1,
        visible: true,
        locked: false,
        zIndex: 2,
        parentId: null,
        stroke: "",
        strokeWidth: 0,
        fill: "",
        text: "Ref {{invoice_ref}}",
        fontFamily: "Arial",
        fontSize: 14,
        fontWeight: "normal",
        fontStyle: "normal",
        textAlign: "left",
        lineHeight: 1.16,
        charSpacing: 0,
        roleKind: "variable",
        textVerticalAlign: "top",
      },
    ],
  };
}

const archive = (t: BillTemplate): Uint8Array => writePackage(buildPackage(t));

const delay = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * `meta.modifiedAt` must not change the archive bytes, and `buildPackage` now
 * enforces it.
 *
 * The field is editor bookkeeping - "when this document was last saved" - and
 * `buildPackage` serialised the whole template into `template.json`, so the save
 * stamp reached the archive and therefore any id taken from it. Two exports of
 * one bill seconds apart were different files with different SHA-256s, which
 * makes `sha256(bytes)` unusable as a content address: the same template
 * exported twice yields two rows, dedupe never hits, and the id stops being able
 * to carry an integrity claim. `writePackage` already pins the other half of the
 * same problem, the zip timestamps; this was the content-side twin.
 *
 * Nothing reads the archived `modifiedAt` - the editor stamps it on save in
 * `lib/template/serialize.ts`, which is a separate file that did not move.
 *
 * This case was originally written first and left deliberately failing rather
 * than fixed: making it pass meant dropping a field from the template
 * `buildPackage` is asked to serialise, which was not that wave's call.
 * `docs/superpowers/plans/2026-10-12-shared-format-package.md:652` records the
 * same finding and defers it to the content-addressed store, which is this wave.
 * The sentinel was the honest encoding in the meantime - the assertion stayed
 * written and executed and turned this suite RED the moment the behaviour
 * changed - so the fix could be made against a test already known to fail for
 * exactly this reason. It is now asserted directly, and goes red again if
 * anyone lets the save stamp back into the archive.
 *
 * The renderer has carried the equivalent rule all along, reducing `meta` to
 * its name (`version 1/lib/render/index.ts:179`, tested at
 * `tests/render.test.ts:1047`); `buildPackage` now has the equivalent rule.
 */
describe("writePackage is a pure function of its input", () => {
  it("produces identical bytes for the same template built twice", { timeout: 15000 }, async () => {
    const first = archive(bandedTemplate());
    await delay(APART_MS);
    const second = archive(bandedTemplate());

    expect(second).toEqual(first);
    expect(sha256HexBytes(second)).toBe(sha256HexBytes(first));
  });

  it("does not let meta.modifiedAt reach the archive", () => {
    // Compared by digest, not by array, so a failure names the two archives
    // instead of printing a few hundred byte values side by side.
    const stamp = "2026-10-10T00:00:00.000Z";
    const first = sha256HexBytes(archive(bandedTemplate(stamp)));
    const second = sha256HexBytes(archive(bandedTemplate("2031-06-06T06:06:06.006Z")));

    expect(second).toBe(first);
  });
});
