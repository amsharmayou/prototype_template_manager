import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import { fillTemplate } from "@/lib/template/dataBinding";
import { measureBridge } from "@/lib/billkit/bridge";
import { calculateLayout } from "@/lib/render/layout";
import type { ContentMeasurement } from "@/lib/render/measure";
import type { BillTemplate } from "@/lib/template/types";

/**
 * Reproduces the Variable_Test.json symptom: field value crosses the guide
 * line, rectangles never move.
 */
describe("variable_test reproduction", () => {
  it("diagnoses why the guide never moves", () => {
    const raw = readFileSync("../outputs/Variable_Test.json", "utf8");
    const template = JSON.parse(raw) as BillTemplate;
    const field = template.objects.find((o) => o.id === "field_eqgsmkr")!;
    console.log("FIELD expansion:", JSON.stringify((field as { expansion?: unknown }).expansion));
    console.log("GUIDES:", JSON.stringify(template.layout?.guides));
    console.log("ATTACHMENTS:", JSON.stringify(template.layout?.attachments));

    // Simulate a long value needing ~300px height in a 260px-wide box.
    const values = { field_1: "Line1\nLine2\nLine3\nLine4\nLine5\nLine6\nLine7\nLine8\nLine9\nLine10" };
    const filled = fillTemplate(template, values);
    const plan = measureBridge(JSON.stringify(filled), JSON.stringify(values), JSON.stringify([]));
    console.log("MEASURE PLAN:", JSON.stringify(plan, null, 1));

    // Fake a measurement: 10 lines x 16px = 160px needed vs 144px authored.
    const measurements: Record<string, ContentMeasurement> = {
      field_eqgsmkr: { naturalWidth: 260, height: 300 },
    };
    const out = calculateLayout({
      objects: filled.objects,
      measurements,
      guides: template.layout?.guides ?? [],
      attachments: template.layout?.attachments ?? [],
      documentPolicy: template.layout?.document ?? { growthX: "fixed", growthY: "fixed" },
      document: template.document,
    });
    console.log("GUIDE final:", JSON.stringify(out.guides));
    console.log("FIELD final:", JSON.stringify(out.objects.find((o) => o.id === "field_eqgsmkr")));
    console.log("DIAGNOSTICS:", JSON.stringify(out.diagnostics));

    // Part 2: what SHOULD happen — rects attached/following the guide.
    const out2 = calculateLayout({
      objects: filled.objects.map((o) =>
        o.type === "rect"
          ? {
              ...o,
              expansion: {
                x: { mode: "fixed" as const },
                y: { mode: "unbounded" as const, growthGuideId: "guide-1" },
              },
            }
          : o,
      ),
      measurements,
      guides: template.layout?.guides ?? [],
      attachments: [
        ...(template.layout?.attachments ?? []).filter(
          // Drop the self-conflicting field top+bottom stretch pair: a field
          // stretched to the very guide it pushes is a feedback loop.
          (a) => !(a.objectId === "field_eqgsmkr"),
        ),
        // Rectangles below the guide move with it.
        { id: "r2", objectId: "rect_97e4jyr", edge: "top" as const, guideId: "guide-1", behavior: "move" as const },
        { id: "r3", objectId: "rect_apph1si", edge: "top" as const, guideId: "guide-1", behavior: "move" as const },
      ],
      documentPolicy: template.layout?.document ?? { growthX: "fixed", growthY: "fixed" },
      document: template.document,
    });
    console.log("FIXED guide:", JSON.stringify(out2.guides));
    for (const o of out2.objects) {
      if (o.type === "rect" || o.id === "field_eqgsmkr")
        console.log("FIXED", o.id, "y=", Math.round(o.y * 100) / 100, "h=", Math.round(o.height * 100) / 100);
    }
    console.log("FIXED diagnostics:", JSON.stringify(out2.diagnostics));
    expect(true).toBe(true);
  });
});
