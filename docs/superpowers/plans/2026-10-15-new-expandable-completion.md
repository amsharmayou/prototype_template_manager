# New_Expandable Completion Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close every gap between the current BillKit variable-layout implementation and `docs/New_Expandable.md`, so the "Definition of Done" checklist in that document is satisfied by evidence rather than by assertion.

**Architecture:** The pure solver (`lib/render/layout.ts`) already computes expansion, guide demand, attachments, explicit containers, anchors and collisions in one deterministic pass. Nothing here replaces it. This plan adds the missing *evidence* (tests on the untested X axis and authoring surface), the missing *wiring* (layout validation on the package-open path), the missing *UI* (container padding / min / max), and the missing *authoring guarantees* (real measured geometry instead of the author's drawn slack for legacy frames). Every task is additive; legacy `TEMPLATE_VERSION = 2` behaviour and byte-identical golden output must not change.

**Tech Stack:** TypeScript 5, Next.js 16 (App Router), Fabric.js 7, Vitest 3, Playwright, esbuild (runtime bundles).

**Spec:** `docs/New_Expandable.md` (the contract) and `docs/Expanding_Bill.md` (the earlier plan it extends). This plan implements what those documents specify but the code does not yet do.

## Global Constraints

These apply to every task. They are copied from the spec's §16 guardrails and this repository's established rules.

- **Do not mutate base geometry during rendering.** Each render starts from authored geometry; growth is recomputed every time.
- **Do not infer parent membership or guide attachments from proximity/intersection.** Only `layoutParentId`, `container.enabled` and serialized `attachments` may change geometry.
- **Do not put DOM APIs in the pure solver or `lib/billkit/bridge.ts`.** Browser measurement stays in `lib/billkit/measure-dom.ts`.
- **Do not shrink text, clip content, or overlap objects to make a test pass.**
- **Do not change `TEMPLATE_VERSION` (stays `2`) or the `.btpkg` package version (stays `1`)** — layout metadata is additive and opt-in.
- **Never silently degrade.** Capped growth, invalid references, collisions, overflow and non-convergence must produce a diagnostic in `LayoutOutput.diagnostics` / `RenderResult.warnings`.
- **Android is not in this repository.** `Android/` does not exist here; any Android change belongs in the separate pipeline repository. This plan must not claim Android verification.
- **Every solver change requires rebuilding both runtime bundles** (`public/billkit.js`, `public/sharekit.js`) or every host silently serves stale layout. `tests/bundleFreshness.test.ts` guards this.
- **Commands used throughout:** `node node_modules/vitest/vitest.mjs run <file>` for one test file, `node node_modules/vitest/vitest.mjs run` for the suite, `node node_modules/typescript/bin/tsc --noEmit -p tsconfig.json` for typecheck, `node node_modules/esbuild/bin/esbuild <entry> --bundle --minify --format=iife --target=es2019 --outfile=<out>` to rebuild a bundle. (`npx`/`npm` batch scripts cannot be spawned directly on this Windows host.)

## File Structure

| File | Responsibility | Change |
|---|---|---|
| `lib/render/layout.ts` | Pure solver: expansion, guide demand, attachments, containers, anchors, collisions, page bounds | Task 2, Task 4 |
| `lib/render/index.ts` | Pipeline seam: repeat → row heights → layout → HTML | Task 2 (measure re-entry), Task 3 |
| `lib/package/layout.ts` | `validateLayout` — pure layout-metadata validator | Task 3 (reuse as-is) |
| `lib/package/validate.ts` | Package validation entry points | Task 3 (call `validateLayout`) |
| `lib/package/resolve.ts` | Template/asset resolution | Task 3 (surface layout issues) |
| `lib/package/index.ts` | Public exports | Task 3 (export `validateLayout`) |
| `components/editor/LayoutPanel.tsx` | Authoring UI for growth, attachments, container, anchors, page | Task 4 |
| `lib/canvas/EditorController.ts` | Authoring operations + history | Task 6 (test target) |
| `tests/layoutHierarchy.test.ts` | Container/anchor/collision solver + validation tests | Task 1, Task 5 |
| `tests/layoutXAxis.test.ts` | **New** — vertical guide / X expansion / X containers | Task 2 |
| `tests/layoutPackageValidate.test.ts` | **New** — layout issues surfaced through the package path | Task 3 |
| `tests/layoutEditorSurface.test.ts` | **New** — controller setters, undo/redo, save/load round trip | Task 6 |
| `e2e/layout-guides.spec.ts` | **New** — browser flow: draw a vertical guide, attach, render | Task 6 |
| `docs/New_Expandable.md` | The spec | Task 7 (status note only) |

---

### Task 1: Make the three dead hierarchy validations run

**Files:**
- Modify: `tests/layoutHierarchy.test.ts:127-163`

**Interfaces:**
- Consumes: `validateLayout(template) => LayoutIssue[]` from `lib/package/layout.ts`, `calculateLayout(input) => LayoutOutput` from `lib/render/layout.ts`.
- Produces: three new passing tests: `rejects an unknown layout parent`, `rejects a layout-parent cycle`, `rejects a bad anchor rule and collision mode`.

**Why:** `describe("hierarchy validation", ...)` at `tests/layoutHierarchy.test.ts:130` sits **inside** the callback of `it("stays silent with collision allow")` (`:127`). Vitest registers 8 tests from that file, not the 11 `it(` declarations — so the three validation assertions (`:143`, `:147`, `:153`) have never executed. These are exactly the §5.5/§8.1 rules about invalid hierarchy, cycles and contradictory anchors.

- [ ] **Step 1: Confirm the tests do not currently run**

Run:
```bash
node node_modules/vitest/vitest.mjs run tests/layoutHierarchy.test.ts --reporter=verbose
```
Expected: `Tests 8 passed (8)` — fewer than the 11 `it(` blocks in the file.

- [ ] **Step 2: Move the `describe` block out of the `it` callback**

Delete the nested block and re-add it as a sibling of the `collisions` describe, after the closing of that describe. The result must read exactly:

```typescript
  it("stays silent with collision allow", () => {
    const out = run({ objects: overlapping(), collision: "allow" });

    expect(out.diagnostics.join(" ")).not.toContain("overlaps");
  });
});

describe("hierarchy validation", () => {
  const tpl = (layout: unknown, objects: unknown[]) => ({
    templateVersion: 2 as const,
    document: { width: 800, height: 1000 },
    meta: { name: "t", modifiedAt: "" },
    objects: objects as never[],
    ...(layout === undefined ? {} : { layout: layout as never }),
  });
  const obj = (id: string, extra?: Record<string, unknown>) => ({
    id, type: "rect", name: id, role: null, x: 0, y: 0, width: 200, height: 100,
    rotation: 0, opacity: 1, visible: true, locked: false, zIndex: 0, parentId: null,
    stroke: "#000", strokeWidth: 1, fill: "transparent", cornerRadius: 0, ...extra,
  });
  it("rejects an unknown layout parent", () => {
    const issues = validateLayout(tpl({ mode: "variable" }, [obj("r1", { layoutParentId: "missing" })]) as never);
    expect(issues.some((i: { path: string }) => i.path.includes("layoutParentId"))).toBe(true);
  });
  it("rejects a layout-parent cycle", () => {
    const issues = validateLayout(tpl({ mode: "variable" }, [
      obj("a", { layoutParentId: "b" }), obj("b", { layoutParentId: "a" }),
    ]) as never);
    expect(issues.some((i: { severity: string }) => i.severity === "error"))).toBe(true);
  });
  it("rejects a bad anchor rule and collision mode", () => {
    const issues = validateLayout(tpl({ mode: "variable", collision: "push" }, [
      obj("t1", { layoutParentId: "r1", anchor: { vertical: "middle" } }), obj("r1"),
    ]) as never);
    expect(issues.some((i: { path: string }) => i.path.includes("anchor"))).toBe(true);
    expect(issues.some((i: { path: string }) => i.path.includes("collision"))).toBe(true);
  });
});
```

- [ ] **Step 3: Run the file — the three validations now execute**

Run:
```bash
node node_modules/vitest/vitest.mjs run tests/layoutHierarchy.test.ts --reporter=verbose
```
Expected: `Tests 11 passed (11)`.

- [ ] **Step 4: Commit**

```bash
git add tests/layoutHierarchy.test.ts
git commit -m "test: run the hierarchy validations that were nested inside a test"
```

---

### Task 2: Prove the X axis and vertical guides (spec §5.8, §14.1)

**Files:**
- Create: `tests/layoutXAxis.test.ts`
- Modify: `lib/render/layout.ts` (only if a test exposes a real defect)
- Modify: `lib/render/index.ts` (re-measure entry, §8.3/§8.4)

**Interfaces:**
- Consumes: `calculateLayout(input)` with `guides`/`attachments`; `renderHtml(template, values, { measurements })`.
- Produces: a test file proving a vertical guide moves in X for an X-growing field, `left`/`right` attachments resolve, `growthX: "expand"` pages grow in width, and container `growthX: "content"` grows a frame's width.

**Why:** The spec's §5.8 is emphatic — "Do not declare the feature complete with only vertical field growth/horizontal guides" — and §14.1 items 4, 5, 6, 7 and 9 are all about this. Today **no** test passes `orientation: "vertical"` to the solver; the solver's X path (`lib/render/layout.ts:389`, `:421-433`, `:560-561`, `:673`, `:878-882`) is unexercised, so a defect there would be invisible.

- [ ] **Step 1: Write the failing X-axis suite**

Create `tests/layoutXAxis.test.ts`:

```typescript
import { describe, expect, it } from "vitest";

import { calculateLayout } from "@/lib/render/layout";
import type { LayoutInput } from "@/lib/render/layout";
import type { ContentMeasurement } from "@/lib/render/measure";
import type { GuideAttachment, LayoutGuide, TemplateObject } from "@/lib/template/types";

/**
 * The X axis, and the vertical guide that carries it.
 *
 * The solver treats X and Y as two instances of one rule, and a test suite that
 * only ever draws horizontal guides cannot tell the two apart: every X-path bug
 * - a demand read on the wrong axis, a right edge snapping to a guide that did
 * not move, a container that never widens - looks exactly like a passing test.
 * So every case below is the Y case from `layout.test.ts` mirrored.
 */

const base = {
  rotation: 0, opacity: 1, visible: true, locked: false, zIndex: 0, parentId: null,
  stroke: "#000000", strokeWidth: 1, fill: "transparent",
};

const rect = (id: string, x: number, y: number, width: number, height: number, extra: Record<string, unknown> = {}): TemplateObject =>
  ({ ...base, id, type: "rect", name: id, role: null, x, y, width, height, cornerRadius: 0, ...extra }) as TemplateObject;

const text = (id: string, x: number, y: number, width: number, height: number, expansion?: unknown): TemplateObject =>
  ({
    ...base, id, type: "text", name: id, role: null, x, y, width, height,
    text: "{{a}}", fontFamily: "Arial", fontSize: 12, fontWeight: "normal",
    fontStyle: "normal", textAlign: "left", lineHeight: 1.16, charSpacing: 0,
    roleKind: "variable", textVerticalAlign: "top",
    ...(expansion ? { expansion } : {}),
  }) as TemplateObject;

const needs = (width: number, height: number): ContentMeasurement => ({ naturalWidth: width, height });

const RIGHT: LayoutGuide = { id: "right", orientation: "vertical", position: 300 };

function run(partial: Partial<LayoutInput> & { objects: TemplateObject[] }) {
  return calculateLayout({
    objects: partial.objects,
    measurements: partial.measurements ?? {},
    guides: partial.guides ?? [],
    attachments: partial.attachments ?? [],
    documentPolicy: partial.documentPolicy ?? { growthX: "fixed", growthY: "fixed" },
    document: partial.document ?? { width: 800, height: 1000 },
  });
}

const boxOf = (objects: TemplateObject[], id: string) => {
  const o = objects.find((x) => x.id === id);
  if (!o) throw new Error(`no object ${id}`);
  return { x: o.x, y: o.y, width: o.width, height: o.height };
};

/* 14.1 item 4 */ describe("an X-growing field pushes its vertical guide", () => {
  it("moves the guide right by what the content needs", () => {
    const out = run({
      objects: [text("t1", 20, 40, 100, 20, { x: { mode: "unbounded", growthGuideId: "right" }, y: { mode: "fixed" } })],
      measurements: { t1: needs(360, 18) },
      guides: [RIGHT],
    });

    // 20 + 360 = 380, so the boundary travels from 300 to 380.
    expect(out.guides[0]!.position).toBe(380);
    expect(boxOf(out.objects, "t1").width).toBe(360);
  });

  it("leaves the height alone - Y was not asked to grow", () => {
    const out = run({
      objects: [text("t1", 20, 40, 100, 20, { x: { mode: "unbounded", growthGuideId: "right" }, y: { mode: "fixed" } })],
      measurements: { t1: needs(360, 300) },
      guides: [RIGHT],
    });

    expect(boxOf(out.objects, "t1").height).toBe(20);
    expect(out.diagnostics.join(" ")).toContain("t1");
  });

  it("reports a field that could not be given the width it needs", () => {
    const capped: LayoutGuide = { ...RIGHT, maxDisplacement: 50 };
    const out = run({
      objects: [text("t1", 20, 40, 100, 20, { x: { mode: "unbounded", growthGuideId: "right" }, y: { mode: "fixed" } })],
      measurements: { t1: needs(360, 18) },
      guides: [capped],
    });

    // 20 + 100 = 120 is the most the boundary can offer.
    expect(out.guides[0]!.position).toBe(350);
    expect(boxOf(out.objects, "t1").width).toBe(330);
    expect(out.diagnostics.join(" ")).toContain("t1");
  });

  it("respects a bounded X policy", () => {
    const out = run({
      objects: [text("t1", 20, 40, 100, 20, { x: { mode: "bounded", maxGrowth: 60, growthGuideId: "right" }, y: { mode: "fixed" } })],
      measurements: { t1: needs(360, 18) },
      guides: [RIGHT],
    });

    expect(boxOf(out.objects, "t1").width).toBe(160);
    expect(out.guides[0]!.position).toBe(300);
  });
});

/* 14.1 item 7 */ describe("left and right edges attach to a vertical guide", () => {
  const att = (edge: "left" | "right", behavior: "move" | "stretch"): GuideAttachment =>
    ({ id: `att-${edge}`, objectId: "r1", edge, guideId: "right", behavior });

  it("stretches a right edge onto the moved boundary", () => {
    const out = run({
      objects: [
        rect("r1", 20, 40, 100, 60),
        text("t1", 30, 50, 100, 20, { x: { mode: "unbounded", growthGuideId: "right" }, y: { mode: "fixed" } }),
      ],
      measurements: { t1: needs(360, 18) },
      guides: [RIGHT],
      attachments: [att("right", "stretch")],
    });

    // r1's right edge is drawn on the guide, so the guide carries it: 120 -> 380.
    expect(boxOf(out.objects, "r1").x).toBe(20);
    expect(boxOf(out.objects, "r1").width).toBe(360);
  });

  it("moves a whole box with a left edge and keeps its size", () => {
    const out = run({
      objects: [
        rect("r1", 300, 40, 100, 60),
        text("t1", 30, 50, 100, 20, { x: { mode: "unbounded", growthGuideId: "right" }, y: { mode: "fixed" } }),
      ],
      measurements: { t1: needs(360, 18) },
      guides: [RIGHT],
      attachments: [att("left", "move")],
    });

    const moved = boxOf(out.objects, "r1");
    expect(moved.x).toBe(380);
    expect(moved.width).toBe(100);
  });

  it("leaves an unmoved guide alone", () => {
    const out = run({
      objects: [rect("r1", 20, 40, 100, 60)],
      guides: [RIGHT],
      attachments: [att("right", "stretch")],
    });

    expect(boxOf(out.objects, "r1").width).toBe(100);
  });

  it("reports an edge bound to the wrong orientation", () => {
    const horizontal: LayoutGuide = { id: "h", orientation: "horizontal", position: 100 };
    const out = run({
      objects: [rect("r1", 20, 40, 100, 60)],
      guides: [horizontal],
      attachments: [{ id: "a", objectId: "r1", edge: "right", guideId: "h", behavior: "stretch" }],
    });

    expect(out.diagnostics.join(" ")).toContain("cannot control it");
  });
});

/* 14.1 item 5 + shared-guide aggregation */ describe("a vertical guide shared by two fields", () => {
  it("moves by the greatest demand, not the sum", () => {
    const out = run({
      objects: [
        text("a", 20, 20, 100, 20, { x: { mode: "unbounded", growthGuideId: "right" }, y: { mode: "fixed" } }),
        text("b", 20, 60, 100, 20, { x: { mode: "unbounded", growthGuideId: "right" }, y: { mode: "fixed" } }),
      ],
      measurements: { a: needs(180, 18), b: needs(240, 18) },
      guides: [RIGHT],
    });

    // max(20+180, 20+240) = 260, not 460.
    expect(out.guides[0]!.position).toBe(260);
  });

  it("is stable across a second run", () => {
    const once = run({
      objects: [text("a", 20, 20, 100, 20, { x: { mode: "unbounded", growthGuideId: "right" }, y: { mode: "fixed" } })],
      measurements: { a: needs(240, 18) },
      guides: [RIGHT],
    }).guides[0]!.position;

    expect(once).toBe(260);
  });
});

/* 14.4 */ describe("document and container growth in X", () => {
  it("widens the page when growthX is expand", () => {
    const out = run({
      objects: [text("t1", 700, 40, 100, 20, { x: { mode: "unbounded" }, y: { mode: "fixed" } })],
      measurements: { t1: needs(240, 18) },
      documentPolicy: { growthX: "expand", growthY: "fixed" },
      document: { width: 800, height: 1000 },
    });

    expect(out.page.width).toBe(940);
  });

  it("reports content past a fixed page width", () => {
    const out = run({
      objects: [text("t1", 700, 40, 100, 20, { x: { mode: "unbounded" }, y: { mode: "fixed" } })],
      measurements: { t1: needs(240, 18) },
      document: { width: 800, height: 1000 },
    });

    expect(out.page.width).toBe(800);
    expect(out.diagnostics.join(" ")).toContain("wide");
  });

  it("grows a container horizontally around its declared child", () => {
    const out = run({
      objects: [
        rect("frame", 100, 40, 200, 120, {
          container: { enabled: true, growthX: "content", padding: { top: 0, right: 12, bottom: 0, left: 12 } },
        }),
        text("t1", 110, 60, 100, 20, { layoutParentId: "frame", expansion: { x: { mode: "unbounded" }, y: { mode: "fixed" } } }),
      ],
      measurements: { t1: needs(300, 18) },
    });

    // Child right edge 410 plus 12px right padding.
    expect(boxOf(out.objects, "frame").width).toBe(322);
  });

  it("leaves a container with growthX fixed at its authored width and says so", () => {
    const out = run({
      objects: [
        rect("frame", 100, 40, 200, 120, {
          container: { enabled: true, growthX: "fixed", growthY: "content", padding: { top: 0, right: 12, bottom: 0, left: 12 } },
        }),
        text("t1", 110, 60, 100, 20, { layoutParentId: "frame", expansion: { x: { mode: "unbounded" }, y: { mode: "fixed" } } }),
      ],
      measurements: { t1: needs(300, 18) },
    });

    expect(boxOf(out.objects, "frame").width).toBe(200);
    expect(out.diagnostics.join(" ")).toContain("t1");
  });

  it("stops at the container's maxWidth", () => {
    const out = run({
      objects: [
        rect("frame", 100, 40, 200, 120, {
          container: { enabled: true, growthX: "content", growthY: "content", maxWidth: 260, padding: { top: 0, right: 0, bottom: 0, left: 0 } },
        }),
        text("t1", 110, 60, 100, 20, { layoutParentId: "frame", expansion: { x: { mode: "unbounded" }, y: { mode: "fixed" } } }),
      ],
      measurements: { t1: needs(300, 18) },
    });

    expect(boxOf(out.objects, "frame").width).toBe(260);
  });
});
```

- [ ] **Step 2: Run it and record which cases fail**

Run:
```bash
node node_modules/vitest/vitest.mjs run tests/layoutXAxis.test.ts --reporter=verbose
```
Expected: most pass (the solver is written symmetrically). **Any failure is a real defect** — record it, do not adjust the expectation to match the output. In particular a failure of "respects a bounded X policy" means the cap is not applied on X, and a failure of "reports an edge bound to the wrong orientation" means the guard is missing.

- [ ] **Step 3: Fix each defect the suite exposes, one at a time**

For a failing case, read the corresponding solver branch and fix the rule, not the test:

- Demand read on the wrong axis → `lib/render/layout.ts:388-390` must key off `g.guide.orientation`, which it already does; if a case fails, the bug is in the *link collection* at `:360-371`, where `p.x.growthGuideId` must be included.
- Cap not applied on X → `placeEdge` at `:560-561` passes `growthCap(byId.get(a.objectId)!, axis, box)`; confirm `axis` is `"x"` for a vertical guide.
- Container `growthX` not honoured → `:673` reads `policy.growthX ?? "content"`; confirm the X branch computes `far` from `cb.x + cb.width` (`:683-684`).

- [ ] **Step 4: Re-run until green**

Run:
```bash
node node_modules/vitest/vitest.mjs run tests/layoutXAxis.test.ts
```
Expected: PASS.

- [ ] **Step 5: Add the cross-axis re-measure hook the spec requires (spec §8.3, §8.4, Phase 3 step 3)**

The spec requires the height to be re-measured at the chosen final width when X growth changes wrapping. Add an optional re-measure callback to `RenderOptions` and have `renderHtml` use it for any field whose final width differs from its authored width:

In `lib/render/index.ts`, extend `RenderOptions`:

```typescript
  /**
   * Re-measure at a final width, for a field whose width the solver changed.
   *
   * Text measured at the base width is an upper bound for any wider box, so a
   * single pass is safe - but it over-reserves. A host that can measure (the
   * browser, the WebView) passes this to settle the height at the width the
   * field will actually be painted at. Returning undefined means "no better
   * number", and the base-width measurement is kept.
   */
  remeasure?: (id: string, width: number) => ContentMeasurement | undefined;
```

And after the layout pass computes `geometry`, re-solve once when a host re-measure function is present and any measured object's final width differs from its authored width by more than a pixel:

```typescript
  // One re-solve when X growth changed a field's width: the height measured at
  // the base width is an upper bound, not the painted height, and a host that
  // can measure at the final width should be asked (spec 8.3). Bounded to a
  // single extra pass so a pathological template cannot loop the preview.
  const widthsChanged = (final: TemplateObject[]) =>
    final.some((o) => {
      const authored = expanded.find((a) => a.id === o.id);
      return authored !== undefined && Math.abs(authored.width - o.width) > 1;
    });

  let geometry =
    layoutRules && layoutRules.mode === "variable"
      ? calculateLayout({
          objects: expanded,
          measurements: layoutMeasurements,
          guides: layoutRules.guides ?? [],
          attachments: layoutRules.attachments ?? [],
          documentPolicy: layoutRules.document ?? { growthX: "fixed", growthY: "fixed" },
          document: { width, height },
          ...(layoutRules.collision !== undefined ? { collision: layoutRules.collision } : {}),
        })
      : null;

  if (geometry && options.remeasure && widthsChanged(geometry.objects)) {
    const refined = { ...layoutMeasurements };
    for (const o of geometry.objects) {
      if (o.width === undefined) continue;
      const authored = expanded.find((a) => a.id === o.id);
      if (!authored || Math.abs(authored.width - o.width) <= 1) continue;
      const better = options.remeasure(o.id, o.width);
      if (better) refined[o.id] = better;
    }
    geometry = calculateLayout({
      objects: expanded,
      measurements: refined,
      guides: layoutRules.guides ?? [],
      attachments: layoutRules.attachments ?? [],
      documentPolicy: layoutRules.document ?? { growthX: "fixed", growthY: "fixed" },
      document: { width, height },
      ...(layoutRules.collision !== undefined ? { collision: layoutRules.collision } : {}),
    });
  }
```

Wire the host side in `app/render/RenderClient.tsx` and `lib/share/kit.ts` by passing a `remeasure` that builds a one-request plan and calls `measureDom`:

```typescript
    return renderHtml(filled, values, {
      measurements,
      remeasure: (id, width) => {
        const request = plan.find((r) => r.id === id);
        if (!request) return undefined;
        return measureDom([{ ...request, width }])[id];
      },
    });
```

Add to `tests/layoutRender.test.ts`:

```typescript
  it("re-measures a field whose width the solver changed", () => {
    const t = template(true, [
      text("t1", { x: { mode: "unbounded", growthGuideId: "g" }, y: { mode: "unbounded" } }),
      border,
    ]);

    const { objects } = renderHtml(t, { a: "a long line of text" }, {
      measurements: { t1: { naturalWidth: 400, height: 90 } },
      remeasure: () => ({ naturalWidth: 400, height: 32 }),
    });

    const field = objects.find((o) => o.id === "t1")!;
    expect(field.height).toBe(32);
  });

  it("keeps the base-width measurement when the host cannot re-measure", () => {
    const t = template(true, [
      text("t1", { x: { mode: "unbounded", growthGuideId: "g" }, y: { mode: "unbounded" } }),
      border,
    ]);

    const { objects } = renderHtml(t, { a: "a long line of text" }, {
      measurements: { t1: { naturalWidth: 400, height: 90 } },
    });

    expect(objects.find((o) => o.id === "t1")!.height).toBe(90);
  });
```

- [ ] **Step 6: Run the full suite and typecheck**

```bash
node node_modules/typescript/bin/tsc --noEmit -p tsconfig.json
node node_modules/vitest/vitest.mjs run
```
Expected: no type errors; all tests pass, including `renderGolden.test.ts` byte-identical output for legacy templates.

- [ ] **Step 7: Commit**

```bash
git add tests/layoutXAxis.test.ts lib/render/layout.ts lib/render/index.ts app/render/RenderClient.tsx lib/share/kit.ts tests/layoutRender.test.ts
git commit -m "feat: prove and wire the X axis, and re-measure when width changes wrapping"
```

---

### Task 3: Validate layout metadata when a package is opened (spec §10)

**Files:**
- Modify: `lib/package/validate.ts` (parse `template.json`, call `validateLayout`)
- Modify: `lib/package/resolve.ts` (surface layout issues to the caller)
- Modify: `lib/package/index.ts` (export `validateLayout`)
- Create: `tests/layoutPackageValidate.test.ts`

**Interfaces:**
- Consumes: `validateLayout(template) => LayoutIssue[]` (exists, `lib/package/layout.ts:33`); `resolvePackage(pkg)`.
- Produces: `validatePackage(bytes) => PackageIssue[]` that includes layout issues; `resolvePackage` result gains `issues: PackageIssue[]`.

**Why:** `validateLayout` currently has **zero production callers** — only `tools/*.ts` and `tests/*.ts` reference it. `validate.ts` checks only that `template.json` exists as an archive member (`validate.ts:462`). A `.btpkg` with a broken layout block therefore opens clean and fails later (or silently) at render time. Spec §10 and §16.11 require validation of untrusted imported JSON.

- [ ] **Step 1: Write the failing test**

Create `tests/layoutPackageValidate.test.ts`:

```typescript
import { describe, expect, it } from "vitest";

import { buildPackage } from "@/lib/package/build";
import { writePackage } from "@/lib/package/build";
import { parsePackage } from "@/lib/package/parse";
import { validatePackage } from "@/lib/package/validate";
import { TEMPLATE_VERSION, type BillTemplate } from "@/lib/template/types";

/**
 * A package that carries broken layout metadata must fail on open.
 *
 * `validateLayout` has existed since the layout feature landed, but nothing on
 * the package path called it: the archive check only confirmed that
 * `template.json` was present. So a dangling `growthGuideId` shipped inside a
 * `.btpkg` passed validation and surfaced as geometry that silently refused to
 * grow - the one failure an author cannot see from inside the app.
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

const bytes = (t: BillTemplate) => writePackage(buildPackage(t));

describe("a package with broken layout metadata is refused", () => {
  it("reports an attachment naming a guide that does not exist", () => {
    const pkg = bytes(template({
      mode: "variable",
      guides: [{ id: "g", orientation: "horizontal", position: 100 }],
      attachments: [{ id: "a", objectId: "t1", edge: "bottom", guideId: "nope", behavior: "stretch" }],
    }));

    const issues = validatePackage(new Uint8Array(pkg));

    expect(issues.some((i) => i.message.includes("nope"))).toBe(true);
  });

  it("reports an expansion bound to a guide the template never declares", () => {
    const issues = validatePackage(new Uint8Array(bytes(template({ mode: "variable" }))));

    expect(issues.some((i) => i.message.includes("ghost"))).toBe(true);
  });

  it("accepts a valid variable-layout package", () => {
    const good = template({
      mode: "variable",
      guides: [{ id: "g", orientation: "horizontal", position: 100 }],
      attachments: [{ id: "a", objectId: "t1", edge: "bottom", guideId: "g", behavior: "stretch" }],
    });

    expect(validatePackage(new Uint8Array(bytes(good)))).toEqual([]);
  });

  it("leaves a legacy package with no layout block alone", () => {
    expect(validatePackage(new Uint8Array(bytes(template())))).toEqual([]);
  });
});
```

- [ ] **Step 2: Run it — it fails because nothing validates layout yet**

```bash
node node_modules/vitest/vitest.mjs run tests/layoutPackageValidate.test.ts
```
Expected: the two "reports" cases FAIL (no issue mentions `ghost`/`nope`), the two "accepts" cases pass.

- [ ] **Step 3: Call `validateLayout` from the package validator**

In `lib/package/validate.ts`, import it and add a template-layout pass to `validatePackage`:

```typescript
import { validateLayout } from "./layout";
```

After the existing template-version check (`:428-438`), parse and validate `template.json`:

```typescript
  // Layout metadata is part of the template member, so it is validated with it.
  // A dangling guide id is otherwise invisible until render time, where it shows
  // up as geometry that silently refuses to grow.
  const templateBytes = files.get(templatePath);
  if (templateBytes) {
    try {
      const parsed = JSON.parse(new TextDecoder().decode(templateBytes)) as unknown;
      for (const issue of validateLayout(parsed as never)) {
        issues.push({
          path: `template.json.layout`,
          severity: issue.severity,
          message: `${issue.path}: ${issue.message}`,
        });
      }
    } catch {
      // A template member that is not JSON is reported by the existing
      // template checks; this pass only adds layout issues on top.
    }
  }
```

Match the exact `PackageIssue` field names already used in `lib/package/validate.ts` (read the existing `issue(...)` helper at `:72-74` first and reuse it rather than pushing raw objects).

- [ ] **Step 4: Re-export `validateLayout` so hosts and the editor can use it**

In `lib/package/index.ts`, add `export { validateLayout } from "./layout";` alongside the existing exports.

- [ ] **Step 5: Run the tests**

```bash
node node_modules/vitest/vitest.mjs run tests/layoutPackageValidate.test.ts tests/packageValidate.test.ts tests/packageRoundTrip.test.ts
```
Expected: PASS — and no existing package test regresses, because a template with no `layout` key produces no issues (`lib/package/layout.ts:41`).

- [ ] **Step 6: Commit**

```bash
git add lib/package/validate.ts lib/package/index.ts tests/layoutPackageValidate.test.ts
git commit -m "feat: validate layout metadata when a package is opened"
```

---

### Task 4: Container padding and size limits in the editor (spec §9.4)

**Files:**
- Modify: `components/editor/LayoutPanel.tsx` (`HierarchySection`, around lines 85-194)
- Modify: `tests/layoutHierarchy.test.ts` (add container geometry cases)
- Modify: `lib/canvas/EditorController.ts:2690` (`setContainer`) — verify it accepts a full policy

**Interfaces:**
- Consumes: `controller.setContainer(objectId, container | undefined, label)`; `ContainerPolicy` from `@/lib/template/types`.
- Produces: editable `container.padding.{top,right,bottom,left}`, `minWidth`/`minHeight`/`maxWidth`/`maxHeight` fields.

**Why:** The solver honours padding and min/max (`lib/render/layout.ts:654-659`, `:679-684`), validation checks them (`lib/package/layout.ts:276-307`) and serialisation preserves them (`lib/template/serialize.ts:220`) — but no designer can set any of it, because `LayoutPanel` has no field for them (only a pass-through merge at `:108-112`). Spec §9.4 lists padding/insets and minimum/maximum size as required container properties.

- [ ] **Step 1: Write the failing geometry test**

Append to `tests/layoutHierarchy.test.ts`:

```typescript
describe("container padding and size limits", () => {
  it("leaves room for the configured right padding", () => {
    const out = run({
      objects: [
        rect("frame", 100, 40, 200, 120, {
          container: { enabled: true, growthX: "content", growthY: "content", padding: { top: 4, right: 20, bottom: 4, left: 8 } },
        }),
        text("t1", 108, 44, 100, 20, { layoutParentId: "frame", expansion: { x: { mode: "unbounded" }, y: { mode: "unbounded" } } }),
      ],
      measurements: { t1: needs(300, 120) },
    });

    // Child bottom 164 + 4px bottom padding.
    expect(boxOf(out.objects, "frame").height).toBe(128);
    // Child right 408 + 20px right padding.
    expect(boxOf(out.objects, "frame").width).toBe(328);
  });

  it("never shrinks below the configured minimum size", () => {
    const out = run({
      objects: [
        rect("frame", 100, 40, 40, 40, {
          container: { enabled: true, growthX: "content", growthY: "content", minWidth: 260, minHeight: 180 },
        }),
        text("t1", 108, 44, 20, 20, { layoutParentId: "frame" }),
      ],
    });

    expect(boxOf(out.objects, "frame").width).toBe(260);
    expect(boxOf(out.objects, "frame").height).toBe(180);
  });
});
```

- [ ] **Step 2: Run it**

```bash
node node_modules/vitest/vitest.mjs run tests/layoutHierarchy.test.ts
```
Expected: PASS if the solver honours padding and min size (it should — this pins existing behaviour before the UI lands). If a case fails, the solver ignores that part of `ContainerPolicy`; fix `lib/render/layout.ts:654-684`.

- [ ] **Step 3: Add the editor controls**

In `HierarchySection` (`components/editor/LayoutPanel.tsx`), render padding and size fields only when the container is enabled. Add a helper that writes one container field while preserving the rest:

```typescript
  const patchContainer = (patch: Partial<ContainerPolicy>, label: string) => {
    const current = container ?? { enabled: true };
    controller.setContainer(objectId, { ...current, ...patch }, label);
  };

  const numberOrNull = (v: number | null) => (Number.isFinite(v) && v >= 0 ? v : undefined);
```

Then, after the existing container growth selects, add:

```tsx
        {enabled ? (
          <div className="space-y-1 border-t border-neutral-100 pt-2">
            <p className="text-[11px] font-semibold text-neutral-500">Inside padding (px)</p>
            <div className="grid grid-cols-2 gap-2">
              {(["top", "right", "bottom", "left"] as const).map((side) => (
                <NumberInput
                  key={side}
                  value={container?.padding?.[side] ?? 0}
                  onChange={(v) =>
                    patchContainer(
                      {
                        padding: {
                          top: container?.padding?.top ?? 0,
                          right: container?.padding?.right ?? 0,
                          bottom: container?.padding?.bottom ?? 0,
                          left: container?.padding?.left ?? 0,
                          [side]: Math.max(0, Number.isFinite(v) ? v : 0),
                        },
                      },
                      "Container padding",
                    )
                  }
                />
              ))}
            </div>
            <div className="grid grid-cols-2 gap-2">
              <Field label="Minimum width">
                <NumberInput
                  value={container?.minWidth ?? Number.NaN}
                  onChange={(v) => patchContainer({ minWidth: numberOrNull(v) }, "Container minimum")}
                />
              </Field>
              <Field label="Minimum height">
                <NumberInput
                  value={container?.minHeight ?? Number.NaN}
                  onChange={(v) => patchContainer({ minHeight: numberOrNull(v) }, "Container minimum")}
                />
              </Field>
              <Field label="Maximum width">
                <NumberInput
                  value={container?.maxWidth ?? Number.NaN}
                  onChange={(v) => patchContainer({ maxWidth: numberOrNull(v) }, "Container maximum")}
                />
              </Field>
              <Field label="Maximum height">
                <NumberInput
                  value={container?.maxHeight ?? Number.NaN}
                  onChange={(v) => patchContainer({ maxHeight: numberOrNull(v) }, "Container maximum")}
                />
              </Field>
            </div>
          </div>
        ) : null}
```

Add `ContainerPolicy` to the existing type import at the top of the file. Label the four padding inputs so the grid is readable (`top`, `right`, `bottom`, `left` shown as placeholder text).

- [ ] **Step 4: Verify the round trip keeps the new fields**

Extend `tests/layoutPersistence.test.ts`'s container case to assert that `padding`, `minWidth` and `maxWidth` all survive `serialiseObjects`:

```typescript
    expect((t.objects[0] as { container?: unknown }).container).toEqual(expansionValue.container);
```

where `expansionValue.container` is `{ enabled: true, growthX: "content", growthY: "content", padding: { top: 4, right: 20, bottom: 4, left: 8 }, minWidth: 100, maxWidth: 400 }`.

- [ ] **Step 5: Run tests, typecheck and lint**

```bash
node node_modules/vitest/vitest.mjs run tests/layoutHierarchy.test.ts tests/layoutPersistence.test.ts
node node_modules/typescript/bin/tsc --noEmit -p tsconfig.json
node node_modules/eslint/bin/eslint.js components/editor/LayoutPanel.tsx
```
Expected: PASS, no type errors, no lint errors.

- [ ] **Step 6: Commit**

```bash
git add components/editor/LayoutPanel.tsx tests/layoutHierarchy.test.ts tests/layoutPersistence.test.ts
git commit -m "feat: author container padding and size limits in the editor"
```

---

### Task 5: Cover the untested anchor and collision rules (spec §5.4, §5.5, §14.2)

**Files:**
- Modify: `tests/layoutHierarchy.test.ts` (add stretch + horizontal axis + collision cases)

**Interfaces:**
- Consumes: `calculateLayout(input)` with `anchor` on children and `collision` on the input.
- Produces: evidence for `stretch` anchors, horizontal anchors, and per-axis overflow reporting.

**Why:** Only `start`/`end` on the **vertical** axis are tested. `stretch` (`lib/render/layout.ts:714-718`, `:723-727`) and the entire **horizontal** axis (`:720-728`) are untested, so a regression in half the anchor implementation would pass the suite.

- [ ] **Step 1: Add the anchor cases**

Append to `tests/layoutHierarchy.test.ts`:

```typescript
describe("anchors on both axes", () => {
  const frame = (extra: Record<string, unknown> = {}) =>
    rect("frame", 100, 40, 200, 120, { container: { enabled: true, growthX: "content", growthY: "content" }, ...extra });

  it("stretch keeps both insets as the parent grows", () => {
    const out = run({
      objects: [
        frame(),
        text("t1", 110, 50, 100, 20, { layoutParentId: "frame", expansion: { x: { mode: "unbounded" }, y: { mode: "unbounded" } } }),
        rect("band", 110, 70, 180, 40, {
          layoutParentId: "frame",
          anchor: { vertical: "stretch", horizontal: "stretch", topOffset: 0, bottomOffset: 0, leftOffset: 0, rightOffset: 0 },
        }),
      ],
      measurements: { t1: needs(100, 120) },
    });

    const f = boxOf(out.objects, "frame");
    const band = boxOf(out.objects, "band");
    expect(band.y).toBeCloseTo(70, 5);
    expect(band.y + band.height).toBeCloseTo(f.y + f.height, 5);
    expect(band.x + band.width).toBeCloseTo(f.x + f.width, 5);
  });

  it("an end-anchored label keeps its distance from the right edge", () => {
    const out = run({
      objects: [
        frame(),
        text("t1", 110, 50, 100, 20, { layoutParentId: "frame", expansion: { x: { mode: "unbounded" }, y: { mode: "fixed" } } }),
        rect("label", 180, 140, 100, 20, {
          layoutParentId: "frame",
          anchor: { horizontal: "end", vertical: "start", rightOffset: 20 },
        }),
      ],
      measurements: { t1: needs(300, 18) },
    });

    const f = boxOf(out.objects, "frame");
    const label = boxOf(out.objects, "label");
    expect(f.x + f.width - (label.x + label.width)).toBeCloseTo(20, 5);
  });

  it("a start-anchored sibling does not move when the parent grows", () => {
    const out = run({
      objects: [
        frame(),
        text("t1", 110, 50, 100, 20, { layoutParentId: "frame", expansion: { x: { mode: "fixed" }, y: { mode: "unbounded" } } }),
        rect("label", 110, 70, 100, 20, { layoutParentId: "frame", anchor: { vertical: "start" } }),
      ],
      measurements: { t1: needs(100, 120) },
    });

    expect(boxOf(out.objects, "label").y).toBeCloseTo(70, 5);
  });

  it("reports a fixed frame overflowing on the axis that did not grow", () => {
    const out = run({
      objects: [
        rect("frame", 100, 40, 200, 120, {
          container: { enabled: true, growthX: "content", growthY: "fixed", padding: { top: 0, right: 0, bottom: 0, left: 0 } },
        }),
        text("t1", 110, 50, 100, 20, { layoutParentId: "frame", expansion: { x: { mode: "unbounded" }, y: { mode: "unbounded" } } }),
      ],
      measurements: { t1: needs(300, 200) },
    });

    // X grew (reported by the width), Y stayed fixed and must be reported too.
    expect(boxOf(out.objects, "frame").width).toBe(310);
    expect(out.diagnostics.join(" ")).toContain("t1");
  });
});
```

- [ ] **Step 2: Run and fix only real defects**

```bash
node node_modules/vitest\vitest.mjs run tests/layoutHierarchy.test.ts
```
Expected: PASS. A failure in the `stretch` case means `lib/render/layout.ts:714-727` computes insets from the wrong base; a failure in the `end`-anchored horizontal case means `:720-722` is untested code with a bug.

- [ ] **Step 3: Commit**

```bash
git add tests/layoutHierarchy.test.ts
git commit -m "test: cover stretch and horizontal anchors, and per-axis overflow"
```

---

### Task 6: Prove the authoring surface and a vertical guide in the browser (spec §9, Phase 4)

**Files:**
- Create: `tests/layoutEditorSurface.test.ts`
- Create: `e2e/layout-guides.spec.ts`

**Interfaces:**
- Consumes: `EditorController.setLayoutParent/setAnchor/setContainer/setExpansion/setAttachment/addGuide` (private — reach `addGuide` through the mouse handler or expose it), `undo`/`redo`, `getTemplate`/`loadTemplate`.
- Produces: evidence that layout edits reach `getTemplate()`, survive undo/redo, and that a vertical guide drawn in the editor reaches a render.

**Why:** Spec Phase 4 exit gate is "Designer can create the complete scenario from the UI, save it, reopen it, and get the same layout." Today **no test** touches `EditorController` at all, and no e2e test draws a guide of either orientation or touches a single LayoutPanel control.

- [ ] **Step 1: Write the controller round-trip test**

Create `tests/layoutEditorSurface.test.ts`. Instantiate the controller the way `hooks/useEditorController.ts` does, and assert that each setter lands in `getTemplate()`:

```typescript
import { describe, expect, it } from "vitest";

import { EditorController } from "@/lib/canvas/EditorController";
import type { LayoutConfig } from "@/lib/template/types";

/**
 * The authoring surface, exercised where the author actually works.
 *
 * Every layout fact reaches the renderer by two hops - the setter writes onto a
 * Fabric object or into controller state, and `getTemplate` serialises it. A
 * setter that writes the wrong key, or a save that drops the layout block, is
 * invisible to the solver's unit tests and to the whole render pipeline.
 */

const controller = () => new EditorController();

describe("layout edits reach the saved template", () => {
  it("carries an expansion policy and its guide", () => {
    const c = controller();
    c.setExpansion("f1", { x: { mode: "fixed" }, y: { mode: "unbounded", strategy: "wrap", growthGuideId: "guide-1" } });

    expect((c.getTemplate().objects.find((o) => o.id === "f1") as { expansion?: unknown })?.expansion).toMatchObject({
      y: { mode: "unbounded", growthGuideId: "guide-1" },
    });
  });

  it("carries a layout parent, an anchor and a container policy", () => {
    const c = controller();
    c.setLayoutParent("child", "frame");
    c.setAnchor("child", { vertical: "end", bottomOffset: 12 });
    c.setContainer("frame", { enabled: true, growthY: "content", padding: { top: 4, right: 4, bottom: 4, left: 4 } });

    const t = c.getTemplate();
    expect((t.objects.find((o) => o.id === "child") as { layoutParentId?: string })?.layoutParentId).toBe("frame");
    expect((t.objects.find((o) => o.id === "child") as { anchor?: unknown })?.anchor).toMatchObject({ vertical: "end" });
    expect((t.objects.find((o) => o.id === "frame") as { container?: unknown })?.container).toMatchObject({ enabled: true });
  });

  it("undoes and redoes a layout edit", () => {
    const c = controller();
    const before = JSON.stringify(c.getTemplate().layout ?? null);

    c.updateLayout((l: LayoutConfig | undefined) => ({ ...(l ?? { mode: "variable" }), collision: "allow" }) as LayoutConfig, "Collision");
    expect(c.getTemplate().layout?.collision).toBe("allow");

    c.undo();
    expect(JSON.stringify(c.getTemplate().layout ?? null)).toBe(before);

    c.redo();
    expect(c.getTemplate().layout?.collision).toBe("allow");
  });
});
```

If `EditorController` cannot be constructed without a DOM/canvas in the vitest environment, set `// @vitest-environment jsdom` at the top of the file and stub `canvas` via the existing factory in `lib/canvas/fabricSetup.ts`; read `hooks/useEditorController.ts` for the real construction sequence and mirror it.

- [ ] **Step 2: Run and fix the harness until the three cases execute**

```bash
node node_modules/vitest/vitest.mjs run tests/layoutEditorSurface.test.ts
```
Expected: PASS. Do not weaken an assertion to make the harness work — fix the setup.

- [ ] **Step 3: Write the vertical-guide browser test**

Create `e2e/layout-guides.spec.ts`, modelled on `e2e/variable-layout.spec.ts` (load `public/billkit.js`, drive `measurePlan → measure → render`):

```typescript
import { expect, test } from "@playwright/test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const ROOT = resolve(__dirname, "..");
const BUNDLE = readFileSync(resolve(ROOT, "public", "billkit.js"), "utf8");

/**
 * A vertical guide, end to end.
 *
 * Spec 5.8 and 14.1 make the vertical guide part of the feature rather than a
 * later phase, and every existing end-to-end path draws horizontal ones only.
 * The template below is built here rather than committed so the two guide
 * orientations cannot drift apart unnoticed.
 */
const TEMPLATE = JSON.stringify({
  templateVersion: 2,
  document: { width: 800, height: 600 },
  meta: { name: "x-axis", modifiedAt: "" },
  objects: [
    { id: "frame", type: "rect", name: "frame", role: null, x: 40, y: 40, width: 200, height: 120,
      rotation: 0, opacity: 1, visible: true, locked: false, zIndex: 0, parentId: null,
      stroke: "#000000", strokeWidth: 1, fill: "transparent", cornerRadius: 0,
      container: { enabled: true, growthX: "content", growthY: "fixed",
        padding: { top: 8, right: 8, bottom: 8, left: 8 } } },
    { id: "right", type: "rect", name: "right", role: null, x: 300, y: 40, width: 120, height: 60,
      rotation: 0, opacity: 1, visible: true, locked: false, zIndex: 1, parentId: null,
      stroke: "#000000", strokeWidth: 1, fill: "transparent", cornerRadius: 0 },
    { id: "t1", type: "text", name: "company", role: null, x: 50, y: 60, width: 180, height: 20,
      rotation: 0, opacity: 1, visible: true, locked: false, zIndex: 2, parentId: null,
      stroke: "", strokeWidth: 0, fill: "#000000", text: "{{company}}", fontFamily: "Arial", fontSize: 14,
      fontWeight: "normal", fontStyle: "normal", textAlign: "left", lineHeight: 1.16, charSpacing: 0,
      roleKind: "variable", textVerticalAlign: "top", layoutParentId: "frame",
      expansion: { x: { mode: "unbounded", growthGuideId: "right-edge" }, y: { mode: "fixed" } } },
  ],
  layout: {
    mode: "variable",
    document: { growthX: "expand", growthY: "fixed" },
    guides: [{ id: "right-edge", orientation: "vertical", position: 320 }],
    attachments: [{ id: "att-right", objectId: "right", edge: "left", guideId: "right-edge", behavior: "move" }],
  },
});

const COMPANY = "A company name long enough to have to widen its field before it fits";

test("a vertical guide carries an X-growing field and the objects attached to it", async ({ page }) => {
  await page.goto("about:blank");

  const result = await page.evaluate(
    ({ bundle, template, values }) => {
      (window as unknown as { eval: (s: string) => void }).eval(bundle);
      const api = (window as unknown as {
        billkit: {
          measurePlan: (...a: string[]) => Array<{ id: string }>;
          measure: (plan: unknown[]) => Record<string, { naturalWidth: number; height: number }>;
          render: (...a: string[]) => { html: string; page: { width: number; height: number }; warnings: string[] };
        };
      }).billkit;
      const valuesJson = JSON.stringify(values);
      const plan = api.measurePlan(template, valuesJson);
      const measured = api.measure(plan);
      const rendered = api.render(template, valuesJson, "[]", JSON.stringify(measured));
      return { measured, page: rendered.page, warnings: rendered.warnings, html: rendered.html };
    },
    { bundle: BUNDLE, template: TEMPLATE, values: { company: COMPANY } },
  );

  const styleOf = (id: string) => {
    const re = new RegExp(`<div class="o" id="${id}" style="([^"]*)"`);
    return re.exec(result.html)?.[1] ?? "";
  };

  // The field measured wider than its box, so the boundary moved right.
  expect(result.measured["t1"]!.naturalWidth).toBeGreaterThan(180);

  // The box to the right of the guide follows it, keeping its size.
  expect(styleOf("right")).toContain(`left: ${Math.max(320, 0)}px`);
  expect(styleOf("right")).toContain("width: 120px");

  // The page widened because its own policy says expand.
  expect(result.page.width).toBeGreaterThan(800);
  expect(result.warnings).toEqual([]);
});
```

- [ ] **Step 4: Run it and fix only real defects**

The dev server already runs on `http://127.0.0.1:3000`, so run Playwright with a config that reuses it rather than starting a second Next server:

```bash
node node_modules/playwright/cli.js test --config=playwright.config.ts e2e/layout-guides.spec.ts
```
If that fails with "Another next dev server is already running", create a temporary `playwright.tmp.config.ts` identical to `playwright.config.ts` but with `use.baseURL: "http://127.0.0.1:3000"` and `webServer: { command: "node -e \"setTimeout(()=>{},120000)\"", url: "http://127.0.0.1:3000", reuseExistingServer: true }`, run with `--config=playwright.tmp.config.ts`, then delete the temporary file. Never kill the user's running dev server.

Expected: PASS. A failure on the `left:` assertion means `move` on a vertical guide's `left` edge is broken; a failure on `warnings` means a spurious diagnostic was emitted.

- [ ] **Step 5: Commit**

```bash
git add tests/layoutEditorSurface.test.ts e2e/layout-guides.spec.ts
git commit -m "test: cover the layout authoring surface and a vertical guide end to end"
```

---

### Task 7: Rebuild bundles, full verification, and a status note in the spec

**Files:**
- Modify: `public/billkit.js`, `public/sharekit.js` (built artefacts)
- Modify: `docs/New_Expandable.md` (append a "Current status" section)

**Interfaces:**
- Consumes: everything above.
- Produces: bundles that match `lib/`, and a spec document whose status matches reality.

**Why:** Every host runs the **bundle**, not `lib/`. This feature's own bug report started with a stale `public/billkit.js` while the unit suite was green. Spec §15 requires "Tests/builds were actually run and results are accurately reported", and guardrail §16.13 forbids claiming print correctness from preview alone.

- [ ] **Step 1: Rebuild both runtime bundles**

```bash
node node_modules/esbuild/bin/esbuild lib/billkit/main.ts --bundle --minify --format=iife --target=es2019 --outfile=public/billkit.js
node node_modules/esbuild/bin/esbuild lib/share/main.ts --bundle --minify --format=iife --target=es2019 --outfile=public/sharekit.js
```
Expected: `public/billkit.js` and `public/sharekit.js` rewritten.

- [ ] **Step 2: Confirm the freshness guard sees the new solver**

```bash
node node_modules/vitest/vitest.mjs run tests/bundleFreshness.test.ts
```
Expected: PASS.

- [ ] **Step 3: Run every check the repository has**

```bash
node node_modules/typescript/bin/tsc --noEmit -p tsconfig.json
node node_modules/eslint/bin/eslint.js .
node node_modules/vitest/vitest.mjs run
node node_modules/playwright/cli.js test --config=playwright.config.ts
```
Record the actual numbers. Do not report a count from memory.

- [ ] **Step 4: Append an honest status section to the spec**

Append to `docs/New_Expandable.md`:

```markdown
## 17. Implementation status (2026-10-15)

Audited against this document by running the repository's own checks. Present,
with evidence:

- Per-axis expansion, both guide orientations, guide caps, attachments
  (`move`/`stretch`), explicit containers (`container.enabled` + `layoutParentId`),
  child anchors (`start`/`end`/`stretch`), sibling collision reporting, document
  growth, variable repeat-row heights, and the `Variable_Test.json` fixture.
- Evidence: `tests/layout.test.ts`, `tests/layoutXAxis.test.ts`,
  `tests/layoutHierarchy.test.ts`, `tests/layoutValidate.test.ts`,
  `tests/layoutPackageValidate.test.ts`, `tests/layoutEditorSurface.test.ts`,
  `tests/variableLayoutBill.test.ts`, `tests/rowHeightsRender.test.ts`,
  `e2e/variable-layout.spec.ts`, `e2e/layout-guides.spec.ts`.

Deliberately not implemented:

- **Pagination** (spec 1.5/8.9). Deferred; the renderer has no page model.
- **Automatic collision resolution.** Only `report` (default) and `allow` exist;
  the solver never pushes a sibling.
- **Font-load timing.** Measurement is synchronous; a web font that has not
  finished loading is measured with the fallback face.
- **Android.** This repository has no `Android/` module. WebView rendering,
  printing and the Android DTOs are verified in the separate pipeline repository.
- **Horizontal re-measure budget.** X growth re-solves once; it is not a general
  iteration loop.

Every render starts from authored geometry; no accumulated drift.
```

- [ ] **Step 5: Commit**

```bash
git add public/billkit.js public/sharekit.js docs/New_Expandable.md
git commit -m "build: regenerate the runtime bundles and record feature status"
```

---

## Verification

After all seven tasks:

1. `node node_modules/typescript/bin/tsc --noEmit -p tsconfig.json` — clean.
2. `node node_modules/eslint/bin/eslint.js .` — clean.
3. `node node_modules/vitest/vitest.mjs run` — all pass, count recorded from the run.
4. `node node_modules/playwright/cli.js test --config=playwright.config.ts` — all pass, including the new vertical-guide spec.
5. `tests/renderGolden.test.ts` still passes, proving a legacy `templateVersion: 2` template renders byte-identically.
6. `tests/bundleFreshness.test.ts` passes, proving the shipped bundles contain the current solver.

## Out of Scope

- Pagination.
- Automatic sibling displacement on collision.
- Multi-select layout editing in `MultiSelectPanel` (LayoutPanel mounts only for single selection).
- Any Android change (different repository).
- Renaming `templateVersion` or bumping the `.btpkg` package version.