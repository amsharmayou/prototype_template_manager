# Proportional Table Side-Marker Resize Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make on-canvas table resizing proportional and idempotent, so dragging a side handle never balloons one column while the rest stay put.

**Architecture:** A resize gesture snapshots the grid, the start totals, the start pointer and a per-axis sign. The target size is derived from the pointer's displacement from the gesture start, and the columns are always resolved from the *snapshot*, never from live state. That removes the compounding feedback loop that caused the distortion.

**Tech Stack:** TypeScript, Fabric.js 7.4, Vitest 3.2, Playwright 1.x, Node 24.

**Spec:** `docs/superpowers/specs/2026-09-30-canvas-image-unification-design.md` — section "Table side-marker resizing", "Largest-remainder distribution", and the `tests/tableResize.test.ts` / `tests/geometry.test.ts` entries under "Testing". This is plan 1 of 2; plan 2 (`2026-09-30-canvas-image-viewport.md`) handles the canvas/image unification and must not start until this one is merged.

## Global Constraints

- Source stays in `C:\Users\Lenovo\Desktop\Personal Project\Prototype\version 1`; this is not a git worktree.
- PowerShell on this machine cannot execute unsigned `.ps1` shims, so **every npm invocation must use `npm.cmd`**, e.g. `npm.cmd test`, not `npm test`. Using `npm` fails with `PSSecurityException`.
- Geometry is pure and lives in `lib/template/geometry.ts`. All arithmetic that
  *splits* a target extent into individual column widths or row heights belongs
  there. The caller may only decide *what extent* to ask for — never how it is
  divided. `EditorController` computes a target width/height from the pointer;
  `BillTable` hands that target to `scaleColWidths`/`scaleRowHeights`.
- Tables keep `scaleX`/`scaleY` pinned to 1. Scaling is converted into real `colWidths`/`rowHeights`; Fabric scaling is never allowed to persist.
- No comments are added to source files unless a comment is required to explain a non-obvious Fabric or geometry constraint.
- The template format, the JSON schema and all four exporters must be untouched by this plan.
- Work is committed after every task. The `origin` remote is configured but pushes currently fail with 403; commit locally regardless and do not retry a failing push on every task.

## File Structure

**New files**

- `tests/tableResize.test.ts` — unit tests for `BillTable`'s gesture API. Instantiates `BillTable` directly, so it needs the Fabric node environment (see Task 2).

**Modified files**

- `lib/template/geometry.ts` — add `scaleSizesProportionally`; add `maxTotal` support to `normaliseSizes`; reimplement `scaleColWidths` and `scaleRowHeights` on the new helper. This keeps a single distribution implementation rather than two near-copies.
- `lib/canvas/objects/BillTable.ts` — add the resize gesture: `beginResizeGesture`, `resizeColumnsTo`, `resizeRowsTo`, `endResizeGesture`. Add `resizeGesture` to `toObject`/`fromObject` so it survives serialisation. A pending gesture is not saved, because a snapshot is only meaningful within one drag.
- `lib/canvas/EditorController.ts` — track `lastKnownScenePoint`; start the gesture in `onMouseDown`; rewrite the table branch of `onObjectScaling` to derive the target from the pointer; end the gesture in `onObjectModified`.
- `tests/geometry.test.ts` — update the `normaliseSizes` `maxTotal` tests for the new clamp direction; add largest-remainder distribution tests.
- `e2e/workflow.spec.ts` — update the two existing resize tests for the new table origin, add handle coverage and a proportionality assertion.
- `README.md` — document proportional resizing and the snapshot approach.

---

### Task 1: Largest-remainder proportional distribution

The existing `scaleColWidths` / `scaleRowHeights` give the entire rounding remainder to the single widest column. That is at most one pixel per column, but it is a visible asymmetry in a hand-traced table, and it is the mechanism that made a growing distortion look like one "extreme" column. Replacing the distribution is a prerequisite for the resize fix, because the resize fix leans on these functions.

**Files:**
- Modify: `lib/template/geometry.ts`
- Test: `tests/geometry.test.ts`

**Interfaces:**
- Consumes: nothing new. Existing exports `totalWidth(colWidths)`, `totalHeight(rowHeights)`, `sum(list)`, `MIN_COL_WIDTH`, `MIN_ROW_HEIGHT` are already in this file.
- Produces:
  ```ts
  // Distribute `total` across `sizes` preserving ratios.
  // Total is exact. No entry below `min`. Remainder goes to the largest
  // fractional parts, largest first.
  export function scaleSizesProportionally(
    sizes: readonly number[],
    total: number,
    min: number,
  ): number[]

  // Existing signature gains an optional third argument.
  // When provided, the total is clamped to at least maxTotal as well as at
  // least sizes.length * min, and the clamp is applied in one pass.
  export function normaliseSizes(
    sizes: readonly number[],
    min: number,
    maxTotal?: number,
  ): number[]
  ```

- [ ] **Step 1: Write the failing tests**

Append to `tests/geometry.test.ts`:

```ts
describe("scaleSizesProportionally", () => {
  it("keeps the total exact", () => {
    expect(sum(scaleSizesProportionally([10, 10, 10], 100, 2))).toBe(100);
    expect(sum(scaleSizesProportionally([7, 11, 13], 47, 2))).toBe(47);
  });

  it("preserves ratios rather than equalising", () => {
    // 300:40:40 must stay 7.89:1:1, not collapse to 1:1:1.
    const out = scaleSizesProportionally([300, 40, 40], 380, 2);
    expect(out[0]).toBeGreaterThan(280);
    expect(out[1]).toBeLessThan(50);
    expect(sum(out)).toBe(380);
  });

  it("spreads the remainder across columns, not all onto the widest", () => {
    // 1/3 each of 100 cannot divide evenly, so exactly one column must
    // carry the extra pixel. The old implementation always picked index 0.
    const out = scaleSizesProportionally([1, 1, 1], 100, 2);
    const bumped = out.filter((n) => n === 34).length;
    expect(sum(out)).toBe(100);
    expect(bumped).toBe(1);
  });

  it("honours the minimum without losing the total", () => {
    const out = scaleSizesProportionally([1, 1000], 20, 8);
    expect(out[0]).toBe(8);
    expect(out[1]).toBe(12);
    expect(sum(out)).toBe(20);
  });

  it("is idempotent: same target twice gives the same result", () => {
    const once = scaleSizesProportionally([120, 30, 30], 500, 2);
    const twice = scaleSizesProportionally(once, 500, 2);
    expect(twice).toEqual(once);
  });

  it("returns a copy for a zero total instead of dividing by zero", () => {
    expect(scaleSizesProportionally([10, 20], 0, 2)).toEqual([10, 20]);
  });
});

describe("normaliseSizes maxTotal clamps upward as well as downward", () => {
  it("raises entries that sum below maxTotal", () => {
    // The old code only ever shrank, so a too-small total was ignored.
    const out = normaliseSizes([5, 5, 5], 2, 60);
    expect(sum(out)).toBe(60);
  });

  it("keeps ratios when clamping upward", () => {
    const out = normaliseSizes([10, 30], 2, 80);
    expect(sum(out)).toBe(80);
    expect(out[0]).toBeLessThan(out[1]!);
    expect(out[0]! / out[1]!).toBeGreaterThan(0.2);
    expect(out[0]! / out[1]!).toBeLessThan(0.45);
  });

  it("still shrinks an oversized total from the last column backwards", () => {
    const out = normaliseSizes([40, 40, 40], 2, 100);
    expect(sum(out)).toBe(100);
    expect(out[0]).toBe(40);
  });

  it("does not loop forever when even the minimums exceed maxTotal", () => {
    const out = normaliseSizes([40, 40, 40], 40, 10);
    expect(out.every((n) => n >= 40)).toBe(true);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run:

```powershell
npm.cmd test -- tests/geometry.test.ts
```

Expected: FAIL. `scaleSizesProportionally` is not exported, and the `normaliseSizes` upward-clamp tests fail because the current implementation only shrinks.

- [ ] **Step 3: Implement the distribution helper**

In `lib/template/geometry.ts`, add above `scaleColWidths`:

```ts
/**
 * Distribute `total` across `sizes` while preserving their ratios.
 *
 * Every entry is floored first, then the leftover pixels are handed out one at
 * a time to whichever entries lost the most to rounding, largest fraction
 * first. This keeps the result as proportional as integers allow instead of
 * giving the whole remainder to one column.
 *
 * Enforcing `min` can push the floored sum past the target (a 1:100 pair scaled
 * to 20 floors to 8 + 19 = 27), so an overshoot is corrected by taking pixels
 * back from the entries with the smallest fractions first.
 */
export function scaleSizesProportionally(
  sizes: readonly number[],
  total: number,
  min: number,
): number[] {
  const n = sizes.length;
  if (n === 0) return [];
  const current = sum(sizes);
  if (current <= 0 || !Number.isFinite(total) || total <= 0) return [...sizes];

  const target = Math.max(min * n, Math.round(total));
  const exact = sizes.map((s) => (s / current) * target);
  const out = exact.map((v) => Math.max(min, Math.floor(v)));
  const fracs = exact.map((v) => v - Math.floor(v));
  const index = (ascending: boolean) =>
    exact
      .map((_, i) => i)
      .sort((a, b) => (ascending ? fracs[a]! - fracs[b]! : fracs[b]! - fracs[a]!));

  // The minimums may have overshot the target; take the excess back, starting
  // with the entries that lost least to rounding.
  let excess = sum(out) - target;
  if (excess > 0) {
    const order = index(true);
    do {
      for (const i of order) {
        if (excess <= 0) break;
        if (out[i]! > min) {
          out[i]! -= 1;
          excess -= 1;
        }
      }
      // Re-enter the loop only while some entry is still above its minimum.
    } while (excess > 0 && out.some((v) => v > min));
    return out;
  }

  // Hand the leftover pixels to the entries that lost the most to flooring.
  const order = index(false);
  let remaining = target - sum(out);
  while (remaining > 0 && out.some((_, i) => out[i]! < Math.floor(exact[i]!) + 1)) {
    for (const i of order) {
      if (remaining <= 0) break;
      if (out[i]! < Math.floor(exact[i]!) + 1) {
        out[i]! += 1;
        remaining -= 1;
      }
    }
  }
  return out;
}
```

Worked examples, which are the tests in Step 1:

| input | total | min | result |
| --- | --- | --- | --- |
| `[10,10,10]` | 100 | 2 | `[34,33,33]` |
| `[7,11,13]` | 47 | 2 | `[10,17,20]` |
| `[300,40,40]` | 380 | 2 | `[300,40,40]` (already exact) |
| `[1,100]` | 20 | 8 | `[8,12]` (overshoot corrected) |
| `[10,20]` | 0 | 2 | `[10,20]` (guarded copy) |

- [ ] **Step 4: Reimplement `scaleColWidths` and `scaleRowHeights` on it**

In the same file, replace both bodies:

```ts
export function scaleColWidths(
  colWidths: readonly number[],
  newTotal: number,
  min = MIN_COL_WIDTH,
): number[] {
  if (totalWidth(colWidths) <= 0) return [...colWidths];
  return scaleSizesProportionally(colWidths, newTotal, min);
}

export function scaleRowHeights(
  rowHeights: readonly number[],
  newTotal: number,
  min = MIN_ROW_HEIGHT,
): number[] {
  if (totalHeight(rowHeights) <= 0) return [...rowHeights];
  return scaleSizesProportionally(rowHeights, newTotal, min);
}
```

- [ ] **Step 5: Make `normaliseSizes` clamp the total from both directions**

Replace the body of `normaliseSizes` with:

```ts
export function normaliseSizes(
  sizes: readonly number[],
  min: number,
  maxTotal?: number,
): number[] {
  const filtered = sizes.filter((n) => Number.isFinite(n) && n > 0);
  const list = (filtered.length ? filtered : [min]).map((n) =>
    Math.max(min, Math.round(n)),
  );
  if (maxTotal === undefined || list.length === 0) return list;

  const floor = min * list.length;
  const target = Math.max(floor, Math.round(maxTotal));
  const total = sum(list);
  if (total === target) return list;
  if (total < target) {
    return scaleSizesProportionally(list, target, min);
  }

  // Shrink from the last column backwards so the left-hand columns keep
  // their measured widths, which is what users expect when dragging.
  let excess = total - target;
  for (let i = list.length - 1; i >= 0 && excess > 0; i--) {
    const take = Math.min(list[i]! - min, excess);
    list[i]! -= take;
    excess -= take;
  }
  return list;
}
```

- [ ] **Step 6: Run the geometry tests to verify they pass**

Run:

```powershell
npm.cmd test -- tests/geometry.test.ts
```

Expected: PASS, all geometry tests green including the 31 pre-existing ones.

- [ ] **Step 7: Run the whole unit suite to catch regressions**

Run:

```powershell
npm.cmd test
```

Expected: PASS. `tests/serialize.test.ts` and `tests/placeholders.test.ts` both exercise table geometry, so this is the real check that the distribution change did not break serialisation.

- [ ] **Step 8: Commit**

```powershell
git add lib/template/geometry.ts tests/geometry.test.ts
git commit -m "fix(geometry): distribute rounding remainder proportionally

scaleColWidths and scaleRowHeights gave the entire remainder to the single
widest column, which is what made a growing table look like it had one extreme
column. Replace with largest-remainder distribution so leftovers go to the
entries that lost most to rounding.

Also make normaliseSizes clamp its maxTotal from below as well as above. It
previously only shrank, so a total below the requested minimum was ignored."
```

---

### Task 2: Resize gesture on `BillTable`

**Files:**
- Modify: `lib/canvas/objects/BillTable.ts`
- Test: `tests/tableResize.test.ts` (create)

**Interfaces:**
- Consumes: `scaleColWidths(colWidths, newTotal, min?)` and `scaleRowHeights(rowHeights, newTotal, min?)` from `lib/template/geometry.ts` (Task 1, signatures unchanged).
- Produces:
  ```ts
  export interface TableResizeGesture {
    colWidths: number[];
    rowHeights: number[];
    width: number;
    height: number;
    startX: number;
    startY: number;
    signX: 1 | -1;
    signY: 1 | -1;
  }

  // BillTable instance methods
  beginResizeGesture(startPointer: { x: number; y: number }): void
  resizeColumnsTo(targetWidth: number): void
  resizeRowsTo(targetHeight: number): void
  endResizeGesture(): void
  ```

- [ ] **Step 1: Write the failing test file**

Create `tests/tableResize.test.ts`:

```ts
import { describe, expect, it } from "vitest";

import { BillTable } from "@/lib/canvas/objects/BillTable";
import { MIN_COL_WIDTH, MIN_ROW_HEIGHT, sum } from "@/lib/template/geometry";

function makeTable(colWidths: number[] = [300, 40, 40], rowHeights: number[] = [30, 30]) {
  return new BillTable({ colWidths, rowHeights, headerRow: false });
}

describe("BillTable resize gesture", () => {
  it("scales every column by the same factor", () => {
    const t = makeTable();
    t.set({ left: 10, top: 20 });
    // Pointer starts in the right half of the table, then moves +180 in x.
    t.beginResizeGesture({ x: 500, y: 60 });
    t.resizeColumnsTo(sum(t.colWidths) + 180);

    expect(sum(t.colWidths)).toBe(560);
    expect(t.colWidths[0]).toBeGreaterThan(440);
    expect(t.colWidths[1]!).toBeGreaterThanOrEqual(50);
    expect(t.colWidths[1]!).toBeLessThan(60);
  });

  it("never lets one column absorb the whole expansion", () => {
    const t = makeTable();
    t.beginResizeGesture({ x: 500, y: 60 });
    const before = [...t.colWidths];
    t.resizeColumnsTo(sum(before) * 2);
    for (let i = 0; i < t.columns; i++) {
      const ratio = t.colWidths[i]! / before[i]!;
      // Every column must be within 1px-of-total of the same scale factor.
      expect(Math.abs(ratio - 2)).toBeLessThan(0.05);
    }
  });

  it("is idempotent, so a long drag cannot compound", () => {
    const t = makeTable();
    t.beginResizeGesture({ x: 500, y: 60 });
    t.resizeColumnsTo(500);
    const once = [...t.colWidths];
    for (let i = 0; i < 20; i++) t.resizeColumnsTo(500);
    expect(t.colWidths).toEqual(once);
  });

  it("clamps at the minimum total instead of collapsing a column", () => {
    const t = makeTable([100, 100, 100, 100]);
    t.beginResizeGesture({ x: 500, y: 60 });
    t.resizeColumnsTo(1);
    expect(sum(t.colWidths)).toBe(MIN_COL_WIDTH * 4);
    expect(t.colWidths.every((n) => n >= MIN_COL_WIDTH)).toBe(true);
  });

  it("signs the delta from the handle side the pointer started on", () => {
    const t = makeTable(2, 2, [200, 200]);
    t.set({ left: 0, top: 0 });
    const startTotal = sum(t.colWidths);

    // Pointer starts in the LEFT half (table spans 0..400, so 100 is left).
    t.beginResizeGesture({ x: 100, y: 30 });
    expect(t.resizeGesture?.signX).toBe(-1);
    // Moving further left grows the table, exactly as a right-side handle
    // would when the pointer moves right.
    t.resizeColumnsTo(startTotal + 100);
    expect(sum(t.colWidths)).toBe(startTotal + 100);
  });

  it("moves both axes from one gesture and never changes left/top", () => {
    const t = makeTable();
    t.set({ left: 40, top: 15 });
    t.beginResizeGesture({ x: 500, y: 60 });
    const w = sum(t.colWidths);
    const h = sum(t.rowHeights);
    t.resizeColumnsTo(w + 100);
    t.resizeRowsTo(h + 40);
    expect(sum(t.colWidths)).toBe(w + 100);
    expect(sum(t.rowHeights)).toBe(h + 40);
    expect(t.left).toBe(40);
    expect(t.top).toBe(15);
  });

  it("falls back to live sizes when no gesture is active", () => {
    const t = makeTable();
    // This is what the properties panel calls; it must not need a gesture.
    t.resizeColumnsTo(200);
    expect(sum(t.colWidths)).toBe(200);
  });

  it("clamps the minimum total when no gesture is active", () => {
    const t = makeTable();
    t.resizeRowsTo(1);
    expect(sum(t.rowHeights)).toBe(MIN_ROW_HEIGHT * t.rows);
  });

  it("ends the gesture so the next resize starts fresh", () => {
    const t = makeTable();
    t.beginResizeGesture({ x: 500, y: 60 });
    t.resizeColumnsTo(500);
    t.endResizeGesture();
    t.resizeColumnsTo(250);
    expect(sum(t.colWidths)).toBe(250);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run:

```powershell
npm.cmd test -- tests/tableResize.test.ts
```

Expected: FAIL. `t.beginResizeGesture is not a function`.

- [ ] **Step 3: Add the gesture interface and field**

In `lib/canvas/objects/BillTable.ts`, add after `BillTableSpec`:

```ts
export interface TableResizeGesture {
  colWidths: number[];
  rowHeights: number[];
  width: number;
  height: number;
  startX: number;
  startY: number;
  signX: 1 | -1;
  signY: 1 | -1;
}
```

Inside the class, next to `editingCell`:

```ts
  /**
   * State captured when a resize handle is grabbed. `BillTable` keeps scale at
   * 1, so the only record of a drag is this snapshot.
   */
  resizeGesture: TableResizeGesture | null = null;
```

- [ ] **Step 4: Implement the gesture methods**

In `lib/canvas/objects/BillTable.ts`, insert immediately before `scaleColumns`:

```ts
  /**
   * Snapshot the grid at the moment a handle is grabbed.
   *
   * The sign per axis records which side of the table the pointer started on,
   * so every handle resizes away from this object's top-left. Deriving it
   * from the pointer position avoids depending on which control Fabric
   * considers active.
   */
  beginResizeGesture(startPointer: { x: number; y: number }): void {
    const w = totalWidth(this.colWidths);
    const h = totalHeight(this.rowHeights);
    const cx = (this.left ?? 0) + w / 2;
    const cy = (this.top ?? 0) + h / 2;
    this.resizeGesture = {
      colWidths: [...this.colWidths],
      rowHeights: [...this.rowHeights],
      width: w,
      height: h,
      startX: startPointer.x,
      startY: startPointer.y,
      signX: startPointer.x >= cx ? 1 : -1,
      signY: startPointer.y >= cy ? 1 : -1,
    };
  }

  /**
   * Resize columns to `targetWidth`, always scaling from the gesture snapshot.
   *
   * Resolving from the snapshot rather than the current sizes is what makes a
   * drag idempotent: a long drag applies the same ratio repeatedly instead of
   * compounding. Without an active gesture the live sizes are used, so the
   * properties panel can call this directly.
   */
  resizeColumnsTo(targetWidth: number): void {
    if (!Number.isFinite(targetWidth)) return;
    const base = this.resizeGesture?.colWidths ?? this.colWidths;
    this.colWidths = scaleColWidths(base, targetWidth, MIN_COL_WIDTH);
    this.syncDimensions();
  }

  resizeRowsTo(targetHeight: number): void {
    if (!Number.isFinite(targetHeight)) return;
    const base = this.resizeGesture?.rowHeights ?? this.rowHeights;
    this.rowHeights = scaleRowHeights(base, targetHeight, MIN_ROW_HEIGHT);
    this.syncDimensions();
  }

  endResizeGesture(): void {
    this.resizeGesture = null;
  }
```

- [ ] **Step 5: Exclude the pending gesture from serialisation**

A snapshot only means something inside one drag, so it must not be saved or
restored. In `toObject`, add one line after `type: "BillTable"`:

```ts
      resizeGesture: null,
```

In `fromObject`, `...fabricProps` is passed straight to `table.set(...)`, so
`resizeGesture` would otherwise be assigned through as a non-Fabric property.
Clear it explicitly after the `set` call instead of destructuring it away — a
destructured-away binding would be dead code that `no-unused-vars` may flag,
whereas one assignment cannot be. Add after the existing `table.set(fabricProps as never);`:

```ts
    table.resizeGesture = null;
```

- [ ] **Step 6: Run the test to verify it passes**

Run:

```powershell
npm.cmd test -- tests/tableResize.test.ts
```

Expected: PASS, 9 tests.

- [ ] **Step 7: Run the full unit suite and typecheck**

Run:

```powershell
npm.cmd test
npm.cmd run typecheck
npm.cmd run lint
```

Expected: all PASS, no type errors, no lint errors. The ESLint check matters
here because of the intentionally unused `_ignoredResizeGesture` binding.

- [ ] **Step 8: Commit**

```powershell
git add lib/canvas/objects/BillTable.ts tests/tableResize.test.ts
git commit -m "feat(table): add a snapshot-based resize gesture

A drag currently applies each event's scaleX to the already-resized widths,
so the table compounds to start * factor^n and the rounding remainder lands on
one column. Snapshot the grid, the start totals and the handle side at
mouse-down, then resolve the target from the pointer's displacement.

Resolving from the snapshot makes the gesture idempotent, keeps every column
proportional, and works for all eight handles without depending on which
Fabric control is active."
```

---

### Task 3: Drive the resize from the pointer in `EditorController`

**Files:**
- Modify: `lib/canvas/EditorController.ts`
- Test: `e2e/workflow.spec.ts`

**Interfaces:**
- Consumes: `BillTable.beginResizeGesture(p)`, `.resizeColumnsTo(w)`, `.resizeRowsTo(h)`, `.endResizeGesture()` from Task 2.
- Produces: no new public surface. The controller gains one private field `lastKnownScenePoint: { x: number; y: number } | null`.

- [ ] **Step 1: Read the current table branch and the target test**

Read `lib/canvas/EditorController.ts` around the `onObjectScaling` method and
find the two resize tests in `e2e/workflow.spec.ts` (search for
`table resizes from its corner handles` and
`dragging the bottom-left corner still keeps the top-left pinned`). Note how
each test locates the handle's document-space point, because the table's origin
convention is what those helpers encode.

- [ ] **Step 2: Track the last known scene point**

In `lib/canvas/EditorController.ts`, add a private field next to
`gestureAnchor`:

```ts
  /** Latest scene-space pointer position, for events that do not carry one. */
  private lastKnownScenePoint: { x: number; y: number } | null = null;
```

In `onMouseMove`, at the top of the method, add:

```ts
    this.lastKnownScenePoint = { x: p.x, y: p.y };
```

- [ ] **Step 3: Start the gesture on mouse down**

In `onMouseDown`, replace the `gestureAnchor` assignment with:

```ts
    this.gestureAnchor = opt.target
      ? { left: opt.target.left ?? 0, top: opt.target.top ?? 0 }
      : null;
    this.lastKnownScenePoint = { x: p.x, y: p.y };
    if (opt.target instanceof BillTable) {
      opt.target.beginResizeGesture({ x: p.x, y: p.y });
    }
```

- [ ] **Step 4: Add the scene-point resolver**

`object:scaling` carries the raw DOM event rather than a scene point, and
`lastKnownScenePoint` can lag a frame behind on a fast drag, so the event is the
authority and the cached value is only a fallback. In
`lib/canvas/EditorController.ts`, add as a private method next to
`onObjectScaling`:

```ts
  private resolveScenePoint(e: Event | undefined): { x: number; y: number } | null {
    const canvas = this.canvas;
    if (canvas && e) {
      const p = canvas.getScenePoint(e);
      if (Number.isFinite(p.x) && Number.isFinite(p.y)) {
        this.lastKnownScenePoint = { x: p.x, y: p.y };
        return this.lastKnownScenePoint;
      }
    }
    return this.lastKnownScenePoint;
  }
```

- [ ] **Step 5: Rewrite the table branch of `onObjectScaling`**

Replace the whole `if (appType === "table") { ... }` block with:

```ts
    if (appType === "table") {
      // A table is resized by changing its column widths, never by scaling,
      // so that the grid stays exact. The target size comes from the pointer's
      // displacement since mouse-down, not from Fabric's scaleX: the drag's
      // scale is computed against the size captured at gesture start, so
      // multiplying the current widths by it compounds on every event.
      const table = target as BillTable;
      const gesture = table.resizeGesture;
      const p = this.resolveScenePoint(opt.e);
      if (gesture && p) {
        const width = gesture.width + (p.x - gesture.startX) * gesture.signX;
        const height = gesture.height + (p.y - gesture.startY) * gesture.signY;
        table.set({
          left: this.gestureAnchor?.left ?? table.left,
          top: this.gestureAnchor?.top ?? table.top,
        } as never);
        table.resizeColumnsTo(width);
        table.resizeRowsTo(height);
        table.set({ scaleX: 1, scaleY: 1 } as never);
      } else {
        // No gesture: fall back to the scale Fabric reports.
        const factorX = table.scaleX;
        const factorY = table.scaleY;
        table.scaleColumns(factorX);
        table.scaleRows(factorY);
        table.set({ scaleX: 1, scaleY: 1 } as never);
      }
      table.setCoords();
      this.canvas?.requestRenderAll();
      return;
    }
```

- [ ] **Step 6: End the gesture on object modified**

In `onObjectModified`, replace the body with:

```ts
  private onObjectModified = (): void => {
    this.getTable()?.endResizeGesture();
    this.commit("Transform");
  };
```

- [ ] **Step 7: Verify the existing E2E resize tests against the new code**

Run:

```powershell
npm.cmd run test:e2e
```

Expected: the 15 tests unrelated to table handles still pass. The two table
resize tests may fail, because their expected document-space handle positions
were derived from the old origin convention; Task 4 rewrites them. Record which
ones fail and by how much before continuing.

- [ ] **Step 8: Commit**

```powershell
git add lib/canvas/EditorController.ts
git commit -m "fix(canvas): derive table resize from the pointer, not scaleX

Fabric computes a drag's scale against the size captured at mouse-down, so
applying it to the already-resized widths compounds on every event and the
table races away from the handle. Take the target size from the pointer's
displacement since mouse-down and resolve the grid from the gesture snapshot."
```

---

### Task 4: Cover all eight handles in E2E

**Files:**
- Modify: `e2e/workflow.spec.ts`

**Interfaces:**
- Consumes: the existing helpers in this file — `openWith(page, FIXTURE)` (returns the document-to-page converter `P`), `drawTable(page, P, from, to, rows, cols)`, and `tableState(page)` which reads `window.__btm.getTable()`. No new bridge is needed; `window.__btm` already exists.
- Produces: `TableState` gains `colWidths: number[]` and `rowHeights: number[]`.

- [ ] **Step 1: Extend `TableState` so per-column geometry is visible**

`tableState` currently reports only `colSum`/`rowSum`, which is enough to
assert the total but not enough to assert proportionality. In
`e2e/workflow.spec.ts`, add the two fields to the interface:

```ts
interface TableState {
  left: number;
  top: number;
  width: number;
  height: number;
  scaleX: number;
  scaleY: number;
  colWidths: number[];
  rowHeights: number[];
  colSum: number;
  rowSum: number;
  rows: number;
  columns: number;
}
```

and copy the arrays out in the `page.evaluate` body, next to the existing
`colSum` line:

```ts
      colWidths: [...t!.colWidths],
      rowHeights: [...t!.rowHeights],
```

- [ ] **Step 2: Replace the two resize tests with a table-driven version**

Delete `a table resizes from its corner handles, growing right and down only`
and `dragging the bottom-left corner still keeps the top-left pinned`, and put
this in their place. Leave `a table's content is painted from its centre,
matching Fabric's origin` untouched.

```ts
const HANDLES = [
  { name: "top-left", fx: 0, fy: 0, dx: -40, dy: -40 },
  { name: "top", fx: 0.5, fy: 0, dx: 0, dy: -40 },
  { name: "top-right", fx: 1, fy: 0, dx: 40, dy: -40 },
  { name: "left", fx: 0, fy: 0.5, dx: -40, dy: 0 },
  { name: "right", fx: 1, fy: 0.5, dx: 40, dy: 0 },
  { name: "bottom-left", fx: 0, fy: 1, dx: -40, dy: 40 },
  { name: "bottom", fx: 0.5, fy: 1, dx: 0, dy: 40 },
  { name: "bottom-right", fx: 1, fy: 1, dx: 40, dy: 40 },
] as const;

for (const handle of HANDLES) {
  test(`the ${handle.name} handle keeps the top-left pinned and stays proportional`, async ({
    page,
  }) => {
    const P = await openWith(page, FIXTURE);
    await drawTable(page, P, [150, 250], [550, 450], 3, 3);
    const before = await tableState(page);

    // Handles sit at fractions of the table box; the drag then moves further
    // out along the same direction, so every handle grows the table.
    const grip = await P(
      before.left + handle.fx * before.width,
      before.top + handle.fy * before.height,
    );
    await page.mouse.move(grip.x, grip.y);
    await page.waitForTimeout(150);
    await page.mouse.down();
    await page.waitForTimeout(120);
    await page.mouse.move(grip.x + handle.dx * 2, grip.y + handle.dy * 2, {
      steps: 12,
    });
    await page.waitForTimeout(120);
    await page.mouse.up();
    await page.waitForTimeout(400);

    const after = await tableState(page);

    // The pinned corner must not have moved at all.
    expect(after.left).toBe(before.left);
    expect(after.top).toBe(before.top);
    // Scaling is converted into real grid geometry, never left on the object.
    expect(after.scaleX).toBe(1);
    expect(after.scaleY).toBe(1);
    expect(after.colSum).toBe(after.width);
    expect(after.rowSum).toBe(after.height);
    // The gesture must actually have changed something, or the case is vacuous.
    expect(after.width).not.toBe(before.width);

    // Every column keeps its share of the total. This is the assertion that
    // fails when a drag compounds and dumps the remainder into one column.
    for (let i = 0; i < before.colWidths.length; i++) {
      expect(before.colWidths[i]! / before.colSum).toBeCloseTo(
        after.colWidths[i]! / after.colSum,
        1,
      );
    }
  });
}
```

- [ ] **Step 3: Run the E2E suite**

Run:

```powershell
npm.cmd run test:e2e
```

Expected: all tests PASS, including the eight new handle cases.

- [ ] **Step 4: Commit**

```powershell
git add e2e/workflow.spec.ts
git commit -m "test(e2e): cover all eight table handles

Each case asserts the top-left stays pinned, every column keeps its share of
the total within 2%, and scale never persists. The share assertion is what
catches a compounding drag."
```

---

### Task 5: Document the behaviour

**Files:**
- Modify: `README.md`

**Interfaces:**
- Consumes: nothing.
- Produces: nothing.

- [ ] **Step 1: Update the resizing section**

In `README.md`, find the section describing table resizing and replace its
explanation of the handle behaviour with: handles resize the table away from a
pinned top-left, every column keeps its proportion, and the top-left corner
never moves. Note that tables store real column widths rather than a scale
factor, which is what keeps the grid exact through JSON, SVG, PDF and DOCX.

- [ ] **Step 2: Add the failure mode to the findings section**

In the Fabric 7 findings, add that Fabric computes a drag's `scaleX` against
the object size captured at `mouse:down`, so an object that mutates its own
`width` mid-drag and resets `scaleX` compounds the factor on every event. The
fix is to derive the target from the pointer and resolve from a snapshot taken
at gesture start.

- [ ] **Step 3: Verify the docs build and commit**

Run:

```powershell
npm.cmd run lint
npm.cmd test
```

Expected: PASS. Then:

```powershell
git add README.md
git commit -m "docs: explain proportional table resizing and the compounding-scale trap"
```

---

### Task 4 as built — corrections to the task text above

The implementer found three defects in this task's brief. The brief text above is
left as-written so the record shows what the implementer was actually given; these
are the corrections that shipped in `fa14858`.

1. **The magnitude formula above is wrong.** It reads `(handle.dx * 2) / zoom`, but
   `beginResizeGesture` folds drag direction into `signX`/`signY`
   (`BillTable.ts:274-275`) and `onObjectScaling` applies
   `(p.x - gesture.startX) * signX` (`EditorController.ts:1040-1041`). For a
   left/top handle both the sign and the pointer delta are negative, so the product
   is positive and growth is `Math.abs` of the travel. Shipped:
   `Math.abs(handle.dx) * 2 / before.zoom`. The signed form demanded −129.83 where
   +129.83 is delivered, failing 5 of the 8 handles with a residual of exactly twice
   the ask.
2. **The unconditional `expect(after.width).not.toBe(before.width)` above is false
   for the top and bottom handles**, which have `dx === 0` on the centreline and
   leave the width unchanged (measured 401 → 401). It would have shipped two red
   tests. Shipped: axis-aware, driving width only when `fx !== 0.5` and height only
   when `fy !== 0.5`.
3. **The commit message above makes two false claims.** `toBeCloseTo(_, 1)` is a 5%
   tolerance, not 2%. And the share assertion is *not* what catches a compounding
   drag — the implementer proved the share assertion passes against the fully
   reverted code. Shipped: a magnitude check against the pointer's scene delta is
   the discriminating assertion, and all 8 handle tests fail on it.

Tolerance derivation, for anyone revisiting these numbers: `tableState` rounds both
readings, contributing ±1, and integer `MouseEvent.clientX/clientY` contributes
±0.5 screen px ≈ ±0.81 scene units, for a worst case of ~1.81. A ±1 bound would sit
inside the noise floor, so **±2 driven / ±4 non-driven is the tightest defensible
value**. The non-driven ±4 exists because the height target is computed on every
scaling event regardless of which control was grabbed (a known, separately tracked
imprecision); the measured jitter turned out to be 0.

The `* 2` drag scaling and `steps: 12` are load-bearing for the `right`/`bottom`
revert-detection margin (~3.5×, against 11.5× headroom on the correct path). The
compounding factor is applied once per scaling event, so shortening either shrinks
the residual roughly proportionally and those two handles would stop discriminating
first while the other six still passed.

## Final Verification

Run all five gates. This is the definition of done for this plan.

```powershell
npm.cmd run lint
npm.cmd run typecheck
npm.cmd test
npm.cmd run test:e2e
npm.cmd run build
```

Expected: lint clean, typecheck clean, all unit tests pass (66 pre-existing
plus 6 new geometry and 9 new table resize tests), all E2E tests pass (15
pre-existing minus 2 replaced, plus 8 handle cases), and the production build
compiles.

Then confirm the two plan-1 outcomes by hand in the editor:

1. Drag a table's middle-column side handle repeatedly. The table should grow
   smoothly with all columns in proportion, and no column should run away.
2. Drag a table's bottom-left corner outward. The top-left corner should stay
   exactly where it was.

## Out of Scope For This Plan

- The canvas/image unification, pointer-anchored zoom, background reference
  and all navigation changes. That is plan 2, and it also deletes the scroll
  container that `e2e/workflow.spec.ts` currently relies on for several
  navigation tests.
- `resizeTo(width, height)` on `BillTable` keeps its existing behaviour. It
  benefits from the new distribution automatically because it calls
  `scaleColWidths`, which is why its tests must keep passing in Task 1.
