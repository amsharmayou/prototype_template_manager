import { describe, expect, it } from "vitest";

import {
  objectBox,
  serialiseObject,
  serialiseObjects,
  type SerialisableObject,
} from "@/lib/template/serialize";

/**
 * Minimal stand-ins for Fabric objects. The serialiser is deliberately
 * duck-typed so this contract can be tested without a canvas.
 */
function fake(props: Partial<SerialisableObject> = {}): SerialisableObject {
  const o = {
    type: "rect",
    left: 0,
    top: 0,
    width: 0,
    height: 0,
    scaleX: 1,
    scaleY: 1,
    angle: 0,
    opacity: 1,
    visible: true,
    stroke: "#000000",
    strokeWidth: 1,
    fill: "transparent",
    ...props,
  } as SerialisableObject;

  if (!o.getScaledWidth) {
    o.getScaledWidth = () => (o.width ?? 0) * (o.scaleX ?? 1);
    o.getScaledHeight = () => (o.height ?? 0) * (o.scaleY ?? 1);
    o.getCenterPoint = () => ({
      x: (o.left ?? 0) + o.getScaledWidth!() / 2,
      y: (o.top ?? 0) + o.getScaledHeight!() / 2,
    });
  }
  return o;
}

describe("objectBox", () => {
  it("derives the top-left from the centre point", () => {
    const o = fake({ type: "rect", left: 40, top: 30, width: 100, height: 50 });
    expect(objectBox(o)).toEqual({ x: 40, y: 30, width: 100, height: 50 });
  });

  it("accounts for scale", () => {
    const o = fake({ left: 100, top: 100, width: 50, height: 20, scaleX: 2 });
    const box = objectBox(o);
    // Scaled width is 100, so the box spans left 100 to 200.
    expect(box.width).toBe(100);
    expect(box.x).toBe(100);
  });
});

describe("serialiseObject: shapes", () => {
  it("serialises a rectangle with full styling", () => {
    const out = serialiseObject(
      fake({
        type: "rect",
        appType: "rect",
        id: "r1",
        name: "Header Box",
        role: "header",
        left: 40,
        top: 30,
        width: 714,
        height: 100,
        stroke: "#111111",
        strokeWidth: 2,
        fill: "transparent",
      }),
      0,
    );
    expect(out).toMatchObject({
      id: "r1",
      type: "rect",
      name: "Header Box",
      role: "header",
      x: 40,
      y: 30,
      width: 714,
      height: 100,
      stroke: "#111111",
      strokeWidth: 2,
      fill: "transparent",
      zIndex: 0,
    });
  });

  it("preserves rounded-rect via appType, not the Fabric type", () => {
    const out = serialiseObject(
      fake({ type: "rect", appType: "rounded-rect", rx: 12 }),
      0,
    );
    expect(out).toMatchObject({ type: "rounded-rect", cornerRadius: 12 });
  });

  it("maps circle to ellipse", () => {
    const out = serialiseObject(fake({ type: "circle" }), 0);
    expect(out).toMatchObject({ type: "ellipse" });
  });
});

describe("serialiseObject: text and placeholders", () => {
  it("derives roleKind and role from a pure placeholder", () => {
    const out = serialiseObject(
      fake({ type: "iText", appType: "text", text: "{{customer_name}}" }),
      0,
    ) as unknown as Record<string, unknown>;
    expect(out.type).toBe("text");
    expect(out.text).toBe("{{customer_name}}");
    expect(out.roleKind).toBe("variable");
  });

  it("marks plain text as static", () => {
    const out = serialiseObject(
      fake({ type: "itext", text: "INVOICE", fontSize: 24 }),
      0,
    ) as unknown as Record<string, unknown>;
    expect(out.roleKind).toBe("static");
    expect(out.fontSize).toBe(24);
  });

  it("recognises lowercase Fabric type names", () => {
    const out = serialiseObject(fake({ type: "textbox", text: "x" }), 0);
    expect(out).not.toBeNull();
  });
});

describe("serialiseObject: lines and rules", () => {
  it("keeps the endpoint of a line", () => {
    const out = serialiseObject(
      fake({ type: "line", appType: "hr", left: 30, top: 200, x2: 764, y2: 200 }),
      0,
    ) as unknown as Record<string, unknown>;
    expect(out.type).toBe("hr");
    expect(out.x).toBe(30);
    expect(out.x2).toBe(764);
    expect(out.y2).toBe(200);
  });

  it("distinguishes vertical rules", () => {
    const out = serialiseObject(
      fake({ type: "line", appType: "vr", left: 430, top: 200, x2: 430, y2: 420 }),
      0,
    ) as unknown as Record<string, unknown>;
    expect(out.type).toBe("vr");
  });

  it("falls back to line when no kind was recorded", () => {
    const out = serialiseObject(fake({ type: "line" }), 0) as unknown as Record<string, unknown>;
    expect(out.type).toBe("line");
  });
});

describe("serialiseObject: tables", () => {
  const table = {
    type: "billtable",
    appType: "table",
    id: "t1",
    name: "Items Table",
    role: "items",
    left: 30,
    top: 420,
    width: 734,
    height: 140,
    colWidths: [184, 184, 183, 183],
    rowHeights: [35, 35, 35, 35],
    cells: Array.from({ length: 16 }, (_, i) => ({
      text: i === 0 ? "No" : "",
      textAlign: "left" as const,
      fontSize: 12,
      fontWeight: "normal" as const,
    })),
  };

  it("recognises the custom class through appType", () => {
    const out = serialiseObject(fake(table), 0) as unknown as Record<string, unknown>;
    expect(out).not.toBeNull();
    expect(out.type).toBe("table");
    expect(out.role).toBe("items");
  });

  it("keeps the grid intact", () => {
    const out = serialiseObject(fake(table), 0) as unknown as Record<string, unknown>;
    expect(out.rows).toBe(4);
    expect(out.columns).toBe(4);
    expect((out.colWidths as number[]).reduce((a, b) => a + b, 0)).toBe(734);
    expect((out.rowHeights as number[]).reduce((a, b) => a + b, 0)).toBe(140);
    expect((out.cells as unknown[]).length).toBe(16);
  });

  it("pads missing cells so the grid is always complete", () => {
    const out = serialiseObject(
      fake({ ...table, colWidths: [100, 100], rowHeights: [20, 20], cells: [] }),
      0,
    ) as unknown as Record<string, unknown>;
    expect((out.cells as unknown[]).length).toBe(4);
    expect(out.rows).toBe(2);
    expect(out.columns).toBe(2);
  });
});

describe("serialiseObject: image placeholders", () => {
  it("keeps the semantic role", () => {
    const out = serialiseObject(
      fake({
        type: "billimageplaceholder",
        appType: "image-placeholder",
        placeholderRole: "logo",
        label: "LOGO",
        width: 120,
        height: 60,
      }),
      0,
    ) as unknown as Record<string, unknown>;
    expect(out.type).toBe("image-placeholder");
    expect(out.placeholderRole).toBe("logo");
    expect(out.label).toBe("LOGO");
  });
});

describe("serialiseObjects", () => {
  it("records document size, z order and skips unknown types", () => {
    const template = serialiseObjects(
      [
        fake({ type: "rect", appType: "rect", id: "a" }),
        fake({ type: "totally-unknown" }),
        fake({ type: "itext", appType: "text", id: "b", text: "hi" }),
      ],
      { width: 794, height: 1123 },
      "My bill",
    );

    expect(template.templateVersion).toBe(1);
    expect(template.document).toEqual({ width: 794, height: 1123 });
    expect(template.meta.name).toBe("My bill");
    expect(template.objects.map((o) => o.id)).toEqual(["a", "b"]);
    expect(template.objects.map((o) => o.zIndex)).toEqual([0, 1]);
  });

  it("never emits a reference image, because none is ever passed in", () => {
    const template = serialiseObjects(
      [fake({ type: "image", id: "ref" })],
      { width: 100, height: 100 },
      "t",
    );
    // Fabric images have no case in the switch, so they are dropped.
    expect(template.objects).toHaveLength(0);
  });
});
