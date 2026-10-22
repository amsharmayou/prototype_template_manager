import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

import { fillTemplate } from "@/lib/template/dataBinding";
import { measureBridge } from "@/lib/billkit/bridge";
import { renderHtml } from "@/lib/render";
import type { BillTemplate } from "@/lib/template/types";

/**
 * The bill the feature was built for, driven end to end.
 *
 * `outputs/Variable_Test.json` is the real thing an author drew: a field that
 * can grow, a guide under it, a frame around the field, an outer frame, and a
 * row of boxes below that must stay where they are. A committed copy sits in
 * `tests/fixtures/` so this suite runs anywhere; when the live file is present
 * it is read instead, so a template the author has since edited is what gets
 * tested rather than a stale snapshot.
 *
 * Measurements are stated rather than measured: `measureDom` needs a font
 * engine, and a line box of `fontSize * lineHeight` is exactly what it reports
 * for a single line of Arial at this template's own typography.
 */

const ROOT = resolve(__dirname, "..");
const LIVE = resolve(ROOT, "..", "outputs", "Variable_Test.json");
const FIXTURE = resolve(__dirname, "fixtures", "Variable_Test.json");

function template(): BillTemplate {
  const raw = existsSync(LIVE)
    ? readFileSync(LIVE, "utf8")
    : readFileSync(FIXTURE, "utf8");
  return JSON.parse(raw) as BillTemplate;
}

/** 14px Arial at lineHeight 1.16: one line box, times the number of lines. */
const lineHeight = 14 * 1.16;

function lineMeasurement(lines: number) {
  return {
    field_eqgsmkr: {
      naturalWidth: Math.min(260.13, lines * 34),
      height: Math.round(lines * lineHeight * 100) / 100,
    },
  };
}

const SHORT = "One short line";
const LONG = Array.from({ length: 10 }, (_, i) => `Line ${i + 1}`).join("\n");

function renderLines(text: string) {
  const t = template();
  const values = { field_1: text };
  const filled = fillTemplate(t, values);
  return renderHtml(filled, values, { measurements: lineMeasurement(text.split("\n").length) });
}

const box = (objects: ReturnType<typeof renderLines>["objects"], id: string) => {
  const o = objects.find((x) => x.id === id);
  if (!o) throw new Error(`no object ${id}`);
  return { x: o.x, y: o.y, width: o.width, height: o.height };
};

/** Where the template's one marking line is drawn. */
const GUIDE_BASE = template().layout?.guides?.[0]?.position ?? 0;

describe("the measured field is asked about", () => {
  it("asks the host to measure exactly the growing slot", () => {
    const t = template();
    const filled = fillTemplate(t, { field_1: LONG });

    const plan = measureBridge(
      JSON.stringify(filled),
      JSON.stringify({ field_1: LONG }),
    );

    // One field carries a policy; the rectangles carry shapes, not text, so
    // asking for them would be cost with no reader.
    expect(plan.map((r) => r.id)).toEqual(["field_eqgsmkr"]);
  });
});

describe("a long value grows the bill", () => {
  const out = renderLines(LONG);
  const field = box(out.objects, "field_eqgsmkr");

  it("grows the field itself", () => {
    expect(field.height).toBeCloseTo(10 * lineHeight, 1);
    expect(field.width).toBeCloseTo(260.13, 1);
  });

  it("crosses no guide: the boundary moves with the field", () => {
    // The guide is authored above the grown text, so the bill reports the
    // field running past a line it never moved - the original symptom.
    expect(out.warnings.join(" ")).not.toContain("field_eqgsmkr");
  });

  it("grows the frame that contains the field, keeping its margin", () => {
    // rect_b5s870i is drawn around the field with 59.18px of slack below it.
    const frame = box(out.objects, "rect_b5s870i");
    expect(frame.height).toBeGreaterThan(222.97);
    expect(frame.height).toBeCloseTo(222.97 + (field.height - 144.17), 1);
  });

  it("grows the outer frame around everything that moved", () => {
    const outer = box(out.objects, "rect_8oytdhn");
    expect(outer.height).toBeGreaterThan(531.44);
    expect(outer.y).toBeCloseTo(138.61, 5);
  });

  it("carries the attached rows down with the guide, keeping their distance", () => {
    // Rectangle 2 and Rectangle 3 are bound to guide-1 by their top edge, so
    // the boundary carries them. The distance the author drew from the line is
    // part of the design: they move down by exactly the boundary's travel and
    // are never yanked *up* onto it.
    const travel = Math.max(0, field.y + field.height - GUIDE_BASE);
    expect(travel).toBeGreaterThan(0);
    for (const id of ["rect_97e4jyr", "rect_apph1si"]) {
      const authored = box(template().objects, id);
      expect(box(out.objects, id).y).toBeCloseTo(authored.y + travel, 5);
      expect(box(out.objects, id).height).toBeCloseTo(authored.height, 5);
    }
  });

  it("leaves the rows nothing is attached to exactly as authored", () => {
    for (const id of ["rect_cftyhvr", "rect_dxwbbeq"]) {
      expect(box(out.objects, id).y).toBeCloseTo(
        box(template().objects, id).y,
        5,
      );
    }
  });

  it("grows the page only as far as the content needs", () => {
    expect(out.page.height).toBeGreaterThanOrEqual(871);
  });

  it("does not squash or fling the field by its contradictory edge pair", () => {
    // The template attaches the field's top *and* bottom to the same guide.
    // That pair cannot both be honoured, and the resolution must not teleport
    // the field onto the line or collapse it to zero height.
    expect(field.y).toBeCloseTo(213.55, 5);
    expect(field.height).toBeGreaterThan(144.17);
  });
});

describe("a short value changes nothing", () => {
  it("leaves the bill as it was traced", () => {
    const t = template();
    const out = renderLines(SHORT);

    for (const o of out.objects) {
      const authored = t.objects.find((a) => a.id === o.id)!;
      expect(o.y).toBeCloseTo(authored.y, 5);
      expect(o.height).toBeCloseTo(authored.height, 5);
      expect(o.x).toBeCloseTo(authored.x, 5);
      expect(o.width).toBeCloseTo(authored.width, 5);
    }
    expect(out.warnings).toEqual([]);
  });
});

describe("a guide carries what the author attached to it", () => {
  const t = template();
  // The author's row below the boundary follows it down. The field's own
  // attachments stay: they are what moves the boundary in the first place.
  const withRules: BillTemplate = {
    ...t,
    layout: {
      ...t.layout!,
      attachments: [
        ...(t.layout!.attachments ?? []),
        { id: "row-top", objectId: "rect_97e4jyr", edge: "top", guideId: "guide-1", behavior: "move" },
        { id: "row2-top", objectId: "rect_apph1si", edge: "top", guideId: "guide-1", behavior: "move" },
      ],
    },
  };
  const values = { field_1: Array.from({ length: 20 }, (_, i) => `Line ${i + 1}`).join("\n") };
  const filled = fillTemplate(withRules, values);
  const out = renderHtml(filled, values, {
    measurements: lineMeasurement(20),
  });

  it("carries the attached boxes down by the boundary's travel", () => {
    // Both boxes are drawn *below* the guide with a margin the author chose, so
    // each shifts by exactly how far the boundary travelled rather than snapping
    // up onto the line - the margin between a section and its boundary is part
    // of the design and survives the growth.
    const field = box(out.objects, "field_eqgsmkr");
    const travel = field.y + field.height - GUIDE_BASE;
    const authoredRow = box(t.objects, "rect_97e4jyr");
    const authoredMargin = authoredRow.y - GUIDE_BASE;

    expect(travel).toBeGreaterThan(0);
    expect(box(out.objects, "rect_97e4jyr").y - authoredRow.y).toBeCloseTo(travel, 5);
    expect(box(out.objects, "rect_apph1si").y - box(t.objects, "rect_apph1si").y).toBeCloseTo(travel, 5);
    // The gap each row was drawn with, measured from the boundary, is intact.
    expect(box(out.objects, "rect_97e4jyr").y - (GUIDE_BASE + travel)).toBeCloseTo(authoredMargin, 5);
  });

  it("keeps their size", () => {
    expect(box(out.objects, "rect_97e4jyr").height).toBeCloseTo(152.56, 5);
  });
});

describe("determinism", () => {
  it("renders the same bill twice from the same values", () => {
    expect(JSON.stringify(renderLines(LONG))).toBe(JSON.stringify(renderLines(LONG)));
  });

  it("re-renders a shorter value without remembering the taller one", () => {
    const t = template();
    const values = { field_1: LONG };
    const grown = renderHtml(fillTemplate(t, values), values, { measurements: lineMeasurement(10) });
    const shrunk = renderHtml(fillTemplate(t, values), values, { measurements: lineMeasurement(1) });

    expect(box(shrunk.objects, "rect_b5s870i").height).toBeCloseTo(222.97, 5);
    expect(box(grown.objects, "rect_b5s870i").height).toBeGreaterThan(222.97);
  });
});
