import { describe, expect, it } from "vitest";

import { buildPackage, writePackage } from "@/lib/package/build";
import { parsePackage } from "@/lib/package/parse";
import { validatePackage } from "@/lib/package/validate";
import { TEMPLATE_VERSION, type BillTemplate } from "@/lib/template/types";

/**
 * A package that carries broken layout metadata must fail on open.
 *
 * `validateLayout` has existed since the layout feature landed, but nothing on
 * the package path called it: the archive check only confirmed that
 * `template.json` was a member. So a dangling `growthGuideId` shipped inside a
 * `.btpkg` validated clean and surfaced as geometry that silently refused to
 * grow - the one failure an author cannot see from inside the app, because the
 * bill renders and simply ignores the rule.
 */

const template = (layout?: unknown): BillTemplate =>
  ({
    templateVersion: TEMPLATE_VERSION,
    document: { width: 794, height: 1123 },
    meta: { name: "t", modifiedAt: "" },
    objects: [
      {
        id: "t1", type: "text", name: "t1", role: null, x: 10, y: 10, width: 100, height: 20,
        rotation: 0, opacity: 1, visible: true, locked: false, zIndex: 0, parentId: null,
        stroke: "", strokeWidth: 0, fill: "#000000", text: "{{a}}", fontFamily: "Arial",
        fontSize: 12, fontWeight: "normal", fontStyle: "normal", textAlign: "left",
        lineHeight: 1.16, charSpacing: 0, roleKind: "variable", textVerticalAlign: "top",
        expansion: { x: { mode: "fixed" }, y: { mode: "unbounded", growthGuideId: "ghost" } },
      },
    ],
    ...(layout === undefined ? {} : { layout: layout as never }),
  }) as BillTemplate;

/** Built, written and parsed back, so this exercises the real archive path. */
const archive = (t: BillTemplate) => parsePackage(writePackage(buildPackage(t)));
const issuesFor = (t: BillTemplate) => validatePackage(archive(t)).issues;

describe("a package with broken layout metadata is refused", () => {
  it("reports an attachment naming a guide that does not exist", () => {
    const issues = issuesFor(
      template({
        mode: "variable",
        guides: [{ id: "g", orientation: "horizontal", position: 100 }],
        attachments: [{ id: "a", objectId: "t1", edge: "bottom", guideId: "nope", behavior: "stretch" }],
      }),
    );

    expect(issues.some((i) => i.message.includes("nope"))).toBe(true);
  });

  it("reports an expansion bound to a guide the template never declares", () => {
    const issues = issuesFor(template({ mode: "variable" }));

    expect(issues.some((i) => i.message.includes("ghost"))).toBe(true);
  });

  it("reports a guide bound to an edge it cannot control", () => {
    const issues = issuesFor(
      template({
        mode: "variable",
        guides: [{ id: "g", orientation: "vertical", position: 100 }],
        attachments: [{ id: "a", objectId: "t1", edge: "bottom", guideId: "g", behavior: "stretch" }],
      }),
    );

    expect(issues.some((i) => i.message.includes("vertical"))).toBe(true);
  });

  it("reports a container child pointing at a parent that does not exist", () => {
    const t = template({ mode: "variable" });
    t.objects[0] = { ...t.objects[0]!, layoutParentId: "missing" } as typeof t.objects[0];

    const issues = issuesFor(t);

    expect(issues.some((i) => i.message.includes("missing"))).toBe(true);
  });

  it("marks such a package as not ok", () => {
    expect(validatePackage(archive(template({ mode: "variable" }))).ok).toBe(false);
  });

  it("accepts a valid variable-layout package", () => {
    const good = template({
      mode: "variable",
      guides: [{ id: "g", orientation: "horizontal", position: 100 }],
      attachments: [{ id: "a", objectId: "t1", edge: "bottom", guideId: "g", behavior: "stretch" }],
    });
    (good.objects[0] as unknown as { expansion: { y: Record<string, unknown> } }).expansion.y = {
      mode: "unbounded",
      growthGuideId: "g",
    };

    expect(validatePackage(archive(good))).toEqual({ ok: true, issues: [] });
  });

  it("leaves a legacy package with no layout block alone", () => {
    const t = template();
    (t.objects[0] as { expansion?: unknown }).expansion = undefined;

    expect(validatePackage(archive(t))).toEqual({ ok: true, issues: [] });
  });
});