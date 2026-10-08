import { afterEach, describe, expect, it, vi } from "vitest";

import { buildPackage } from "@/lib/package/build";
import type { Package } from "@/lib/package/format";
import { resolvePackage } from "@/lib/package/resolve";
import { renderHtml } from "@/lib/render";
import type { BillTemplate } from "@/lib/template/types";

import { strToU8 } from "fflate";

const PNG =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";

/** A RIFF/WEBP header. Its bytes are never decoded, only re-encoded. */
const WEBP = "data:image/webp;base64,UklGRhYAAABXRUJQVlA4IAAAAAAAAAAAAAA=";

function templated(src: string): BillTemplate {
  return {
    templateVersion: 2,
    document: { width: 200, height: 200 },
    meta: { name: "T", modifiedAt: "2026-10-08T00:00:00.000Z" },
    objects: [
      {
        id: "obj_7",
        type: "bill-part",
        name: "Part",
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
        src,
        normalized: true,
      },
    ],
  };
}

/**
 * A one-asset package whose asset type cannot be established: the manifest asset
 * declares no `mime`, and the member's extension is not one the fallback map
 * recognises.
 *
 * Derived from a real `buildPackage` rather than hand-assembled, so the only two
 * variables are the things under test. The `checksums` entry is left stale on
 * purpose: nothing in `resolvePackage` reads it, and verifying it is
 * `validatePackage`'s job, which is not what this fixture is for.
 */
function untypedPackage(): Package {
  const pkg = buildPackage(templated(PNG));
  const bytes = pkg.files.get("assets/obj_7.png")!;
  const json = new TextDecoder()
    .decode(pkg.files.get("template.json")!)
    .replace("pkg://assets/obj_7.png", "pkg://assets/obj_7.bin");

  const files = new Map(pkg.files);
  files.set("template.json", strToU8(json));
  files.delete("assets/obj_7.png");
  files.set("assets/obj_7.bin", bytes);

  return {
    ...pkg,
    files,
    manifest: {
      ...pkg.manifest,
      assets: [{ ...pkg.manifest.assets[0]!, file: "assets/obj_7.bin", mime: undefined }],
    },
  };
}

describe("resolvePackage", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("turns a pkg reference back into the original data URI", () => {
    const { template, unresolved } = resolvePackage(buildPackage(templated(PNG)));
    expect(unresolved).toEqual([]);
    expect((template.objects[0] as { src?: string }).src).toBe(PNG);
  });

  it("reports a reference that points at nothing instead of throwing", () => {
    const pkg = buildPackage(templated(PNG));
    // Only the asset member goes missing. An empty `files` would take
    // `template.json` with it, and `resolvePackage` would then resolve nothing
    // because there is no template to resolve it out of.
    const files = new Map(pkg.files);
    files.delete("assets/obj_7.png");
    const { template, unresolved } = resolvePackage({ ...pkg, files });
    expect(unresolved).toEqual(["assets/obj_7.png"]);
    // Left in place rather than dropped, so a later render records a refusal
    // naming the file instead of silently losing the part.
    expect((template.objects[0] as { src?: string }).src).toBe("pkg://assets/obj_7.png");
  });

  it("never leaves a pkg reference inside rendered output", () => {
    const pkg = buildPackage(templated(PNG));
    const files = new Map(pkg.files);
    files.delete("assets/obj_7.png");
    const { template } = resolvePackage({ ...pkg, files });
    expect(renderHtml(template).html).not.toContain("pkg://");
  });

  it("leaves a remote https image src alone", () => {
    const { template } = resolvePackage(buildPackage(templated("https://example.com/a.png")));
    expect((template.objects[0] as { src?: string }).src).toBe("https://example.com/a.png");
  });

  it("does not mutate the package it was given", () => {
    const pkg = buildPackage(templated(PNG));
    const read = () => new TextDecoder().decode(pkg.files.get("template.json")!);
    const before = read();
    resolvePackage(pkg);
    expect(read()).toBe(before);
  });

  it("inlines a webp asset as a webp rather than relabelling it as a png", () => {
    const { template, unresolved } = resolvePackage(buildPackage(templated(WEBP)));
    expect(unresolved).toEqual([]);
    expect((template.objects[0] as { src?: string }).src).toBe(WEBP);
  });

  it("falls back to the member's extension when the asset declares no mime", () => {
    const pkg = buildPackage(templated(WEBP));
    const legacy: Package = {
      ...pkg,
      manifest: {
        ...pkg.manifest,
        assets: [{ ...pkg.manifest.assets[0]!, mime: undefined }],
      },
    };
    const { template, unresolved } = resolvePackage(legacy);
    expect(unresolved).toEqual([]);
    expect((template.objects[0] as { src?: string }).src).toBe(WEBP);
  });

  it("reports a reference whose type it cannot establish instead of guessing", () => {
    const { template, unresolved } = resolvePackage(untypedPackage());
    expect(unresolved).toEqual(["assets/obj_7.bin"]);
    // No data URI at all: a plausible wrong one would pass `isSafeImageSrc`, render
    // as a broken image, and record no refusal.
    expect((template.objects[0] as { src?: string }).src).toBe("pkg://assets/obj_7.bin");
  });

  it("throws naming the asset when the runtime has no base64 encoder", () => {
    vi.stubGlobal("btoa", undefined);
    // Pins that the stub took, so a failure below is the missing throw rather than
    // a shadowing that never happened.
    expect(typeof btoa).toBe("undefined");
    expect(() => resolvePackage(buildPackage(templated(PNG)))).toThrow(/assets\/obj_7\.png/);
  });
});
