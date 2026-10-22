import { describe, expect, it } from "vitest";

import { renderDocument, type RenderTelemetry } from "@/lib/render/document";
import { buildDisplayPages } from "@/lib/engine/list";
import { FontBook } from "@/lib/engine/fonts";
import { writePdf } from "@/lib/engine/pdf";
import { emptyTemplate, type TemplateObject, type BillTemplate } from "@/lib/template/types";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * Phase 4 telemetry: one structured event per render and per PDF, shaped for
 * a refusal-rate dashboard. The sink runs *after* the work and its failures
 * are contained - an odd host listener must not take the bill down.
 */
describe("telemetry sinks", () => {
  it("emits one render event with the counts a dashboard reads", () => {
    const template = emptyTemplate(794, 1123, "Telemetry");
    template.objects = [
      { type: "text", id: "t1", text: "{{invoice_number}}", x: 10, width: 100, y: 10, height: 20 } as unknown as TemplateObject,
    ];
    const templateObj = template as unknown as { meta: { name?: string } };
    templateObj.meta = templateObj.meta ?? { name: "T" };
    const events: RenderTelemetry[] = [];
    const result = renderDocument(template as BillTemplate, { invoice_number: "INV-1" }, {
      telemetry: (e) => events.push({ ...e, warnings: [...e.warnings] }),
    });
    expect(events).toHaveLength(1);
    expect(events[0]!.kind).toBe("render");
    expect(events[0]!.pages).toBe(1);
    // The telemetry counts agree with the render result itself.
    expect(events[0]!.refusals).toBe(result.refusals.length);
    expect(events[0]!.ms).toBeGreaterThanOrEqual(0);
    expect(Array.isArray(events[0]!.warnings)).toBe(true);
  });

  it("keeps rendering when a telemetry sink throws", () => {
    const template = emptyTemplate(794, 1123, "Throwing sink");
    template.objects = [
      { type: "text", id: "t1", text: "hello", x: 10, width: 100, y: 10, height: 20 } as unknown as TemplateObject,
    ];
    const rendered = renderDocument(template as BillTemplate, {}, {
      telemetry: () => {
        throw new Error("host sink bug");
      },
    });
    // The render itself completed: the html carries the static text.
    expect(rendered.html).toContain("hello");
  });

  it("emits one pdf event with byte and refusal counts", async () => {
    const fontsDir = join(__dirname, "..", "assets", "fonts");
    const sources: Array<[string, Uint8Array]> = readdirSync(fontsDir)
      .filter((f) => f.endsWith(".ttf"))
      .map((f) => [`fonts/${f}`, new Uint8Array(readFileSync(join(fontsDir, f)))]);
    const book = FontBook.load(sources).book;
    const template = emptyTemplate(794, 1123, "PDF telemetry");
    template.objects = [
      { type: "text", id: "t1", text: "hello pdf", x: 10, width: 200, y: 10, height: 20, fontFamily: "Arimo", fontSize: 14 } as unknown as TemplateObject,
    ];
    const rendered = renderDocument(template, {});
    const lists = buildDisplayPages(rendered.pages, rendered.warnings, { book });
    const events: Array<{ kind: string; pages: number; refusals: number; bytes: number; ms: number }> = [];
    const pdf = await writePdf(lists, {
      book,
      telemetry: (e) => events.push({ ...e }),
    });
    expect(events).toHaveLength(1);
    expect(events[0]!.kind).toBe("pdf");
    expect(events[0]!.pages).toBe(1);
    expect(events[0]!.refusals).toBe(0);
    expect(events[0]!.bytes).toBe(pdf.bytes.length);
    expect(events[0]!.ms).toBeGreaterThanOrEqual(0);
  });
});
