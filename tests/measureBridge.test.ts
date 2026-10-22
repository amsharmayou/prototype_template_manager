import { describe, expect, it } from "vitest";

import { measureBridge, renderBridge } from "@/lib/billkit/bridge";
import { TEMPLATE_VERSION } from "@/lib/template/types";
import type { BillTemplate, LayoutConfig, TemplateObject } from "@/lib/template/types";

/**
 * Measurement crosses the host boundary in two halves.
 *
 * The plan is built here, in pure TypeScript: which boxes need measuring, with
 * the text already filled in and the typography already resolved. Executing it
 * needs a font engine, so that half lives in the host - a browser on web, the
 * WebView on Android - and is the only part that touches a DOM.
 *
 * Splitting them this way keeps the part that can be tested against real
 * behaviour here, and keeps the part that cannot from leaking into the solver.
 */

const base = {
  rotation: 0, opacity: 1, visible: true, locked: false, zIndex: 0, parentId: null,
  stroke: "#000000", strokeWidth: 1, fill: "transparent",
};

const text = (id: string, t: string, expansion?: unknown): TemplateObject =>
  ({
    ...base, id, type: "text", name: id, role: null, x: 0, y: 0, width: 150, height: 20,
    text: t, fontFamily: "Arial", fontSize: 12, fontWeight: "normal",
    fontStyle: "normal", textAlign: "left", lineHeight: 1.16, charSpacing: 0,
    roleKind: "variable", textVerticalAlign: "top",
    ...(expansion ? { expansion } : {}),
  }) as TemplateObject;

const field = (id: string, key: string, expansion?: unknown): TemplateObject =>
  ({
    ...base, id, type: "field", name: id, role: null, x: 0, y: 0, width: 200, height: 20,
    key, fieldType: "text", text: `{{${key}}}`, fontFamily: "Arial", fontSize: 12,
    fontWeight: "normal", fontStyle: "normal", textAlign: "left", lineHeight: 1.16,
    charSpacing: 0, roleKind: "variable", textVerticalAlign: "top",
    ...(expansion ? { expansion } : {}),
  }) as TemplateObject;

const layout: LayoutConfig = {
  mode: "variable",
  document: { growthX: "fixed", growthY: "expand" },
  guides: [{ id: "g", orientation: "horizontal", position: 100 }],
};

const template = (objects: TemplateObject[]): BillTemplate => ({
  templateVersion: TEMPLATE_VERSION,
  document: { width: 800, height: 1000 },
  meta: { name: "t", modifiedAt: "" },
  objects,
  layout,
});

const plan = (objects: TemplateObject[], values: Record<string, string> = {}) =>
  measureBridge(JSON.stringify(template(objects)), JSON.stringify(values));

describe("the measurement plan asks only for what can grow", () => {
  it("skips an object with no expansion policy", () => {
    const requests = plan([text("t1", "{{a}}")], { a: "hello" });

    expect(requests).toEqual([]);
  });

  it("skips a plain rectangle", () => {
    const rect = {
      ...base, id: "r1", type: "rect", name: "r", role: null,
      x: 0, y: 0, width: 50, height: 50, cornerRadius: 0,
    } as TemplateObject;

    expect(plan([rect], {})).toEqual([]);
  });

  it("asks for a growing field", () => {
    const requests = plan([
      field("f1", "address", { x: { mode: "fixed" }, y: { mode: "unbounded", strategy: "wrap" } }),
    ], { address: "12 Long Road" });

    expect(requests).toHaveLength(1);
    expect(requests[0]!.id).toBe("f1");
  });

  it("asks for nothing when the template has no layout block", () => {
    const plain: BillTemplate = { ...template([field("f1", "address")]) };
    delete (plain as { layout?: unknown }).layout;

    expect(measureBridge(JSON.stringify(plain), "{}")).toEqual([]);
  });
});

describe("a request carries the text that will actually be painted", () => {
  it("resolves the token rather than asking to measure a placeholder", () => {
    // Measuring "{{address}}" would size the box to the label, not to the value.
    const requests = plan([
      text("t1", "{{a}}", { x: { mode: "fixed" }, y: { mode: "unbounded" } }),
    ], { a: "Hello" });

    expect(requests[0]!.text).toBe("Hello");
  });

  it("keeps the token when the field is empty, so an empty box measures as empty", () => {
    const requests = plan([
      text("t1", "{{a}}", { x: { mode: "fixed" }, y: { mode: "unbounded" } }),
    ], {});

    expect(requests[0]!.text).toBe("{{a}}");
  });

  it("carries the typography the renderer will use", () => {
    const requests = plan([
      text("t1", "{{a}}", { x: { mode: "fixed" }, y: { mode: "unbounded" } }),
    ], { a: "Hi" });

    expect(requests[0]).toMatchObject({
      fontFamily: "Arial",
      fontSize: 12,
      lineHeight: 1.16,
      charSpacing: 0,
      width: 150,
    });
  });

  it("asks a field to wrap and a plain text object not to", () => {
    // A field is rendered with a wrap width equal to its box; a text object is
    // not, so measuring both the same way would over-size the text object.
    const requests = plan([
      field("f1", "address", { x: { mode: "fixed" }, y: { mode: "unbounded" } }),
      text("t2", "{{a}}", { x: { mode: "fixed" }, y: { mode: "unbounded" } }),
    ], { address: "A long address that will need to wrap somewhere", a: "Short" });

    expect(requests.find((r) => r.id === "f1")!.wrap).toBe(true);
    expect(requests.find((r) => r.id === "t2")!.wrap).toBe(false);
  });
});

describe("measurements handed back to render are used", () => {
  const growable = () =>
    template([
      field("f1", "address", { x: { mode: "fixed" }, y: { mode: "unbounded", growthGuideId: "g" } }),
    ]);

  it("expands the box to the measured height", () => {
    const out = renderBridge(
      JSON.stringify(growable()),
      JSON.stringify({ address: "12 Long Road" }),
      "[]",
      JSON.stringify({ f1: { naturalWidth: 180, height: 96 } }),
    );

    expect(out.html).toContain("height: 96px");
  });

  it("renders as a fixed layout when no measurements are supplied", () => {
    const out = renderBridge(
      JSON.stringify(growable()),
      JSON.stringify({ address: "12 Long Road" }),
      "[]",
    );

    expect(out.html).toContain("height: 20px");
  });

  it("ignores a measurement for an object that is not in the template", () => {
    const out = renderBridge(
      JSON.stringify(growable()),
      "{}",
      "[]",
      JSON.stringify({ ghost: { naturalWidth: 900, height: 900 } }),
    );

    expect(out.html).toContain("height: 20px");
  });

  it("survives malformed measurement JSON rather than failing the render", () => {
    const out = renderBridge(
      JSON.stringify(growable()),
      JSON.stringify({ address: "12 Long Road" }),
      "[]",
      "{not json",
    );

    expect(out.html).toContain("height: 20px");
  });
});