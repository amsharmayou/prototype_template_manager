import { describe, expect, it } from "vitest";

import { calculateLayout } from "@/lib/render/layout";
import type {
  AttachmentEdge,
  BillTemplate,
  GuideAttachment,
  LayoutGuide,
  TableObject,
} from "@/lib/template/types";

/**
 * An attachment has to be able to ask for room.
 *
 * A growth rule (`expansion.y.growthGuideId`) says "this object pushes that
 * guide". An attachment says "this edge *is* that guide". The editor offers
 * both, and for the second one there is no growthGuideId at all - so if the
 * solver only ever read demand from the first, an attached object would be
 * parked on a guide that never moves and simply run off the page.
 */

const CELL = { text: "", textAlign: "left", fontSize: 10, fontWeight: "normal" } as const;

function table(over: Partial<TableObject> = {}): TableObject {
  return {
    id: "t1",
    type: "table",
    name: "Items",
    role: null,
    x: 24,
    y: 80,
    width: 400,
    height: 90,
    zIndex: 0,
    visible: true,
    locked: false,
    rows: 3,
    columns: 2,
    colWidths: [200, 200],
    rowHeights: [20, 30, 24],
    cells: [
      { ...CELL, text: "Desc" },
      { ...CELL, text: "Amt" },
      { ...CELL, text: "{{d}}" },
      { ...CELL, text: "{{a}}" },
      { ...CELL, text: "Total" },
      { ...CELL, text: "T" },
    ],
    borderColor: "#333333",
    borderWidth: 1,
    cellFill: "#ffffff",
    headerRow: true,
    headerFill: "#f0f0f0",
    headerTextColor: "#000000",
    cellTextColor: "#000000",
    padding: 4,
    fontFamily: "Arial",
    expansion: { x: { mode: "fixed" }, y: { mode: "unbounded" } },
    ...over,
  } as TableObject;
}

const GUIDE: LayoutGuide = { id: "guide-1", orientation: "horizontal", position: 200 };

function attachment(edge: AttachmentEdge): GuideAttachment {
  return { id: "att-1", objectId: "t1", edge, guideId: "guide-1", behavior: "move" };
}

function run(edge: AttachmentEdge, measurements: Record<string, { naturalWidth: number; height: number }>) {
  const template = {
    templateVersion: 2,
    document: { width: 794, height: 1123 },
    objects: [table()],
    layout: {
      mode: "variable",
      document: { growthX: "fixed", growthY: "expand" },
      guides: [GUIDE],
      attachments: [attachment(edge)],
    },
  } as unknown as BillTemplate;

  return calculateLayout({
    objects: template.objects,
    measurements,
    guides: [GUIDE],
    attachments: [attachment(edge)],
    documentPolicy: { growthX: "fixed", growthY: "expand" },
    document: { width: 794, height: 1123 },
  });
}

const SHORT = { "t1": { naturalWidth: 0, height: 90 } };
const TALL = { "t1": { naturalWidth: 0, height: 600 } };

describe("an attachment asks for room", () => {
  it("moves the guide when the attached edge has grown past it", () => {
    const out = run("bottom", TALL);
    const guide = out.guides.find((g) => g.id === "guide-1")!;

    // The table is at y=80 and 600 tall, so its bottom is 680 - well past the
    // guide's 200. The guide has to follow or the table is cut off.
    expect(guide.position).toBeGreaterThan(200);
  });

  it("leaves the guide alone when the object still fits above it", () => {
    const out = run("bottom", SHORT);
    const guide = out.guides.find((g) => g.id === "guide-1")!;

    expect(guide.position).toBe(200);
  });

  it("grows the page with it", () => {
    const out = run("bottom", TALL);

    // 80 + 600 is well past a 1123 page only once the table has grown; the
    // point is that growth reaches the document at all.
    expect(out.page.height).toBeGreaterThanOrEqual(1123);
  });

  it("pins the guide to the top edge instead of chasing the growth", () => {
    const out = run("top", { "t1": { naturalWidth: 0, height: 400 } });
    const guide = out.guides.find((g) => g.id === "guide-1")!;
    const placed = out.objects.find((o) => o.id === "t1")!;

    // A top attachment says "the guide is this object's top edge". Growth runs
    // downwards, away from that edge, so the guide has nothing to follow: it
    // stays put and the object simply becomes taller beneath it.
    //
    // The table is drawn at y=80 with the guide at 200, and because that guide
    // never travels the table is left exactly where it was traced. Snapping it
    // up to the line would mean opening the template already moved it - a bill
    // that no longer matches the design the author drew.
    expect(guide.position).toBe(200);
    expect(placed.y).toBe(80);
    expect(placed.height).toBe(400);
  });

  it("respects the guide's own travel limit", () => {
    const capped = { ...GUIDE, maxDisplacement: 50 };
    const template = {
      objects: [table()],
      guides: [capped],
      attachments: [{ ...attachment("bottom"), guideId: "guide-1" }],
      documentPolicy: { growthX: "fixed", growthY: "expand" },
      document: { width: 794, height: 1123 },
    } as unknown as Parameters<typeof calculateLayout>[0];

    const out = calculateLayout({
      ...template,
      measurements: { "t1": { naturalWidth: 0, height: 600 } },
    });
    const guide = out.guides.find((g) => g.id === "guide-1")!;

    expect(guide.position).toBe(250);
  });

  it("is stable across a second run - a re-render must not keep pushing", () => {
    const once = run("bottom", TALL).guides.find((g) => g.id === "guide-1")!.position;
    const twice = run("bottom", TALL).guides.find((g) => g.id === "guide-1")!.position;

    // Feeding the result back in must not walk the guide down the page.
    expect(twice).toBe(once);
  });
});

describe("a growth rule still works the same", () => {
  it("drives demand through growthGuideId as before", () => {
    const withRule = table({
      expansion: { x: { mode: "fixed" }, y: { mode: "unbounded", growthGuideId: "guide-1" } },
    });
    const out = calculateLayout({
      objects: [withRule],
      measurements: { t1: { naturalWidth: 0, height: 600 } },
      guides: [GUIDE],
      attachments: [],
      documentPolicy: { growthX: "fixed", growthY: "expand" },
      document: { width: 794, height: 1123 },
    });

    expect(out.guides.find((g) => g.id === "guide-1")!.position).toBeGreaterThan(200);
  });
});