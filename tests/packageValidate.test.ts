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

  it("never throws on a garbage manifest", () => {
    for (const bad of [null, undefined, 42, "x", [], { assets: "no", fields: 3 }]) {
      const p = { manifest: bad as never, files: new Map() };
      expect(() => validatePackage(p)).not.toThrow();
      expect(validatePackage(p).ok).toBe(false);
    }
  });
});
