# Snapping Guides — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** While composing boxes and rules, give the author snappy, Instagram-style alignment: rule drawing snaps its endpoints onto nearby edges and centres, full-span splits a box in one drag, moving an object snaps its edges the same way, and a thin blue guide announces every alignment as it happens. Resizing shows guides but does not force geometry.

**Architecture:** A new pure, Fabric-free snap engine (`lib/canvas/snap.ts`) plus a `EditorState.snaps` list that `CanvasStage` paints as a hairline overlay. The rule-drawing, move and object:scaling handlers call the engine. Serialise/hydrate/render, groups and text-wrap are untouched.

**Tech Stack:** Next.js 16 (App Router, Turbopack), React 19, TypeScript strict, Fabric.js 7.4, Vitest (node), Playwright, Tailwind.

**Spec:** `docs/superpowers/specs/2026-10-05-snapping-guides-design.md`

## Global Constraints

- Windows PowerShell. `npm.cmd` / `npx.cmd`; bare `npm`/`npx` fail.
- E2E: `$env:PORT="3000"; npx.cmd playwright test`.
- Gate: `npx.cmd tsc --noEmit`, `npm.cmd test`, `npm.cmd run lint`, `$env:PORT="3000"; npx.cmd playwright test`, `npm.cmd run build` — all clean.
- Baseline: **317 unit tests, 60 E2E tests**, tsc/lint/build clean. Must not regress.
- `lib/canvas/snap.ts` is Fabric-free like `lib/canvas/groups.ts`, so it is testable in the node environment.
- `BillTable` is a snap *target* only — its resize path (table column widths) is never snapped.
- Alt is already centred-scale; it is not a snap modifier.
- Do not commit unless asked.

---

### Task 1: Snap engine (pure)

**Files:**
- Create: `lib/canvas/snap.ts`
- Create: `tests/snap.test.ts`

**Interface:**
```ts
export interface Levels {
  x: number[]; // vertical levels
  y: number[]; // horizontal levels
}

export interface SnapLine {
  axis: "x" | "y";
  pos: number;
}

export interface Edges {
  left: number; centreX: number; right: number;
  top: number; centreY: number; bottom: number;
}

export function levelsFromBounds(bounds: Array<{left:number;top:number;right:number;bottom:number}>): Levels;
export function snapToLevels(edges: Edges, levels: Levels, tolerance: number): { dx: number; dy: number; guides: SnapLine[] };
```

- [ ] **Step 1: Write failing tests**

`tests/snap.test.ts`:
```ts
import { describe, expect, it } from "vitest";
import { levelsFromBounds, snapToLevels, type Levels } from "@/lib/canvas/snap";

const levels = (x: number[], y: number[]): Levels => ({ x, y });

describe("levelsFromBounds", () => {
  it("emits edges and centres on both axes", () => {
    const l = levelsFromBounds([{ left: 0, top: 0, right: 100, bottom: 40 }]);
    expect(l.x).toEqual([0, 50, 100]);
    expect(l.y).toEqual([0, 20, 40]);
  });
});

describe("snapToLevels", () => {
  const tolerance = 5;
  it("snaps the left edge to a nearby vertical level", () => {
    const edges = { left: 101, centreX: 141, right: 181, top: 0, centreY: 9, bottom: 18 };
    const r = snapToLevels(edges, levels([100], []), tolerance);
    expect(r.dx).toBe(-1);
    expect(r.guides).toEqual([{ axis: "x", pos: 100 }]);
  });
  it("Snaps to whichever of the three x edges is closest to a level", () => {
    const edges = { left: 0, centreX: 48, right: 97, top: 0, centreY: 0, bottom: 0 };
    const r = snapToLevels(edges, levels([100], []), tolerance);
    expect(r.dx).toBe(3); // right edge 97 -> 100
    expect(r.guides).toEqual([{ axis: "x", pos: 100 }]);
  });
  it("snaps an edge and a centre can both snap on one axis -> one best guide", () => {
    const edges = { left: 99, centreX: 100, right: 101, top: 0, centreY: 0, bottom: 0 };
    const r = snapToLevels(edges, levels([100], []), tolerance);
    // centre snap (dx 0) and left/right snap all within tolerance: pick the one
    // that maximises the match, then report the level once.
    expect(r.dx).toBe(0);
    expect(r.guides).toEqual([{ axis: "x", pos: 100 }]);
  });
  it("produces no offset beyond tolerance", () => {
    const edges = { left: 120, centreX: 150, right: 180, top: 0, centreY: 0, bottom: 0 };
    const r = snapToLevels(edges, levels([100], []), tolerance);
    expect(r.dx).toBe(0);
    expect(r.guides).toEqual([]);
  });
  it("allows a corner to snap on both axes at once", () => {
    const edges = { left: 101, centreX: 141, right: 181, top: 21, centreY: 30, bottom: 39 };
    const r = snapToLevels(edges, levels([100], [20]), tolerance);
    expect(r.dx).toBe(-1);
    expect(r.dy).toBe(-1);
    expect(r.guides).toEqual(
      expect.arrayContaining([{ axis: "x", pos: 100 }, { axis: "y", pos: 20 }]),
    );
  });
  it("no candidates -> no offset and no guides", () => {
    const edges = { left: 0, centreX: 0, right: 0, top: 0, centreY: 0, bottom: 0 };
    const r = snapToLevels(edges, levels([], []), tolerance);
    expect(r.dx).toBe(0);
    expect(r.dy).toBe(0);
    expect(r.guides).toEqual([]);
  });
});
```

- [ ] **Step 2: Run, verify it fails**

`npm.cmd test -- snap` → cannot find module.

- [ ] **Step 3: Implement**

`lib/canvas/snap.ts`:
```ts
/**
 * Snapping engine for the editor. Pure and Fabric-free, so it is exercised in
 * the node test environment like `lib/canvas/groups.ts`.
 *
 * The engine never touches geometry: it answers "how far is the moving object
 * from every candidate edge on each axis, and which single level on that axis
 * is the nearest to a moving edge, within tolerance?". The caller applies the
 * correction and shows the returned guides.
 */

export interface Levels {
  x: number[]; // vertical levels in scene coordinates
  y: number[]; // horizontal levels
}

export interface SnapLine {
  // 'y' = a horizontal guide drawn at this scene y; 'x' = vertical at this x.
  axis: "x" | "y";
  pos: number;
}

export interface Edges {
  left: number;
  centreX: number;
  right: number;
  top: number;
  centreY: number;
  bottom: number;
}

/** All centres and edges of each rect, as vertical/horizontal candidate levels. */
export function levelsFromBounds(
  bounds: Array<{ left: number; top: number; right: number; bottom: number }>,
): Levels {
  const x: number[] = [];
  const y: number[] = [];
  for (const b of bounds) {
    x.push(b.left, (b.left + b.right) / 2, b.right);
    y.push(b.top, (b.top + b.bottom) / 2, b.bottom);
  }
  return { x, y };
}

/**
 * Choose, on each axis, the level that a moving edge/centre is closest to. The
 * reported offset moves every edge by the same amount so the whole edge row
 * lands on that level; independently per axis.
 */
export function snapToLevels(
  edges: Edges,
  levels: Levels,
  tolerance: number,
): { dx: number; dy: number; guides: SnapLine[] } {
  const bestX = pickAxisSegments(
    [edges.left, edges.centreX, edges.right],
    levels.x,
    tolerance,
  );
  const bestY = pickAxisSegments(
    [edges.top, edges.centreY, edges.bottom],
    levels.y,
    tolerance,
  );
  const guides: SnapLine[] = [];
  if (bestX) {
    guides.push({ axis: "x", pos: bestX.level });
  }
  if (bestY) {
    guides.push({ axis: "y", pos: bestY.level });
  }
  return {
    dx: bestX ? bestX.delta : 0,
    dy: bestY ? bestY.delta : 0,
    guides,
  };
}

interface Best {
  level: number;
  delta: number;
}

/**
 * Among candidate levels, pick the one that any of the moving segments aligns
 * with by the smallest distance. A level can be matched by more than one
 * segment (e.g. a square corner matches both the left edge and the top edge);
 * the smallest absolute delta wins, and that level is reported once.
 */
function pickAxisSegments(
  moving: number[],
  candidates: number[],
  tolerance: number,
): Best | null {
  let best: Best | null = null;
  for (const m of moving) {
    for (const c of candidates) {
      const delta = c - m;
      if (Math.abs(delta) > tolerance) continue;
      if (!best || Math.abs(delta) < Math.abs(best.delta)) {
        best = { level: c, delta };
      }
    }
  }
  return best;
}
```

- [ ] **Step 4: Run, verify they pass**

`npm.cmd test -- snap` → PASS, 7 tests.

- [ ] **Step 5: Commit** *(user will decide)*

```bash
git add lib/canvas/snap.ts tests/snap.test.ts
git commit -m "feat(snap): pure edge/centre snapping engine"
```

---

### Task 2: Controller snap state and move-snap, guides published

**Files:**
- Modify: `lib/canvas/EditorController.ts` — `EditorState`, initial state,
  `onObjectMoving`, mouse:move for rules, `mouse:up`, tool change, type check

**Given a canvas with objects, when the user moves an object or draws a rule,
the controller computes active snaps and publishes them in `EditorState.snaps`.**

- [ ] **Step 1: Extend the state and imports**

Import in `EditorController.ts`:
```ts
import { levelsFromBounds, snapToLevels, type Levels, type SnapLine } from "@/lib/canvas/snap";
```

`EditorState` gets:
```ts
/** Object-to-object snapping, separate from grid snapping. */
  snapToObjects: boolean;
  /** Active guide lines to paint; reset on mouse:up / tool change. */
  snaps: SnapLine[];
```
Initial state:
```ts
    snapToObjects: true,
    snaps: [],
```

- [ ] **Step 2: Collect levels for an interaction, excluding the moving/drawn object**

Add as a private method:
```ts
  private levelsForSnapTargets(exclude: FabricObject | null): Levels {
    const canvas = this.canvas;
    if (!canvas) return { x: [], y: [] };
    const boxes: Array<{ left: number; top: number; right: number; bottom: number }> = [];
    for (const o of canvas.getObjects()) {
      if (o === exclude) continue;
      const b = o.getBoundingRect();
      boxes.push({ left: b.left, top: b.top, right: b.left + b.width, bottom: b.top + b.height });
    }
    return levelsFromBounds(boxes);
  }
```

- [ ] **Step 3: Publish / clear the guides**

Add helper:
```ts
  private setSnaps(snaps: SnapLine[]): void {
    const sameLength = snaps.length === this.state.snaps.length;
    const same = sameLength && snaps.every((s, i) => s.axis === this.state.snaps[i]!.axis && s.pos === this.state.snaps[i]!.pos);
    if (same) return;
    this.setState({ snaps });
  }
```
Every place that sets `this.drawing = null` or switches tool must also `this.setSnaps([])`.

- [ ] **Step 4: Snap a rule's live endpoint while drawing**

In `updateDrawing`, for rule kinds, after computing the candidate far point, when
`state.snapToObjects` is on:

```ts
    if (ruleKind === "line" || ruleKind === "hr" || ruleKind === "vr") {
      let x2 = origin.x + dx;
      let y2 = origin.y + dy;
      if (ruleKind === "hr") y2 = origin.y;
      if (ruleKind === "vr") x2 = origin.x;

      if (this.state.snapToObjects) {
        const tol = 6 / (this.state.zoom || 1);
        // For an hr the start and end share a y; snapping that dy level, the
        // rule can still flatly cross the canvas so the level equals a
        // candidate's level rather an intersection at both endpoints. Keep it
        // simple: snap the start axis level and the far endpoint independently.
        if (ruleKind === "hr") {
          const hit = snapToLevels(
            { left: origin.x, centreX: (origin.x + x2) / 2, right: x2, top: y2, centreY: y2, bottom: y2 },
            this.levelsForSnapTargets(obj), tol,
          );
          if (hit.dy !== 0) y2 += hit.dy;
          if (hit.dx !== 0) x2 += hit.dx;
          this.setSnaps(hit.guides);
        } else if (ruleKind === "vr") {
          const hit = snapToLevels(
            { left: x2, centreX: x2, right: x2, top: origin.y, centreY: (origin.y + y2) / 2, bottom: y2 },
            this.levelsForSnapTargets(obj), tol,
          );
          if (hit.dx !== 0) x2 += hit.dx;
          if (hit.dy !== 0) y2 += hit.dy;
          this.setSnaps(hit.guides);
        } else {
          const hit = snapToLevels(
            { left: Math.min(origin.x, x2), centreX: (origin.x + x2) / 2, right: Math.max(origin.x, x2), top: Math.min(origin.y, y2), centreY: (origin.y + y2) / 2, bottom: Math.max(origin.y, y2) },
            this.levelsForSnapTargets(obj), tol,
          );
          if (hit.dx !== 0 || hit.dy !== 0) { x2 += hit.dx; y2 += hit.dy; }
          this.setSnaps(hit.guides);
        }
      }
      obj.set({ x2, y2 } as never);
      obj.setCoords();
      canvas.requestRenderAll();
      return;
    }
```

- [ ] **Step 5: Snap a dragged object on move**

In `onObjectMoving`, for every non-BillTable target when `snapToObjects` is on,
after the grid snap, snap edges to candidate levels:

```ts
    if (this.state.snapToObjects && !(target instanceof BillTable)) {
      const rect = target.getBoundingRect();
      const hit = snapToLevels(
        {
          left: rect.left, centreX: rect.left + rect.width / 2, right: rect.left + rect.width,
          top: rect.top, centreY: rect.top + rect.height / 2, bottom: rect.top + rect.height,
        },
        this.levelsForSnapTargets(target),
        6 / (this.state.zoom || 1),
      );
      if (hit.dx !== 0 || hit.dy !== 0) {
        target.set({ left: (target.left ?? 0) + hit.dx, top: (target.top ?? 0) + hit.dy } as never);
        target.setCoords();
      }
      this.setSnaps(hit.guides);
    } else {
      this.setSnaps([]);
    }
    canvas.requestRenderAll();
```

- [ ] **Step 6: Snap-guide state cleared when drawing ends**

In `onMouseUp`, after `this.commit(...)` call `this.setSnaps([])`. Also in
`setTool` add `this.setSnaps([])`.

- [ ] **Step 7: The new setting and control**

Add `setSnapToObjects(on: boolean)`:
```ts
  setSnapToObjects(on: boolean): void {
    this.setState({ snapToObjects: on });
  }
```

In `components/editor/BillEditor.tsx` GridSettingsDialog add a `Checkbox` row
(
```
<Checkbox label="Snap to objects" checked={state.snapToObjects} onChange={(v) => controller.setSnapToObjects(v)} />
```
). It renders on the same basis as the existing Snap to grid cell.

- [ ] **Step 8: Unit/E2E sanity**

Run `npm.cmd test -- groups snap` and confirm nothing regressed (drawing rules
in the existing tests must still pass because `snapToObjects` defaults on and
the rules' endpoints end up aligned within 6/zoom of nearby objects).

Run `$env:PORT="3000"; npx.cmd playwright test --grep "Wrapping|Grouping"` —
should pass unchanged because those tests do not depend on alignment.

- [ ] **Step 9: Commit**

```bash
git add lib/canvas/EditorController.ts components/editor/BillEditor.tsx
git commit -m "feat(snap): guide snap state and move/rule snapping"
```

---

### Task 3: Full-span divider when drawing inside a shape

**Files:**
- Modify: `lib/canvas/EditorController.ts` — `beginLine` / `updateDrawing` / `onMouseDown`

When the drag starts inside a `rect` or `rounded-rect`, the dominant drag axis
pins the live rule to span that shape exactly. It does not participate in the
endpoint snap-to-level computation — we know exactly where it goes.

- [ ] **Step 1: Detect the span target at mouse-down**

Add a field set on mouse-down when the tool is a rule:
```ts
  private spanTarget: FabricObject | null = null;
```
In `onMouseDown`, for `tool === "line" | "hr" | "vr"`, before `beginLine`:

```ts
      case "line":
      case "hr":
      case "vr": {
        if (this.state.snapToObjects) {
          const scene = p; // scene coordinates
          const rects = canvas.getObjects().filter((o) => {
            const at = (o as unknown as { appType?: string }).appType;
            if (at !== "rect" && at !== "rounded-rect") return false;
            const b = o.getBoundingRect();
            return scene.x >= b.left && scene.x <= b.left + b.width && scene.y >= b.top && scene.y <= b.top + b.height;
          });
          // innermost wins
          rects.sort((a, b) => {
            const ra = a.getBoundingRect();
            const rb = b.getBoundingRect();
            return ra.width * ra.height - rb.width * rb.height;
          });
          this.spanTarget = rects[0] ?? null;
        }
        this.beginLine(tool as "line" | "hr" | "vr");
        break;
      }
```

- [ ] **Step 2: Full-span from the start for the live rule**

In `updateDrawing`, at the top of the rule-kind branch, when `this.spanTarget`
exists, derive the span and ignore free x2/y2:

```ts
      if (this.spanTarget) {
        const b = this.spanTarget.getBoundingRect();
        const horizontal = Math.abs(dy) <= Math.abs(dx);
        if (ruleKind === "hr" || (ruleKind === "line" && horizontal)) {
          x2 = dx >= 0 ? b.left + b.width : b.left;
          if (obj) {
            obj.set({ left: b.left, top: origin.y, width: b.width, height: 1 } as never);
          }
          this.setSnaps([{ axis: "y", pos: origin.y }]);
        } else {
          y2 = dy >= 0 ? b.top + b.height : b.top;
          if (obj) {
            obj.set({ left: origin.x, top: b.top, width: 1, height: b.height } as never);
          }
          this.setSnaps([{ axis: "x", pos: origin.x }]);
        }
        obj.set({ x2, y2 } as never);
        obj.setCoords();
        canvas.requestRenderAll();
        return;
      }
```

- [ ] **Step 3: Clear spanTarget and the guide on mouse-up**

`onMouseUp`: `this.spanTarget = null; this.setSnaps([]);` Next to where
`this.drawing = null`. Also clear on `setTool`.

- [ ] **Step 4: The endpoint positions Fabric stores**

Our rule contract (Task 2 of the earlier drift fix) already reads `left`/`top`
and `x2`/`y2` off the object. For a span in the negative direction we still
want left/top at the box's corner and x2/y2 the far corner, matching how
`serialiseLine` sees the object — so set them together, always, as above.

- [ ] **Step 5: Test**

Add to `e2e/workflow.spec.ts`:
```ts
  test("a rule dragged inside a rect spans it exactly", async ({ page }) => {
    await openEditorWithBill(page);
    const P = await docToPage(page);
    const a = await P(120, 150);
    const b = await P(420, 150 + 120);
    await pickTool(page, "Rect");
    await page.mouse.move(a.x, a.y);
    await page.mouse.down();
    await page.mouse.move(b.x, b.y, { steps: 5 });
    await page.mouse.up();
    await page.waitForTimeout(150);

    const mid = await P(200, 210);
    const end = await P(350, 230);
    await pickTool(page, "Horizontal Rule");
    await page.mouse.move(mid.x, mid.y);
    await page.mouse.down();
    await page.mouse.move(end.x, end.y, { steps: 5 });
    await page.mouse.up();
    await page.waitForTimeout(150);

    const rule = await page.evaluate(() =>
      window.__btm!.getTemplate().objects.find((o) => o.type === "hr") as unknown as {
        x: number; y: number; x2: number; y2: number;
      },
    );
    const rect = await page.evaluate(() => {
      const o = window.__btm!.getTemplate().objects.find((o) => o.type === "rect")!;
      return o as unknown as { x: number; y: number; width: number };
    });
    expect(rule.x).toBeCloseTo(rect.x, 0);
    expect(rule.x2).toBeCloseTo(rect.x + rect.width, 0);
    expect(rule.y).toBeCloseTo(rule.y2, 5);
  });
```

Run it: `$env:PORT="3000"; npx.cmd playwright test --grep "spans it exactly"`.

- [ ] **Step 6: Commit**

```bash
git add lib/canvas/EditorController.ts e2e/workflow.spec.ts
git commit -m "feat(snap): full-span rule when drawing a divider inside a shape"
```

---

### Task 4: Guides rendered in the overlay

**Files:**
- Modify: `components/editor/CanvasStage.tsx`

`EditorState.snaps` is now published by the controller. Paint it.

- [ ] **Step 1:**

In `CanvasStage.tsx`, find the overlay `<div>` at `:123` (`pointer-events-none absolute inset-0`).

Import:
```ts
import type { SnapLine } from "@/lib/canvas/snap";
```
Accept `snaps: SnapLine[]` and `zoom: number` via props or by reading
`state.snaps` (the stage is passed `state` already).

Render, inside the overlay:
```tsx
{snaps.map((s, i) =>
  s.axis === "y" ? (
    <div
      key={`h${i}`}
      className="absolute w-full border-t"
      style={{
        top: s.pos * zoom + ty,
        borderColor: "rgba(37,99,235,0.55)",
        borderTopWidth: 1,
        borderTopStyle: "solid",
      }}
    />
  ) : (
    <div
      key={`v${i}`}
      className="absolute h-full border-l"
      style={{
        left: s.pos * zoom + tx,
        borderColor: "rgba(37,99,235,0.55)",
        borderLeftWidth: 1,
        borderLeftStyle: "solid",
      }}
    />
  ),
)}
```

`zoom`, `tx`, `ty` are available there as `state.zoom`, `state.tx` and `state.ty` — verify against the file, adjusting names to match.

- [ ] **Step 2: Verify one shows in the browser**

Run the sanity check quickly through the existing guides e2e (temporarily
assert `document.querySelectorAll('border-t').length > 0` inside a new
`Guides` describe block in Task 5).

- [ ] **Step 3: Commit**

```bash
git add components/editor/CanvasStage.tsx
git commit -m "feat(snap): paint alignment guides in the stage overlay"
```

---

### Task 5: Resize guides-only and the full verification gate

**Files:**
- Modify: `lib/canvas/EditorController.ts` — `onObjectScaling`

- [ ] **Step 1: Publish guides during scale**

Within the existing `object:scaling` handler, after the BillTable case and before
the grid snap, for non-table targets, compute edges from the object's
`getBoundingRect()` and publish guides through `this.setSnaps(...)` — but
**do not adjust** `left`/`top`/`scaleX`/`scaleY`. This matches the design
decision: scaling indicates, it does not force.

- [ ] **Step 2: Clear on mouse-up** — `this.setSnaps([])` at the same spot as
Task 2's mouse-up clear (they share the handler).

- [ ] **Step 3: E2E for scaling shows a guide**

`tests/workflow.spec.ts`:
```ts
  test("scaling an object surfaces an alignment guide", async ({ page }) => {
    await openEditorWithBill(page);
    // ... two rects at aligned tops ...
    // drag a corner of one so its top edge catches the other's, then assert
    // the stage overlay contains a 1px line.
    const guides = await page.evaluate(() =>
      (window as unknown as { __btm: { getSnapshot: () => { snaps: Array<{axis:string,pos:number}> } } })
        .__btm.getSnapshot().snaps,
    );
    expect(guides.some((g) => g.axis === "y")).toBe(true);
  });
```

This requires `getSnapshot()` to include `snaps` — extend `EditorController.getSnapshot()`
to merge in `snaps: this.state.snaps`.

- [ ] **Step 4: Full gate**

```powershell
npx.cmd tsc --noEmit
npm.cmd test
npm.cmd run lint
$env:PORT="3000"; npx.cmd playwright test
npm.cmd run build
```
Expected: all clean, same baseline as before + the new tests.

- [ ] **Step 5: Commit**

```bash
git add lib/canvas/EditorController.ts e2e/workflow.spec.ts
git commit -m "feat(snap): alignment guides during scaling"
```

---

## Self-Review

**Spec coverage.** What the design calls for is covered end to end:
route a candidate lookup through `lib/canvas/snap.ts` (Task 1, Task 2 step 2),
free rules snap endpoints (Task 2 step 4), moving objects snap edges and publish
guides (Task 2 step 5), resize shows guides only (Task 5), dividing a box via a
full-span rule (Task 3), guides painted at the right screen position and
cleared on mouse:up/tool change (Tasks 2 & 4), off switch (Task 2 step 7),
`BillTable` exempt from forced motion (Tasks 2 & 5), no template/renderer
impact on any rule's serialisation path (by construction, and Task 2's
sanity assertion holds that the shape stays put).

**Type consistency.** `SnapLine { axis:'x'|'y', pos:number }` is defined once in
Task 1 and used identically in Tasks 2 and 4. `Levels`/`levelsFromBounds`/
`snapToLevels` keep their names through all tasks. `EditorState.snaps`/`snapToObjects`
and `setSnapToObjects` are each introduced where first consumed.

**Behaviour notes.** Full-span changes the meaning of the `h` shape from
free line to full-span *whenever the start is inside a rect*; this is what the
user described, and outside a rect the experience is unchanged. Guide only for
scaling is a deliberate scope guard that matches what the user asked for.
