import { describe, expect, it } from "vitest";

import { renderDocument } from "@/lib/render/document";
import { serialiseObject, type SerialisableObject } from "@/lib/template/serialize";
import type { BillTemplate, TemplateObject } from "@/lib/template/types";

function makeTemplate(withCondition: boolean): BillTemplate {
  const objects: TemplateObject[] = [
    { type: "text", id: "head", text: "ACME", x: 40, width: 300, y: 40, height: 20 },
    {
      type: "text",
      id: "carrier",
      text: "Transport by {{carrier_name}}",
      x: 40,
      width: 300,
      y: 70,
      height: 20,
      ...(withCondition ? { visibleWhen: { key: "carrier_name", notEmpty: true } } : {}),
    },
    {
      type: "text",
      id: "mode",
      text: "Mode: {{mode}}",
      x: 40,
      width: 300,
      y: 100,
      height: 20,
      ...(withCondition ? { visibleWhen: { key: "mode", equals: "Air" } } : {}),
    },
  ] as unknown as TemplateObject[];
  return {
    templateVersion: 2,
    document: { width: 794, height: 1123 },
    meta: { name: "Conditioned" },
    objects,
  } as unknown as BillTemplate;
}

describe("conditional blocks", () => {
  it("paints unconditioned objects regardless of values", () => {
    const { html } = renderDocument(makeTemplate(false), { carrier_name: "Any", mode: "Any" });
    expect(html).toContain("Transport by");
    expect(html).toContain("Mode:");
  });

  it("hides a notEmpty block when the field is blank and shows it when filled", () => {
    const blank = renderDocument(makeTemplate(true), {});
    expect(blank.html).not.toContain("Transport by");

    const filledRender = renderDocument(makeTemplate(true), { carrier_name: "Blue Dart" });
    expect(filledRender.html).toContain("Transport by Blue Dart");
  });

  it("shows an equals block only on the exact value", () => {
    const air = renderDocument(makeTemplate(true), { mode: "Air" });
    expect(air.html).toContain("Mode: Air");
  });

  it("hides an equals block on any other value", () => {
    const sea = renderDocument(makeTemplate(true), { mode: "Sea" });
    expect(sea.html).not.toContain("Mode:");
    expect(sea.html).not.toContain("Sea");
  });

  it("honours the condition on computed values too", () => {
    const template = makeTemplate(false);
    (template.objects[2] as unknown as { visibleWhen?: unknown }).visibleWhen = {
      key: "paid_words",
      notEmpty: true,
    };
    (template.objects[2] as unknown as { text: string }).text = "Paid in full";
    // `paid_words` is a computed line, so the condition is exercised against
    // engine output rather than a typed value.
    template.meta.computed = [
      { key: "paid_words", op: "in-words", args: ["paid_words_src"] } as never,
    ];
    const unpaid = renderDocument(template, { paid_words_src: "" });
    expect(unpaid.html).not.toContain("Paid in full");
  });

  it("carries the condition through serialisation", () => {
    // Duck-typed Fabric stand-in, the way the serializer contract tests do:
    // visibleWhen rides as a custom property, and the serialiser must read it
    // shape-checked rather than spread it raw.
    const fake = {
      type: "text",
      id: "carrier",
      left: 0,
      top: 0,
      width: 10,
      height: 10,
      scaleX: 1,
      scaleY: 1,
      angle: 0,
      opacity: 1,
      visible: true,
      stroke: "#000000",
      strokeWidth: 1,
      fill: "transparent",
      text: "Transport by {{carrier_name}}",
      visibleWhen: { key: "carrier_name", notEmpty: true },
    } as unknown as SerialisableObject;
    const out = serialiseObject(fake, 0) as unknown as {
      visibleWhen?: { key: string; notEmpty?: boolean };
    };
    expect(out.visibleWhen).toEqual({ key: "carrier_name", notEmpty: true });
  });
});
