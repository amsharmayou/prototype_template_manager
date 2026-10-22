/**
 * The Phase 6 contract fixture: every consumer (web, Admin server, Android)
 * starts from the same committed bytes and must agree on validation, field
 * schema, computed values and the rejection behaviour for forward versions
 * and spanning-corrupt archives.
 *
 * Fixture produced by `npm run fixture:build` (tools/build-golden-fixture.ts);
 * the rebuild-equality test keeps the two permanently in lock-step.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { strToU8, zipSync } from "fflate";
import { describe, expect, it } from "vitest";

import {
  buildPackage, computedSpecsFor, deriveForm, parsePackage, validatePackage, writePackage,
} from "@/lib/package";
import { sha256HexBytes } from "@/lib/render/sha256";
import type { BillTemplate } from "@/lib/template/types";

const goldDir = fileURLToPath(new URL("./fixtures/golden/", import.meta.url));
const committed = readFileSync(`${goldDir}golden-invoice.btpkg`);
const template = JSON.parse(readFileSync(`${goldDir}invoice.template.json`, "utf8")) as BillTemplate;

const entries = (bytes: Uint8Array): Record<string, Uint8Array> => {
  const pkg = parsePackage(bytes);
  const parts: Record<string, Uint8Array> = { "manifest.json": pkg.manifestBytes! };
  for (const [name, data] of pkg.files) parts[name] = data;
  return parts;
};

describe("golden invoice fixture", () => {
  it("rebuilds the committed bytes from the committed template", () => {
    // Same call shape the export pipeline uses: derived computed specs travel
    // as BuildOptions, never guessed.
    const rebuilt = writePackage(buildPackage(template, { computed: computedSpecsFor(template) }));
    expect(Buffer.from(rebuilt).equals(committed)).toBe(true);
  });

  it("validates the committed package with no issues at all", () => {
    const pkg = parsePackage(new Uint8Array(committed));
    const { issues } = validatePackage(pkg);
    expect(issues).toEqual([]);
    // Every archive member is covered by a checksum, and the covered set names
    // nothing that is not a member.
    const declared = new Set(Object.keys(pkg.manifest.checksums ?? {}));
    const members = new Set(["manifest.json", ...pkg.files.keys()]);
    expect([...declared].every((name) => members.has(name))).toBe(true);
    expect([...members].every((name) => name === "manifest.json" ? true : declared.has(name))).toBe(true);
  });

  it("derives the invoice form: band fields plus explicit placeholders", () => {
    const pkg = parsePackage(new Uint8Array(committed));
    const form = deriveForm(pkg.manifest, template);
    const keys = form.fields.map((f) => f.key);
    for (const expected of ["invoice_no", "invoice_date", "customer_name", "qty", "description", "amount"]) {
      expect(keys).toContain(expected);
    }
    // The repeat band arrives as a repeating spec carrying its columns.
    const band = form.repeats.find((r) => r.key === "items");
    expect(band?.columns).toEqual(["qty", "description", "amount"]);
    expect(band?.maxItems).toBe(25);
    // The engine derived the money total from the band's amount column, plus
    // the safe default total; export passed them via BuildOptions.computed.
    expect(pkg.manifest.computed).toEqual([
      { key: "subtotal", op: "sum", args: ["items.amount"] },
      { key: "total", op: "add", args: ["subtotal"] },
    ]);
  });

  it("a forward package version is refused with the contract message", () => {
    const pkg = parsePackage(new Uint8Array(committed));
    const manifest = { ...pkg.manifest, packageVersion: 3 };
    const forward = zipSync(
      { ...entries(new Uint8Array(committed)), "manifest.json": strToU8(JSON.stringify(manifest)) },
      { level: 6, mtime: 315532800000 },
    );
    const { issues } = validatePackage(parsePackage(forward));
    expect(issues.some((i) => i.severity === "error" && i.message.includes("package version 3 is not supported; this build reads up to 2"))).toBe(true);
  });

  it("a forward template version is refused with the contract message", () => {
    const pkg = parsePackage(new Uint8Array(committed));
    const manifest = { ...pkg.manifest, templateVersion: 3 };
    const json = JSON.stringify(manifest);
    const rebuilt = zipSync(
      {
        ...entries(new Uint8Array(committed)),
        "manifest.json": strToU8(json),
        "manifest.json.sha256": strToU8(`${sha256HexBytes(strToU8(json))}.json`),
      },
      { level: 6, mtime: 315532800000 },
    );
    const { issues } = validatePackage(parsePackage(rebuilt));
    expect(issues.some((i) => i.message.includes("template version 3 exceeds the renderer's supported 2"))).toBe(true);
  });

  it("a modified member fails its checksum, not silently renders", () => {
    const parts = entries(new Uint8Array(committed));
    const tampered = new TextEncoder().encode(JSON.stringify({
      ...(JSON.parse(new TextDecoder().decode(parts["template.json"]))),
      metaName: "TAMPERED",
    }));
    const bad = zipSync({ ...parts, "template.json": tampered }, { level: 6, mtime: 315532800000 });
    const { issues } = validatePackage(parsePackage(bad));
    expect(issues.some((i) => i.severity === "error" && (i.message.includes("checksum") || i.message.includes("checksums")))).toBe(true);
  });

  it("a repeat cap over the 200-row hard limit is an error, not a truncation", () => {
    const beyond: BillTemplate = JSON.parse(JSON.stringify(template));
    const table = beyond.objects.find((o) => o.type === "table") as { repeat?: { maxItems?: number } };
    table.repeat = { ...table.repeat, maxItems: 201 };
    const over = writePackage(buildPackage(beyond));
    const { issues } = validatePackage(parsePackage(new Uint8Array(over)));
    const cap = issues.find((i) => i.severity === "error" && i.path.endsWith("maxItems"));
    expect(cap?.message).toContain("between 1 and 200");
  });
});
