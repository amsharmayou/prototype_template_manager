import { describe, expect, it } from "vitest";

import { hydrateTemplate } from "@/lib/template/hydrate";
import { serialiseObjects } from "@/lib/template/serialize";
import { emptyTemplate, type TemplateObject } from "@/lib/template/types";

/**
 * Regression: an ellipse fed through the template format had rx = ry = 0 at
 * all times (Fabric's defaults), so it didn't paint and was dropped from the
 * Fabric-based export paths. Hydration now supplies rx/ry from the box.
 */
const ellipse: TemplateObject = {
  id: "e1",
  type: "ellipse",
  name: "Ellipse",
  role: null,
  x: 20,
  y: 20,
  width: 80,
  height: 40,
  rotation: 0,
  opacity: 1,
  visible: true,
  locked: false,
  zIndex: 0,
  parentId: null,
  stroke: "#000000",
  strokeWidth: 1,
  fill: "transparent",
  cornerRadius: 0,
};

describe("ellipse hydration + serialise round-trip", () => {
  it("sets rx/ry from the document dimensions", () => {
    const tpl = emptyTemplate(200, 200);
    tpl.objects = [ellipse];
    const [obj] = hydrateTemplate(tpl) as Array<{ rx?: number; ry?: number }>;
    expect(obj).toBeDefined();
    expect(obj!.rx).toBe(40);
    expect(obj!.ry).toBe(20);
  });

  it("serialise keeps the ellipse recognisable through the loop", () => {
    const tpl = emptyTemplate(200, 200);
    tpl.objects = [ellipse];
    const objects = hydrateTemplate(tpl);
    const roundTripped = serialiseObjects(objects as never, tpl.document, "t");
    const e = roundTripped.objects.find((o) => o.type === "ellipse");
    expect(e).toBeDefined();
    if (e && e.type !== "ellipse") throw new Error("unreachable");
    expect(e!.width).toBe(80);
    expect(e!.height).toBe(40);
  });
});
