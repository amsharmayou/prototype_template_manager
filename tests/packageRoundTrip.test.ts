import { describe, expect, it } from "vitest";

import { buildPackage, writePackage } from "@/lib/package/build";
import { parsePackage } from "@/lib/package/parse";
import type { Package } from "@/lib/package/format";
import { validatePackage } from "@/lib/package/validate";
import type { BillTemplate, TableCell } from "@/lib/template/types";

const PNG =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";

const dec = new TextDecoder();

/**
 * Bill-part bytes that deflate cannot collapse. `i % 251` walks the whole byte
 * range, so the sequence has no run longer than one; the short identical run in
 * the middle stands in for the flat regions a real bill image has. A repeating
 * pattern would compress to nearly nothing and make the size comparison below
 * measure the deflate window rather than the base64 overhead.
 */
function noisyBytes(length: number): Uint8Array {
  const out = new Uint8Array(length);
  for (let i = 0; i < length; i += 1) out[i] = i % 251;
  for (let i = 5000; i < 5200; i += 1) out[i] = 200;
  return out;
}

/** The same noisy bytes as an inline image, the way the editor stores them. */
function largeDataUri(): string {
  const bytes = noisyBytes(40 * 1024);
  return `data:image/png;base64,${Buffer.from(bytes).toString("base64")}`;
}

const cell = (text: string): TableCell => ({
  text,
  textAlign: "left",
  fontSize: 10,
  fontWeight: "normal",
});

/** A template whose only image is the 1x1 fixture above. */
function base(): BillTemplate {
  return {
    templateVersion: 2,
    document: { width: 794, height: 1123 },
    meta: { name: "Invoice A4", modifiedAt: "2026-10-08T00:00:00.000Z" },
    objects: [
      {
        id: "obj_7",
        type: "bill-part",
        name: "Bill Part 1",
        role: null,
        x: 10,
        y: 20,
        width: 30,
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
        src: PNG,
        normalized: true,
      },
    ],
  };
}

/** A template with a repeat band, which makes the manifest's graph live. */
function withBand(): BillTemplate {
  return {
    templateVersion: 2,
    document: { width: 794, height: 1123 },
    meta: { name: "Invoice A4", modifiedAt: "2026-10-08T00:00:00.000Z" },
    objects: [
      {
        id: "t1",
        type: "table",
        name: "Items",
        role: null,
        x: 0,
        y: 0,
        width: 400,
        height: 60,
        rotation: 0,
        opacity: 1,
        visible: true,
        locked: false,
        zIndex: 0,
        parentId: null,
        stroke: "",
        strokeWidth: 0,
        fill: "",
        rows: 3,
        columns: 2,
        colWidths: [200, 200],
        rowHeights: [20, 20, 20],
        cells: [
          cell("Item"),
          cell("Amount"),
          cell("{{description}}"),
          cell("{{amount}}"),
          cell("Total"),
          cell("{{total}}"),
        ],
        borderColor: "#000000",
        borderWidth: 1,
        cellFill: "",
        headerRow: true,
        headerFill: "",
        headerTextColor: "",
        cellTextColor: "",
        padding: 2,
        fontFamily: "Arial",
        repeat: { startRow: 1, endRow: 1, key: "items", maxItems: 30 },
      },
    ],
  };
}

const templateIn = (pkg: { files: Map<string, Uint8Array> }): BillTemplate =>
  JSON.parse(dec.decode(pkg.files.get("template.json")!));

describe("package round-trip", () => {
  it("survives write then read unchanged", () => {
    const back = parsePackage(writePackage(buildPackage(base())));
    expect(back.manifest.name).toBe("Invoice A4");
    expect(back.manifest.templateVersion).toBe(2);
    expect(back.manifest.assets).toHaveLength(1);
    expect(back.files.get("template.json")).toBeDefined();
  });

  it("extracts the inline image into the archive instead of base64 in the template", () => {
    const pkg = buildPackage(base());
    const part = templateIn(pkg).objects[0] as { src?: string };
    expect(part.src).toMatch(/^pkg:\/\//);
    expect(part.src).not.toContain("base64");
    expect(pkg.files.get(part.src!.replace("pkg://", ""))).toBeDefined();
  });

  it("validates clean after a round-trip", () => {
    expect(validatePackage(parsePackage(writePackage(buildPackage(base()))))).toEqual({
      ok: true,
      issues: [],
    });
  });

  it("stores image bytes raw rather than base64, which is smaller", () => {
    const archived = buildPackage(base()).files.get("assets/obj_7.png")!;
    expect(archived.length).toBe(70);
    expect(archived.length).toBeLessThan(PNG.length);
  });

  it("is smaller than the equivalent base64 JSON once the image carries real payload", () => {
    const t = base();
    (t.objects[0] as { src?: string }).src = largeDataUri();
    const zipped = writePackage(buildPackage(t)).length;
    const asJson = new TextEncoder().encode(JSON.stringify(t)).length;
    expect(zipped).toBeLessThan(asJson);
  });

  it("keeps a bill part with no image, as a part that renders nothing yet", () => {
    const t = base();
    delete (t.objects[0] as { src?: string }).src;
    expect(parsePackage(writePackage(buildPackage(t))).manifest.assets).toHaveLength(0);
  });

  it("does not extract an image src that is not a data URI", () => {
    const t = base();
    (t.objects[0] as { src?: string }).src = "https://example.com/a.png";
    const pkg = buildPackage(t);
    expect(pkg.manifest.assets).toHaveLength(0);
    expect(templateIn(pkg).objects[0]).toMatchObject({ src: "https://example.com/a.png" });
  });

  it("gives two parts with identical images one archive entry", () => {
    const t = base();
    t.objects.push({ ...t.objects[0], id: "obj_8", name: "Bill Part 2" } as never);
    const srcs = templateIn(buildPackage(t)).objects.map((o) => (o as { src?: string }).src);
    expect(new Set(srcs).size).toBe(1);
  });

  it("derives the manifest fields from the template", () => {
    const t = base();
    t.objects = [
      {
        ...base().objects[0],
        type: "text",
        src: undefined,
        text: "Dear {{customer_name}}",
        fontFamily: "Arial",
        fontSize: 12,
        fontWeight: "normal",
        fontStyle: "normal",
        textAlign: "left",
        lineHeight: 14,
        charSpacing: 0,
        roleKind: "variable",
        textVerticalAlign: "top",
      } as never,
    ];
    expect(buildPackage(t).manifest.fields.map((f) => f.key)).toContain("customer_name");
  });

  it("refuses to parse bytes that are not a zip", () => {
    expect(() => parsePackage(new TextEncoder().encode("not a zip"))).toThrow();
  });

  it("reports a manifest edited after it was written", () => {
    // The manifest is the one member that cannot carry its own digest, so the
    // sibling `manifest.json.sha256` is what makes tampering detectable. Without
    // this check the manifest is the blind spot in an otherwise verified package.
    const good = writePackage(buildPackage(base()));
    const back = parsePackage(good);
    const tampered: Package = { ...back, manifest: { ...back.manifest, name: "Swapped" } };
    const result = validatePackage(tampered);
    expect(result.ok).toBe(false);
    expect(result.issues.some((i) => i.path === "manifest")).toBe(true);
  });

  it("verifies a manifest that was not tampered with", () => {
    const back = parsePackage(writePackage(buildPackage(base())));
    expect(validatePackage(back).ok).toBe(true);
  });

  it("declares a repeating field for a table's band, with its columns", () => {
    const repeat = buildPackage(withBand()).manifest.fields.find(
      (f) => f.type === "repeating",
    );
    expect(repeat).toMatchObject({
      key: "items",
      source: "table",
      objectName: "Items",
      columns: ["description", "amount"],
      maxItems: 30,
    });
  });

  it("takes the band columns from the band rows only, in band order", () => {
    const t = withBand();
    const table = t.objects[0] as unknown as {
      repeat: { startRow: number; endRow: number };
      cells: TableCell[];
    };
    table.repeat.startRow = 1;
    table.repeat.endRow = 2;
    const repeat = buildPackage(t).manifest.fields.find((f) => f.type === "repeating");
    expect(repeat?.columns).toEqual(["description", "amount", "total"]);
  });

  it("validates clean with a band, so the manifest declares what computed totals read", () => {
    // The load-bearing round trip: `items.amount` is resolved against the
    // repeating field this build emits, so the package validates only because
    // the repeat is declared. Drop the emission and this reports an issue at
    // `computed[0].args[0]`.
    const pkg = buildPackage(withBand(), {
      computed: [{ key: "total", op: "sum", args: ["items.amount"] }],
    });
    expect(validatePackage(parsePackage(writePackage(pkg)))).toEqual({ ok: true, issues: [] });
  });

  it("reports the unresolved computed arg when the band is not declared", () => {
    const t = withBand();
    t.objects = [];
    const pkg = buildPackage(t, {
      computed: [{ key: "total", op: "sum", args: ["items.amount"] }],
    });
    const result = validatePackage(pkg);
    expect(result.ok).toBe(false);
    expect(result.issues.some((i) => i.path === "computed[0].args[0]")).toBe(true);
  });
});
