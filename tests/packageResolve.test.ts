import { describe, expect, it } from "vitest";

import { buildPackage } from "@/lib/package/build";
import { resolvePackage } from "@/lib/package/resolve";
import { renderHtml } from "@/lib/render";
import type { BillTemplate } from "@/lib/template/types";

const PNG =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";

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

describe("resolvePackage", () => {
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
});
