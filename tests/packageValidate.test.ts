import { describe, expect, it } from "vitest";

import type { Package, PackageManifest } from "@/lib/package/format";
import { PACKAGE_VERSION } from "@/lib/package/format";
import { validatePackage } from "@/lib/package/validate";

function manifest(over: Partial<PackageManifest> = {}): PackageManifest {
  return {
    packageVersion: PACKAGE_VERSION,
    templateVersion: 2,
    name: "Invoice",
    document: { width: 794, height: 1123, unit: "px", dpi: 96, paper: "A4", currencyScale: 2 },
    template: "template.json",
    assets: [],
    fonts: [],
    fields: [],
    computed: [],
    checksums: {},
    ...over,
  };
}

function pkg(
  over: Partial<PackageManifest> = {},
  files: Record<string, Uint8Array> = {},
): Package {
  const map = new Map<string, Uint8Array>([
    ["template.json", new Uint8Array([1, 2, 3])],
    ...Object.entries(files),
  ]);
  return { manifest: manifest(over), files: map };
}

const errors = (p: Package) =>
  validatePackage(p).issues.filter((i) => i.severity === "error");

const errorAt = (p: Package, path: string) => errors(p).find((i) => i.path === path);

describe("validatePackage", () => {
  it("accepts a well-formed package", () => {
    expect(validatePackage(pkg())).toEqual({ ok: true, issues: [] });
  });

  it("rejects an unsupported package version", () => {
    const p = pkg({ packageVersion: (PACKAGE_VERSION + 1) as never });
    expect(errors(p).some((i) => i.path === "packageVersion")).toBe(true);
    expect(validatePackage(p).ok).toBe(false);
  });

  it("rejects a template version this build cannot render", () => {
    expect(errors(pkg({ templateVersion: 99 })).some((i) => i.path === "templateVersion")).toBe(
      true,
    );
  });

  it("rejects a missing template file", () => {
    const p = pkg();
    p.files.delete("template.json");
    expect(errors(p).some((i) => i.path === "template")).toBe(true);
  });

  it("rejects a non-positive page width", () => {
    const p = pkg({
      document: { width: 0, height: 1123, unit: "px", dpi: 96, paper: "A4", currencyScale: 2 },
    });
    expect(errors(p).some((i) => i.path === "document.width")).toBe(true);
  });

  it("rejects an asset declared but not present in the archive", () => {
    const p = pkg({
      assets: [{ id: "a", role: "bill-part", file: "assets/missing.png", width: 1, height: 1 }],
    });
    expect(errors(p).some((i) => i.path === "assets[0].file")).toBe(true);
  });

  it("rejects duplicate field keys", () => {
    const f = {
      key: "customer_name",
      label: "A",
      type: "text" as const,
      source: "text" as const,
      objectName: "X",
    };
    expect(errors(pkg({ fields: [f, { ...f, label: "B" }] })).some(
      (i) => i.path === "fields[1].key",
    )).toBe(true);
  });

  it("rejects a field type outside the union", () => {
    const p = pkg({
      fields: [
        {
          key: "x",
          label: "X",
          type: "telepathy" as never,
          source: "text" as const,
          objectName: "O",
        },
      ],
    });
    expect(errors(p).some((i) => i.path === "fields[0].type")).toBe(true);
  });

  it("requires columns on a repeating field", () => {
    const p = pkg({
      fields: [
        {
          key: "items",
          label: "Items",
          type: "repeating" as const,
          source: "table" as const,
          objectName: "Items",
        },
      ],
    });
    expect(errors(p).some((i) => i.path === "fields[0].columns")).toBe(true);
  });

  it("rejects a computed op outside the vocabulary", () => {
    expect(
      errors(pkg({ computed: [{ key: "t", op: "eval-me" as never, args: ["subtotal"] }] })).some(
        (i) => i.path === "computed[0].op",
      ),
    ).toBe(true);
  });

  it("requires a rateKey on a percent op", () => {
    expect(
      errors(pkg({ computed: [{ key: "tax", op: "percent" as const, args: ["subtotal"] }] })).some(
        (i) => i.path === "computed[0].rateKey",
      ),
    ).toBe(true);
  });

  it("reports a checksum mismatch", () => {
    const p = pkg({ checksums: { "template.json": "0".repeat(64) } });
    expect(errors(p).some((i) => i.path === "checksums.template.json")).toBe(true);
  });

  it("rejects a computed arg naming a column the repeat does not declare", () => {
    const p = pkg({
      fields: [
        {
          key: "items",
          label: "Items",
          type: "repeating" as const,
          source: "table" as const,
          objectName: "Items",
          columns: ["name", "qty"],
        },
      ],
      computed: [{ key: "t", op: "sum" as const, args: ["items.amount"] }],
    });
    expect(errorAt(p, "computed[0].args[0]")).toBeDefined();
  });

  it("rejects a computed arg naming a repeat that is not declared", () => {
    const p = pkg({
      computed: [{ key: "t", op: "sum" as const, args: ["items.amount"] }],
    });
    expect(errorAt(p, "computed[0].args[0]")).toBeDefined();
  });

  it("rejects a computed arg that is neither a field key nor another computed key", () => {
    const p = pkg({
      fields: [
        {
          key: "customer_name",
          label: "Customer",
          type: "text" as const,
          source: "text" as const,
          objectName: "X",
        },
      ],
      computed: [{ key: "total", op: "sum" as const, args: ["nonsense"] }],
    });
    expect(errorAt(p, "computed[0].args[0]")).toBeDefined();
  });

  it("accepts a computed chain whose args resolve to other computed keys", () => {
    const fields: PackageManifest["fields"] = [
      {
        key: "items",
        label: "Items",
        type: "repeating",
        source: "table",
        objectName: "Items",
        columns: ["amount", "qty"],
      },
    ];
    const computed: PackageManifest["computed"] = [
      { key: "subtotal", op: "sum", args: ["items.amount"] },
      { key: "tax", op: "percent", args: ["subtotal"], rateKey: "tax_rate" },
      { key: "total", op: "add", args: ["subtotal", "tax"] },
    ];
    // Not clean: `tax_rate` is referenced as a rate but never declared.
    expect(errorAt(pkg({ fields, computed }), "computed[1].rateKey")).toBeDefined();

    const withRate: PackageManifest["fields"] = [
      ...fields,
      { key: "tax_rate", label: "Tax rate", type: "number", source: "text", objectName: "R" },
    ];
    expect(validatePackage(pkg({ fields: withRate, computed })).issues).toEqual([]);

    // The chain is only clean because it resolves; breaking one link must bite.
    const broken: PackageManifest["computed"] = [
      computed[0],
      computed[1],
      { key: "total", op: "add", args: ["subtotal", "taxx"] },
    ];
    expect(errorAt(pkg({ fields: withRate, computed: broken }), "computed[2].args[1]")).toBeDefined();
  });

  it("accepts a chain whose rateKey resolves and rejects one that does not", () => {
    const fields: PackageManifest["fields"] = [
      {
        key: "tax_rate",
        label: "Tax rate",
        type: "number",
        source: "text",
        objectName: "R",
      },
    ];
    const computed: PackageManifest["computed"] = [
      { key: "tax", op: "percent", args: ["subtotal"], rateKey: "tax_rate" },
    ];
    // `subtotal` is declared nowhere, so the arg cannot resolve - asserted here so
    // the rateKey half below has something to be clean *against*.
    expect(errorAt(pkg({ fields, computed }), "computed[0].args[0]")).toBeDefined();
    // The rateKey itself resolves, so no rateKey issue despite the arg problem.
    expect(errorAt(pkg({ fields, computed }), "computed[0].rateKey")).toBeUndefined();

    const chain: PackageManifest["computed"] = [
      { key: "subtotal", op: "sum", args: [] },
      { key: "tax", op: "percent", args: ["subtotal"], rateKey: "tax_rate" },
    ];
    expect(validatePackage(pkg({ fields, computed: chain })).issues).toEqual([]);

    const broken: PackageManifest["computed"] = [
      chain[0],
      { key: "tax", op: "percent", args: ["subtotal"], rateKey: "nope" },
    ];
    expect(errorAt(pkg({ fields, computed: broken }), "computed[1].rateKey")).toBeDefined();
  });

  it("reports a string where the assets array is required", () => {
    expect(errorAt(pkg({ assets: "no" as never }), "assets")?.message).toContain("string");
  });

  it("reports a string where the fonts array is required", () => {
    expect(errorAt(pkg({ fonts: "no" as never }), "fonts")?.message).toContain("string");
  });

  it("reports a string where the fields array is required", () => {
    expect(errorAt(pkg({ fields: "no" as never }), "fields")?.message).toContain("string");
  });

  it("reports a string where the computed array is required", () => {
    expect(errorAt(pkg({ computed: "no" as never }), "computed")?.message).toContain("string");
  });

  it("rejects a field source outside the union", () => {
    const p = pkg({
      fields: [
        {
          key: "x",
          label: "X",
          type: "text" as const,
          source: "telepathy" as never,
          objectName: "O",
        },
      ],
    });
    expect(errorAt(p, "fields[0].source")).toBeDefined();
  });

  it("rejects an asset role outside the union", () => {
    const p = pkg({
      assets: [{ id: "a", role: "mascot" as never, file: "template.json", width: 1, height: 1 }],
    });
    expect(errorAt(p, "assets[0].role")).toBeDefined();
  });

  it("rejects a dotted arg whose head is not a repeating field", () => {
    const p = pkg({
      fields: [
        {
          key: "sub",
          label: "Sub",
          type: "text" as const,
          source: "text" as const,
          objectName: "S",
          columns: ["amount"],
        },
      ],
      computed: [{ key: "t", op: "sum" as const, args: ["sub.amount"] }],
    });
    expect(errorAt(p, "computed[0].args[0]")).toBeDefined();
  });

  it("rejects duplicate computed keys", () => {
    const p = pkg({
      computed: [
        { key: "subtotal", op: "sum" as const, args: [] },
        { key: "subtotal", op: "sum" as const, args: [] },
      ],
    });
    expect(errorAt(p, "computed[1].key")).toBeDefined();
  });

  it("accepts a computed list with distinct keys", () => {
    const distinct: PackageManifest["computed"] = [
      { key: "subtotal", op: "sum", args: [] },
      { key: "total", op: "add", args: ["subtotal"] },
    ];
    expect(validatePackage(pkg({ computed: distinct })).issues).toEqual([]);
    // Clean only because the keys differ; collapsing the second is the defect.
    expect(validatePackage(pkg({ computed: [distinct[0], distinct[0]] })).issues).not.toEqual([]);
  });

  it("rejects a computed entry whose args name its own key", () => {
    const p = pkg({
      computed: [{ key: "subtotal", op: "sum" as const, args: ["subtotal"] }],
    });
    expect(errorAt(p, "computed[0].args[0]")).toBeDefined();
    // Self-reference is the length-1 cycle; the graph walk must not report it
    // a second time alongside the arg-level error.
    expect(errors(p)).toHaveLength(1);
  });

  it("rejects a computed entry with an empty key", () => {
    const p = pkg({ computed: [{ key: "", op: "sum" as const, args: [] }] });
    expect(errorAt(p, "computed[0].key")).toBeDefined();
  });

  it("rejects a computed entry with no key at all", () => {
    const p = pkg({ computed: [{ op: "sum" as const, args: [] } as never] });
    expect(errorAt(p, "computed[0].key")).toBeDefined();
  });

  it("rejects a computed entry whose key is only whitespace", () => {
    const p = pkg({ computed: [{ key: "   ", op: "sum" as const, args: [] }] });
    expect(errorAt(p, "computed[0].key")).toBeDefined();
  });

  it("rejects a two-entry computed cycle, naming both entries", () => {
    const p = pkg({
      computed: [
        { key: "a", op: "add" as const, args: ["b"] },
        { key: "b", op: "sum" as const, args: ["a"] },
      ],
    });
    const found = errorAt(p, "computed[0]");
    expect(found?.message).toContain("a -> b -> a");
  });

  it("rejects a three-entry computed cycle, naming every entry", () => {
    const p = pkg({
      computed: [
        { key: "a", op: "add" as const, args: ["b"] },
        { key: "b", op: "add" as const, args: ["c"] },
        { key: "c", op: "sum" as const, args: ["a"] },
      ],
    });
    const found = errorAt(p, "computed[0]");
    expect(found?.message).toContain("a -> b -> c -> a");
  });

  it("accepts a long acyclic graph with forward references", () => {
    const fields: PackageManifest["fields"] = [
      {
        key: "items",
        label: "Items",
        type: "repeating",
        source: "table",
        objectName: "Items",
        columns: ["amount"],
      },
      { key: "tax_rate", label: "Tax rate", type: "number", source: "text", objectName: "R" },
    ];
    // total is declared first but reads three entries declared after it, and
    // tax's rateKey points at a computed key declared before it. Neither is a
    // cycle, so nothing here may be reported.
    const acyclic: PackageManifest["computed"] = [
      { key: "tax_rate_pct", op: "multiply", args: ["tax_rate"] },
      { key: "total", op: "add", args: ["subtotal", "tax", "fee"] },
      { key: "subtotal", op: "sum", args: ["items.amount"] },
      { key: "tax", op: "percent", args: ["subtotal"], rateKey: "tax_rate_pct" },
      { key: "fee", op: "multiply", args: ["subtotal", "tax_rate"] },
    ];
    expect(validatePackage(pkg({ fields, computed: acyclic })).issues).toEqual([]);

    // Same graph with one link reversed into a loop, to prove the graph above
    // was only clean because it is acyclic.
    const looped: PackageManifest["computed"] = [
      ...acyclic.slice(0, 4),
      { key: "fee", op: "multiply", args: ["subtotal", "total"] },
    ];
    expect(errorAt(pkg({ fields, computed: looped }), "computed[1]")).toBeDefined();
  });

  it("reports one issue per disjoint cycle, anchored at each ring's earliest entry", () => {
    const p = pkg({
      computed: [
        { key: "a", op: "add" as const, args: ["b"] },
        { key: "b", op: "sum" as const, args: ["a"] },
        { key: "c", op: "add" as const, args: ["d"] },
        { key: "d", op: "sum" as const, args: ["c"] },
      ],
    });
    const cycles = errors(p).filter((i) => i.message.includes("form a cycle"));
    expect(cycles).toHaveLength(2);
    expect(errorAt(p, "computed[0]")?.message).toContain("a -> b -> a");
    expect(errorAt(p, "computed[2]")?.message).toContain("c -> d -> c");
  });

  it("rejects a field pattern that is not a string", () => {
    const p = pkg({
      fields: [
        {
          key: "x",
          label: "X",
          type: "text" as const,
          source: "text" as const,
          objectName: "O",
          pattern: 5 as never,
        },
      ],
    });
    expect(errorAt(p, "fields[0].pattern")?.message).toContain("must be a string");
  });

  it("rejects a currencyScale above 6", () => {
    const p = pkg({
      document: { width: 794, height: 1123, unit: "px", dpi: 96, paper: "A4", currencyScale: 7 },
    });
    expect(errorAt(p, "document.currencyScale")).toBeDefined();
  });

  it("rejects a fractional currencyScale", () => {
    const p = pkg({
      document: { width: 794, height: 1123, unit: "px", dpi: 96, paper: "A4", currencyScale: 1.5 },
    });
    expect(errorAt(p, "document.currencyScale")).toBeDefined();
  });

  it("rejects a non-positive page height", () => {
    const p = pkg({
      document: { width: 794, height: 0, unit: "px", dpi: 96, paper: "A4", currencyScale: 2 },
    });
    expect(errorAt(p, "document.height")?.message).toContain("positive");
  });

  it("rejects a non-finite page height", () => {
    const p = pkg({
      document: {
        width: 794,
        height: Number.NaN,
        unit: "px",
        dpi: 96,
        paper: "A4",
        currencyScale: 2,
      },
    });
    expect(errorAt(p, "document.height")).toBeDefined();
  });

  it("rejects an empty name", () => {
    expect(errorAt(pkg({ name: "" }), "name")?.message).toContain("no name");
  });

  it("reports an asset entry that is not an object", () => {
    expect(errorAt(pkg({ assets: ["nope"] as never }), "assets[0]")?.message).toContain(
      "not an object",
    );
  });

  it("reports a font entry that is not an object", () => {
    expect(errorAt(pkg({ fonts: ["nope"] as never }), "fonts[0]")?.message).toContain(
      "not an object",
    );
  });

  it("reports a field entry that is not an object", () => {
    expect(errorAt(pkg({ fields: ["nope"] as never }), "fields[0]")?.message).toContain(
      "not an object",
    );
  });

  it("reports a computed entry that is not an object", () => {
    expect(errorAt(pkg({ computed: ["nope"] as never }), "computed[0]")?.message).toContain(
      "not an object",
    );
  });

  it("rejects a font file that is not in the archive", () => {
    const p = pkg({
      fonts: [{ family: "Inter", file: "fonts/inter.ttf", sha256: "0".repeat(64) }],
    });
    expect(errorAt(p, "fonts[0].file")?.message).toContain("not in the archive");
  });

  it("rejects a computed args list holding a non-string", () => {
    const p = pkg({
      computed: [{ key: "t", op: "sum" as const, args: ["subtotal", 5] as never }],
    });
    expect(errorAt(p, "computed[0].args")?.message).toContain("all be strings");
  });

  it("rejects checksums that are not an object", () => {
    expect(errorAt(pkg({ checksums: "nope" as never }), "checksums")?.message).toContain(
      "must be an object",
    );
  });

  it("rejects a checksum given for a file that is not in the archive", () => {
    const p = pkg({ checksums: { "assets/absent.png": "0".repeat(64) } });
    expect(errorAt(p, "checksums.assets/absent.png")?.message).toContain("not in the archive");
  });

  it("names null as the type found in a mistyped section", () => {
    expect(errorAt(pkg({ fields: null as never }), "fields")?.message).toContain("it is null");
  });

  it("never throws on a garbage manifest", () => {
    for (const bad of [null, undefined, 42, "x", [], { assets: "no", fields: 3 }]) {
      const p = { manifest: bad as never, files: new Map() };
      expect(() => validatePackage(p)).not.toThrow();
      expect(validatePackage(p).ok).toBe(false);
    }
  });
});
