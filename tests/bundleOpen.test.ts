import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { openBundle } from "@/lib/package/open";

const goldDir = join(__dirname, "fixtures", "golden");
const committed = new Uint8Array(readFileSync(join(goldDir, "golden-invoice.btpkg")));

describe("openBundle", () => {
  it("opens the committed fixture: verified, resolved, renderable", async () => {
    const opened = await openBundle(committed);
    expect(opened.ok).toBe(true);
    if (!opened.ok) return;
    expect(opened.refusals).toEqual([]);
    expect(opened.template.objects.length).toBeGreaterThan(0);
    expect(opened.bundle.manifest.templateSha256).toMatch(/^[0-9a-f]{64}$/);
    expect(opened.bundle.files.has("template.json")).toBe(true);
  });

  it("refuses a tampered template member instead of rendering a lie", async () => {
    const pkg = await import("@/lib/package");
    const parsed = pkg.parsePackage(committed);
    const parts: Record<string, Uint8Array> = { "manifest.json": parsed.manifestBytes! };
    for (const [name, data] of parsed.files) parts[name] = data;
    parts["template.json"] = new TextEncoder().encode(
      JSON.stringify({ ...(JSON.parse(new TextDecoder().decode(parsed.files.get("template.json")!)) as object), metaName: "X" }),
    );
    const zipSync = (await import("fflate")).zipSync;
    const tampered = zipSync(parts, { level: 6, mtime: 315532800000 });
    const opened = await openBundle(tampered);
    expect(opened.ok).toBe(false);
    if (opened.ok) return;
    expect(opened.refusals.some((m) => m.toLowerCase().includes("checksum") || m.toLowerCase().includes("identity"))).toBe(true);
  });

  it("refuses a bundle needing a newer engine than the host runs", async () => {
    const { zipSync } = await import("fflate");
    const parsed = (await import("@/lib/package")).parsePackage(committed);
    const manifest = { ...parsed.manifest, engineVersion: 99 };
    const entries: Record<string, Uint8Array> = { "manifest.json": new TextEncoder().encode(JSON.stringify(manifest)) };
    for (const [name, data] of parsed.files) entries[name] = data;
    const repacked = zipSync(entries, { level: 6, mtime: 315532800000 });
    const opened = await openBundle(repacked);
    expect(opened.ok).toBe(false);
    if (opened.ok) return;
    expect(opened.refusals.some((m) => m.includes("engine 99"))).toBe(true);
  });

  it("refuses when the manifest digest member is missing", async () => {
    const { zipSync, strToU8 } = await import("fflate");
    const parsed = (await import("@/lib/package")).parsePackage(committed);
    const entries: Record<string, Uint8Array> = {};
    for (const [name, data] of parsed.files) entries[name] = data;
    entries["manifest.json"] = parsed.manifestBytes!;
    const repacked = zipSync(entries, { level: 6, mtime: 315532800000 });
    void strToU8;
    const opened = await openBundle(repacked);
    expect(opened.ok).toBe(false);
    if (opened.ok) return;
    expect(opened.refusals.some((m) => m.includes("manifest.json.sha256"))).toBe(true);
  });
});
