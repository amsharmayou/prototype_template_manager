import { describe, expect, it } from "vitest";

import { renderDocument } from "@/lib/render/document";
import { serialiseObject } from "@/lib/template/serialize";
import { extractTemplateFields } from "@/lib/template/dataBinding";
import { emptyTemplate } from "@/lib/template/types";
import type { BillTemplate, TemplateObject } from "@/lib/template/types";

/**
 * A cell field: a dynamic slot that fills a whole box the way an Excel cell
 * does - bounded by the box, wrapped inside it, and growing the box downward
 * when the value is longer than the space.
 *
 * The fixture binds the field to a rect the author drew with its container
 * policy enabled (`growthY: "content"`), which is what the tool creates
 * in one gesture: the box paints its own stroke and fill; the field paints
 * only the value inside the box's inner area, minus the container padding.
 */
function boundFixture(): BillTemplate {
  const template = emptyTemplate(794, 1123, "Cell field");
  template.objects = [
    {
      type: "rect",
      id: "box1",
      name: "Box",
      roleKind: "static",
      x: 100,
      y: 100,
      width: 200,
      height: 60,
      rotation: 0,
      opacity: 1,
      visible: true,
      locked: false,
      zIndex: 1,
      parentId: null,
      stroke: "#000000",
      strokeWidth: 1,
      fill: "transparent",
      cornerRadius: 0,
      container: { enabled: true, growthX: "fixed", growthY: "content", padding: { top: 6, right: 6, bottom: 6, left: 6 } },
      expansion: { y: { mode: "unbounded" } },
    } as unknown as TemplateObject,
    {
      type: "cell-field",
      id: "cell1",
      name: "Cell field",
      roleKind: "variable",
      x: 106,
      y: 106,
      width: 188,
      height: 48,
      rotation: 0,
      opacity: 1,
      visible: true,
      locked: false,
      zIndex: 2,
      parentId: null,
      layoutParentId: "box1",
      stroke: "transparent",
      strokeWidth: 0,
      fill: "#111111",
      key: "equipment_location",
      fieldType: "text",
      text: "{{equipment_location}}",
      fontFamily: "Arimo",
      fontSize: 14,
      fontWeight: "normal",
      fontStyle: "normal",
      textAlign: "left",
      lineHeight: 1.16,
      charSpacing: 0,
      textVerticalAlign: "middle",
      padding: 6,
      wrap: true,
      containerId: "box1",
      expansion: { x: { mode: "fixed" }, y: { mode: "unbounded" } },
    } as unknown as TemplateObject,
  ];
  template.layout = { mode: "variable" };
  return template;
}

describe("cell fields", () => {
  it("paints the value inside the bound box", () => {
    const rendered = renderDocument(boundFixture(), { equipment_location: "Bay 12, Rack 4" });
    expect(rendered.html).toContain("Bay 12, Rack 4");
    expect(rendered.refusals).toEqual([]);
  });

  it("grows the bound box downward when the value wraps", () => {
    const long = "A".repeat(420);
    const rendered = renderDocument(boundFixture(), { equipment_location: long }, {
      // The host measure pass: the field's wrapped height at the inner width
      // (188px = container 200 - padding 12), well past the authored 48px.
      measurements: { cell1: { naturalWidth: 188, height: 150 } },
      computed: [],
    });
    const container = rendered.objects.find((o) => o.id === "box1") as { y: number; height: number };
    const field = rendered.objects.find((o) => o.id === "cell1") as { y: number; height: number };
    // The field grew to its measured height; the container grew around it and
    // kept the authored padding (6px top and bottom).
    expect(field.height).toBe(150);
    expect(container.height).toBe(field.height + 12);
    // The value stays inside the box it belongs to.
    expect(field.height).toBeLessThanOrEqual(container.height);
  });

  it("hides the value token when the field is blank (placeholders hidden)", () => {
    const rendered = renderDocument(boundFixture(), {});
    expect(rendered.html).not.toContain("{{equipment_location}}");
  });

  it("registers the key with the form, sourced from cell fields", () => {
    const fields = extractTemplateFields(boundFixture());
    const own = fields.find((f) => f.key === "equipment_location");
    expect(own).toBeDefined();
    expect(own!.source).toBe("cell-field");
    expect(own!.type).toBe("text");
  });

  it("serialises the bound box and the styles", () => {
    const fake = {
      type: "BillCellField",
      appType: "cell-field",
      id: "cf1",
      name: "Cell field",
      left: 106,
      top: 106,
      width: 188,
      height: 48,
      scaleX: 1,
      scaleY: 1,
      angle: 0,
      opacity: 1,
      visible: true,
      stroke: "transparent",
      strokeWidth: 0,
      fill: "#111111",
      text: "Transport by {{transporter}}",
      key: "transporter",
      fieldType: "text",
      layoutParentId: "box9",
      fontFamily: "Arial",
      fontSize: 14,
      fontWeight: "normal",
      fontStyle: "normal",
      textAlign: "left",
      textVerticalAlign: "middle",
      padding: 8,
      wrap: true,
      containerId: "box9",
      expansion: { y: { mode: "unbounded" } },
    } as unknown as Parameters<typeof serialiseObject>[0];
    const out = serialiseObject(fake, 2) as unknown as {
      type: string;
      key: string;
      text: string;
      containerId: string | null;
      padding: number;
      wrap: boolean;
      textVerticalAlign: string;
      layoutParentId?: string;
    };
    expect(out.type).toBe("cell-field");
    expect(out.key).toBe("transporter");
    expect(out.text).toBe("{{transporter}}");
    expect(out.containerId).toBe("box9");
    expect(out.padding).toBe(8);
    expect(out.wrap).toBe(true);
    expect(out.textVerticalAlign).toBe("middle");
    expect(out.layoutParentId).toBe("box9");
  });
});
