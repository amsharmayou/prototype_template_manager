import { describe, expect, it } from "vitest";

import { serialiseObjects } from "@/lib/template/serialize";
import type { SerialisableObject } from "@/lib/template/serialize";
import { migrateTemplate } from "@/lib/template/migrate";
import { buildPackage, writePackage } from "@/lib/package/build";
import { parsePackage } from "@/lib/package/parse";
import { resolvePackage } from "@/lib/package/resolve";
import { calculateLayout } from "@/lib/render/layout";
import type { LayoutInput } from "@/lib/render/layout";
import { TEMPLATE_VERSION } from "@/lib/template/types";
import type { BillTemplate, LayoutConfig, TemplateObject } from "@/lib/template/types";

/**
 * Layout configuration has to survive every hop between authoring and printing.
 *
 * Three code paths rebuild the template from a whitelist of keys rather than
 * carrying it: `migrateTemplate`, `serialiseObjects`, and the per-object
 * serialisers. Each one silently dropped a `layout` block or an `expansion`
 * policy when it was added, which is the difference between a template that
 * survives a save-and-reopen and one that quietly reverts to fixed geometry.
 */

const layout: LayoutConfig = {
  mode: "variable",
  document: { growthX: "fixed", growthY: "expand", maxHeight: 4000 },
  guides: [
    { id: "details-bottom", orientation: "horizontal", position: 220, maxDisplacement: 600 },
    { id: "details-right", orientation: "vertical", position: 500 },
  ],
  attachments: [
    { id: "border-bottom", objectId: "r1", edge: "bottom", guideId: "details-bottom", behavior: "stretch" },
    { id: "table-top", objectId: "t1", edge: "top", guideId: "details-bottom", behavior: "move" },
  ],
};

const expansion = {
  x: { mode: "fixed" as const, maxGrowth: 0 },
  y: { mode: "unbounded" as const, strategy: "wrap" as const, growthGuideId: "details-bottom" },
};

const textObject = (id: string, withExpansion = true): TemplateObject => ({
  id,
  type: "text",
  name: "Address",
  role: "customer_address",
  x: 100, y: 160, width: 150, height: 30,
  rotation: 0, opacity: 1, visible: true, locked: false, zIndex: 1, parentId: null,
  stroke: "", strokeWidth: 0, fill: "#000000",
  text: "{{customer_address}}",
  fontFamily: "Arial", fontSize: 12, fontWeight: "normal", fontStyle: "normal",
  textAlign: "left", lineHeight: 1.16, charSpacing: 0,
  roleKind: "variable", textVerticalAlign: "top",
  ...(withExpansion ? { expansion } : {}),
});

const base: TemplateObject = {
  id: "r1", type: "rect", name: "Border", role: null,
  x: 90, y: 150, width: 200, height: 80,
  rotation: 0, opacity: 1, visible: true, locked: false, zIndex: 0, parentId: null,
  stroke: "#000000", strokeWidth: 1, fill: "transparent", cornerRadius: 0,
};

function withLayout(objects: TemplateObject[] = [base, textObject("t1")]): BillTemplate {
  return {
    templateVersion: TEMPLATE_VERSION,
    document: { width: 1127, height: 871 },
    meta: { name: "Layout bill", modifiedAt: "" },
    objects,
    layout,
  };
}

/** A Fabric-shaped object, which is what the serialiser actually reads. */
function fabricText(expansionValue: unknown): SerialisableObject {
  return {
    type: "text",
    appType: "text",
    id: "t1",
    name: "Address",
    role: "customer_address",
    left: 100, top: 160, width: 150, height: 30,
    angle: 0, opacity: 1, visible: true,
    stroke: null, strokeWidth: 0, fill: "#000000",
    scaleX: 1, scaleY: 1,
    text: "{{customer_address}}",
    fontFamily: "Arial", fontSize: 12,
    roleKind: "variable",
    expansion: expansionValue,
  };
}

describe("migrateTemplate keeps the layout block", () => {
  it("carries layout through a migration", () => {
    const { template } = migrateTemplate(withLayout());

    expect(template.layout).toEqual(layout);
  });

  it("leaves the key off entirely when the template has no layout", () => {
    const plain: BillTemplate = { ...withLayout(), layout: undefined };
    delete (plain as { layout?: unknown }).layout;

    const { template } = migrateTemplate(plain);

    expect(template.layout).toBeUndefined();
    expect("layout" in template).toBe(false);
  });

  it("still repairs name and document size while carrying layout", () => {
    const broken = {
      ...withLayout(),
      document: {} as never,
      meta: {} as never,
    };

    const { template } = migrateTemplate(broken);

    expect(template.layout).toEqual(layout);
    expect(template.meta.name).toBe("Untitled bill");
  });
});

describe("serialiseObjects keeps layout and expansion", () => {
  it("carries the layout block onto the serialised template", () => {
    const t = serialiseObjects(
      [fabricText(undefined)],
      { width: 1127, height: 871 },
      "Layout bill",
      layout,
    );

    expect(t.layout).toEqual(layout);
  });

  it("omits the key entirely when no layout is supplied", () => {
    const t = serialiseObjects([fabricText(undefined)], { width: 1127, height: 871 }, "No layout");

    expect("layout" in t).toBe(false);
  });

  it("carries a text object's expansion policy", () => {
    const t = serialiseObjects(
      [fabricText(expansion)],
      { width: 1127, height: 871 },
      "Layout bill",
      layout,
    );

    expect((t.objects[0] as { expansion?: unknown }).expansion).toEqual(expansion);
  });

  it("omits expansion when the object has none", () => {
    const t = serialiseObjects([fabricText(undefined)], { width: 1127, height: 871 }, "Plain");

    expect("expansion" in (t.objects[0] as object)).toBe(false);
  });

  it("carries layoutParentId and anchor on a child", () => {
    const t = serialiseObjects(
      [{ ...fabricText(undefined), layoutParentId: "r1", anchor: { vertical: "end" } }],
      { width: 1127, height: 871 },
      "Layout bill",
      layout,
    );

    expect((t.objects[0] as { layoutParentId?: unknown }).layoutParentId).toBe("r1");
    expect((t.objects[0] as { anchor?: unknown }).anchor).toEqual({ vertical: "end" });
  });

  it("carries a container policy on a rect", () => {
    const container = {
      enabled: true,
      growthY: "content" as const,
      padding: { top: 5, right: 5, bottom: 10, left: 5 },
      minWidth: 120,
      maxHeight: 400,
    };
    const t = serialiseObjects(
      [{
        type: "rect", appType: "rect", id: "r1", name: "Box", role: null,
        left: 90, top: 150, width: 200, height: 80, angle: 0, opacity: 1, visible: true,
        stroke: "#000000", strokeWidth: 1, fill: "transparent", scaleX: 1, scaleY: 1,
        container,
      }],
      { width: 1127, height: 871 },
      "Layout bill",
      layout,
    );

    // Padding and the size limits are the numbers the solver enforces, so they
    // have to survive the save exactly as typed - a container that silently lost
    // its padding would look right in the editor and wrong on the bill.
    expect((t.objects[0] as { container?: unknown }).container).toEqual(container);
  });

  it("carries a container policy through packaging", () => {
    const template = withLayout();
    template.objects[0] = {
      ...template.objects[0]!,
      type: "rect",
      cornerRadius: 0,
      container: { enabled: true, growthY: "content", padding: { top: 5, right: 5, bottom: 10, left: 5 }, maxWidth: 400 },
    } as typeof template.objects[0];

    const back = resolvePackage(parsePackage(writePackage(buildPackage(template))));

    expect((back.template.objects[0] as { container?: unknown }).container).toEqual({
      enabled: true,
      growthY: "content",
      padding: { top: 5, right: 5, bottom: 10, left: 5 },
      maxWidth: 400,
    });
  });

  it("carries the collision policy through a migration and packaging", () => {
    const withCollision: BillTemplate = withLayout();
    withCollision.layout = { ...layout, collision: "allow" };

    expect(migrateTemplate(withCollision).template.layout?.collision).toBe("allow");

    const pkg = buildPackage(withCollision);
    const back = resolvePackage(parsePackage(writePackage(pkg)));
    expect(back.template.layout?.collision).toBe("allow");
  });
});

describe("layout survives packaging", () => {
  it("round-trips through build, write, parse and resolve", () => {
    const pkg = buildPackage(withLayout());
    const back = resolvePackage(parsePackage(writePackage(pkg)));

    expect(back.template.layout).toEqual(layout);
    expect((back.template.objects[1] as { expansion?: unknown }).expansion).toEqual(expansion);
  });

  it("leaves a template without layout untouched", () => {
    const plain = withLayout();
    delete (plain as { layout?: unknown }).layout;
    const pkg = buildPackage(plain);

    expect(pkg.manifest.packageVersion).toBe(1);
    expect(resolvePackage(parsePackage(writePackage(pkg))).template.layout).toBeUndefined();
  });
});

describe("shape expansion survives the editor round-trip", () => {
  const fabricRect = (expansionValue: unknown): SerialisableObject => ({
    type: "rect",
    appType: "rect",
    id: "r1",
    name: "Border",
    role: null,
    left: 90, top: 150, width: 200, height: 80,
    angle: 0, opacity: 1, visible: true,
    stroke: '#000000', strokeWidth: 1, fill: 'transparent',
    scaleX: 1, scaleY: 1,
    expansion: expansionValue,
  });

  it("carries a rect expansion policy instead of dropping it", () => {
    const expansion = {
      x: { mode: "fixed" as const },
      y: { mode: "unbounded" as const, growthGuideId: "details-bottom" },
    };
    const t = serialiseObjects(
      [fabricRect(expansion)],
      { width: 1127, height: 871 },
      "Layout bill",
      layout,
    );

    expect((t.objects[0] as { expansion?: unknown }).expansion).toEqual(expansion);
  });

  it("a linked rect follows the guide its field pushed", () => {
    const field: TemplateObject = {
      id: "t1", type: "text", name: "Address", role: null,
      x: 100, y: 160, width: 150, height: 30,
      rotation: 0, opacity: 1, visible: true, locked: false, zIndex: 1, parentId: null,
      stroke: "", strokeWidth: 0, fill: "#000000",
      text: "{{a}}", fontFamily: "Arial", fontSize: 12,
      fontWeight: "normal", fontStyle: "normal", textAlign: "left",
      lineHeight: 1.16, charSpacing: 0,
      roleKind: "variable", textVerticalAlign: "top",
      expansion: {
        x: { mode: "fixed" as const },
        y: { mode: "unbounded" as const, strategy: "wrap" as const, growthGuideId: "g" },
      },
    };
    const rect: TemplateObject = {
      id: "r1", type: "rect", name: "Border", role: null,
      x: 90, y: 150, width: 200, height: 80,
      rotation: 0, opacity: 1, visible: true, locked: false, zIndex: 0, parentId: null,
      stroke: "#000000", strokeWidth: 1, fill: "transparent", cornerRadius: 0,
      expansion: {
        x: { mode: "fixed" as const },
        y: { mode: "unbounded" as const, growthGuideId: "g" },
      },
    };
    const input: LayoutInput = {
      objects: [rect, field],
      measurements: { t1: { naturalWidth: 150, height: 120 } },
      guides: [{ id: "g", orientation: "horizontal", position: 230 }],
      attachments: [],
      documentPolicy: { growthX: "fixed", growthY: "fixed" },
      document: { width: 800, height: 1000 },
    };

    const out = calculateLayout(input);
    const grown = out.objects.find((o) => o.id === 'r1')!;

    // The field needed 160+120=280, pushing the guide to 280; the linked
    // rect stretches its bottom edge to the same boundary.
    expect(out.guides[0]!.position).toBe(280);
    expect(grown.height).toBe(280 - 150);
  });

  it("an unlinked rect keeps its authored box", () => {
    const rect: TemplateObject = {
      id: "r1", type: "rect", name: "Border", role: null,
      x: 90, y: 150, width: 200, height: 80,
      rotation: 0, opacity: 1, visible: true, locked: false, zIndex: 0, parentId: null,
      stroke: "#000000", strokeWidth: 1, fill: "transparent", cornerRadius: 0,
      expansion: {
        x: { mode: "fixed" as const },
        y: { mode: "unbounded" as const },
      },
    };
    const out = calculateLayout({
      objects: [rect],
      measurements: {},
      guides: [],
      attachments: [],
      documentPolicy: { growthX: "fixed", growthY: "fixed" },
      document: { width: 800, height: 1000 },
    });

    expect(out.objects[0]).toMatchObject({ width: 200, height: 80 });
  });
});

describe("resolvePackage is the pass-through it should be", () => {
  it("does not rewrite the layout block while resolving assets", () => {
    const pkg = buildPackage(withLayout());
    const { template, unresolved } = resolvePackage(pkg);

    expect(unresolved).toEqual([]);
    expect(template.layout).toEqual(layout);
  });
});
