import { afterEach, describe, expect, it, vi } from "vitest";

import { buildPackage, writePackage } from "@/lib/package/build";
import { parsePackage } from "@/lib/package/parse";
import type { Package, PackageManifest } from "@/lib/package/format";
import { PACKAGE_VERSION } from "@/lib/package/format";
import { sha256HexBytes } from "@/lib/render/sha256";
import { validatePackage } from "@/lib/package/validate";
import type { BillTemplate, TableCell } from "@/lib/template/types";

import { strToU8 } from "fflate";

const PNG =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";

const dec = new TextDecoder();

/**
 * Bill-part bytes that deflate genuinely cannot shrink.
 *
 * An earlier version used `i % 251`, which looked non-uniform and was not: it is
 * exactly periodic at period 251, and deflate collapsed 40960 bytes to 484. A
 * comparison built on that measured the deflate window, not the thing under test.
 *
 * This is a 32-bit linear congruential generator, so the state sequence has its
 * full period of 2^32 and the high byte - which is all that is stored - has no
 * short period to find. Deterministic, no `Math.random`.
 */
function noisyBytes(length: number): Uint8Array {
  const out = new Uint8Array(length);
  let state = 0x2545f491;
  for (let i = 0; i < length; i += 1) {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    out[i] = state >>> 24;
  }
  return out;
}

/** The same noisy bytes as an inline image, the way the editor stores them. */
function largeDataUri(): string {
  const bytes = noisyBytes(40 * 1024);
  return `data:image/png;base64,${Buffer.from(bytes).toString("base64")}`;
}

/**
 * The same template packaged *without* extracting its image, for the size
 * comparison to run against.
 *
 * Both archives go through the same `writePackage` at the same zip settings, so
 * the only difference is whether the image moved out of the JSON. Comparing a
 * zipped archive against uncompressed template JSON instead would confound the
 * two effects: deflate alone would produce the win whether or not extraction
 * happened at all.
 */
function packageWithoutExtraction(template: BillTemplate): Package {
  const files = new Map<string, Uint8Array>([
    ["template.json", strToU8(JSON.stringify(template, null, 2))],
  ]);
  return {
    manifest: {
      packageVersion: PACKAGE_VERSION,
      templateVersion: template.templateVersion,
      name: template.meta.name,
      document: {
        width: template.document.width,
        height: template.document.height,
        unit: "px",
        dpi: 96,
        paper: "A4",
        currencyScale: 2,
      },
      template: "template.json",
      assets: [],
      fonts: [],
      fields: [],
      computed: [],
      checksums: { "template.json": sha256HexBytes(files.get("template.json")!) },
    },
    files,
  };
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

/**
 * A band whose cells also contain `{{items}}` - the band key itself, used as a
 * flat token. `extractTemplateFields` claims it as an ordinary table field before
 * the repeat is emitted, which is the only way the retyping branch is reached.
 */
function withCollidingBand(): BillTemplate {
  const t = withBand();
  const table = t.objects[0] as unknown as {
    cells: TableCell[];
    repeat: { startRow: number; endRow: number };
  };
  table.cells = [
    cell("Item"),
    cell("Amount"),
    cell("{{description}}"),
    cell("{{amount}}"),
    cell("{{items}}"),
    cell("{{qty}}"),
  ];
  table.repeat.endRow = 2;
  return t;
}

const templateIn = (pkg: { files: Map<string, Uint8Array> }): BillTemplate =>
  JSON.parse(dec.decode(pkg.files.get("template.json")!));

describe("package round-trip", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

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

  it("is smaller because the image moved out of the JSON, not because deflate flattened it", () => {
    // Both sides are archives from the same writer at the same zip settings, so
    // the sole variable is whether the image was extracted. Comparing against
    // uncompressed template JSON instead would have credited the win to deflate,
    // which would still win if extraction did nothing at all.
    const t = base();
    (t.objects[0] as { src?: string }).src = largeDataUri();
    const extracted = writePackage(buildPackage(t)).length;
    const inlined = writePackage(packageWithoutExtraction(t)).length;
    expect(extracted).toBeLessThan(inlined);
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

  it("names an archived asset after the mime type of its data URI", () => {
    // `ManifestAsset` carries no mime field, so the only record of what the bytes
    // are is the archive name. A JPEG stored as `.png` loses that for good.
    const t = base();
    (t.objects[0] as { src?: string }).src =
      "data:image/jpeg;base64,/9j/4AAQSkZJRgABAQEAYABgAAD/2wBDAAgGBgcGBQgHBwcJ";
    const pkg = buildPackage(t);
    expect([...pkg.files.keys()]).toContain("assets/obj_7.jpeg");
    expect(pkg.manifest.assets[0]?.file).toBe("assets/obj_7.jpeg");
  });

  it("gives two parts with identical images one archive entry", () => {
    const t = base();
    t.objects.push({ ...t.objects[0], id: "obj_8", name: "Bill Part 2" } as never);
    const pkg = buildPackage(t);
    const srcs = templateIn(pkg).objects.map((o) => (o as { src?: string }).src);
    expect(new Set(srcs).size).toBe(1);
    // Distinct from the srcs agreeing: an implementation that wrote two members
    // and two asset records while pointing both objects at the first entry would
    // satisfy the assertion above.
    expect(pkg.manifest.assets).toHaveLength(1);
    expect([...pkg.files.keys()].filter((n) => n.startsWith("assets/"))).toHaveLength(1);
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

  it("reports manifest bytes that do not match the digest stored beside them", () => {
    // The archive-level case: someone edited manifest.json inside the zip and
    // left the sibling digest alone, so the pair disagrees. The parsed manifest
    // is untouched here, which is why re-serialising it still reproduces the
    // *original* bytes and matches the digest - this is the one case only the
    // check against `manifestBytes` can see.
    const back = parsePackage(writePackage(buildPackage(base())));
    const corrupted: Package = {
      ...back,
      manifestBytes: strToU8(`{"packageVersion":1,"name":"Swapped"}`),
    };
    const result = validatePackage(corrupted);
    expect(result.ok).toBe(false);
    expect(result.issues.some((i) => i.path === "manifest")).toBe(true);
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

  it("names the object whose image it cannot decode, rather than archiving nothing", () => {
    // The bill part carries a well-formed data URI, so nothing about the
    // template is wrong - only the runtime cannot read base64. Archiving a
    // zero-byte asset anyway is the failure this rules out: its checksum would
    // be the checksum of nothing, so `validatePackage` would pass and the bill
    // would print with a silently missing part. The bytes are internally
    // consistent, so no validator can catch it later; `buildPackage` is the
    // only place it can be caught at all.
    vi.stubGlobal("atob", undefined);

    let thrown: unknown;
    try {
      buildPackage(base());
    } catch (e) {
      thrown = e;
    }

    expect(thrown).toBeInstanceOf(Error);
    const message = (thrown as Error).message;
    // Both identifiers, so an author holding a 200-object template can find the
    // one object that needs attention without guessing.
    expect(message).toContain("obj_7");
    expect(message).toContain("Bill Part 1");
  });

  it("trims a band key, so the manifest and the derived form name the same repeat", () => {
    // `validateManifest` trims, `repeatsOf` in `deriveForm` trims, and this loop
    // is the only place a key can be normalised. Emitting `" items "` untrimmed
    // declared a repeat under a name no computed arg could resolve against, so
    // the package failed its own validator.
    const t = withBand();
    const table = t.objects[0] as unknown as { repeat: { key: string } };
    table.repeat.key = " items ";
    const pkg = buildPackage(t, {
      computed: [{ key: "total", op: "sum", args: ["items.amount"] }],
    });
    const repeat = pkg.manifest.fields.find((f) => f.type === "repeating");
    expect(repeat?.key).toBe("items");
    expect(validatePackage(parsePackage(writePackage(pkg)))).toEqual({ ok: true, issues: [] });
  });

  it("skips a band whose key is only whitespace, rather than declaring no repeat at all", () => {
    // A whitespace key names no values array a form could bind to. Declaring it
    // would put a `repeating` field with a blank key into the manifest, and the
    // validator rejects that at `fields[0].key`.
    const t = withBand();
    const table = t.objects[0] as unknown as { repeat: { key: string } };
    table.repeat.key = "   ";
    const pkg = buildPackage(t);
    expect(pkg.manifest.fields.some((f) => f.type === "repeating")).toBe(false);
    expect(validatePackage(parsePackage(writePackage(pkg)))).toEqual({ ok: true, issues: [] });
  });

  it("retypes a field the band key already claimed instead of declaring it twice", () => {
    // `{{items}}` inside the band is an ordinary token, so `extractTemplateFields`
    // claims `items` before the repeat is emitted. The field has to be *retyped*:
    // `repeats` is keyed by field key and needs one entry per band, and adding a
    // second `items` would be the duplicate-key error the validator rejects.
    const pkg = buildPackage(withCollidingBand());
    const keys = pkg.manifest.fields.map((f) => f.key);
    expect(keys).toEqual(["description", "amount", "items", "qty"]);
    const repeat = pkg.manifest.fields.find((f) => f.type === "repeating");
    expect(repeat).toMatchObject({
      key: "items",
      type: "repeating",
      source: "table",
      objectName: "Items",
      columns: ["description", "amount", "items", "qty"],
      maxItems: 30,
    });
    expect(validatePackage(parsePackage(writePackage(pkg)))).toEqual({ ok: true, issues: [] });
  });

  it("reports a manifest it cannot serialise, rather than throwing", () => {
    // `validateManifest`'s contract is that it reports and never throws.
    // `JSON.stringify` throws a TypeError on a BigInt, which an in-memory caller
    // can hand it even though parsed archive bytes cannot contain one.
    const back = parsePackage(writePackage(buildPackage(base())));
    const hostile: Package = {
      ...back,
      manifest: { ...back.manifest, computed: [BigInt(1)] } as unknown as PackageManifest,
    };
    const result = validatePackage(hostile);
    expect(result.ok).toBe(false);
    expect(result.issues.some((i) => i.path === "manifest")).toBe(true);
  });

  it("reports a cyclic manifest, rather than throwing", () => {
    const back = parsePackage(writePackage(buildPackage(base())));
    const cyclic: Record<string, unknown> = { ...back.manifest };
    cyclic.self = cyclic;
    const result = validatePackage({ ...back, manifest: cyclic as unknown as PackageManifest });
    expect(result.ok).toBe(false);
    expect(result.issues.some((i) => i.path === "manifest")).toBe(true);
  });

  it("carries an explicit currency scale into the manifest", () => {
    expect(buildPackage(base(), { currencyScale: 0 }).manifest.document.currencyScale).toBe(0);
    expect(buildPackage(base(), { currencyScale: 4 }).manifest.document.currencyScale).toBe(4);
  });

  it("defaults the currency scale to 2 when the caller states none", () => {
    expect(buildPackage(base()).manifest.document.currencyScale).toBe(2);
  });

  it("names an untitled template rather than shipping an empty name", () => {
    const t = base();
    delete (t.meta as { name?: string }).name;
    const pkg = buildPackage(t);
    expect(pkg.manifest.name).toBe("Untitled bill");
    expect(validatePackage(parsePackage(writePackage(pkg)))).toEqual({ ok: true, issues: [] });
  });

  it("marks a page that is not exactly A4 as custom paper", () => {
    const t = base();
    t.document = { width: 612, height: 792 };
    expect(buildPackage(t).manifest.document.paper).toBe("custom");
  });

  it("marks an A4 page as A4", () => {
    expect(buildPackage(base()).manifest.document.paper).toBe("A4");
  });
});
