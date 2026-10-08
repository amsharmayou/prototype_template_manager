import { describe, expect, it } from "vitest";

import { buildShareDocument, embedJson } from "@/lib/share/document";
import { emptyTemplate, type BillTemplate } from "@/lib/template/types";

function templateWithText(text: string, name = "Tax invoice"): BillTemplate {
  const t = emptyTemplate(800, 1000, name);
  t.objects = [
    {
      id: "t1",
      name: "Company",
      role: null,
      x: 40,
      y: 40,
      width: 300,
      height: 24,
      rotation: 0,
      opacity: 1,
      visible: true,
      locked: false,
      zIndex: 0,
      parentId: null,
      stroke: "transparent",
      strokeWidth: 0,
      fill: "#000000",
      type: "text",
      text,
      fontFamily: "Arial",
      fontSize: 18,
      fontWeight: "normal",
      fontStyle: "normal",
      textAlign: "left",
      lineHeight: 1.16,
      charSpacing: 0,
      roleKind: "static",
      textVerticalAlign: "top",
    },
  ] as BillTemplate["objects"];
  return t;
}

const KIT = `window.bootShareKit=function(){/* kit */};`;

describe("embedJson", () => {
  it("neutralises a closing script tag inside a string value", () => {
    const out = embedJson({ name: "Acme </script><img onerror=alert(1)>" });
    expect(out).not.toContain("</script");
    expect(out).not.toContain("<");
    // Still valid JSON that round-trips to the original value.
    expect(JSON.parse(out).name).toBe("Acme </script><img onerror=alert(1)>");
  });

  it("survives the line separators that are illegal in older script parsers", () => {
    const out = embedJson({ name: "a\u2028b\u2029c" });
    expect(out).not.toContain("\u2028");
    expect(out).not.toContain("\u2029");
    expect(JSON.parse(out).name).toBe("a\u2028b\u2029c");
  });
});

describe("buildShareDocument", () => {
  it("inlines the kit and the template so the file needs no server", () => {
    const html = buildShareDocument(templateWithText("{{company}}"), KIT);
    expect(html).toContain("window.bootShareKit=function()");
    expect(html).toContain('<script type="application/json" id="share-template">');
    expect(html).toContain('<div id="share-app"></div>');
    expect(html).toContain('<iframe id="share-preview"');
    expect(html).toContain("JSON.parse(document.getElementById(\"share-template\")");
    expect(html).toContain("{{company}}");
    expect(html.startsWith("<!DOCTYPE html>")).toBe(true);
  });

  it("does not let a template string close the kit's script tag", () => {
    const html = buildShareDocument(templateWithText("{{a}}", "Nasty </script>"), KIT);
    // Exactly the two script blocks the builder emits, plus nothing unexpected.
    const openings = html.match(/<script/g) ?? [];
    expect(openings).toHaveLength(3);
    expect(html).not.toContain("Nasty </script>");
  });

  it("escapes a kit source that itself contains a closing tag", () => {
    const html = buildShareDocument(templateWithText("{{a}}"), "var s='</script>';");
    expect(html).not.toContain("var s='</script>'");
    expect(html).toContain("<\\/script>");
  });
});