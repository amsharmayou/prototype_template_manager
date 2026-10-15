import { describe, expect, it } from "vitest";

import { serialiseObjects } from "@/lib/template/serialize";
import type { LayoutConfig } from "@/lib/template/types";

/**
 * The authoring surface, seen where it reaches the file.
 *
 * Every layout control in the properties panel writes one key on a Fabric
 * object or in the controller's `layout` state, and `getTemplate` serialises
 * both. A control that writes the wrong key, or a save that drops one field, is
 * invisible to the solver's unit tests and to the renderer - the rule simply
 * never reaches a bill.
 *
 * These cases therefore build the object shape a control produces and assert it
 * survives `serialiseObjects`, which is the only route from a panel click to
 * `template.json`. The geometry those rules produce is covered by
 * `layoutHierarchy.test.ts`; what is at stake here is that the data arrives.
 */

/** A fabric rect as `setContainer` leaves it, including the fields it preserves. */
const fabricRect = (container: Record<string, unknown>) =>
  ({
    type: "rect",
    appType: "rect",
    id: "frame",
    name: "Frame",
    role: null,
    left: 90,
    top: 150,
    width: 200,
    height: 80,
    angle: 0,
    opacity: 1,
    visible: true,
    stroke: "#000000",
    strokeWidth: 1,
    fill: "transparent",
    scaleX: 1,
    scaleY: 1,
    container,
  }) as never;

const fabricText = (extra: Record<string, unknown>) =>
  ({
    type: "text",
    appType: "text",
    id: "t1",
    name: "Address",
    role: null,
    left: 100,
    top: 160,
    width: 150,
    height: 30,
    angle: 0,
    opacity: 1,
    visible: true,
    fill: "#000000",
    scaleX: 1,
    scaleY: 1,
    text: "{{address}}",
    fontFamily: "Arial",
    fontSize: 12,
    fontWeight: "normal",
    fontStyle: "normal",
    textAlign: "left",
    lineHeight: 1.16,
    charSpacing: 0,
    ...extra,
  }) as never;

const layout: LayoutConfig = {
  mode: "variable",
  document: { growthX: "expand", growthY: "expand" },
  guides: [{ id: "guide-1", orientation: "horizontal", position: 230 }],
  collision: "report",
};

const page = { width: 1127, height: 871 };

describe("a container control's edits reach the template", () => {
  it("carries the enabled flag, both growth axes and every padding side", () => {
    const container = {
      enabled: true,
      growthX: "content",
      growthY: "content",
      padding: { top: 4, right: 20, bottom: 4, left: 8 },
    };
    const t = serialiseObjects([fabricRect(container)], page, "Bill", layout);

    expect((t.objects[0] as { container?: unknown }).container).toEqual(container);
  });

  it("carries the size limits an author typed, and only the ones they typed", () => {
    const container = { enabled: true, minWidth: 120, maxHeight: 400 };
    const t = serialiseObjects([fabricRect(container)], page, "Bill", layout);

    expect((t.objects[0] as { container?: unknown }).container).toEqual({
      enabled: true,
      minWidth: 120,
      maxHeight: 400,
    });
  });

  it("keeps a container a plain frame when the author turns it back off", () => {
    const t = serialiseObjects([fabricRect({ enabled: false })], page, "Bill", layout);

    // A frame switched off must leave no half-configured policy behind for the
    // solver to read as an opt-in.
    expect((t.objects[0] as { container?: unknown }).container).toBeUndefined();
  });
});

describe("membership and anchors reach the template", () => {
  it("carries a child's layout parent and anchor", () => {
    const t = serialiseObjects(
      [fabricText({ layoutParentId: "frame", anchor: { vertical: "end", bottomOffset: 12 } })],
      page,
      "Bill",
      layout,
    );
    const child = t.objects[0] as { layoutParentId?: unknown; anchor?: unknown };

    expect(child.layoutParentId).toBe("frame");
    expect(child.anchor).toEqual({ vertical: "end", bottomOffset: 12 });
  });

  it("writes a cleared parent as null rather than leaving the previous one", () => {
    const t = serialiseObjects([fabricText({ layoutParentId: null })], page, "Bill", layout);

    // The serialiser always writes the key, so a child removed from a container
    // is visibly unparented instead of inheriting membership on reload.
    expect((t.objects[0] as { layoutParentId?: unknown }).layoutParentId).toBeNull();
  });

  it("carries an expansion policy and the guide it pushes", () => {
    const expansion = {
      x: { mode: "fixed" as const },
      y: { mode: "unbounded" as const, strategy: "wrap" as const, growthGuideId: "guide-1" },
    };
    const t = serialiseObjects([fabricText({ expansion })], page, "Bill", layout);

    expect((t.objects[0] as { expansion?: unknown }).expansion).toEqual(expansion);
  });
});

describe("the template-level layout block reaches the file", () => {
  it("carries guides, attachments, the document policy and the collision choice", () => {
    const t = serialiseObjects([fabricText({})], page, "Bill", {
      ...layout,
      attachments: [
        { id: "a", objectId: "t1", edge: "bottom", guideId: "guide-1", behavior: "stretch" },
      ],
    });

    expect(t.layout?.guides).toHaveLength(1);
    expect(t.layout?.attachments).toHaveLength(1);
    expect(t.layout?.document).toEqual({ growthX: "expand", growthY: "expand" });
    expect(t.layout?.collision).toBe("report");
  });

  it("omits the block entirely for a template with no layout", () => {
    const t = serialiseObjects([fabricText({})], page, "Bill", undefined);

    expect(t.layout).toBeUndefined();
  });
});