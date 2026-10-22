import { describe, expect, it } from "vitest";

import { validateLayout } from "@/lib/package/layout";
import { TEMPLATE_VERSION } from "@/lib/template/types";
import type { BillTemplate, LayoutConfig, TemplateObject } from "@/lib/template/types";

/**
 * A layout rule that cannot be honoured should be named, not obeyed.
 *
 * The temptation for a layout engine is to ignore whatever it does not
 * understand: an unknown edge, a guide id that matches nothing, a horizontal
 * guide asked to control a left edge. Each of those produces a document that
 * looks almost right, which is the hardest failure to notice. Reporting the
 * exact path instead is what makes the template fixable.
 */

const rect: TemplateObject = {
  id: "r1", type: "rect", name: "Border", role: null,
  x: 0, y: 0, width: 200, height: 100,
  rotation: 0, opacity: 1, visible: true, locked: false, zIndex: 0, parentId: null,
  stroke: "#000000", strokeWidth: 1, fill: "transparent", cornerRadius: 0,
};

const text: TemplateObject = {
  id: "t1", type: "text", name: "Address", role: null,
  x: 10, y: 10, width: 100, height: 20,
  rotation: 0, opacity: 1, visible: true, locked: false, zIndex: 1, parentId: null,
  stroke: "", strokeWidth: 0, fill: "#000000",
  text: "{{a}}", fontFamily: "Arial", fontSize: 12,
  fontWeight: "normal", fontStyle: "normal", textAlign: "left",
  lineHeight: 1.16, charSpacing: 0, roleKind: "variable", textVerticalAlign: "top",
};

function template(layout?: LayoutConfig, objects: TemplateObject[] = [rect, text]): BillTemplate {
  return {
    templateVersion: TEMPLATE_VERSION,
    document: { width: 800, height: 1000 },
    meta: { name: "t", modifiedAt: "" },
    objects,
    ...(layout === undefined ? {} : { layout }),
  };
}

const errors = (layout?: LayoutConfig, objects?: TemplateObject[]) =>
  validateLayout(template(layout, objects)).filter((i) => i.severity === "error");

const paths = (layout?: LayoutConfig, objects?: TemplateObject[]) =>
  errors(layout, objects).map((i) => i.path);

const good: LayoutConfig = {
  mode: "variable",
  document: { growthX: "fixed", growthY: "expand", maxHeight: 4000 },
  guides: [
    { id: "bottom", orientation: "horizontal", position: 220, maxDisplacement: 600 },
    { id: "right", orientation: "vertical", position: 500 },
  ],
  attachments: [
    { id: "a1", objectId: "r1", edge: "bottom", guideId: "bottom", behavior: "stretch" },
    { id: "a2", objectId: "t1", edge: "right", guideId: "right", behavior: "move" },
  ],
};

describe("a template without layout is not a layout problem", () => {
  it("reports nothing at all", () => {
    expect(validateLayout(template(undefined))).toEqual([]);
  });
});

describe("a well-formed layout validates clean", () => {
  it("accepts guides, attachments and a document policy together", () => {
    expect(errors(good)).toEqual([]);
  });

  it("accepts a mode of fixed", () => {
    expect(errors({ mode: "fixed" })).toEqual([]);
  });

  it("accepts growth without a document policy", () => {
    expect(errors({ mode: "variable", guides: [{ id: "g", orientation: "vertical", position: 1 }] })).toEqual([]);
  });
});

describe("guides", () => {
  it("rejects a duplicate guide id", () => {
    expect(paths({
      mode: "variable",
      guides: [
        { id: "g", orientation: "horizontal", position: 10 },
        { id: "g", orientation: "vertical", position: 20 },
      ],
    })).toContain("layout.guides[1].id");
  });

  it("rejects an unknown orientation", () => {
    expect(paths({ mode: "variable", guides: [{ id: "g", orientation: "diagonal" as never, position: 1 }] }))
      .toContain("layout.guides[0].orientation");
  });

  it("rejects a non-finite position", () => {
    expect(paths({ mode: "variable", guides: [{ id: "g", orientation: "horizontal", position: Number.NaN }] }))
      .toContain("layout.guides[0].position");
  });

  it("rejects a negative maxDisplacement", () => {
    expect(paths({
      mode: "variable",
      guides: [{ id: "g", orientation: "horizontal", position: 1, maxDisplacement: -5 }],
    })).toContain("layout.guides[0].maxDisplacement");
  });

  it("rejects guides that are not an array", () => {
    expect(paths({ mode: "variable", guides: {} as never })).toContain("layout.guides");
  });
});

describe("attachments", () => {
  it("rejects a guide id that matches nothing", () => {
    expect(paths({
      mode: "variable",
      guides: [{ id: "g", orientation: "horizontal", position: 1 }],
      attachments: [{ id: "a", objectId: "r1", edge: "top", guideId: "missing", behavior: "move" }],
    })).toContain("layout.attachments[0].guideId");
  });

  it("rejects a horizontal guide asked to control a left edge", () => {
    // The single most likely authoring slip: the guide is horizontal and the
    // edge is vertical, and honouring it would move the wrong thing.
    expect(paths({
      mode: "variable",
      guides: [{ id: "g", orientation: "horizontal", position: 1 }],
      attachments: [{ id: "a", objectId: "r1", edge: "left", guideId: "g", behavior: "move" }],
    })).toContain("layout.attachments[0].edge");
  });

  it("rejects an object that is not in the template", () => {
    expect(paths({
      mode: "variable",
      guides: [{ id: "g", orientation: "horizontal", position: 1 }],
      attachments: [{ id: "a", objectId: "ghost", edge: "top", guideId: "g", behavior: "move" }],
    })).toContain("layout.attachments[0].objectId");
  });

  it("rejects a duplicate attachment id", () => {
    expect(paths({
      mode: "variable",
      guides: [{ id: "g", orientation: "horizontal", position: 1 }],
      attachments: [
        { id: "a", objectId: "r1", edge: "top", guideId: "g", behavior: "move" },
        { id: "a", objectId: "t1", edge: "top", guideId: "g", behavior: "move" },
      ],
    })).toContain("layout.attachments[1].id");
  });
});

describe("document policy", () => {
  it("rejects an unknown growth mode", () => {
    expect(paths({ mode: "variable", document: { growthX: "sideways" as never, growthY: "fixed" } }))
      .toContain("layout.document.growthX");
  });

  it("rejects a non-positive maximum", () => {
    expect(paths({ mode: "variable", document: { growthX: "fixed", growthY: "expand", maxHeight: 0 } }))
      .toContain("layout.document.maxHeight");
  });
});

describe("per-object expansion", () => {
  const withExpansion = (expansion: unknown): TemplateObject[] => [
    { ...text, expansion } as TemplateObject,
  ];

  it("accepts a two-axis policy bound to a matching guide", () => {
    expect(errors({
      mode: "variable",
      guides: [{ id: "bottom", orientation: "horizontal", position: 1 }],
    }, withExpansion({
      x: { mode: "fixed" },
      y: { mode: "unbounded", strategy: "wrap", growthGuideId: "bottom" },
    }))).toEqual([]);
  });

  it("rejects y growth bound to a vertical guide", () => {
    expect(paths({
      mode: "variable",
      guides: [{ id: "right", orientation: "vertical", position: 1 }],
    }, withExpansion({
      x: { mode: "fixed" },
      y: { mode: "unbounded", growthGuideId: "right" },
    }))).toContain("objects[0].expansion.y.growthGuideId");
  });

  it("rejects an unknown mode", () => {
    expect(paths({ mode: "variable" }, withExpansion({ x: { mode: "huge" }, y: { mode: "fixed" } })))
      .toContain("objects[0].expansion.x.mode");
  });

  it("rejects a negative growth cap", () => {
    expect(paths({ mode: "variable" }, withExpansion({
      x: { mode: "bounded", maxGrowth: -10 },
      y: { mode: "fixed" },
    }))).toContain("objects[0].expansion.x.maxGrowth");
  });

  it("warns rather than errors when bounded is given a zero cap", () => {
    // Legal, and not worth refusing the package over - but it can never grow,
    // so it is worth saying out loud.
    const all = validateLayout(template({ mode: "variable" }, withExpansion({
      x: { mode: "bounded", maxGrowth: 0 },
      y: { mode: "fixed" },
    })));

    expect(all).toHaveLength(1);
    expect(all[0]!.severity).toBe("warning");
    expect(all[0]!.path).toBe("objects[0].expansion.x.maxGrowth");
  });

  it("rejects an object with no y axis at all", () => {
    expect(paths({ mode: "variable" }, withExpansion({ x: { mode: "fixed" } })))
      .toContain("objects[0].expansion.y");
  });

  it("ignores an object that carries no policy", () => {
    expect(errors({ mode: "variable" }, [rect, text])).toEqual([]);
  });
});

describe("a malformed block is refused rather than half-believed", () => {
  it("reports a non-object layout", () => {
    expect(paths("nonsense" as never)).toEqual(["layout"]);
  });

  it("reports an unknown mode and stops there", () => {
    expect(paths({ mode: "elastic" as never })).toEqual(["layout.mode"]);
  });
});