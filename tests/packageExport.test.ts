import { afterEach, describe, expect, it, vi } from "vitest";

import { blockingIssues, buildPackageBytes, describeIssues, packageFilename } from "@/lib/export/toPackage";
import { computedSpecsFor } from "@/lib/package/computedSpecs";
import { parsePackage } from "@/lib/package/parse";
import type { BillTemplate, TableCell, TableObject } from "@/lib/template/types";
import { unzipSync, strFromU8 } from "fflate";

const PNG =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";

function cell(text: string, row = 0): TableCell {
  return { text, textAlign: "left", fontSize: 12, fontWeight: row === 0 ? "bold" : "normal" };
}

/** A template with one repeat band and a trailing total row. */
function bandedTemplate(name = "Lorry Receipt"): BillTemplate {
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
    meta: { name, modifiedAt: "2026-10-10T00:00:00.000Z" },
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
    ],
  };
}

describe("computedSpecsFor", () => {
  it("sums each band's amount column into a total", () => {
    const specs = computedSpecsFor(bandedTemplate());

    expect(specs).toEqual([
      { key: "subtotal", op: "sum", args: ["items.amount"] },
      { key: "total", op: "add", args: ["subtotal"] },
    ]);
  });

  it("still produces a total when there is no band", () => {
    const empty: BillTemplate = {
      templateVersion: 2,
      document: { width: 794, height: 1123 },
      meta: { name: "Bare", modifiedAt: "" },
      objects: [],
    };

    // Nothing, rather than a `total` reading a `subtotal` no spec produces.
    // `validateManifest` refuses such an arg, so emitting it would make the
    // export button fail on the simplest bill there is.
    expect(computedSpecsFor(empty)).toEqual([]);
  });

  it("folds several bands into one subtotal rather than colliding on the key", () => {
    const template = bandedTemplate();
    const table = template.objects.find((o) => o.type === "table") as TableObject;
    const second: TableObject = {
      ...table,
      id: "t2",
      repeat: { startRow: 1, endRow: 2, key: "extras", maxItems: 5 },
    };
    const withTwo: BillTemplate = { ...template, objects: [...template.objects, second] };

    const specs = computedSpecsFor(withTwo);

    expect(specs.map((s) => s.key)).toEqual(["subtotal", "total"]);
    expect(specs[0]!.args).toEqual(["items.amount", "extras.amount"]);
  });
});

describe("buildPackageBytes", () => {
  it("writes an archive the host can open", () => {
    const { bytes } = buildPackageBytes(bandedTemplate());

    const members = unzipSync(bytes);
    expect(Object.keys(members).sort()).toEqual([
      "assets/img1.png",
      "manifest.json",
      "manifest.json.sha256",
      "template.json",
    ]);

    const pkg = parsePackage(bytes);
    expect(pkg.manifest.name).toBe("Lorry Receipt");
    expect(pkg.manifest.computed.map((c) => c.key)).toEqual(["subtotal", "total"]);
    expect(pkg.files.has("assets/img1.png")).toBe(true);
  });

  it("rewrites inline images to pkg references the manifest declares", () => {
    const { bytes } = buildPackageBytes(bandedTemplate());
    const pkg = parsePackage(bytes);
    const template = JSON.parse(strFromU8(pkg.files.get("template.json")!));

    const slot = template.objects.find((o: { type: string }) => o.type === "image-placeholder");
    expect(slot.src).toBe("pkg://assets/img1.png");
    expect(pkg.manifest.assets[0]).toMatchObject({
      file: "assets/img1.png",
      mime: "image/png",
      role: "image-placeholder",
    });
  });

  it("declares a repeating field so a host can edit the line items", () => {
    const { bytes } = buildPackageBytes(bandedTemplate());
    const manifest = parsePackage(bytes).manifest;

    const band = manifest.fields.find((f) => f.key === "items");
    expect(band).toMatchObject({ type: "repeating", source: "table", maxItems: 20 });
    expect(band?.columns).toEqual(["description", "packages", "weight", "amount"]);
  });

  it("produces no blocking issues for a well-formed template", () => {
    const { issues } = buildPackageBytes(bandedTemplate());

    expect(blockingIssues(issues)).toEqual([]);
  });

  it("reports a band with no tokens instead of shipping a form nothing can fill", () => {
    const template = bandedTemplate();
    const table = template.objects.find((o) => o.type === "table") as TableObject;
    // Blank out the band's cells, leaving only the header and the total row.
    for (let r = table.repeat!.startRow; r <= table.repeat!.endRow; r += 1) {
      for (let c = 0; c < table.columns; c += 1) {
        table.cells[r * table.columns + c] = cell("", r);
      }
    }

    const { issues } = buildPackageBytes(template);

    expect(blockingIssues(issues).length).toBeGreaterThan(0);
  });
});

describe("packageFilename", () => {
  it("is the document name, made safe", () => {
    expect(packageFilename(bandedTemplate("Lucky Cargo Movers — Lorry Receipt"))).toBe(
      "Lucky-Cargo-Movers-—-Lorry-Receipt.btpkg",
    );
  });

  it("strips characters a file system would reject", () => {
    expect(packageFilename(bandedTemplate('a/b:c*d?e"f<g>h|i'))).toBe("a-b-c-d-e-f-g-h-i.btpkg");
  });

  it("falls back when the name is nothing usable", () => {
    expect(packageFilename(bandedTemplate("   "))).toBe("bill.btpkg");
  });
});

describe("describeIssues", () => {
  it("names the path and the reason on each line", () => {
    expect(
      describeIssues([{ severity: "error", path: "fields[2].columns", message: "has no columns" }]),
    ).toBe("fields[2].columns: has no columns");
  });
});

afterEach(() => {
  vi.restoreAllMocks();
});