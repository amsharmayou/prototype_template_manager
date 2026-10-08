import { afterEach, describe, expect, it, vi } from "vitest";

import { buildPackage } from "@/lib/package/build";
import type { Package, ManifestAsset } from "@/lib/package/format";
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
 * A one-asset package whose single member has been renamed to `file`, with its
 * manifest asset record overridden by `asset`.
 *
 * Renaming is how a fixture reaches a member whose extension the fallback map does
 * not know, which is the only condition under which the manifest's `mime` is
 * distinguishable from the fallback's answer.
 *
 * Derived from a real `buildPackage` rather than hand-assembled, so the only
 * variables are the things under test. The `checksums` entry is left stale on
 * purpose: nothing in `resolvePackage` reads it, and verifying it is
 * `validatePackage`'s job, which is not what this fixture is for.
 */
function renamedPackage(file: string, asset: Partial<ManifestAsset> = {}): Package {
  const pkg = buildPackage(templated(PNG));
  const bytes = pkg.files.get("assets/obj_7.png")!;
  const json = new TextDecoder()
    .decode(pkg.files.get("template.json")!)
    .replace("pkg://assets/obj_7.png", `pkg://${file}`);

  const files = new Map(pkg.files);
  files.set("template.json", strToU8(json));
  files.delete("assets/obj_7.png");
  files.set(file, bytes);

  return {
    ...pkg,
    files,
    manifest: {
      ...pkg.manifest,
      assets: [{ ...pkg.manifest.assets[0]!, file, ...asset }],
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
    const rendered = renderHtml(template);
    expect(rendered.html).not.toContain("pkg://");

    // The refusal is the whole diagnosable-not-silent argument, so it is pinned here
    // rather than left true by accident. It names the *object* whose image was
    // refused. It does not name the file: `renderBillPart` records `typeof o.src`,
    // so the recorded value is the string `"string"` and the path is recoverable
    // only from `unresolved` above.
    expect(rendered.refusals).toEqual([
      { field: "obj_7.src", value: "string", reason: "not a safe image source" },
    ]);
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
    const { template, unresolved } = resolvePackage(renamedPackage("assets/obj_7.bin", { mime: undefined }));
    expect(unresolved).toEqual(["assets/obj_7.bin"]);
    // No data URI at all: a plausible wrong one would pass `isSafeImageSrc`, render
    // as a broken image, and record no refusal.
    expect((template.objects[0] as { src?: string }).src).toBe("pkg://assets/obj_7.bin");
  });

  it("inlines an asset from the manifest's mime when the name cannot say what it is", () => {
    // `.svg-xml` is `image/svg+xml` after the filename sanitising, so the name and
    // the declared type are only distinguishable through the manifest. It is not in
    // the fallback map, so removing the manifest branch leaves nothing to answer
    // with - which is the whole reason the field exists.
    const { template, unresolved } = resolvePackage(
      renamedPackage("assets/obj_7.svg-xml", { mime: "image/svg+xml" }),
    );
    expect(unresolved).toEqual([]);
    // Only the declared type is under test. The fixture reuses the PNG's bytes under
    // the new name, so the payload is not an SVG and is not asserted to be one.
    expect((template.objects[0] as { src?: string }).src).toMatch(
      /^data:image\/svg\+xml;base64,/,
    );
  });

  it("does not trust a declared mime that is not a bare image subtype", () => {
    // `attr()` escapes quotes today, so this cannot break out of the attribute, and
    // the result can only begin `data:image/` so there is no scheme to break either.
    // Both are incidental though - they hold because of what the renderer happens to
    // do, not because anything here requires it.
    const { template, unresolved } = resolvePackage(
      renamedPackage("assets/obj_7.bin", { mime: 'image/x" onerror="alert(1)' }),
    );
    expect(unresolved).toEqual(["assets/obj_7.bin"]);
    expect((template.objects[0] as { src?: string }).src).toBe("pkg://assets/obj_7.bin");
  });

  it("survives a manifest whose assets is not an array", () => {
    const pkg = renamedPackage("assets/obj_7.bin", { mime: undefined });
    const broken: Package = { ...pkg, manifest: { ...pkg.manifest, assets: "nope" as never } };
    // `validateManifest` rejects this, and the documented order is parse, validate,
    // resolve - so this needs a caller that skipped validation. The guard exists
    // because this function's own comment justifies itself by manifests arriving
    // through an unvalidated cast, and a guard that leaves a `TypeError` in the same
    // path would contradict that.
    expect(() => resolvePackage(broken)).not.toThrow();
    expect(resolvePackage(broken).unresolved).toEqual(["assets/obj_7.bin"]);
  });

  it("throws naming the asset when the runtime has no base64 encoder", () => {
    vi.stubGlobal("btoa", undefined);
    // Pins that the stub took, so a failure below is the missing throw rather than
    // a shadowing that never happened.
    expect(typeof btoa).toBe("undefined");
    expect(() => resolvePackage(buildPackage(templated(PNG)))).toThrow(/assets\/obj_7\.png/);
  });
});
