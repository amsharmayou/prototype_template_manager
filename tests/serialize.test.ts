import { describe, expect, it } from "vitest";

import {
  objectBox,
  serialiseObject,
  serialiseObjects,
  type SerialisableObject,
} from "@/lib/template/serialize";
import { hydrateTemplate } from "@/lib/template/hydrate";

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

  it("keeps a horizontal rule level instead of tilting it half a stroke", () => {
    // Fabric centres the stroke on the line, so its bounding box sits half a
    // stroke below the true row while `x2`/`y2` hold the real endpoint. Taking
    // `y` from the box and `y2` from the object tilted every saved rule.
    const out = serialiseObject(
      fake({
        type: "line",
        appType: "hr",
        left: 98.5,
        top: 299,
        x2: 699,
        y2: 299.5,
        width: 600,
        height: 0,
      }),
      0,
    ) as unknown as Record<string, unknown>;
    expect(out.type).toBe("hr");
    expect(out.y).toBe(299);
    expect(out.y2).toBe(299);
    expect(out.height).toBe(0);
  });

  it("keeps a vertical rule upright", () => {
    const out = serialiseObject(
      fake({
        type: "line",
        appType: "vr",
        left: 299,
        top: 98.5,
        x2: 299.5,
        y2: 699,
        width: 0,
        height: 600,
      }),
      0,
    ) as unknown as Record<string, unknown>;
    expect(out.type).toBe("vr");
    expect(out.x).toBe(299);
    expect(out.x2).toBe(299);
    expect(out.width).toBe(0);
  });

  it("leaves a genuinely sloped line sloped", () => {
    // Only an axis-aligned *rule* gets flattened; a drawn diagonal keeps the
    // slope the author traced.
    const out = serialiseObject(
      fake({
        type: "line",
        left: 0,
        top: 0,
        x2: 100,
        y2: 50,
        width: 100,
        height: 50,
      }),
      0,
    ) as unknown as Record<string, unknown>;
    expect(out.y2).toBe(50);
    expect(out.height).toBe(50);
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

describe("serialiseObject: fields", () => {
  it("serialises a field with key and type", () => {
    const out = serialiseObject(
      fake({
        type: "billfield",
        appType: "field",
        key: "invoice_date",
        fieldType: "date",
        left: 100,
        top: 200,
        width: 120,
        height: 24,
      }),
      0,
    ) as unknown as Record<string, unknown>;
    expect(out.type).toBe("field");
    expect(out.key).toBe("invoice_date");
    expect(out.fieldType).toBe("date");
    expect(out.text).toBe("{{invoice_date}}");
    expect(out.roleKind).toBe("variable");
  });

  it("defaults fieldType to text", () => {
    const out = serialiseObject(
      fake({ type: "billfield", appType: "field", key: "total" }),
      0,
    ) as unknown as Record<string, unknown>;
    expect(out.fieldType).toBe("text");
  });

  it("writes the marker's own styling rather than a fixed guess", () => {
    // The template already had slots for all of these; nothing on the canvas
    // ever set them, so every field was written out as Arial 14 / left.
    const out = serialiseObject(
      fake({
        type: "billfield",
        appType: "field",
        key: "total",
        fontFamily: "Georgia",
        fontSize: 22,
        fontWeight: "bold",
        fontStyle: "italic",
        textAlign: "right",
      }),
      0,
    ) as unknown as Record<string, unknown>;
    expect(out.fontFamily).toBe("Georgia");
    expect(out.fontSize).toBe(22);
    expect(out.fontWeight).toBe("bold");
    expect(out.fontStyle).toBe("italic");
    expect(out.textAlign).toBe("right");
  });

  it("hydrates a field back with its styling and marker label intact", () => {
    // `hydrateField` used to read no text styling at all and rebuilt the label
    // from the bare key, so a styled field reverted to its defaults on reload
    // while the template still claimed otherwise.
    const template = serialiseObjects(
      [
        fake({
          type: "billfield",
          appType: "field",
          id: "f1",
          key: "total",
          fieldType: "currency",
          fontFamily: "Georgia",
          fontSize: 22,
          fontWeight: "bold",
          textAlign: "right",
          // The ink lives on `textColor`; `fill` on the canvas is the tint
          // behind the dashed box and must not travel into the template.
          textColor: "#b91c1c",
          fill: "rgba(37,99,235,0.06)",
        }),
      ],
      { width: 400, height: 400 },
      "t",
    );
    // The template carries the ink, so the value prints in the chosen colour.
    const saved = template.objects.find((o) => o.type === "field")!;
    expect((saved as unknown as { fill: string }).fill).toBe("#b91c1c");

    const [back] = hydrateTemplate(template) as unknown as Array<
      Record<string, unknown>
    >;
    expect(back.key).toBe("total");
    expect(back.fieldType).toBe("currency");
    expect(back.fontFamily).toBe("Georgia");
    expect(back.fontSize).toBe(22);
    expect(back.fontWeight).toBe("bold");
    expect(back.textAlign).toBe("right");
    expect(back.textColor).toBe("#b91c1c");
    // The background stays the tint; painting it with the ink would fill the
    // slot solid on reload.
    expect(back.fill).toBe("rgba(37,99,235,0.06)");
    expect(back.label).toBe("{{total}}");
  });

  it("prints an unstyled field's value in black, not the editor tint", () => {
    // The canvas tint is a 6%-alpha blue. It used to be copied into the
    // template's `fill`, which `renderText` reads as the value's ink, so every
    // default field printed almost invisibly.
    const out = serialiseObject(
      fake({
        type: "billfield",
        appType: "field",
        key: "paid",
        fill: "rgba(37,99,235,0.06)",
      }),
      0,
    ) as unknown as Record<string, unknown>;
    expect(out.fill).toBe("#000000");
  });
});

describe("serialiseObject: text scaling", () => {
  it("records the stretch beside the unscaled metrics instead of inflating fontSize", () => {
    // What Fabric actually holds after a side + down drag: the metrics are
    // untouched and only the scale moved. Copying `fontSize` verbatim and
    // folding the scale into the box (which is what `objectBox` does) cannot
    // describe the result, so both halves are written out explicitly.
    const out = serialiseObject(
      fake({
        type: "itext",
        appType: "text",
        text: "Text",
        fontSize: 14,
        scaleX: 2,
        scaleY: 1.5,
        width: 25.68,
        height: 15.82,
      }),
      0,
    ) as unknown as Record<string, unknown>;
    expect(out.fontSize).toBe(14);
    expect(out.scaleX).toBe(2);
    expect(out.scaleY).toBe(1.5);
    expect(out.width).toBe(25.68);
    expect(out.height).toBe(15.82);
  });

  it("records a neutral scale when the text was never stretched", () => {
    const out = serialiseObject(
      fake({ type: "itext", appType: "text", text: "Text", fontSize: 14 }),
      0,
    ) as unknown as Record<string, unknown>;
    expect(out.scaleX).toBe(1);
    expect(out.scaleY).toBe(1);
  });

  it("writes wrapWidth for a box that wraps, and omits it otherwise", () => {
    const wrapped = serialiseObject(
      fake({
        type: "textbox",
        appType: "text",
        text: "{{company}}",
        width: 120,
        height: 40,
        wrapWidth: 120,
      }),
      0,
    ) as unknown as Record<string, unknown>;
    expect(wrapped.wrapWidth).toBe(120);

    const auto = serialiseObject(
      fake({
        type: "itext",
        appType: "text",
        text: "{{company}}",
        width: 90,
        height: 16,
      }),
      0,
    ) as unknown as Record<string, unknown>;
    expect(auto.wrapWidth).toBeUndefined();
  });

  it("stops claiming the vertical alignment is always top", () => {
    // `serialiseText` hardcoded "top", so the field never reflected the object.
    const out = serialiseObject(
      fake({
        type: "textbox",
        appType: "text",
        text: "x",
        textVerticalAlign: "middle",
      }),
      0,
    ) as unknown as Record<string, unknown>;
    expect(out.textVerticalAlign).toBe("middle");
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

it("round-trips freehand path data through the template", async () => {
  const { Path } = await import("fabric");
  const path = new Path(
    [
      ["M", 0, 0],
      ["L", 100, 50],
      ["Q", 120, 80, 140, 60],
    ],
    { stroke: "#000000", fill: "", strokeWidth: 2 },
  );
  path.set({ left: 10, top: 20, appType: "path", id: "p1", name: "Stroke" } as never);

  const template = serialiseObjects([path] as never, { width: 400, height: 400 }, "t");
  const freehand = template.objects.find((o) => o.type === "freehand");
  expect(freehand).toBeDefined();
  if (freehand?.type !== "freehand") throw new Error("unreachable");

  // Path data, not an empty string. This was the assertion that failed before
  // the serialiser fix and passes now.
  expect(freehand.path).toBe("M 0 0 L 100 50 Q 120 80 140 60");

  // And it survives a hydrate, so every existing export now draws the stroke.
  const back = hydrateTemplate(template);
  const revived = back.find((o) => o.type === "path");
  expect(revived).toBeDefined();
});

describe("serialiseObject: bill parts", () => {
  it("keeps the embedded crop and recapture metadata", () => {
    const out = serialiseObject(
      fake({
        type: "billpart",
        appType: "bill-part",
        src: "data:image/png;base64,AAAA",
        normalized: true,
        sourceRect: { x: 10, y: 20, width: 30, height: 40 },
        width: 30,
        height: 40,
      }),
      0,
    ) as unknown as Record<string, unknown>;

    expect(out.type).toBe("bill-part");
    expect(out.src).toBe("data:image/png;base64,AAAA");
    expect(out.normalized).toBe(true);
    expect(out.sourceRect).toEqual({ x: 10, y: 20, width: 30, height: 40 });
  });
});

