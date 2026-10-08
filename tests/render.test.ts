import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { renderHtml } from "@/lib/render";
import { canonicalJson } from "@/lib/render/canonical";
import { Refusals, fontStack, safeAngle, safeColor, safeLength, safeOpacity } from "@/lib/render/css";
import { escapeHtml } from "@/lib/render/escape";
import { renderObject } from "@/lib/render/primitives";
import { sha256Hex } from "@/lib/render/sha256";
import { stylesheet } from "@/lib/render/style";
import { resolveText } from "@/lib/render/values";
import { emptyTemplate, type BillTemplate } from "@/lib/template/types";

describe("sha256Hex", () => {
  it("matches the published vectors", () => {
    expect(sha256Hex("")).toBe(
      "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
    );
    expect(sha256Hex("abc")).toBe(
      "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad",
    );
    expect(
      sha256Hex("abcdbcdecdefdefgefghfghighijhijkijkljklmklmnlmnomnopnopq"),
    ).toBe("248d6a61d20638b8e5c026930c3e6039a33ce45964ff2167f6ecedd419db06c1");
  });

  it("handles a multi-byte character without mojibake", () => {
    // "日本語" in UTF-8
    expect(sha256Hex("日本語")).toBe(
      "77710aedc74ecfa33685e33a6c7df5cc83004da1bdcef7fb280f5c2b2e97e0a5",
    );
  });

  it("agrees with the platform digest across the padding boundaries", () => {
    const node = (s: string) => createHash("sha256").update(s, "utf8").digest("hex");
    for (const s of [
      "a",
      "é".repeat(30),
      "\u{1F600}\u{10FFFF}",
      "a".repeat(55),
      "a".repeat(56),
      "a".repeat(63),
      "a".repeat(64),
      "a".repeat(65),
      "a".repeat(1000),
    ]) {
      expect(sha256Hex(s)).toBe(node(s));
    }
  });
});

describe("canonicalJson", () => {
  it("sorts keys at every level", () => {
    expect(canonicalJson({ b: 1, a: { d: 2, c: 3 } })).toBe('{"a":{"c":3,"d":2},"b":1}');
  });

  it("is independent of key insertion order", () => {
    expect(canonicalJson({ a: 1, b: 2 })).toBe(canonicalJson({ b: 2, a: 1 }));
  });

  it("normalises numbers so equivalent values hash alike", () => {
    // Pinned to exact output, not compared against another call: 1e21 and -0
    // are the two forms a naive serializer gets wrong, so these can fail.
    expect(canonicalJson({ a: -0 })).toBe('{"a":0}');
    expect(canonicalJson({ a: [0, -0] })).toBe('{"a":[0,0]}');
    expect(canonicalJson({ a: 1e21 })).toBe('{"a":1e+21}');
    expect(canonicalJson({ a: Number.NaN })).toBe('{"a":null}');
    expect(canonicalJson({ a: Number.POSITIVE_INFINITY })).toBe('{"a":null}');
  });

  it("drops an undefined key so it cannot change the fingerprint", () => {
    expect(canonicalJson({ a: 1, b: undefined })).toBe('{"a":1}');
  });

  it("handles arrays and null", () => {
    expect(canonicalJson({ a: [3, 1, 2], b: null })).toBe('{"a":[3,1,2],"b":null}');
  });
});

describe("escapeHtml", () => {
  it("escapes the five dangerous characters", () => {
    expect(escapeHtml(`Sharma & Sons <Traders> "x" 'y'`)).toBe(
      "Sharma &amp; Sons &lt;Traders&gt; &quot;x&quot; &#39;y&#39;",
    );
  });

  it("escapes ampersand first so entities are not double-broken", () => {
    expect(escapeHtml("&lt;")).toBe("&amp;lt;");
  });

  it("neutralises a script tag", () => {
    expect(escapeHtml("<script>alert(1)</script>")).not.toContain("<script");
  });
});

describe("resolveText", () => {
  it("substitutes a key that is present", () => {
    expect(resolveText("Total {{ total }} due", { total: "3,510.00" })).toBe(
      "Total 3,510.00 due",
    );
  });

  it("leaves an unknown token literally in place", () => {
    expect(resolveText("Hello {{ zzz_custom_thing }}", {})).toBe(
      "Hello {{ zzz_custom_thing }}",
    );
  });

  it("returns the value raw, because the primitive escapes at emit time", () => {
    expect(resolveText("{{ n }}", { n: "A & B" })).toBe("A & B");
  });

  it("ignores a non-string value and leaves the token", () => {
    expect(resolveText("{{ n }}", { n: 42 as never })).toBe("{{ n }}");
  });

  it("substitutes the same key in every position", () => {
    expect(resolveText("{{ a }}-{{ a }}-{{ b }}", { a: "1", b: "2" })).toBe("1-1-2");
  });

  it("leaves text with no tokens untouched", () => {
    expect(resolveText("ACME TRADING CO.", {})).toBe("ACME TRADING CO.");
  });

  it("resolves on a second call, which a shared lastIndex would swallow", () => {
    // A module-level global regex carries `lastIndex` between uses. `replace`
    // resets it, so this holds today; it is pinned because the first symptom of
    // the hazard is a caller that stops matching and returns nothing.
    expect(resolveText("{{ a }}", { a: "1" })).toBe("1");
    expect(resolveText("{{ a }}", { a: "2" })).toBe("2");
    expect(resolveText("{{ a }}-{{ b }}", { a: "3", b: "4" })).toBe("3-4");
  });
});

it("agrees with the template package's token grammar", async () => {
  const { extractVariables } = await import("@/lib/template/placeholders");
  const text = "{{ a }} {{ b.c }} {{d_1}} plain";
  const viaTemplatePkg = extractVariables(text).sort();
  const viaRenderer = Array.from(
    new Set(
      (text.match(/\{\{\s*([a-zA-Z0-9_.-]+)\s*\}\}/g) ?? []).map((t) =>
        t.replace(/[{}\s]/g, ""),
      ),
    ),
  ).sort();
  expect(viaRenderer).toEqual(viaTemplatePkg);
  expect(resolveText(text, {})).toBe(text);
  for (const name of viaTemplatePkg) {
    expect(resolveText(`{{ ${name} }}`, { [name]: "X" })).toBe("X");
  }
});
describe("safeColor", () => {
  it("accepts the safe forms", () => {
    const r = new Refusals();
    expect(safeColor("#abc", "#000000", r)).toBe("#abc");
    expect(safeColor("#aabbcc", "#000000", r)).toBe("#aabbcc");
    expect(safeColor("#aabbccdd", "#000000", r)).toBe("#aabbccdd");
    expect(safeColor("rgb(1, 2, 3)", "#000000", r)).toBe("rgb(1, 2, 3)");
    expect(safeColor("rgba(1,2,3,0.5)", "#000000", r)).toBe("rgba(1,2,3,0.5)");
    expect(safeColor("transparent", "#000000", r)).toBe("transparent");
    expect(safeColor("none", "#000000", r)).toBe("none");
    expect(safeColor("red", "#000000", r)).toBe("red");
    expect(safeColor("Aqua", "#000000", r)).toBe("Aqua");
    expect(safeColor("hsl(120, 50%, 50%)", "#000000", r)).toBe("hsl(120, 50%, 50%)");
    expect(safeColor("hsla(120, 50%, 50%, 0.5)", "#000000", r)).toBe("hsla(120, 50%, 50%, 0.5)");
    expect(r.list()).toHaveLength(0);
  });

  it("refuses unknown words rather than echoing them as CSS", () => {
    const r = new Refusals();
    expect(safeColor("notacolor", "#000000", r)).toBe("#000000");
    expect(r.list()).toHaveLength(1);
  });

  it("refuses a CSS injection attempt and records a reason", () => {
    const r = new Refusals();
    const out = safeColor("red; } body { display: none", "#000000", r, "fill");
    expect(out).toBe("#000000");
    expect(r.list()).toHaveLength(1);
    expect(r.list()[0]!.field).toBe("fill");
  });

  it("refuses a url() and a non-finite value", () => {
    const r = new Refusals();
    expect(safeColor("url(javascript:alert(1))", "#000", r)).toBe("#000");
    expect(safeColor(Number.NaN, "#000", r)).toBe("#000");
    expect(safeColor(undefined, "#000", r)).toBe("#000");
    expect(r.list()).toHaveLength(3);
  });
});

describe("fontStack", () => {
  it("maps a known family to a stack", () => {
    expect(fontStack("Arial")).toContain("Arial");
    expect(fontStack("Arial")).toMatch(/sans-serif$/);
  });

  it("passes an unknown family through with a generic fallback, quoted", () => {
    const out = fontStack("Billington Script");
    expect(out).toBe('"Billington Script", Helvetica, Arial, sans-serif');
  });

  it("sanitises a hostile family name instead of echoing it", () => {
    const out = fontStack("My; } body { display:none");
    expect(out).not.toContain('display:none", }');
    expect(out).not.toContain("{");
    expect(out).toMatch(/, [A-Za-z"-]+(?:, [A-Za-z-]+)*$/);
  });

  it("picks a serif/mono fallback from a cue in the name", () => {
    expect(fontStack("ACME Modern Serif Display")).toMatch(/Georgia/);
    expect(fontStack("MyCode Mono")).toMatch(/ui-monospace/);
  });

  it("handles a non-string", () => {
    expect(fontStack(undefined)).toMatch(/sans-serif$/);
  });

  it("never crashes on Object.prototype keys and only echoes a sanitised string", () => {
    for (const key of ["__proto__", "constructor", "toString", "hasOwnProperty"]) {
      const out = fontStack(key);
      expect(typeof out).toBe("string");
      expect(out).toMatch(/^"[^"]+", /);
      expect(out).not.toContain("{");
    }
  });
});

describe("numeric guards", () => {
  it("safeLength keeps finite numbers and replaces the rest", () => {
    expect(safeLength(12.5)).toBe(12.5);
    expect(safeLength(Number.POSITIVE_INFINITY, 0)).toBe(0);
    expect(safeLength("20", 0)).toBe(0);
  });

  it("safeAngle and safeOpacity clamp", () => {
    expect(safeAngle(45)).toBe(45);
    expect(safeAngle(Number.NaN)).toBe(0);
    expect(safeOpacity(0.5)).toBe(0.5);
    expect(safeOpacity(9)).toBe(1);
    expect(safeOpacity(-2)).toBe(0);
  });

  it("safeAngle accepts any finite angle, deliberately", () => {
    // Pinned because it is a decision rather than an omission: a rotation is
    // taken modulo a full turn, so `rotate(370deg)` and `rotate(10deg)` draw
    // the same thing and clamping to a "sane" range would change a traced
    // template's own geometry. Only opacity has a range that means something.
    expect(safeAngle(1e300)).toBe(1e300);
    expect(safeAngle(-720)).toBe(-720);
    expect(safeAngle(Number.POSITIVE_INFINITY)).toBe(0);
    expect(safeAngle("45")).toBe(0);
  });
});

describe("stylesheet", () => {
  it("declares the page at the document size in px, not A4 in mm", () => {
    const css = stylesheet(1240, 1754);
    expect(css).toContain("@page");
    expect(css).toContain("size: 1240px 1754px");
    expect(css).not.toMatch(/size:\s*A4/);
  });

  it("sizes the sheet to the document and clips overflow", () => {
    const css = stylesheet(800, 1000);
    expect(css).toContain("width: 800px");
    expect(css).toContain("height: 1000px");
    expect(css).toContain("overflow: hidden");
  });

  it("uses only px lengths so browser font settings cannot move anything", () => {
    const css = stylesheet(800, 1000);
    expect(css).not.toMatch(/\d(rem|em|pt|vh|vw)\b/);
  });

  it("pins text sizing for print", () => {
    const css = stylesheet(800, 1000);
    expect(css).toContain("text-size-adjust: 100%");
  });

  it("fetches nothing", () => {
    const css = stylesheet(800, 1000);
    expect(css).not.toContain("@import");
    expect(css).not.toMatch(/url\(/);
  });

  it("keeps cell and header fills on paper", () => {
    const css = stylesheet(800, 1000);
    expect(css).toContain("-webkit-print-color-adjust: exact");
    expect(css).toContain("print-color-adjust: exact");
  });
});

const base = {
  id: "o1",
  name: "n",
  role: null,
  x: 10,
  y: 20,
  width: 100,
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
} as const;

const table = {
  ...base,
  width: 300,
  height: 60,
  type: "table",
  rows: 2,
  columns: 3,
  colWidths: [100, 120, 80],
  rowHeights: [30, 30],
  cells: [
    { text: "A", textAlign: "left", fontSize: 12, fontWeight: "bold" },
    { text: "B", textAlign: "left", fontSize: 12, fontWeight: "normal" },
    { text: "C", textAlign: "left", fontSize: 12, fontWeight: "normal" },
    { text: "D", textAlign: "left", fontSize: 12, fontWeight: "normal" },
    { text: "E", textAlign: "left", fontSize: 12, fontWeight: "normal" },
    { text: "F", textAlign: "left", fontSize: 12, fontWeight: "normal" },
  ],
  borderColor: "#000000",
  borderWidth: 1,
  cellFill: "transparent",
  headerRow: true,
  headerFill: "#eeeeee",
  headerTextColor: "#000000",
  cellTextColor: "#000000",
  padding: 4,
  fontFamily: "Arial",
} as const;

const textObj = (over: Record<string, unknown> = {}) =>
  ({
    ...base,
    type: "text",
    text: "Hello",
    fontFamily: "Arial",
    fontSize: 12,
    fontWeight: "normal",
    fontStyle: "normal",
    textAlign: "left",
    lineHeight: 1.16,
    charSpacing: 0,
    roleKind: "static",
    textVerticalAlign: "top",
    ...over,
  }) as never;

it("returns null for a group, which has no paint of its own", () => {
  const r = new Refusals();
  expect(renderObject({ ...base, type: "group" } as never, 0, {}, r)).toBeNull();
});

it("returns null for an invisible object", () => {
  const r = new Refusals();
  expect(renderObject({ ...base, type: "rect", visible: false, cornerRadius: 0 } as never, 0, {}, r)).toBeNull();
});

it("returns null for a non-finite box rather than emitting NaNpx", () => {
  const r = new Refusals();
  expect(renderObject({ ...base, type: "rect", x: Number.NaN, cornerRadius: 0 } as never, 0, {}, r)).toBeNull();
  expect(r.list().length).toBeGreaterThan(0);
});

it("renders a rect with its border inside the traced box", () => {
  const r = new Refusals();
  const out = renderObject({ ...base, type: "rect", cornerRadius: 0, fill: "#ff0000" } as never, 0, {}, r)!;
  expect(out).toContain("position: absolute");
  expect(out).toContain("left: 10px");
  expect(out).toContain("top: 20px");
  expect(out).toContain("border: 1px solid #000000");
  expect(out).toContain("background: #ff0000");
});

it("refuses an injected fill and renders the default", () => {
  const r = new Refusals();
  const out = renderObject({ ...base, type: "rect", cornerRadius: 0, fill: "red; } body{display:none" } as never, 0, {}, r)!;
  expect(out).not.toContain("display:none");
  expect(r.list().length).toBeGreaterThan(0);
});

it("emits a rotation transform with a centre origin", () => {
  const r = new Refusals();
  const out = renderObject({ ...base, type: "rect", cornerRadius: 0, rotation: 30 } as never, 0, {}, r)!;
  expect(out).toContain("transform: rotate(30deg)");
  expect(out).toContain("transform-origin: 50% 50%");
});

it("renders text pre-formatted so it cannot reflow", () => {
  const r = new Refusals();
  const out = renderObject(textObj(), 0, {}, r)!;
  expect(out).toContain("white-space: pre");
  expect(out).toContain("font-size: 12px");
  expect(out).toContain("line-height: 13.92px");
  expect(out).toContain("Hello");
});

it("renders a table as a real table with colgroup and row heights", () => {
  const r = new Refusals();
  const out = renderObject(table as never, 0, {}, r)!;
  expect(out).toContain("<table");
  expect(out).toContain("<colgroup>");
  expect(out).toContain('style="width: 100px"');
  expect(out).toContain('style="width: 120px"');
  expect(out).toContain('style="width: 80px"');
  expect(out).toContain("<thead>");
  expect(out).toContain("height: 30px");
  expect(out).toContain("border: 1px solid #000000");
});

it("clips a table cell instead of ellipsising it", () => {
  const r = new Refusals();
  const out = renderObject({
    ...base,
    width: 100,
    height: 30,
    type: "table",
    rows: 1,
    columns: 1,
    colWidths: [100],
    rowHeights: [30],
    cells: [{ text: "a very long value indeed", textAlign: "left", fontSize: 12, fontWeight: "normal" }],
    borderColor: "#000000",
    borderWidth: 1,
    cellFill: "transparent",
    headerRow: false,
    headerFill: "transparent",
    headerTextColor: "#000000",
    cellTextColor: "#000000",
    padding: 4,
    fontFamily: "Arial",
  } as never, 0, {}, r)!;
  expect(out).toContain("overflow: hidden");
  expect(out).not.toContain("text-overflow");
});

it("escapes a value that reaches a rendered text object", () => {
  const r = new Refusals();
  const out = renderObject(
    textObj({ text: "Dear {{ name }}", roleKind: "variable" }),
    0,
    { name: "A & B <C>" },
    r,
  )!;
  expect(out).toContain("A &amp; B &lt;C&gt;");
  expect(out).not.toContain("<C>");
});

it("maps colWidths onto colgroup cols in order", () => {
  const r = new Refusals();
  const out = renderObject(table as never, 0, {}, r)!;
  const cols = [...out.matchAll(/<col style="([^"]*)"/g)].map((m) => m[1]);
  expect(cols).toEqual(["width: 100px", "width: 120px", "width: 80px"]);
});

it("pins the table wrapper at the traced top-left corner", () => {
  const r = new Refusals();
  const out = renderObject({ ...table, x: 40, y: 200 } as never, 0, {}, r)!;
  const wrapper = /^<div class="o"[^>]*style="([^"]*)"/.exec(out)?.[1] ?? "";
  expect(wrapper).toContain("left: 40px");
  expect(wrapper).toContain("top: 200px");
  expect(out.indexOf("left: 40px")).toBeLessThan(out.indexOf("<table"));
});

it("sizes the table wrapper to the sum of the columns", () => {
  const r = new Refusals();
  const out = renderObject(table as never, 0, {}, r)!;
  expect(out).toContain("width: 300px");
  expect(out).toContain("<table class=\"tbl\" style=\"width: 300px\">");
});

it("puts the header row in thead with th and the rest in tbody with td", () => {
  const r = new Refusals();
  const out = renderObject(table as never, 0, {}, r)!;
  expect(out.indexOf("<thead>")).toBeLessThan(out.indexOf("<tbody>"));
  expect(out).toContain("<th ");
  expect(out).toContain("<td ");
  expect(out.indexOf(">A<")).toBeLessThan(out.indexOf(">D<"));
});

it("renders a line as a rotated bar of the traced length", () => {
  const r = new Refusals();
  const out = renderObject({ ...base, type: "line", x2: 110, y2: 20 } as never, 0, {}, r)!;
  expect(out).toContain("left: 10px");
  expect(out).toContain("top: 19.5px");
  expect(out).toContain("width: 100px");
  expect(out).toContain("background: #000000");
  expect(out).toContain("transform-origin: 0 50%");
  expect(out).toContain("transform: rotate(0deg)");
});

it("renders a diagonal line at its traced angle and length", () => {
  const r = new Refusals();
  const out = renderObject({ ...base, type: "line", x: 0, y: 0, x2: 100, y2: 100 } as never, 0, {}, r)!;
  expect(out).toContain("width: 141.42px");
  expect(out).toContain("transform: rotate(45deg)");
});

it("returns null for a zero-length line and for a non-finite endpoint", () => {
  const r = new Refusals();
  expect(renderObject({ ...base, type: "line", x2: 10, y2: 20 } as never, 0, {}, r)).toBeNull();
  expect(renderObject({ ...base, type: "line", x2: Number.NaN, y2: 20 } as never, 0, {}, r)).toBeNull();
  expect(r.list().length).toBe(1);
});

it("rounds the corners of a rounded rect and rounds an ellipse fully", () => {
  const r = new Refusals();
  expect(
    renderObject({ ...base, type: "rounded-rect", cornerRadius: 8 } as never, 0, {}, r),
  ).toContain("border-radius: 8px");
  expect(
    renderObject({ ...base, type: "ellipse", cornerRadius: 0 } as never, 0, {}, r),
  ).toContain("border-radius: 50%");
});

it("renders a polygon as an inline svg with its points", () => {
  const r = new Refusals();
  const out = renderObject({
    ...base,
    type: "polygon",
    points: [[0, 0], [100, 20], [60, 80.1267]],
  } as never, 0, {}, r)!;
  expect(out).toContain('<polygon points="0,0 100,20 60,80.13"');
  expect(out).toContain('fill="transparent"');
  expect(out).not.toContain("xmlns");
});

it("returns null for a polygon with fewer than two finite points", () => {
  const r = new Refusals();
  expect(renderObject({ ...base, type: "polygon", points: [] } as never, 0, {}, r)).toBeNull();
  expect(renderObject({ ...base, type: "polygon", points: [[0, 0]] } as never, 0, {}, r)).toBeNull();
  expect(renderObject({ ...base, type: "polygon", points: [[0, 0], [1, Number.NaN]] } as never, 0, {}, r)).toBeNull();
});

it("renders a freehand stroke as an unfilled inline svg path", () => {
  const r = new Refusals();
  const out = renderObject({
    ...base,
    type: "freehand",
    strokeWidth: 2,
    path: 'M 0 0 L 60 40" onload="x',
  } as never, 0, {}, r)!;
  expect(out).toContain('d="M 0 0 L 60 40&quot; onload=&quot;x"');
  expect(out).toContain('fill="none"');
  expect(out).toContain('stroke="#000000"');
  expect(out).toContain('stroke-width="2"');
  expect(out).not.toContain('onload="x');
});

it("returns null for a freehand stroke carrying the pre-fix empty path", () => {
  const r = new Refusals();
  expect(renderObject({ ...base, type: "freehand", path: "" } as never, 0, {}, r)).toBeNull();
});

it("centres an image placeholder label and escapes it", () => {
  const r = new Refusals();
  const out = renderObject({
    ...base,
    type: "image-placeholder",
    placeholderRole: "logo",
    label: "<b>LOGO</b>",
  } as never, 0, {}, r)!;
  expect(out).toContain('class="o ph"');
  expect(out).toContain("&lt;b&gt;LOGO&lt;/b&gt;");
  expect(out).not.toContain("<b>");
});

it("escapes the style attribute so a quoted family cannot end it", () => {
  const r = new Refusals();
  const out = renderObject(textObj({ fontFamily: "Times New Roman" }), 0, {}, r)!;
  expect(out).toContain("font-family: &quot;Times New Roman&quot;, Times, serif");
});

it("omits the transform entirely at zero rotation", () => {
  const r = new Refusals();
  const out = renderObject(textObj(), 0, {}, r)!;
  expect(out).not.toContain("transform");
});

it("maps vertical alignment onto the flex child's justify-content", () => {
  for (const [alignValue, justify] of [
    ["top", "flex-start"],
    ["middle", "center"],
    ["bottom", "flex-end"],
  ] as const) {
    const r = new Refusals();
    const out = renderObject(textObj({ textVerticalAlign: alignValue }), 0, {}, r)!;
    expect(out).toContain(`justify-content: ${justify}`);
  }
});

it("refuses a cell colour injection and falls back", () => {
  const r = new Refusals();
  const out = renderObject({
    ...table,
    cells: table.cells.map((c) => ({ ...c, text: "{{ n }}" })),
  } as never, 0, { n: "<img src=x>" }, r)!;
  expect(out).toContain("&lt;img src=x&gt;");
  const bad = renderObject({ ...table, headerFill: "red; } body{display:none" } as never, 0, {}, new Refusals())!;
  expect(bad).not.toContain("display:none");
});

it("gives each object a stable name derived from its index", () => {
  const r = new Refusals();
  const a = renderObject({ ...base, type: "rect", cornerRadius: 0 } as never, 3, {}, r)!;
  const b = renderObject({ ...base, type: "rect", cornerRadius: 0 } as never, 3, {}, r)!;
  expect(a).toBe(b);
  expect(a).toContain('id="o3"');
  expect(renderObject({ ...base, type: "rect", cornerRadius: 0 } as never, 4, {}, r)).toContain('id="o4"');
});

describe("renderObject text ink", () => {
  const textBg = {
    ...base,
    type: "text",
    text: "Total",
    fontFamily: "Arial",
    fontSize: 12,
    fontWeight: "normal",
    fontStyle: "normal",
    textAlign: "left",
    lineHeight: 1.16,
    charSpacing: 0,
    roleKind: "static",
    textVerticalAlign: "top",
  };

  it("emits the text fill colour as CSS color", () => {
    const r = new Refusals();
    const out = renderObject({ ...textBg, fill: "#b91c1c" } as never, 0, {}, r)!;
    expect(out).toContain("color: #b91c1c");
  });

  it("falls back to black and records a refusal for a non-colour fill", () => {
    const r = new Refusals();
    const out = renderObject({ ...textBg, fill: "not-a-colour" } as never, 0, {}, r)!;
    expect(out).toContain("color: #000000");
    expect(r.list().some((x) => x.field === "o1.fill")).toBe(true);
  });

  it("emits a per-cell colour when the cell carries one", () => {
    const r = new Refusals();
    const table = {
      ...base,
      type: "table",
      rows: 1,
      columns: 2,
      colWidths: [100, 100],
      rowHeights: [20],
      cells: [
        { text: "Item", textAlign: "left", fontSize: 12, fontWeight: "normal", color: "#1d4ed8" },
        { text: "2", textAlign: "left", fontSize: 12, fontWeight: "normal" },
      ],
      borderColor: "#000000",
      borderWidth: 1,
      cellFill: "#ffffff",
      headerRow: false,
      headerFill: "#ffffff",
      headerTextColor: "#000000",
      cellTextColor: "#000000",
      padding: 4,
      fontFamily: "Arial",
    };
    const out = renderObject(table as never, 0, {}, r)!;
    expect(out).toContain("color: #1d4ed8");
    expect(out).toContain("color: #000000");
  });
});

describe("renderObject field alignment", () => {
  const field = {
    ...base,
    type: "field",
    key: "paid",
    fieldType: "tickmark",
    text: "{{paid}}",
    fontFamily: "Georgia",
    fontSize: 18,
    fontWeight: "bold",
    fontStyle: "normal",
    textAlign: "right",
    lineHeight: 1.16,
    charSpacing: 0,
    roleKind: "variable",
    textVerticalAlign: "top",
  };

  it("honours a field's alignment and font like a text box", () => {
    // `renderObject` casts a field to a TextObject and calls `renderText`, so
    // everything `serialiseField` writes was already honoured — the values
    // simply never reached it from the canvas.
    const r = new Refusals();
    const out = renderObject({ ...field, textAlign: "right" } as never, 0, {}, r)!;
    expect(out).toContain("text-align: right");
    expect(out).toContain("font-family: Georgia");
    expect(out).toContain("font-size: 18px");
    expect(out).toContain("font-weight: bold");
  });

  it("centres and left-aligns a field on request", () => {
    const r = new Refusals();
    expect(
      renderObject({ ...field, textAlign: "center" } as never, 0, {}, r)!,
    ).toContain("text-align: center");
    expect(
      renderObject({ ...field, textAlign: "left" } as never, 0, {}, r)!,
    ).toContain("text-align: left");
  });

  it("prints the tickmark glyph the form supplied", () => {
    const r = new Refusals();
    const out = renderObject(field as never, 0, { paid: "✓" }, r)!;
    expect(out).toContain("✓");
    expect(out).not.toContain("{{paid}}");
  });
});

describe("renderObject text stretch", () => {
  const stretched = {
    ...base,
    type: "text",
    text: "Total",
    fontFamily: "Arial",
    fontSize: 14,
    fontWeight: "normal",
    fontStyle: "normal",
    textAlign: "left",
    lineHeight: 1.16,
    charSpacing: 0,
    roleKind: "static",
    textVerticalAlign: "top",
    width: 25.68,
    height: 15.82,
  };

  it("scales about the top-left corner so a side/down drag survives the export", () => {
    const r = new Refusals();
    const out = renderObject(
      { ...stretched, scaleX: 2, scaleY: 1.5 } as never,
      0,
      {},
      r,
    )!;
    expect(out).toContain("transform: scale(2, 1.5)");
    expect(out).toContain("transform-origin: 0 0");
  });

  it("scales a uniform stretch too, which is what a plain drag produces", () => {
    // Fabric 7 scales an IText uniformly from every handle, so this is the
    // common case in practice. Treating "uniform" as "no stretch" dropped the
    // drag on the floor and rendered the box at its natural size.
    const r = new Refusals();
    const out = renderObject(
      { ...stretched, scaleX: 2.89, scaleY: 2.89 } as never,
      0,
      {},
      r,
    )!;
    expect(out).toContain("transform: scale(2.89, 2.89)");
    expect(out).toContain("transform-origin: 0 0");
  });

  it("treats a scale within rounding distance of 1 as no stretch", () => {
    const r = new Refusals();
    const out = renderObject(
      { ...stretched, scaleX: 1.00001, scaleY: 1 } as never,
      0,
      {},
      r,
    )!;
    expect(out).not.toContain("transform");
  });

  it("leaves an unstretched box with no transform at all", () => {
    const r = new Refusals();
    const out = renderObject(stretched as never, 0, {}, r)!;
    expect(out).not.toContain("transform");
    expect(r.list()).toHaveLength(0);
  });

  it("keeps the layout box unscaled so the stretch is not counted twice", () => {
    const r = new Refusals();
    const out = renderObject(
      { ...stretched, scaleX: 2, scaleY: 1.5 } as never,
      0,
      {},
      r,
    )!;
    // 25.68 x 15.82 is the text's own metrics; the transform paints it at
    // 51.36 x 23.73. Emitting the scaled box here would stretch it twice.
    expect(out).toContain("width: 25.68px");
    expect(out).toContain("height: 15.82px");
    expect(out).toContain("font-size: 14px");
  });

  it("composes rotation with a non-uniform scale in Fabric's order", () => {
    const r = new Refusals();
    const out = renderObject(
      { ...stretched, rotation: 30, scaleX: 2, scaleY: 1.5 } as never,
      0,
      {},
      r,
    )!;
    // rotate * scale about the centre: the scale is written after the turn so
    // the tilt follows the object's own diagonal.
    expect(out).toContain("transform: rotate(30deg) scale(2, 1.5)");
    expect(out).toContain("transform-origin: 50% 50%");
  });

  it("refuses a non-positive scale instead of collapsing the box", () => {
    const r = new Refusals();
    const out = renderObject({ ...stretched, scaleX: 0 } as never, 0, {}, r)!;
    expect(out).not.toContain("transform: scale");
    expect(r.list().some((x) => x.field === "o1.scaleX")).toBe(true);
  });
});

const tpl = (mutate?: (t: BillTemplate) => void): BillTemplate => {
  const t = emptyTemplate(1240, 1754, "Acme Bill");
  t.meta.modifiedAt = "2026-09-30T12:00:00.000Z";
  mutate?.(t);
  return t;
};

describe("renderHtml", () => {
  it("produces a complete document", () => {
    const { html } = renderHtml(tpl());
    expect(html.startsWith("<!DOCTYPE html>")).toBe(true);
    expect(html).toContain("</html>");
    expect(html).toContain("charset=\"utf-8\"");
  });

  it("is byte-identical across runs", () => {
    const a = renderHtml(tpl()).html;
    const b = renderHtml(tpl()).html;
    expect(a).toBe(b);
  });

  it("never emits modifiedAt", () => {
    const { html } = renderHtml(tpl());
    expect(html).not.toContain("2026-09-30T12:00:00.000Z");
  });

  it("is inert: no script, no link, no import, no remote reference", () => {
    const { html } = renderHtml(tpl());
    expect(html).not.toContain("<script");
    expect(html).not.toContain("<link");
    expect(html).not.toContain("@import");
    expect(html).not.toContain("http://");
    expect(html).not.toContain("https://");
  });

  it("records the template version and a stable hash", () => {
    const a = renderHtml(tpl()).html;
    const b = renderHtml(tpl()).html;
    expect(a).toContain('data-template-version="1"');
    const hash = /data-template-hash="([0-9a-f]{64})"/.exec(a);
    expect(hash).not.toBeNull();
    expect(b).toContain(hash![1]!);
  });

  it("changes the hash when the template changes", () => {
    const a = /data-template-hash="([0-9a-f]{64})"/.exec(renderHtml(tpl()).html)![1];
    const b = /data-template-hash="([0-9a-f]{64})"/.exec(
      renderHtml(tpl((t) => { t.document.width = 999; })).html,
    )![1];
    expect(a).not.toBe(b);
  });

  it("refuses an unsupported template version instead of guessing", () => {
    expect(() => renderHtml(tpl((t) => { (t as never as { templateVersion: number }).templateVersion = 99; })))
      .toThrow(/version/i);
  });

  it("reports the document's variables", () => {
    const { variables } = renderHtml(
      tpl((t) => {
        t.objects.push({
          id: "t1", name: "T", role: null, x: 0, y: 0, width: 100, height: 20,
          rotation: 0, opacity: 1, visible: true, locked: false, zIndex: 0,
          parentId: null, stroke: "#000", strokeWidth: 1, fill: "transparent",
          type: "text", text: "Hi {{ customer_name }}", fontFamily: "Arial",
          fontSize: 12, fontWeight: "normal", fontStyle: "normal",
          textAlign: "left", lineHeight: 1.16, charSpacing: 0,
          roleKind: "variable", textVerticalAlign: "top",
        } as never);
      }),
    );
    expect(variables).toEqual(["customer_name"]);
  });

  it("renders objects in zIndex order regardless of array order", () => {
    const mk = (id: string, z: number, text: string) => ({
      id, name: id, role: null, x: 0, y: 0, width: 50, height: 20, rotation: 0,
      opacity: 1, visible: true, locked: false, zIndex: z, parentId: null,
      stroke: "#000", strokeWidth: 1, fill: "transparent", type: "text", text,
      fontFamily: "Arial", fontSize: 12, fontWeight: "normal", fontStyle: "normal",
      textAlign: "left", lineHeight: 1.16, charSpacing: 0, roleKind: "static",
      textVerticalAlign: "top",
    });
    const { html } = renderHtml(tpl((t) => {
      t.objects.push(mk("second", 5, "SECOND") as never, mk("first", 1, "FIRST") as never);
    }));
    expect(html.indexOf("FIRST")).toBeLessThan(html.indexOf("SECOND"));
  });

  it("keeps a valid page size and refuses nothing", () => {
    const { html, refusals } = renderHtml(tpl());
    expect(html).toContain("size: 1240px 1754px");
    expect(refusals).toHaveLength(0);
  });

  it("falls back to A4 when the page size is not a positive length", () => {
    const { html, refusals } = renderHtml(tpl((t) => {
      t.document.width = Number.NaN;
      t.document.height = "1754" as never;
    }));
    expect(html).not.toContain("NaN");
    expect(html).toContain("size: 794px 1123px");
    expect(refusals.map((f) => f.field).sort()).toEqual(["page.height", "page.width"]);
  });

  it("escapes a substituted value all the way through the document", () => {
    const { html } = renderHtml(
      tpl((t) => {
        t.objects.push(textObj({ text: "Dear {{ name }}" }) as never);
      }),
      { name: "A & B <C>" },
    );
    expect(html).toContain("A &amp; B &lt;C&gt;");
    expect(html).not.toContain("<C>");
  });

  it("emits nothing for a group but still renders its siblings", () => {
    const { html } = renderHtml(tpl((t) => {
      t.objects.push(
        { ...base, type: "group" } as never,
        textObj({ id: "t9", text: "AFTERGROUP" }) as never,
      );
    }));
    expect(html).toContain("AFTERGROUP");
    expect(html).not.toContain('id="o0"');
  });

  it("drops an unrecognised object type with a refusal, not a blank line", () => {
    const r = new Refusals();
    expect(renderObject({ ...base, type: "spiral" } as never, 0, {}, r)).toBeNull();
    expect(r.list().map((f) => f.field)).toContain("o1.type");

    const { html } = renderHtml(tpl((t) => {
      t.objects.push(
        { ...base, type: "spiral" } as never,
        textObj({ id: "t8", text: "KEPT" }) as never,
      );
    }));
    expect(html).toContain("KEPT");
    // An `undefined` from the switch would join as an empty line, leaving a
    // hole where the dropped object was.
    expect(html).not.toContain("\n\n");
  });

  it("refuses a non-numeric template version rather than interpolating it", () => {
    const { html, refusals } = renderHtml(
      tpl((t) => {
        (t as never as { templateVersion: unknown }).templateVersion = '1" onload="x';
      }),
    );
    expect(html).not.toContain("onload");
    expect(html).toContain('data-template-version="1"');
    expect(refusals.map((f) => f.field)).toContain("templateVersion");
  });

  it("refuses a template that carries no version at all", () => {
    const { html, refusals } = renderHtml(
      tpl((t) => {
        delete (t as never as { templateVersion?: unknown }).templateVersion;
      }),
    );
    expect(html).not.toContain("undefined");
    expect(html).toContain('data-template-version="1"');
    expect(refusals.map((f) => f.field)).toContain("templateVersion");
  });

  it("breaks out of the attribute entirely if the version carries a tag", () => {
    const { html } = renderHtml(
      tpl((t) => {
        (t as never as { templateVersion: unknown }).templateVersion = '1"><b>x';
      }),
    );
    expect(html).not.toContain("<b>x");
    expect(html).toContain('data-template-version="1"');
  });

  it("gives a re-saved template the same fingerprint", () => {
    const hashOf = (modifiedAt: string) =>
      /data-template-hash="([0-9a-f]{64})"/.exec(
        renderHtml(tpl((t) => { t.meta.modifiedAt = modifiedAt; })).html,
      )![1];
    expect(hashOf("2026-01-01T00:00:00.000Z")).toBe(hashOf("2026-12-31T23:59:59.999Z"));
  });

  it("keeps the same fingerprint for a trace whose objects are untouched", () => {
    // The fingerprint is the template with `meta` reduced to `name`, so the one
    // field that changes on every save must not move it and a real change must.
    const hashOf = (mutate: (t: BillTemplate) => void) =>
      /data-template-hash="([0-9a-f]{64})"/.exec(renderHtml(tpl(mutate)).html)![1];
    expect(hashOf((t) => { t.meta.modifiedAt = "2020-01-01T00:00:00.000Z"; }))
      .toBe(hashOf((t) => { t.meta.modifiedAt = "2031-06-06T06:06:06.006Z"; }));
    expect(hashOf((t) => { t.document.height = 2000; }))
      .not.toBe(hashOf((t) => { t.document.height = 2001; }));
  });

  it("refuses a template with no meta rather than dereferencing it", () => {
    const t = tpl();
    delete (t as never as { meta?: unknown }).meta;
    const { html, refusals } = renderHtml(t);
    expect(html.startsWith("<!DOCTYPE html>")).toBe(true);
    expect(html).toContain('data-template-version="1"');
    expect(refusals.map((f) => f.field)).toContain("meta.name");
  });

  it("refuses a template with no objects rather than mapping over undefined", () => {
    const t = tpl();
    delete (t as never as { objects?: unknown }).objects;
    const { html, refusals, variables } = renderHtml(t);
    expect(html.startsWith("<!DOCTYPE html>")).toBe(true);
    expect(html).not.toContain("undefined");
    expect(refusals.map((f) => f.field)).toContain("objects");
    expect(variables).toEqual([]);
  });

  it("refuses a template with no document and falls back to A4", () => {
    const t = tpl();
    delete (t as never as { document?: unknown }).document;
    const { html, refusals } = renderHtml(t);
    expect(html).toContain("size: 794px 1123px");
    expect(refusals.map((f) => f.field).sort()).toEqual(["page.height", "page.width"]);
  });

  it("coerces a non-string meta.name instead of throwing inside escapeHtml", () => {
    const { html, refusals } = renderHtml(
      tpl((t) => {
        (t.meta as never as { name: unknown }).name = 42;
      }),
    );
    expect(html).toContain("<title>42</title>");
    expect(refusals.map((f) => f.field)).toContain("meta.name");
  });

  it("still hashes a non-string meta.name, because it is part of the template", () => {
    const hashOf = (name: unknown) =>
      /data-template-hash="([0-9a-f]{64})"/.exec(
        renderHtml(tpl((t) => { (t.meta as never as { name: unknown }).name = name; })).html,
      )![1];
    expect(hashOf(42)).toBe(hashOf(42));
    expect(hashOf(42)).not.toBe(hashOf("42"));
  });
});

it("renders a rotated polygon, freehand stroke and table", () => {
  const r = new Refusals();
  const poly = renderObject({
    ...base, type: "polygon", points: [[0, 0], [10, 0], [5, 5]], rotation: 30,
  } as never, 0, {}, r)!;
  expect(poly).toContain("transform: rotate(30deg)");
  expect(poly).toContain("transform-origin: 50% 50%");
  expect(poly).toContain("overflow: visible");

  const freehand = renderObject({
    ...base, type: "freehand", path: "M 0 0 L 10 10", rotation: 30,
  } as never, 0, {}, r)!;
  expect(freehand).toContain("transform: rotate(30deg)");

  const tableWrapper = /^<div class="o"[^>]*style="([^"]*)"/.exec(
    renderObject({ ...table, rotation: 30 } as never, 0, {}, r)!,
  )?.[1] ?? "";
  expect(tableWrapper).toContain("transform: rotate(30deg)");
  expect(tableWrapper).toContain("transform-origin: 50% 50%");
});

it("omits the transform on a polygon, freehand stroke and table at zero rotation", () => {
  const r = new Refusals();
  expect(
    renderObject({ ...base, type: "polygon", points: [[0, 0], [10, 0], [5, 5]] } as never, 0, {}, r),
  ).not.toContain("transform");
  expect(
    renderObject({ ...base, type: "freehand", path: "M 0 0 L 10 10" } as never, 0, {}, r),
  ).not.toContain("transform");
  expect(renderObject(table as never, 0, {}, r)).not.toContain("transform");
});

it("composes a line's traced slope with the object's own rotation", () => {
  const r = new Refusals();
  const diagonal = renderObject({
    ...base, type: "line", x: 0, y: 0, x2: 100, y2: 100, rotation: 30,
  } as never, 0, {}, r)!;
  expect(diagonal).toContain("transform: rotate(75deg)");
  expect(diagonal).toContain("transform-origin: 0 50%");

  // The rule that starts flat and is turned 90 degrees becomes vertical.
  const turned = renderObject({
    ...base, type: "hr", x: 20, y: 360, width: 400, height: 0, x2: 420, y2: 360, rotation: 90,
  } as never, 0, {}, r)!;
  expect(turned).toContain("transform: rotate(90deg)");
  expect(turned).toContain("width: 400px");
});

it("rounds a fractional z-index so the paint order survives", () => {
  const r = new Refusals();
  expect(
    renderObject({ ...base, type: "rect", cornerRadius: 0, zIndex: 3.4 } as never, 0, {}, r),
  ).toContain("z-index: 3");
  expect(
    renderObject({ ...base, type: "rect", cornerRadius: 0, zIndex: 3.6 } as never, 0, {}, r),
  ).toContain("z-index: 4");
  expect(
    renderObject({ ...base, type: "rect", cornerRadius: 0, zIndex: "9" } as never, 0, {}, r),
  ).toContain("z-index: 0");
});

it("survives a table cell whose text is not a string", () => {
  const r = new Refusals();
  const out = renderObject({
    ...table,
    cells: [{ text: 42, textAlign: "left", fontSize: 12, fontWeight: "normal" }],
  } as never, 0, {}, r);
  expect(out).toContain("<td");
  expect(out).not.toContain("42");
});

it("collects variables through renderHtml when a cell text is not a string", () => {
  const { html, variables } = renderHtml(
    tpl((t) => {
      t.objects.push({
        ...table,
        cells: [
          { text: 42, textAlign: "left", fontSize: 12, fontWeight: "normal" },
          { text: null, textAlign: "left", fontSize: 12, fontWeight: "normal" },
          { text: "Due {{ due_date }}", textAlign: "left", fontSize: 12, fontWeight: "normal" },
        ],
      } as never);
      t.objects.push(textObj({ id: "tx", text: "Paid {{ amount_due }}" }) as never);
    }),
  );
  expect(html).toContain("<table");
  expect(variables).toEqual(["amount_due", "due_date"]);
});

/** A 3x3 table, so a per-cell refusal would land nine times. */
const grid = {
  ...table,
  id: "g1",
  rows: 3,
  columns: 3,
  colWidths: [100, 100, 100],
  rowHeights: [30, 30, 30],
  cells: Array.from({ length: 9 }, () => ({
    text: "x", textAlign: "left", fontSize: 12, fontWeight: "normal",
  })),
} as const;

it("reports one bad table colour once, not once per cell", () => {
  const r = new Refusals();
  const out = renderObject({ ...grid, borderColor: "red; } body { display: none" } as never, 0, {}, r)!;
  expect([...out.matchAll(/<t[hd] /g)]).toHaveLength(9);
  expect(out).not.toContain("display:none");
  expect(r.list().map((f) => f.field)).toEqual(["g1.borderColor"]);
});

it("reports one bad table-level length once, not once per cell", () => {
  const r = new Refusals();
  renderObject({ ...grid, padding: -4 } as never, 0, {}, r);
  expect(r.list().map((f) => f.field)).toEqual(["g1.padding"]);
});

it("records the same refusal twice over only when the value differs", () => {
  const r = new Refusals();
  r.add("f", "not-a-colour", "not a recognised colour");
  r.add("f", "not-a-colour", "not a recognised colour");
  expect(r.list()).toHaveLength(1);
  r.add("f", "still-not-a-colour", "not a recognised colour");
  expect(r.list()).toHaveLength(2);
});

it("refuses a negative traced width, which the CSS parser would discard", () => {
  const r = new Refusals();
  const out = renderObject({ ...base, type: "rect", cornerRadius: 0, width: -50, height: -10 } as never, 0, {}, r)!;
  expect(out).toContain("width: 0px");
  expect(out).toContain("height: 0px");
  expect(out).not.toContain("-50px");
  expect(out).not.toContain("-10px");
  expect(r.list().map((f) => f.field).sort()).toEqual(["o1.height", "o1.width"]);
});

it("keeps a negative x and y, which are positions and not lengths", () => {
  // An object may hang off the page edge, and the sheet clips it. Routing a
  // position through the length guard would record a refusal and move it.
  const r = new Refusals();
  const out = renderObject({ ...base, type: "rect", cornerRadius: 0, x: -30, y: -12 } as never, 0, {}, r)!;
  expect(out).toContain("left: -30px");
  expect(out).toContain("top: -12px");
  expect(r.list()).toHaveLength(0);
});

describe("purity of lib/render", () => {
  const dir = join(__dirname, "..", "lib", "render");
  const sourcesIn = (root: string) =>
    readdirSync(root, { recursive: true, encoding: "utf8" })
      .filter((f) => f.endsWith(".ts"))
      .map((f) => ({ file: f, src: readFileSync(join(root, f), "utf8") }));
  const sources = () => sourcesIn(dir);

  it("imports no engine, no UI and nothing impure", () => {
    const banned = [
      /from ["']fabric["']/,
      /from ["']react/,
      /from ["']next\//,
      /lib\/canvas/,
      /\bDate\b/,
      /Math\.random/,
      /\bIntl\b/,
      /toLocaleString/,
      /\bcrypto\b/,
      /\bfetch\b/,
      /document\./,
      /window\./,
    ];
    for (const { file, src } of sources()) {
      for (const re of banned) {
        expect(`${file}: ${re.source} ${re.test(src) ? "FOUND" : "ok"}`).toContain("ok");
      }
    }
  });

  it("contains no field vocabulary", async () => {
    const { SUGGESTED_VARIABLES } = await import("@/lib/template/placeholders");
    for (const { file, src } of sources()) {
      for (const name of SUGGESTED_VARIABLES) {
        // The source is what is asserted on: naming the field in the failure
        // message would otherwise put it in the string being checked.
        expect({ file, name, present: src.includes(name) }).toEqual({
          file,
          name,
          present: false,
        });
      }
    }
  });

  it("reads a subdirectory, not only the top level", () => {
    // A guard that skips a subdirectory is a guard that silently stops guarding
    // the day someone organises the renderer into folders, so the recursion is
    // itself under test rather than assumed.
    const root = mkdtempSync(join(tmpdir(), "render-purity-"));
    try {
      mkdirSync(join(root, "nested"));
      writeFileSync(join(root, "top.ts"), "export const a = 1;\n");
      writeFileSync(join(root, "nested", "deep.ts"), "export const b = 2;\n");
      writeFileSync(join(root, "nested", "notes.md"), "ignored\n");
      expect(sourcesIn(root).map((s) => s.file).sort()).toEqual([
        join("nested", "deep.ts"),
        "top.ts",
      ]);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});describe("renderObject wrapped text", () => {
  const baseText = {
    ...base,
    type: "text",
    text: "{{company}}",
    fontFamily: "Arial",
    fontSize: 16,
    fontWeight: "normal",
    fontStyle: "normal",
    textAlign: "left",
    lineHeight: 1.16,
    charSpacing: 0,
    roleKind: "variable",
    textVerticalAlign: "top",
  };

  it("wraps at the stored width and grows downward", () => {
    const r = new Refusals();
    const out = renderObject(
      { ...baseText, width: 120, height: 20, wrapWidth: 120 } as never,
      0,
      { company: "A company name far longer than one line" },
      r,
    )!;
    expect(out).toContain("white-space: pre-wrap");
    expect(out).toContain("width: 120px");
    // Grows downward rather than being cut at the traced height.
    expect(out).toContain("height: auto");
    expect(out).not.toContain("white-space: pre;");
  });

  it("breaks a single unbreakable token instead of running past the box", () => {
    const r = new Refusals();
    const out = renderObject(
      { ...baseText, width: 60, height: 20, wrapWidth: 60 } as never,
      0,
      { company: "27ABCDE1234F1Z5XXXXXXXXXXXX" },
      r,
    )!;
    // Without this a long GSTIN ignores pre-wrap and overflows the box.
    expect(out).toContain("overflow-wrap: break-word");
  });

  it("refuses a non-positive wrap width instead of collapsing the box", () => {
    const r = new Refusals();
    const out = renderObject(
      { ...baseText, width: 60, height: 20, wrapWidth: 0 } as never,
      0,
      {},
      r,
    )!;
    expect(out).toContain("white-space: pre");
    expect(out).not.toContain("pre-wrap");
  });

  it("leaves an unwrapped box exactly as it was", () => {
    const r = new Refusals();
    const out = renderObject(
      { ...baseText, width: 300, height: 24 } as never,
      0,
      {},
      r,
    )!;
    expect(out).toContain("white-space: pre");
    expect(out).toContain("height: 24px");
    expect(out).not.toContain("pre-wrap");
  });
});

describe("renderObject field bounds", () => {
  const fieldObj = {
    ...base,
    type: "field",
    key: "paid",
    fieldType: "tickmark",
    text: "{{paid}}",
    fill: "#000000",
    fontFamily: "Arial",
    fontSize: 14,
    fontWeight: "normal",
    fontStyle: "normal",
    textAlign: "left",
    lineHeight: 1.16,
    charSpacing: 0,
    roleKind: "variable",
    textVerticalAlign: "top",
  };

it("bounds a value inside the box the author drew", () => {
    // A tick, a checkbox and a date are all small slots. `overflow: hidden` is
    // the guarantee that nothing paints outside the box that was traced.
    const r = new Refusals();
    const out = renderObject(
      { ...fieldObj, width: 24, height: 24 } as never,
      0,
      { paid: "✓" },
      r,
    )!;
    expect(out).toContain("overflow: hidden");
    expect(out).toContain("width: 24px");
  });

  it("wraps a value too wide for the box onto the next line", () => {
    // The field's own width is the wrap boundary, and the box grows downward so
    // the wrapped line is visible rather than cut off.
    const r = new Refusals();
    const out = renderObject(
      { ...fieldObj, width: 60, height: 20 } as never,
      0,
      { paid: "a value much wider than sixty pixels" },
      r,
    )!;
    expect(out).toContain("white-space: pre-wrap");
    expect(out).toContain("overflow-wrap: break-word");
    expect(out).toContain("width: 60px");
    expect(out).toContain("height: auto");
  });

  it("breaks a single unbreakable token instead of spilling", () => {
    const r = new Refusals();
    const out = renderObject(
      { ...fieldObj, width: 40, height: 20 } as never,
      0,
      { paid: "27ABCDE1234F1Z5" },
      r,
    )!;
    expect(out).toContain("overflow-wrap: break-word");
  });

  it("wraps at its own box width, ignoring a stray wrapWidth", () => {
    // CSS wraps at the container width, so a `wrapWidth` the container does not
    // have cannot be the boundary. The slot drawn at creation time wins.
    const r = new Refusals();
    const out = renderObject(
      { ...fieldObj, width: 80, height: 20, wrapWidth: 400 } as never,
      0,
      { paid: "a value" },
      r,
    )!;
    expect(out).toContain("width: 80px");
    expect(out).toContain("white-space: pre-wrap");
  });

  it("bounds every unstyled field kind the same way", () => {
    for (const fieldType of ["checkbox", "date", "number", "currency", "text"]) {
      const r = new Refusals();
      const out = renderObject(
        { ...fieldObj, fieldType, width: 40, height: 18 } as never,
        0,
        {},
        r,
      )!;
      expect(out, fieldType).toContain("overflow: hidden");
    }
  });

  it("prints the value in the template's ink, defaulting to black", () => {
    const r = new Refusals();
    const out = renderObject(
      { ...fieldObj, width: 60, height: 20 } as never,
      0,
      { paid: "✓" },
      r,
    )!;
    expect(out).toContain("color: #000000");
  });

  it("leaves a plain text box unclipped", () => {
    // Only fields are bounded; a text box keeps spilling as it always has.
    const r = new Refusals();
    const out = renderObject(
      {
        ...fieldObj,
        type: "text",
        width: 60,
        height: 20,
      } as never,
      0,
      {},
      r,
    )!;
    expect(out).not.toContain("overflow: hidden");
  });
});

const billPart = {
  ...base,
  type: "bill-part",
  src: "data:image/png;base64,AAAA",
  normalized: true,
  sourceRect: { x: 10, y: 20, width: 30, height: 40 },
} as never;

it("renders a bill part as an embedded image", () => {
  const r = new Refusals();
  const out = renderObject(billPart, 0, {}, r)!;

  expect(out).toContain("data:image/png;base64,AAAA");
  expect(out).toContain("<img");
});

it("keeps the crop inside the traced box rather than stretching it", () => {
  // The crop is stored at its own pixel size and the object carries the scale
  // that maps it onto the box, so `contain` is what shows the whole cut-out.
  const r = new Refusals();
  const out = renderObject(billPart, 0, {}, r)!;
  expect(out).toContain("object-fit: contain");
  expect(out).toContain("left: 10px");
  expect(out).toContain("top: 20px");
  expect(out).toContain("width: 100px");
  expect(out).toContain("height: 40px");
  expect(r.list()).toHaveLength(0);
});

it("refuses a bill part whose src is not a safe image source", () => {
  const r = new Refusals();
  const out = renderObject({ ...(billPart as object), src: "javascript:alert(1)" } as never, 0, {}, r);
  expect(out).toBeNull();
  expect(r.list().some((x) => x.field === "o1.src")).toBe(true);
});

it("refuses a bill part with no src at all", () => {
  const r = new Refusals();
  expect(renderObject({ ...(billPart as object), src: undefined } as never, 0, {}, r)).toBeNull();
  expect(r.list().some((x) => x.field === "o1.src")).toBe(true);
});

// A hand-edited template can carry any shape of `name`, and a missing or
// non-string one must refuse the field rather than escape the renderer as a
// raw TypeError out of `attr`'s string method.
it("falls back to an empty alt for a bill part with no usable name", () => {
  for (const name of [undefined, null, 42, {}]) {
    const r = new Refusals();
    const out = renderObject({ ...(billPart as object), name } as never, 0, {}, r);
    expect(out).toContain('alt=""');
  }
});
