import { describe, expect, it } from "vitest";

import { renderHtml } from "@/lib/render";
import { emptyTemplate, type BillTemplate, type TemplateObject } from "@/lib/template/types";

/**
 * An unfilled slot is an instruction to the author, not content for the reader.
 *
 * The editor draws a dashed box and a `{{token}}` so it is obvious where
 * something is meant to go. Printed, those same marks say "put an image here"
 * and "Consignment OR" to someone who cannot act on either. So a rendered
 * document leaves an unfilled slot empty, and keeps the marks available under
 * `placeholders: "show"` for the passes that want them.
 */

const base = {
  id: "o", name: "o", role: null, x: 10, y: 10, width: 300, height: 24,
  rotation: 0, opacity: 1, visible: true, locked: false, zIndex: 1,
  parentId: null, stroke: "", strokeWidth: 0, fill: "",
};

const text = (id: string, t: string, y = 10): TemplateObject =>
  ({
    ...base, id, type: "text", x: 10, y, text: t, fontFamily: "Arial",
    fontSize: 12, fontWeight: "normal", fontStyle: "normal", textAlign: "left",
    lineHeight: 1.16, charSpacing: 0, roleKind: "variable", textVerticalAlign: "top",
  }) as TemplateObject;

const field = (id: string, t: string): TemplateObject =>
  ({ ...base, id, type: "field", text: t, key: "date", fieldType: "date" }) as TemplateObject;

const imageSlot = (id: string, role: string, label: string): TemplateObject =>
  ({
    ...base, id, type: "image-placeholder", width: 160, height: 100,
    placeholderRole: role, label, src: "",
  }) as TemplateObject;

const withObjects = (...objects: TemplateObject[]): BillTemplate => ({
  ...emptyTemplate(),
  document: { width: 800, height: 1000 },
  objects,
});

describe("placeholders are not painted into a rendered document", () => {
  it("leaves an unfilled token out entirely", () => {
    const { html } = renderHtml(withObjects(text("t1", "{{consignment_or}}")));

    expect(html).not.toContain("{{");
    expect(html).not.toContain("consignment_or");
  });

  it("keeps the words around an unfilled token", () => {
    const { html } = renderHtml(withObjects(text("t1", "Total {{total}} due")));

    expect(html).toContain("Total");
    expect(html).toContain("due");
    expect(html).not.toContain("{{");
  });

  it("shows the value when the field is filled", () => {
    const { html } = renderHtml(
      withObjects(text("t1", "Total {{total}} due")),
      { total: "1,250.00" },
    );

    expect(html).toContain("1,250.00");
    expect(html).not.toContain("{{");
  });

  it("empties a field object whose whole content is one unfilled token", () => {
    const { html } = renderHtml(withObjects(field("f1", "{{date}}")));

    expect(html).not.toContain("{{");
    expect(html).not.toContain(">date<");
  });

  it("draws no dashed box for an unbound image slot", () => {
    const { html } = renderHtml(withObjects(imageSlot("i1", "logo", "IMAGE")));

    // Asserted on the element, not on the word "dashed": the `.ph` rule is in
    // the stylesheet either way, because `"show"` still emits it. What matters
    // is that no placeholder box is painted.
    expect(html).not.toContain('class="o ph"');
    expect(html).not.toContain("IMAGE");
    expect(html).not.toContain("<img");
  });

  it("draws the image once the slot is bound", () => {
    const { html } = renderHtml(
      withObjects(imageSlot("i1", "logo", "IMAGE")),
      { logo: "data:image/png;base64,AAAA" },
    );

    expect(html).toContain("<img");
    expect(html).not.toContain('class="o ph"');
  });

  it("empties an unfilled cell in a repeat band", () => {
    const table = {
      ...base, id: "tb", type: "table", width: 400, rows: 2, columns: 2,
      colWidths: [200, 200], rowHeights: [20, 20],
      cells: [
        { text: "Description", textAlign: "left", fontSize: 11, fontWeight: "bold" },
        { text: "Amount", textAlign: "right", fontSize: 11, fontWeight: "bold" },
        { text: "{{description}}", textAlign: "left", fontSize: 11, fontWeight: "normal" },
        { text: "{{amount}}", textAlign: "right", fontSize: 11, fontWeight: "normal" },
      ],
      borderColor: "#000000", borderWidth: 1, cellFill: "#ffffff",
      headerRow: true, headerFill: "#ffffff", headerTextColor: "#000000",
      cellTextColor: "#000000", padding: 2, fontFamily: "Arial",
    } as TemplateObject;

    const { html } = renderHtml(withObjects(table));

    expect(html).toContain("Description");
    expect(html).toContain("Amount");
    expect(html).not.toContain("{{");
  });
});

describe("placeholders stay available for the passes that want them", () => {
  it("keeps the literal token when asked to show them", () => {
    const { html } = renderHtml(withObjects(text("t1", "{{consignment_or}}")), {}, {
      placeholders: "show",
    });

    expect(html).toContain("{{consignment_or}}");
  });

  it("keeps the dashed slot when asked to show them", () => {
    const { html } = renderHtml(withObjects(imageSlot("i1", "logo", "IMAGE")), {}, {
      placeholders: "show",
    });

    expect(html).toContain('class="o ph"');
    expect(html).toContain("dashed");
    expect(html).toContain("IMAGE");
  });
});

describe("the missing-variable report is independent of the mode", () => {
  // Android shows "5 still empty" from this list. It is collected from the
  // template rather than from the HTML, so cleaning the page cannot silence it
  // - which is the whole reason hiding a placeholder is safe.
  it("still lists an unfilled key when its token is hidden", () => {
    const { variables } = renderHtml(withObjects(text("t1", "{{consignment_or}}")));

    expect(variables).toContain("consignment_or");
  });

  it("lists the same keys in both modes", () => {
    const template = withObjects(text("t1", "{{consignment_or}}"), imageSlot("i1", "logo", "IMAGE"));

    const hidden = renderHtml(template, {}, { placeholders: "hide" }).variables;
    const shown = renderHtml(template, {}, { placeholders: "show" }).variables;

    expect([...hidden].sort()).toEqual([...shown].sort());
  });
});

describe("the token grammar agrees with the one resolution uses", () => {
  // Three copies of this pattern exist - here, in `./values`, and in
  // `../template/placeholders` - because `values.ts` is vendored and cannot be
  // imported from without dragging the admin server's copy along. This is what
  // keeps the copies honest.
  it.each([
    "{{simple}}",
    "{{ spaced }}",
    "{{with.dots}}",
    "{{with-dashes}}",
    "{{Mixed_Case9}}",
  ])("strips %s", (token) => {
    const { html } = renderHtml(withObjects(text("t1", token)));

    expect(html).not.toContain("{{");
  });

  it.each([
    "{{ }}",
    "{{bad char}}",
    "{{Consignment OR}}",
  ])("hides the unresolvable mark %s", (mark) => {
    // Wider than the grammar `resolveText` matches: a token carrying a space
    // can never acquire a value, so under "hide" it is a placeholder mark that
    // would otherwise print on the bill as literal text.
    const { html } = renderHtml(withObjects(text("t1", mark)));

    expect(html).not.toContain("{{");
  });

  it.each([
    "{{unclosed",
    "closed}}",
    "no braces here",
  ])("leaves %s alone", (literal) => {
    // Not placeholder-shaped at all, so it is literal content and must survive
    // untouched rather than being silently swallowed.
    const { html } = renderHtml(withObjects(text("t1", literal)));

    expect(html).toContain(literal);
  });
});