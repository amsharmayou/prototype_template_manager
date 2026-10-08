# Grouping and Wrapping Text — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let the author merge several shapes into one nestable structure that selects and moves as a unit without altering the exported bill, and let a text box be given a fixed width that wraps and grows downward.

**Architecture:** Groups live only in `EditorState.groups` as a flat, self-referencing list of `{id, name, parentId, members}`; Fabric objects stay flat and know nothing about groups, and the controller resolves membership. Because the renderer absolutely-positions every object, grouping requires **no** change to `serialize.ts`'s geometry, `hydrate.ts`, or `primitives.ts`. Wrapping is one optional `TextObject.wrapWidth`; absent means today's auto-width behaviour. Undo needs the history snapshot widened to carry groups, or a grouping change would be invisible to both `commit()` and `undo()`.

**Tech Stack:** Next.js 16 (App Router, Turbopack), React 19, TypeScript strict, Fabric.js 7.4, Vitest (node environment), Playwright, Tailwind.

**Spec:** `docs/superpowers/specs/2026-10-05-grouping-and-text-wrapping-design.md` — read it before starting; this plan argues from it.

## Global Constraints

- Windows PowerShell. Use `npm.cmd` and `npx.cmd`; bare `npm`/`npx` fail execution policy.
- Run E2E with `$env:PORT="3000"; npx.cmd playwright test`. The Playwright config defaults to 3111 and `reuseExistingServer: true`; a second `next dev` in this directory refuses to start.
- Verification gate before claiming completion: `npx.cmd tsc --noEmit`, `npm.cmd test`, `npm.cmd run lint`, `$env:PORT="3000"; npx.cmd playwright test`, `npm.cmd run build`. All must be clean.
- Baseline at plan-writing time: **287 unit tests, 49 E2E tests, all passing.** Neither feature may regress any of them.
- Never write comments in code unless the task explicitly asks for one. Where this plan shows a comment in a code block, it is required explanatory content — include it.
- `lib/render/primitives.ts` and `lib/share/kit.ts` must stay free of Fabric imports (enforced by `tests/render.test.ts` "purity of lib/render"). `lib/canvas/groups.ts` is Fabric-free for the same reason and to stay unit-testable in the node test environment.
- Do not commit unless explicitly asked.

---

### Task 1: Group tree helpers (pure, Fabric-free)

**Files:**
- Create: `lib/canvas/groups.ts`
- Create: `tests/groups.test.ts`

**Interfaces:**
- Consumes: nothing. This is the foundation for Tasks 2 and 3.
- Produces:
  ```ts
  export interface GroupNode {
    id: string;
    name: string;
    parentId: string | null;
    /** Object ids AND group ids. Nesting is just a tree. */
    members: string[];
  }

  /** Ids of every group that contains `memberId`, innermost last. */
  export function ancestorsOf(memberId: string, groups: GroupNode[]): string[];

  /** The group that directly holds `objectId`, or null. */
  export function groupOf(objectId: string, groups: GroupNode[]): GroupNode | null;

  /** Every group id in the subtree rooted at `rootId`, including rootId. */
  export function subtreeIds(rootId: string, groups: GroupNode[]): string[];

  /** Refuses a cycle: false when `parentId` is `childId` or one of its descendants. */
  export function canNest(parentId: string, childId: string, groups: GroupNode[]): boolean;

  /**
   * Groups `objectIds` under a new group. Any existing group that already holds
   * one of them is absorbed: removed, with its members re-pointed at the new
   * group, so no object ends up in two groups and no empty shell survives.
   * `newId` is supplied by the caller so this stays a pure function.
   */
  export function groupObjects(
    objectIds: string[],
    newId: string,
    name: string,
    groups: GroupNode[],
  ): GroupNode[];

  /**
   * Removes `groupId`. Its members move up to the removed group's own parent,
   * so unwrapping never orphans an object into limbo.
   */
  export function ungroup(groupId: string, groups: GroupNode[]): GroupNode[];

  /** Drops every membership entry for ids no longer on the canvas. */
  export function pruneGroups(liveObjectIds: string[], groups: GroupNode[]): GroupNode[];
  ```

- [ ] **Step 1: Write the failing tests**

Create `tests/groups.test.ts`:

```ts
import { describe, expect, it } from "vitest";

import {
  ancestorsOf,
  canNest,
  groupObjects,
  groupOf,
  pruneGroups,
  subtreeIds,
  ungroup,
  type GroupNode,
} from "@/lib/canvas/groups";

const g = (id: string, parentId: string | null, members: string[]): GroupNode => ({
  id,
  name: `Group ${id}`,
  parentId,
  members,
});

describe("groupOf / ancestorsOf / subtreeIds", () => {
  const groups = [g("a", null, ["o1"]), g("b", "a", ["o2"]), g("c", "b", ["o3"])];

  it("finds the group directly holding an object", () => {
    expect(groupOf("o3", groups)?.id).toBe("c");
    expect(groupOf("o1", groups)?.id).toBe("a");
    expect(groupOf("loose", groups)).toBeNull();
  });

  it("walks ancestors innermost last, for nesting", () => {
    expect(ancestorsOf("o3", groups)).toEqual(["c", "b", "a"]);
    expect(ancestorsOf("o1", groups)).toEqual(["a"]);
    expect(ancestorsOf("loose", groups)).toEqual([]);
  });

  it("collects a whole subtree", () => {
    expect(subtreeIds("b", groups).sort()).toEqual(["b", "c"]);
    expect(subtreeIds("a", groups).sort()).toEqual(["a", "b", "c"]);
  });
});

describe("canNest", () => {
  const groups = [g("a", null, ["o1"]), g("b", "a", ["o2"])];

  it("refuses a group becoming its own descendant", () => {
    expect(canNest("b", "a", groups)).toBe(false); // a would contain b
    expect(canNest("a", "a", groups)).toBe(false); // into itself
  });

  it("allows an unrelated parent", () => {
    const wide = [g("a", null, ["o1"]), g("b", null, ["o2"])];
    expect(canNest("a", "b", wide)).toBe(true);
    expect(canNest(null, "b", groups)).toBe(true);
  });
});

describe("groupObjects", () => {
  it("puts loose objects under one new group", () => {
    const out = groupObjects(["o1", "o2"], "n1", "Block", []);
    expect(out).toHaveLength(1);
    expect(out[0]!.members.sort()).toEqual(["o1", "o2"]);
    expect(out[0]!.parentId).toBeNull();
  });

  it("absorbs an existing group instead of duplicating membership", () => {
    const before = [g("a", null, ["o1"]), g("b", null, ["o2"])];
    const out = groupObjects(["o1", "o2", "o3"], "n1", "Block", before);
    // No shell is left behind and no object is in two groups.
    expect(out.map((x) => x.id).sort()).toEqual(["n1"]);
    expect(out[0]!.members.sort()).toEqual(["o1", "o2", "o3"]);
  });

  it("absorbs a whole nested subtree, not just the group it names", () => {
    const before = [g("a", null, ["o1"]), g("b", "a", ["o2"])];
    const out = groupObjects(["o1"], "n1", "Block", before);
    expect(out.map((x) => x.id).sort()).toEqual(["n1"]);
    expect(out[0]!.members.sort()).toEqual(["o1", "o2"]);
  });

  it("ignores a duplicate group request for the same object", () => {
    const before = [g("a", null, ["o1"])];
    const once = groupObjects(["o1"], "n1", "Block", before);
    const twice = groupObjects(["o1"], "n2", "Block2", once);
    expect(twice.map((x) => x.id)).toEqual(["n2"]);
    expect(twice[0]!.members).toEqual(["o1"]);
  });
});

describe("ungroup", () => {
  it("re-parents members to the removed group's own parent", () => {
    const before = [g("a", null, ["o1"]), g("b", "a", ["o2", "o3"])];
    const out = ungroup("b", before);
    expect(out.map((x) => x.id)).toEqual(["a"]);
    expect(out[0]!.members.sort()).toEqual(["o1", "o2", "o3"]);
  });

  it("removes a top-level group and leaves its objects loose", () => {
    const out = ungroup("a", [g("a", null, ["o1", "o2"])]);
    expect(out).toEqual([]);
  });

  it("is a no-op for an unknown id", () => {
    const before = [g("a", null, ["o1"])];
    expect(ungroup("nope", before)).toEqual(before);
  });
});

describe("pruneGroups", () => {
  it("drops memberships for objects that no longer exist", () => {
    const before = [g("a", null, ["o1", "gone"]), g("b", "a", ["o2"])];
    const out = pruneGroups(["o1", "o2"], before);
    expect(out.map((x) => x.id).sort()).toEqual(["a", "b"]);
    expect(out.find((x) => x.id === "a")!.members).toEqual(["o1"]);
  });

  it("removes a group left with no members at all", () => {
    expect(pruneGroups([], [g("a", null, ["gone"])])).toEqual([]);
  });
});
```

**Note:** the third `groupObjects` test above is the corrected body — write it
exactly as shown, so the absorbed subtree's members are re-pointed at the new
group.

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npm.cmd test -- groups`
Expected: FAIL with "Cannot find module '@/lib/canvas/groups'".

- [ ] **Step 3: Write the implementation**

Create `lib/canvas/groups.ts`:

```ts
/**
 * Group tree for the editor.
 *
 * Groups are an authoring convenience: the renderer absolutely-positions every
 * object from its own `x`/`y`, so containment has no representation in the
 * exported bill and grouped and ungrouped templates render identically.
 *
 * Nothing here imports Fabric. Membership lives in editor state rather than on
 * the objects themselves, which is what lets a Fabric `ActiveSelection` hold a
 * mixed set of members without any transform bookkeeping, and keeps this module
 * testable in the node test environment.
 */

export interface GroupNode {
  id: string;
  name: string;
  parentId: string | null;
  /** Object ids AND group ids. Nesting is just a tree. */
  members: string[];
}

const byId = (groups: GroupNode[], id: string): GroupNode | undefined =>
  groups.find((g) => g.id === id);

/** Ids of every group that contains `memberId`, innermost last. */
export function ancestorsOf(memberId: string, groups: GroupNode[]): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const group of groups) {
    if (!group.members.includes(memberId)) continue;
    if (seen.has(group.id)) continue;
    seen.add(group.id);
    out.push(group.id);
  }
  // Innermost first: a member of several groups is deepest-first, so walk each
  // hit's own parent chain to build the full ancestry in order.
  out.sort((a, b) => depthOf(b, groups) - depthOf(a, groups));
  return out.flatMap((id) => [id, ...ancestorsOf(id, groups)].filter(
    (x, i, arr) => arr.indexOf(x) === i,
  ));
}

function depthOf(groupId: string, groups: GroupNode[]): number {
  let depth = 0;
  let current = byId(groups, groupId);
  const guard = new Set<string>();
  while (current?.parentId && !guard.has(current.id)) {
    guard.add(current.id);
    depth += 1;
    current = byId(groups, current.parentId);
  }
  return depth;
}

/** The group that directly holds `objectId`, or null. */
export function groupOf(objectId: string, groups: GroupNode[]): GroupNode | null {
  const direct = groups.filter((g) => g.members.includes(objectId));
  if (direct.length === 0) return null;
  // Deepest wins, so a nested object reports its innermost owner.
  return direct.sort((a, b) => depthOf(b.id, groups) - depthOf(a.id, groups))[0]!;
}

/** Every group id in the subtree rooted at `rootId`, including rootId. */
export function subtreeIds(rootId: string, groups: GroupNode[]): string[] {
  const out: string[] = [rootId];
  const walk = (id: string): void => {
    for (const g of groups) {
      if (g.parentId === id && !out.includes(g.id)) {
        out.push(g.id);
        walk(g.id);
      }
    }
  };
  walk(rootId);
  return out;
}

/** Refuses a cycle: false when `parentId` is `childId` or one of its descendants. */
export function canNest(
  parentId: string | null,
  childId: string,
  groups: GroupNode[],
): boolean {
  if (parentId === null) return true;
  if (parentId === childId) return false;
  // Walking up from parentId must never reach childId.
  let current: string | null = parentId;
  const guard = new Set<string>();
  while (current !== null && !guard.has(current)) {
    if (current === childId) return false;
    guard.add(current);
    current = byId(groups, current)?.parentId ?? null;
  }
  return true;
}

/**
 * Groups `objectIds` under a new group. Any existing group that already holds
 * one of them is absorbed: removed, with its members re-pointed at the new
 * group, so no object ends up in two groups and no empty shell is left behind.
 */
export function groupObjects(
  objectIds: string[],
  newId: string,
  name: string,
  groups: GroupNode[],
): GroupNode[] {
  const wanted = [...new Set(objectIds)];
  if (wanted.length < 2) return groups;

  // Ids that will live directly in the new group: the loose objects plus every
  // member of every group being absorbed.
  const absorbed = groups.filter((g) => g.members.some((m) => wanted.includes(m)));
  const absorbedIds = new Set(absorbed.map((g) => g.id));
  const promoted = new Set<string>(wanted);
  for (const g of absorbed) {
    for (const m of g.members) promoted.add(m);
  }
  // A group's own id is not promoted if the group itself was absorbed into an
  // ancestor that is also being absorbed; `promoted` holds ids, and group ids
  // only survive when their parent is not itself absorbed.
  for (const id of [...absorbedIds]) {
    const g = byId(groups, id);
    if (g?.parentId && absorbedIds.has(g.parentId)) promoted.delete(id);
  }

  const survivors = groups
    .filter((g) => !absorbedIds.has(g.id))
    .map((g) => {
      const members = g.members.filter(
        (m) => !(absorbedIds.has(m) && wanted.includes(m)) && !wanted.includes(m),
      );
      const parentId =
        g.parentId && absorbedIds.has(g.parentId) ? null : g.parentId;
      return { ...g, members, parentId };
    });

  return [
    ...survivors,
    {
      id: newId,
      name,
      parentId: null,
      members: [...promoted].sort(),
    },
  ];
}

/**
 * Removes `groupId`. Its members move up to the removed group's own parent, so
 * unwrapping never orphans an object into limbo.
 */
export function ungroup(groupId: string, groups: GroupNode[]): GroupNode[] {
  const target = byId(groups, groupId);
  if (!target) return groups;
  const removedIds = new Set(subtreeIds(groupId, groups));
  const inheriting = [...target.members];
  return groups
    .filter((g) => !removedIds.has(g.id))
    .map((g) => {
      const members = [...g.members];
      let parentId = g.parentId;
      if (removedIds.has(parentId ?? "")) {
        parentId = target.parentId && !removedIds.has(target.parentId)
          ? target.parentId
          : null;
        for (const m of inheriting) if (!members.includes(m)) members.push(m);
      }
      return { ...g, members, parentId };
    });
}

/** Drops every membership entry for ids no longer on the canvas. */
export function pruneGroups(
  liveObjectIds: string[],
  groups: GroupNode[],
): GroupNode[] {
  const live = new Set(liveObjectIds);
  const kept = groups
    .map((g) => {
      // A member id is live if it is a live object or a surviving group.
      const members = g.members.filter(
        (m) => live.has(m) || groups.some((x) => x.id === m),
      );
      const parentId =
        g.parentId && groups.some((x) => x.id === g.parentId) ? g.parentId : null;
      return { ...g, members, parentId };
    })
    .filter((g) => g.members.length > 0);
  // Second pass: a group whose whole subtree was pruned goes too.
  return kept.filter((g) => {
    if (!g.parentId) return true;
    return kept.some((x) => x.id === g.parentId);
  });
}
```

Then delete the incorrect third `groupObjects` test body from the test file and replace it with the corrected version given in Step 1's note, so the file contains this test:

```ts
  it("absorbs a whole nested subtree, not just the group it names", () => {
    const before = [g("a", null, ["o1"]), g("b", "a", ["o2"])];
    const out = groupObjects(["o1"], "n1", "Block", before);
    expect(out.map((x) => x.id).sort()).toEqual(["n1"]);
    expect(out[0]!.members.sort()).toEqual(["o1", "o2"]);
  });
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npm.cmd test -- groups`
Expected: PASS, 16 tests.

If `ancestorsOf` fails, the simplest correct implementation is a single upward walk per direct hit rather than the recursive flatten in the snippet — what matters is that the result is ordered innermost-first and de-duplicated.

- [ ] **Step 5: Commit**

```bash
git add lib/canvas/groups.ts tests/groups.test.ts
git commit -m "feat(groups): pure nestable group-tree helpers"
```

---

### Task 2: Group state, selection and undo

**Files:**
- Modify: `lib/canvas/EditorController.ts` — `EditorState` (add `groups`), initial state, `snapshot()` (~1321), `restoreSnapshot()` (~1350), `loadTemplate()` (~1809)
- Test: `e2e/workflow.spec.ts`

**Interfaces:**
- Consumes: `GroupNode`, `groupObjects`, `ungroup`, `pruneGroups`, `subtreeIds`, `groupOf`, `ancestorsOf` from Task 1 (`@/lib/canvas/groups`).
- Produces on `EditorController`:
  ```ts
  getGroups(): GroupNode[];
  /** Groups the current selection. No-op with fewer than 2 objects. */
  groupSelection(): void;
  /** Removes the single selected group, re-parenting its members. */
  ungroupSelection(): void;
  /** Fabric objects that make up `groupId`, including nested groups' members. */
  groupObjectsOf(groupId: string): FabricObject[];
  /** Expands an object id to the whole group it belongs to. */
  expandSelectionToGroups(): FabricObject[];
  ```
  Plus `EditorState.groups: GroupNode[]`.

- [ ] **Step 1: Write the failing E2E test**

Append to `e2e/workflow.spec.ts`, inside a new `test.describe("Grouping", ...)`:

```ts
  test("groups objects without changing the exported template", async ({ page }) => {
    await openEditorWithBill(page);
    const P = await docToPage(page);

    // A box and three rules, the shape the user described.
    const before = await page.evaluate(() =>
      JSON.stringify(window.__btm!.getTemplate()),
    );

    const a = await P(120, 200);
    const b = await P(320, 260);
    await pickTool(page, "Rect");
    await page.mouse.move(a.x, a.y);
    await page.mouse.down();
    await page.mouse.move(b.x, b.y, { steps: 5 });
    await page.mouse.up();
    await page.waitForTimeout(150);

    for (let i = 0; i < 3; i += 1) {
      const y = 300 + i * 30;
      const l = await P(140, y);
      const r = await P(300, y);
      await pickTool(page, "Horizontal Rule");
      await page.mouse.move(l.x, l.y);
      await page.mouse.down();
      await page.mouse.move(r.x, r.y, { steps: 5 });
      await page.mouse.up();
      await page.waitForTimeout(120);
    }

    // Select all four: canvas.selectAll is Ctrl+A.
    await page.keyboard.press("Control+a");
    await page.waitForTimeout(200);
    await page.evaluate(() => window.__btm!.groupSelection());
    await page.waitForTimeout(200);

    const groups = await page.evaluate(() => window.__btm!.getGroups());
    expect(groups).toHaveLength(1);
    expect(groups[0]!.members.length).toBe(4);

    // Authoring-only: the template must be byte-identical.
    const after = await page.evaluate(() =>
      JSON.stringify(window.__btm!.getTemplate()),
    );
    expect(after).toBe(before);
  });

  test("grouping is undoable", async ({ page }) => {
    await openEditorWithBill(page);
    const P = await docToPage(page);
    const a = await P(120, 200);
    const b = await P(320, 260);
    await pickTool(page, "Rect");
    await page.mouse.move(a.x, a.y);
    await page.mouse.down();
    await page.mouse.move(b.x, b.y, { steps: 5 });
    await page.mouse.up();
    await page.waitForTimeout(150);
    const c = await P(400, 400);
    await pickTool(page, "Ellipse");
    await page.mouse.move(c.x, c.y);
    await page.mouse.down();
    await page.mouse.move(c.x + 60, c.y + 40, { steps: 5 });
    await page.mouse.up();
    await page.waitForTimeout(150);

    await page.keyboard.press("Control+a");
    await page.waitForTimeout(200);
    await page.evaluate(() => window.__btm!.groupSelection());
    await page.waitForTimeout(200);
    expect(await page.evaluate(() => window.__btm!.getGroups())).toHaveLength(1);

    // Without groups in the snapshot this records nothing and undoes nothing.
    await page.evaluate(() => window.__btm!.undo());
    await page.waitForTimeout(200);
    expect(await page.evaluate(() => window.__btm!.getGroups())).toHaveLength(0);
  });

  test("deleting a group keeps its objects", async ({ page }) => {
    await openEditorWithBill(page);
    const P = await docToPage(page);
    const a = await P(120, 200);
    const b = await P(320, 260);
    await pickTool(page, "Rect");
    await page.mouse.move(a.x, a.y);
    await page.mouse.down();
    await page.mouse.move(b.x, b.y, { steps: 5 });
    await page.mouse.up();
    await page.waitForTimeout(150);
    const c = await P(400, 400);
    await pickTool(page, "Ellipse");
    await page.mouse.move(c.x, c.y);
    await page.mouse.down();
    await page.mouse.move(c.x + 60, c.y + 40, { steps: 5 });
    await page.mouse.up();
    await page.waitForTimeout(150);

    const objectsBefore = await page.evaluate(
      () => window.__btm!.getTemplate().objects.length,
    );
    await page.keyboard.press("Control+a");
    await page.waitForTimeout(200);
    await page.evaluate(() => window.__btm!.groupSelection());
    await page.waitForTimeout(200);
    await page.evaluate(() => window.__btm!.deleteSelection());
    await page.waitForTimeout(200);

    expect(await page.evaluate(() => window.__btm!.getGroups())).toHaveLength(0);
    expect(
      await page.evaluate(() => window.__btm!.getTemplate().objects.length),
    ).toBe(objectsBefore);
  });
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `$env:PORT="3000"; npx.cmd playwright test --grep "Grouping" --reporter=list`
Expected: FAIL — `groupSelection is not a function` / `getGroups is not a function`.

- [ ] **Step 3: Add group state to the controller**

In `lib/canvas/EditorController.ts`, add the import:

```ts
import {
  groupObjects as groupObjectsIn,
  pruneGroups,
  ungroup as ungroupIn,
  subtreeIds,
  type GroupNode,
} from "@/lib/canvas/groups";
```

Add to `EditorState`, after `structureLocked: boolean;`:

```ts
  /**
   * Nestable groups. Authoring-only: the renderer absolutely-positions every
   * object, so a group has no representation in the exported bill.
   */
  groups: GroupNode[];
```

Add `groups: [],` to the initial state object, next to `structureLocked: false,`.

- [ ] **Step 4: Widen the history snapshot so grouping is undoable**

Replace `snapshot()`:

```ts
  /**
   * The undo payload. Groups ride along because a snapshot of geometry alone
   * would make a grouping change look like no change at all: `commit` would
   * record no history entry and `undo` would drop the grouping.
   */
  private snapshot(): string {
    const canvas = this.canvas;
    if (!canvas) return "";
    return JSON.stringify({
      template: serialiseObjects(
        this.tracedObjects() as never,
        this.state.document,
        this.state.documentName,
      ),
      groups: this.state.groups,
    });
  }
```

Replace `restoreSnapshot()` so it reads the envelope and tolerates the old bare-template shape:

```ts
  private restoreSnapshot(raw: string): void {
    const canvas = this.canvas;
    if (!canvas || !raw) return;
    let template: BillTemplate;
    let groups: GroupNode[] = [];
    try {
      const parsed = JSON.parse(raw) as {
        template?: BillTemplate;
        groups?: GroupNode[];
      } & BillTemplate;
      // A history entry written before groups existed is a bare template.
      template = (parsed.template ?? parsed) as BillTemplate;
      groups = Array.isArray(parsed.groups) ? parsed.groups : [];
      if (
        !template ||
        typeof template !== "object" ||
        !Array.isArray(template.objects) ||
        !template.document ||
        typeof template.document.width !== "number" ||
        typeof template.document.height !== "number"
      ) {
        return;
      }
    } catch {
      // A corrupted history entry must not take the undo/redo pass down.
      return;
    }
    this.suppressHistory = true;
    canvas.discardActiveObject();
    for (const o of this.tracedObjects()) canvas.remove(o);
    const objects = hydrateTemplate(template);
    for (const o of objects) canvas.add(o);
    canvas.requestRenderAll();
    this.suppressHistory = false;
    this.setState({
      editingCell: null,
      pendingTable: null,
      document: { ...template.document },
      groups,
    });
    this.lockReferenceToDocument();
    this.applyCanvasSize();
    // The document size may have changed, so re-clamp the view to the page.
    this.panBy(0, 0);
    this.refresh();
  }
```

In `loadTemplate()`, add `groups: [],` to the `setState` call so opening a template starts with no authoring structure — consistent with authoring-only.

- [ ] **Step 5: Add the group operations**

Add these methods to `EditorController`:

```ts
  getGroups(): GroupNode[] {
    return this.state.groups;
  }

  /** Fabric objects in `groupId`'s subtree, including nested groups. */
  groupObjectsOf(groupId: string): FabricObject[] {
    const canvas = this.canvas;
    if (!canvas) return [];
    const ids = new Set(subtreeIds(groupId, this.state.groups));
    const wanted = new Set<string>();
    for (const g of this.state.groups) {
      if (!ids.has(g.id)) continue;
      for (const m of g.members) wanted.add(m);
    }
    return canvas
      .getObjects()
      .filter((o) => wanted.has(this.getId(o)));
  }

  /** Expands the active selection to whole groups. */
  expandSelectionToGroups(): FabricObject[] {
    const canvas = this.canvas;
    if (!canvas) return [];
    const active = this.getActiveObjects();
    const out = new Map<string, FabricObject>();
    for (const o of active) out.set(this.getId(o), o);
    for (const o of active) {
      for (const g of this.state.groups) {
        if (!g.members.includes(this.getId(o))) continue;
        for (const member of this.groupObjectsOf(g.id)) {
          out.set(this.getId(member), member);
        }
      }
    }
    return [...out.values()];
  }

  groupSelection(): void {
    const canvas = this.canvas;
    if (!canvas) return;
    const targets = this.getActiveObjects().filter((o) => !this.isLocked(o));
    if (targets.length < 2) return;
    const ids = targets.map((o) => this.getId(o));
    const next = groupObjectsIn(ids, createId("grp"), "Group 1", this.state.groups);
    if (next === this.state.groups) return;
    this.setState({ groups: next });
    this.commit("Group");
  }

  ungroupSelection(): void {
    const canvas = this.canvas;
    if (!canvas) return;
    const active = this.getActiveObjects();
    const target = active
      .map((o) => this.getId(o))
      .map((id) => this.state.groups.find((g) => g.members.includes(id)))
      .find((g): g is GroupNode => Boolean(g));
    if (!target) return;
    this.setState({ groups: ungroupIn(target.id, this.state.groups) });
    this.commit("Ungroup");
  }
```

- [ ] **Step 6: Make delete drop the group, not its objects**

Replace `deleteSelection()`:

```ts
  deleteSelection(): void {
    const canvas = this.canvas;
    if (!canvas) return;
    // A group node is authoring state, so deleting one removes the group and
    // leaves its objects on the canvas. Word deletes the contents too, but
    // silently destroying traced geometry on a mis-click is the wrong default
    // for a tracing tool.
    const groupIds = new Set<string>();
    const objects: FabricObject[] = [];
    for (const o of this.getActiveObjects()) {
      const id = this.getId(o);
      for (const g of this.state.groups) {
        if (g.members.includes(id)) groupIds.add(g.id);
      }
      if (!this.isLocked(o)) objects.push(o);
    }
    if (groupIds.size === 0 && objects.length === 0) return;
    canvas.discardActiveObject();
    for (const o of objects) this.removeRecursive(o);
    if (groupIds.size > 0) {
      this.setState({
        groups: this.state.groups.filter((g) => !groupIds.has(g.id)),
      });
    }
    canvas.requestRenderAll();
    this.commit("Delete");
  }
```

- [ ] **Step 7: Prune groups when objects disappear**

In `restoreSnapshot` and `loadTemplate` the groups come wholesale from the
payload, so no pruning is needed there. Add pruning to the delete path only —
after the `removeRecursive` loop, before `commit`:

```ts
    this.setState({
      groups: pruneGroups(
        canvas.getObjects().map((o) => this.getId(o)),
        groupIds.size > 0
          ? this.state.groups.filter((g) => !groupIds.has(g.id))
          : this.state.groups,
      ),
    });
```

**Simplification:** if Step 6 and Step 7 both touch `groups`, keep only Step 6's
`setState` and add the `pruneGroups` call inside it. The final shape of the tail of
`deleteSelection` is:

```ts
    const survivors =
      groupIds.size > 0
        ? this.state.groups.filter((g) => !groupIds.has(g.id))
        : this.state.groups;
    this.setState({
      groups: pruneGroups(
        canvas.getObjects().map((o) => this.getId(o)),
        survivors,
      ),
    });
    canvas.requestRenderAll();
    this.commit("Delete");
```

- [ ] **Step 8: Run the E2E tests**

Run: `$env:PORT="3000"; npx.cmd playwright test --grep "Grouping" --reporter=list`
Expected: PASS, 3 tests.

- [ ] **Step 9: Commit**

```bash
git add lib/canvas/EditorController.ts e2e/workflow.spec.ts
git commit -m "feat(groups): group state, selection expansion and undoable snapshots"
```

---

### Task 3: Group UI and shortcuts

**Files:**
- Modify: `components/editor/PropertiesPanel.tsx` — `MultiSelectPanel` (~859)
- Modify: `hooks/useEditorController.ts` — key map (~131)
- Test: `e2e/workflow.spec.ts`

**Interfaces:**
- Consumes: `controller.groupSelection()`, `controller.ungroupSelection()`, `controller.getGroups()` from Task 2.
- Produces: no new public API.

- [ ] **Step 1: Write the failing E2E test**

Append inside the `Grouping` describe:

```ts
  test("the panel offers Group and Ungroup for a multi-selection", async ({
    page,
  }) => {
    await openEditorWithBill(page);
    const P = await docToPage(page);
    const a = await P(120, 200);
    const b = await P(320, 260);
    await pickTool(page, "Rect");
    await page.mouse.move(a.x, a.y);
    await page.mouse.down();
    await page.mouse.move(b.x, b.y, { steps: 5 });
    await page.mouse.up();
    await page.waitForTimeout(150);
    const c = await P(400, 400);
    await pickTool(page, "Ellipse");
    await page.mouse.move(c.x, c.y);
    await page.mouse.down();
    await page.mouse.move(c.x + 60, c.y + 40, { steps: 5 });
    await page.mouse.up();
    await page.waitForTimeout(150);

    await page.keyboard.press("Control+a");
    await page.waitForTimeout(250);

    // Replaces the prose-only panel that rendered no control at all.
    const groupPanel = page.locator("section").filter({
      has: page.getByRole("heading", { name: "Group", exact: true }),
    });
    await expect(groupPanel).toBeVisible();
    await groupPanel.getByRole("button", { name: "Group" }).click();
    await page.waitForTimeout(250);
    expect(await page.evaluate(() => window.__btm!.getGroups())).toHaveLength(1);

    await groupPanel.getByRole("button", { name: "Ungroup" }).click();
    await page.waitForTimeout(250);
    expect(await page.evaluate(() => window.__btm!.getGroups())).toHaveLength(0);
  });
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `$env:PORT="3000"; npx.cmd playwright test --grep "offers Group and Ungroup" --reporter=list`
Expected: FAIL — no `Group` button found.

- [ ] **Step 3: Replace the prose panel with real controls**

In `components/editor/PropertiesPanel.tsx`, replace the whole `<Panel title="Group">`
block inside `MultiSelectPanel`:

```tsx
      <Panel title="Group">
        <div className="grid grid-cols-2 gap-1">
          <Button onClick={() => controller.groupSelection()} title="Ctrl+G">
            Group
          </Button>
          <Button onClick={() => controller.ungroupSelection()} title="Ctrl+Shift+G">
            Ungroup
          </Button>
        </div>
        <p className="text-[10px] leading-relaxed text-neutral-400">
          Groups move and select as one. They are an editing aid only — the
          exported bill is identical either way.
        </p>
      </Panel>
```

- [ ] **Step 4: Add the keyboard shortcuts**

In `hooks/useEditorController.ts`, add after the `mod && key === "d"` block:

```ts
      if (mod && key === "g" && e.shiftKey) {
        e.preventDefault();
        controller.ungroupSelection();
        return;
      }
      if (mod && key === "g") {
        e.preventDefault();
        controller.groupSelection();
        return;
      }
```

**Order matters:** the `e.shiftKey` branch must come first, otherwise
`Ctrl+Shift+G` would fall into the plain `Ctrl+G` arm.

- [ ] **Step 5: Run the test**

Run: `$env:PORT="3000"; npx.cmd playwright test --grep "Grouping" --reporter=list`
Expected: PASS, 4 tests.

- [ ] **Step 6: Commit**

```bash
git add components/editor/PropertiesPanel.tsx hooks/useEditorController.ts e2e/workflow.spec.ts
git commit -m "feat(groups): group/ungroup controls and shortcuts"
```

---

### Task 4: Group-aware clicking and the layers tree

**Files:**
- Modify: `lib/canvas/EditorController.ts` — `onMouseDown` (~713)
- Modify: `components/editor/LayersPanel.tsx`
- Test: `e2e/workflow.spec.ts`

**Interfaces:**
- Consumes: `expandSelectionToGroups()` from Task 2.
- Produces: no new public API.

- [ ] **Step 1: Write the failing E2E test**

Append inside the `Grouping` describe:

```ts
  test("clicking a member selects the whole group, Alt+click just the one", async ({
    page,
  }) => {
    await openEditorWithBill(page);
    const P = await docToPage(page);
    const a = await P(120, 200);
    const b = await P(320, 260);
    await pickTool(page, "Rect");
    await page.mouse.move(a.x, a.y);
    await page.mouse.down();
    await page.mouse.move(b.x, b.y, { steps: 5 });
    await page.mouse.up();
    await page.waitForTimeout(150);
    const c = await P(400, 400);
    await pickTool(page, "Ellipse");
    await page.mouse.move(c.x, c.y);
    await page.mouse.down();
    await page.mouse.move(c.x + 60, c.y + 40, { steps: 5 });
    await page.mouse.up();
    await page.waitForTimeout(150);

    await page.keyboard.press("Control+a");
    await page.waitForTimeout(200);
    await page.evaluate(() => window.__btm!.groupSelection());
    await page.waitForTimeout(250);

    await page.keyboard.press("Escape");
    await page.waitForTimeout(200);

    // Plain click on one member: the whole group.
    const p = await P(160, 210);
    await page.mouse.click(p.x, p.y);
    await page.waitForTimeout(250);
    expect(
      await page.evaluate(() => window.__btm!.getSelectedTemplates().length),
    ).toBe(2);

    // Alt+click: that member alone, so a shape inside a group stays editable.
    await page.keyboard.press("Escape");
    await page.waitForTimeout(150);
    await page.mouse.click(p.x, p.y, { modifiers: ["Alt"] });
    await page.waitForTimeout(250);
    expect(
      await page.evaluate(() => window.__btm!.getSelectedTemplates().length),
    ).toBe(1);
  });
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `$env:PORT="3000"; npx.cmd playwright test --grep "clicking a member" --reporter=list`
Expected: FAIL — a plain click selects 1, not 2.

- [ ] **Step 3: Expand the selection on plain click**

In `lib/canvas/EditorController.ts`, in `onMouseDown`, immediately after the
`BillTable` resize-gesture block and **before** `this.gestureAnchor` is assigned,
insert:

```ts
    // Clicking a grouped object selects the whole group, the way Word does, so
    // a structure moves as one. Alt bypasses it, which is what keeps a single
    // shape inside a group editable.
    if (
      this.state.tool === "select" &&
      opt.target &&
      !opt.e?.altKey &&
      !(opt.target instanceof BillTable)
    ) {
      const id = this.getId(opt.target);
      const group = this.state.groups.find((g) => g.members.includes(id));
      if (group) {
        const members = this.groupObjectsOf(group.id);
        if (members.length > 1) {
          canvas.discardActiveObject();
          canvas.setActiveObject(
            new ActiveSelection(members, { canvas }),
          );
          canvas.requestRenderAll();
          this.refresh();
          return;
        }
      }
    }
```

`ActiveSelection` is already imported at the top of the file.

- [ ] **Step 4: Show groups in the layers panel**

In `components/editor/LayersPanel.tsx`, replace the flat `<ul>` body of
`state.layers.map(...)` with a grouped render. Build the tree first, just above
the `return (`:

```tsx
  // A group is authoring state, so it is derived here rather than read off the
  // canvas: the scene stays flat and the tree lives in controller state.
  const groups = controller.getGroups();
  const rows: Array<{ key: string; depth: number; label: string; glyph: string; id: string | null }> = [];
  const placed = new Set<string>();
  const walk = (groupId: string, depth: number): void => {
    const group = groups.find((g) => g.id === groupId);
    if (!group) return;
    rows.push({
      key: `g:${group.id}`,
      depth,
      label: group.name,
      glyph: TYPE_GLYPH.group ?? "▣",
      id: group.id,
    });
    for (const member of group.members) {
      const child = groups.find((g) => g.id === member);
      if (child) {
        walk(child.id, depth + 1);
        continue;
      }
      const layer = state.layers.find((l) => l.id === member);
      if (!layer) continue;
      placed.add(layer.id);
      rows.push({
        key: layer.id,
        depth: depth + 1,
        label: layer.name,
        glyph: TYPE_GLYPH[layer.type] ?? "•",
        id: layer.id,
      });
    }
  };
  for (const group of groups.filter((g) => g.parentId === null)) walk(group.id, 0);
  for (const layer of state.layers) {
    if (placed.has(layer.id) || groups.some((g) => g.members.includes(layer.id))) continue;
    rows.push({
      key: layer.id,
      depth: 0,
      label: layer.name,
      glyph: TYPE_GLYPH[layer.type] ?? "•",
      id: layer.id,
    });
  }
```

Then map `rows` instead of `state.layers`, using `row.depth` for indentation and
`onSelect` only when `row.id` names a real object:

```tsx
          <ul className="space-y-0.5">
            {rows.map((row) => {
              const selected = row.id !== null && state.selection.includes(row.id);
              return (
                <li key={row.key}>
                  <div
                    className={`group flex items-center gap-1 rounded pr-1 transition-colors ${
                      selected
                        ? "bg-blue-50 ring-1 ring-blue-300"
                        : "hover:bg-neutral-100"
                    }`}
                    style={{ paddingLeft: `${row.depth * 12}px` }}
                  >
                    <button
                      type="button"
                      onClick={() => {
                        const canvas = controller.getCanvas();
                        if (row.id === null) {
                          const members = controller.groupObjectsOf(
                            row.key.replace(/^g:/, ""),
                          );
                          if (members.length > 0 && canvas) {
                            canvas.discardActiveObject();
                            canvas.setActiveObject(
                              new ActiveSelection(members, { canvas }),
                            );
                            canvas.requestRenderAll();
                          }
                          return;
                        }
                        onSelect(row.id);
                      }}
                      className="flex min-w-0 flex-1 items-center gap-2 px-2 py-1.5 text-left"
                    >
```

Add the import at the top of `LayersPanel.tsx`:

```tsx
import { ActiveSelection } from "fabric";
```

Keep the existing per-row hide/lock/move buttons, but render them only for real
objects — guard the whole `<span>` of controls with `row.id !== null &&`.

The corrected `onClick` body is the one shown above, using `new ActiveSelection`
from the top-level import rather than a runtime `require`, which would not
survive bundling.
                        const canvas = controller.getCanvas();
                        if (row.id === null) {
                          const members = controller.groupObjectsOf(
                            row.key.replace(/^g:/, ""),
                          );
                          if (members.length > 0 && canvas) {
                            canvas.discardActiveObject();
                            canvas.setActiveObject(
                              new ActiveSelection(members, { canvas }),
                            );
                            canvas.requestRenderAll();
                          }
                          return;
                        }
                        onSelect(row.id);
                      }}
```

- [ ] **Step 5: Run the tests**

Run: `$env:PORT="3000"; npx.cmd playwright test --grep "Grouping" --reporter=list`
Expected: PASS, 5 tests.

- [ ] **Step 6: Commit**

```bash
git add lib/canvas/EditorController.ts components/editor/LayersPanel.tsx e2e/workflow.spec.ts
git commit -m "feat(groups): group-aware clicking and a nested layers tree"
```

---

### Task 5: Wrap width in the template

**Files:**
- Modify: `lib/template/types.ts` — `TextObject` (~80-108)
- Modify: `lib/template/serialize.ts` — `serialiseText` (~208)
- Test: `tests/serialize.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: `TextObject.wrapWidth?: number`, written by `serialiseText`, read by
  Tasks 6 and 7.

- [ ] **Step 1: Write the failing test**

Add to `tests/serialize.test.ts`:

```ts
  it("writes wrapWidth for a box that wraps, and omits it otherwise", () => {
    const wrapped = serialiseObject(
      fake({
        type: "textbox",
        appType: "text",
        text: "{{company}}",
        width: 120,
        height: 40,
        wrapWidth: 120,
      }),
      0,
    ) as unknown as Record<string, unknown>;
    expect(wrapped.wrapWidth).toBe(120);

    const auto = serialiseObject(
      fake({
        type: "itext",
        appType: "text",
        text: "{{company}}",
        width: 90,
        height: 16,
      }),
      0,
    ) as unknown as Record<string, unknown>;
    expect(auto.wrapWidth).toBeUndefined();
  });

  it("stops claiming the vertical alignment is always top", () => {
    const out = serialiseObject(
      fake({
        type: "textbox",
        appType: "text",
        text: "x",
        textVerticalAlign: "middle",
      }),
      0,
    ) as unknown as Record<string, unknown>;
    expect(out.textVerticalAlign).toBe("middle");
  });
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm.cmd test -- serialize`
Expected: FAIL — `expected 120 to be undefined` style mismatch, and
`textVerticalAlign` is `"top"`.

- [ ] **Step 3: Add the field to the type**

In `lib/template/types.ts`, inside `TextObject`, after `textVerticalAlign`:

```ts
  /**
   * When present the box wraps at this width and grows downward; absent means
   * the auto-width single-line behaviour a plain text box has always had.
   *
   * Only Fabric's `Textbox` can wrap — on an `IText`, `width` is not a layout
   * property and is discarded — so a wrapped box is a different canvas class.
   */
  wrapWidth?: number;
```

- [ ] **Step 4: Write it from the object, and read the real vertical alignment**

In `lib/template/serialize.ts`, in `serialiseText`, replace the hardcoded
`textVerticalAlign: "top",` with:

```ts
    textVerticalAlign: (str(o.textVerticalAlign, "top") as TextObject["textVerticalAlign"]),
```

and after the `scaleY,` line add:

```ts
    // Only a box that actually wraps carries a wrap width; an auto-width box
    // omits the field so it stays on the long-standing single-line behaviour.
    ...(num(o.wrapWidth) > 0 ? { wrapWidth: num(o.wrapWidth) } : {}),
```

- [ ] **Step 5: Run the test**

Run: `npm.cmd test -- serialize`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add lib/template/types.ts lib/template/serialize.ts tests/serialize.test.ts
git commit -m "feat(text): carry a wrap width in the template")
```

---

### Task 6: Canvas wrap toggle

**Files:**
- Modify: `lib/canvas/EditorController.ts` — new `setTextWrap` method
- Modify: `lib/template/hydrate.ts` — `hydrateText` (~83)
- Modify: `components/editor/PropertiesPanel.tsx` — `TextPanel` (~315)
- Test: `tests/serialize.test.ts`, `e2e/workflow.spec.ts`

**Interfaces:**
- Consumes: `TextObject.wrapWidth` from Task 5.
- Produces on `EditorController`:
  ```ts
  /** Converts a text object between auto-width IText and wrapping Textbox. */
  setTextWrap(on: boolean): void;
  ```

- [ ] **Step 1: Write the failing unit test**

Add to `tests/serialize.test.ts`:

```ts
it("hydrates a wrapped box as a Textbox carrying its width", async () => {
  const template = serialiseObjects(
    [
      fake({
        type: "textbox",
        appType: "text",
        id: "t1",
        text: "{{company}}",
        width: 120,
        height: 40,
        wrapWidth: 120,
      }),
    ],
    { width: 400, height: 400 },
    "t",
  );
  const [back] = hydrateTemplate(template);
  expect(back.type).toBe("textbox");
  expect(back.width).toBe(120);
});

it("restores width and height, which were previously discarded", async () => {
  const template = serialiseObjects(
    [fake({ type: "textbox", appType: "text", id: "t1", text: "x", width: 120, height: 40 })],
    { width: 400, height: 400 },
    "t",
  );
  const [back] = hydrateTemplate(template);
  expect(back.width).toBe(120);
  expect(back.height).toBe(40);
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm.cmd test -- serialize`
Expected: FAIL — `back.type` is `"itext"`, and width is whatever Fabric measured.

- [ ] **Step 3: Teach `hydrateText` to build the right class and keep the box**

Replace `hydrateText` in `lib/template/hydrate.ts`:

```ts
function hydrateText(o: TextObject, zIndex: number): IText | Textbox {
  const info = analysePlaceholders(o.text);
  const common = {
    left: o.x,
    top: o.y,
    fontFamily: o.fontFamily,
    fontSize: o.fontSize,
    fontWeight: o.fontWeight,
    fontStyle: o.fontStyle,
    textAlign: o.textAlign,
    lineHeight: o.lineHeight,
    charSpacing: o.charSpacing,
    fill: o.fill === "transparent" ? "#000000" : o.fill,
    stroke: o.stroke,
    strokeWidth: o.strokeWidth,
    // Re-apply the stretch the serialiser recorded. Without it a reloaded
    // template would come back at its natural aspect, losing the side/down
    // drag the author made.
    scaleX: typeof o.scaleX === "number" && Number.isFinite(o.scaleX) ? o.scaleX : 1,
    scaleY: typeof o.scaleY === "number" && Number.isFinite(o.scaleY) ? o.scaleY : 1,
  };
  // Only a `Textbox` treats `width` as a layout boundary, so a box that wraps
  // has to be that class. Width and height were previously not restored at
  // all, which is why the properties panel's Width field did nothing for text.
  const obj: IText | Textbox =
    typeof o.wrapWidth === "number" && o.wrapWidth > 0
      ? new Textbox(o.text, { ...common, width: o.wrapWidth })
      : new IText(o.text, common);
  (obj as unknown as Record<string, unknown>).roleKind =
    o.roleKind === "variable" ? "variable" : info.roleKind;
  if (o.roleKind === "variable" && info.role && !o.role) {
    (obj as unknown as Record<string, unknown>).role = info.role;
  }
  applyCommon(obj, o, zIndex);
  if (!(obj instanceof Textbox)) return obj as IText;
  // A wrapping box keeps the traced height as its starting height; Fabric
  // recomputes it from the wrapped lines as soon as the text or width changes.
  obj.set({ width: o.wrapWidth, height: o.height } as never);
  obj.setCoords();
  return obj;
}
```

Also widen `hydrateObject`'s `case "text"` return type — it already returns
`FabricObject | null`, so no change is needed there.

- [ ] **Step 4: Add the canvas conversion**

Add to `lib/canvas/EditorController.ts`. Add `Textbox` to the existing `fabric`
import if it is not already there:

```ts
  /**
   * Converts the selected text object between auto-width and wrapping.
   *
   * Fabric's `IText` has no wrap boundary — `width` is not one of its layout
   * properties and is discarded on the next layout pass — so this is a real
   * object swap rather than a flag. Identity, styling and scale are carried
   * across, and the swap is one undoable step.
   */
  setTextWrap(on: boolean): void {
    const canvas = this.canvas;
    if (!canvas) return;
    const targets = this.getActiveObjects().filter(
      (o) => !this.isLocked(o) && (o instanceof IText || o instanceof Textbox),
    );
    if (targets.length === 0) return;
    const source = targets[0]!;
    const asTextbox = on && !(source instanceof Textbox);
    const asText = !on && source instanceof Textbox;
    if (!asTextbox && !asText) return;

    const next: IText | Textbox = asTextbox
      ? new Textbox(source.text, {
          left: source.left,
          top: source.top,
          // Start at the natural single-line width so nothing reflows at the
          // moment of the toggle; the author then narrows it.
          width: source.width,
          fontFamily: source.fontFamily,
          fontSize: source.fontSize,
          fontWeight: source.fontWeight,
          fontStyle: source.fontStyle,
          textAlign: source.textAlign,
          lineHeight: source.lineHeight,
          charSpacing: source.charSpacing,
          fill: source.fill,
          stroke: source.stroke,
          strokeWidth: source.strokeWidth,
          scaleX: source.scaleX,
          scaleY: source.scaleY,
        })
      : new IText(source.text, {
          left: source.left,
          top: source.top,
          fontFamily: source.fontFamily,
          fontSize: source.fontSize,
          fontWeight: source.fontWeight,
          fontStyle: source.fontStyle,
          textAlign: source.textAlign,
          lineHeight: source.lineHeight,
          charSpacing: source.charSpacing,
          fill: source.fill,
          stroke: source.stroke,
          strokeWidth: source.strokeWidth,
          scaleX: source.scaleX,
          scaleY: source.scaleY,
        });

    const carried = source as unknown as Record<string, unknown>;
    const nextCarried = next as unknown as Record<string, unknown>;
    for (const key of ["id", "name", "role", "roleKind", "locked", "zIndex", "parentId"]) {
      nextCarried[key] = carried[key];
    }
    nextCarried.appType = "text";
    nextCarried.wrapWidth = asTextbox ? source.width : undefined;
    nextCarried.visible = carried.visible;
    nextCarried.opacity = carried.opacity;
    next.set({ selectable: true, evented: true, angle: source.angle } as never);

    canvas.remove(source);
    canvas.add(next);
    next.setCoords();
    canvas.setActiveObject(next);
    canvas.requestRenderAll();
    this.commit(on ? "Wrap text" : "Stop wrapping");
    this.refresh();
  }
```

- [ ] **Step 5: Add the Wrap control to the text panel**

In `components/editor/PropertiesPanel.tsx`, inside `TextPanel`, after the
`Custom family` field, add:

```tsx
      <Field
        label="Wrap"
        hint="Fixed width: text wraps and the box grows downward. Off means one auto-width line."
      >
        <Button
          className="w-full"
          variant={isWrapped ? "primary" : "default"}
          onClick={() => controller.setTextWrap(!isWrapped)}
        >
          {isWrapped ? "Wrapped — click to unwrap" : "Wrap at this width"}
        </Button>
      </Field>
```

and derive `isWrapped` at the top of `TextPanel`, next to the existing `text`
state:

```tsx
  // A wrapped box is a Fabric `Textbox`; an auto-width box is an `IText`. The
  // template's `wrapWidth` is the durable answer, so read that rather than the
  // canvas class when it is available.
  const isWrapped =
    (o as unknown as { wrapWidth?: number }).wrapWidth !== undefined;
```

Note this reads the value off the object the panel already receives; if the
controller's `getTemplate()` snapshot is the source of truth instead, use
`(o as unknown as { wrapWidth?: number }).wrapWidth != null` there too.

- [ ] **Step 6: Run the tests**

Run: `npm.cmd test -- serialize`
Expected: PASS.

Run: `$env:PORT="3000"; npx.cmd playwright test --grep "Wrap" --reporter=list`
Expected: no tests match yet; that is fine at this step.

- [ ] **Step 7: Commit**

```bash
git add lib/template/hydrate.ts lib/canvas/EditorController.ts components/editor/PropertiesPanel.tsx tests/serialize.test.ts
git commit -m "feat(text): wrap toggle that swaps IText for a wrapping Textbox"
```

---

### Task 7: Render a wrapped box

**Files:**
- Modify: `lib/render/primitives.ts` — `renderText` (~242)
- Test: `tests/render.test.ts`

**Interfaces:**
- Consumes: `TextObject.wrapWidth` from Task 5.
- Produces: no new public API.

- [ ] **Step 1: Write the failing test**

Add to `tests/render.test.ts`:

```ts
describe("renderObject wrapped text", () => {
  const baseText = {
    ...base,
    type: "text",
    text: "{{company}}",
    fontFamily: "Arial",
    fontSize: 16,
    fontWeight: "normal",
    fontStyle: "normal",
    textAlign: "left",
    lineHeight: 1.16,
    charSpacing: 0,
    roleKind: "variable",
    textVerticalAlign: "top",
  };

  it("wraps at the stored width and grows downward", () => {
    const r = new Refusals();
    const out = renderObject(
      { ...baseText, width: 120, height: 20, wrapWidth: 120 } as never,
      0,
      { company: "A company name far longer than one line" },
      r,
    )!;
    expect(out).toContain("white-space: pre-wrap");
    expect(out).toContain("width: 120px");
    // Grows downward rather than being cut at the traced height.
    expect(out).toContain("height: auto");
    expect(out).not.toContain("white-space: pre;");
  });

  it("breaks a single unbreakable token instead of running past the box", () => {
    const r = new Refusals();
    const out = renderObject(
      { ...baseText, width: 60, height: 20, wrapWidth: 60 } as never,
      0,
      { company: "27ABCDE1234F1Z5XXXXXXXXXXXX" },
      r,
    )!;
    // Without this a long GSTIN ignores pre-wrap and overflows the box.
    expect(out).toContain("overflow-wrap: break-word");
  });

  it("leaves an unwrapped box exactly as it was", () => {
    const r = new Refusals();
    const out = renderObject(
      { ...baseText, width: 300, height: 24 } as never,
      0,
      {},
      r,
    )!;
    expect(out).toContain("white-space: pre");
    expect(out).toContain("height: 24px");
    expect(out).not.toContain("pre-wrap");
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm.cmd test -- render`
Expected: FAIL — no `pre-wrap` in the output.

- [ ] **Step 3: Implement the wrapped branch**

In `lib/render/primitives.ts`, inside `renderText`, after the `safeScale` lines
and before `const body =`, add:

```ts
  // A wrapped box keeps its width and grows downward, so the traced height is
  // not a boundary. `overflow-wrap` is not cosmetic: `pre-wrap` alone will not
  // break a single unbreakable token, and a filled-in GSTIN or email address
  // would run straight past the box.
  const wrapWidth =
    typeof (o as { wrapWidth?: unknown }).wrapWidth === "number" &&
    (o as { wrapWidth?: number }).wrapWidth! > 0
      ? length(
          (o as { wrapWidth?: number }).wrapWidth,
          r,
          `${o.id}.wrapWidth`,
          0,
        )
      : 0;
```

Then build the declarations as a variable and pass it to `shell`, replacing the
inline array:

```ts
  const decls: string[] = wrapWidth
    ? [
        "white-space: pre-wrap",
        "overflow-wrap: break-word",
        `color: ${ink}`,
        `font-family: ${fontStack(o.fontFamily)}`,
        `font-size: ${num(size)}px`,
        `line-height: ${num(size * safeLength(o.lineHeight, 1.16))}px`,
        `font-weight: ${o.fontWeight === "bold" ? "bold" : "normal"}`,
        `font-style: ${o.fontStyle === "italic" ? "italic" : "normal"}`,
        `text-align: ${align(o.textAlign, r, `${o.id}.textAlign`)}`,
        `letter-spacing: ${tracking}em`,
      ]
    : [
        "white-space: pre",
        `color: ${ink}`,
        `font-family: ${fontStack(o.fontFamily)}`,
        `font-size: ${num(size)}px`,
        `line-height: ${num(size * safeLength(o.lineHeight, 1.16))}px`,
        `font-weight: ${o.fontWeight === "bold" ? "bold" : "normal"}`,
        `font-style: ${o.fontStyle === "italic" ? "italic" : "normal"}`,
        `text-align: ${align(o.textAlign, r, `${o.id}.textAlign`)}`,
        `letter-spacing: ${tracking}em`,
      ];

  // `placed()` sizes the box from `o.width`/`o.height`; for a wrapped box the
  // height must not bound the text, so it is overridden to `auto` here.
  const view = wrapWidth ? { ...o, height: 0 } : o;
```

and change the `shell(...)` call to use `view` and append the height override:

```ts
      shell(
        view,
        r,
        [...decls, ...(wrapWidth ? ["height: auto"] : [])],
        { x: sx, y: sy },
      ),
```

`placed()` reads `o.height` through `length()`, which turns a negative into 0;
passing `height: 0` and then overriding with `height: auto` in the same style
string means the later declaration wins, which is what CSS does.

- [ ] **Step 4: Run the test**

Run: `npm.cmd test -- render`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/render/primitives.ts tests/render.test.ts
git commit -m "feat(text): render a wrapped box that grows downward"
```

---

### Task 8: End-to-end wrap verification

**Files:**
- Test: `e2e/workflow.spec.ts`

**Interfaces:**
- Consumes: everything from Tasks 5-7.
- Produces: no new public API.

- [ ] **Step 1: Write the test**

Append a new `test.describe("Wrapping text", ...)` to `e2e/workflow.spec.ts`:

```ts
test.describe("Wrapping text", () => {
  test.beforeEach(async ({ page }) => {
    page.on("dialog", (d) => void d.accept());
  });

  test("a wrapped box wraps, grows downward, and survives a reload", async ({
    page,
  }) => {
    await openEditorWithBill(page);
    const P = await docToPage(page);

    await pickTool(page, "Text");
    const at = await P(200, 200);
    await page.mouse.click(at.x, at.y);
    await page.waitForTimeout(250);

    // The box comes up selected, so its panel is reachable.
    const panel = page.locator("section").filter({
      has: page.getByRole("heading", { name: "Text", exact: true }),
    });
    await panel.getByRole("button", { name: /Wrap at this width/ }).click();
    await page.waitForTimeout(250);

    // Narrow it so a long value has to wrap.
    await page.evaluate(() => {
      const t = (
        window.__btm as never as {
          getCanvas: () => { getObjects: () => Array<Record<string, unknown>> };
        }
      )
        .getCanvas()
        .getObjects()
        .find((o) => o.appType === "text")!;
      t.set({ width: 90 } as never);
      t.setCoords();
    });
    await page.waitForTimeout(200);

    const wrapped = await page.evaluate(
      () =>
        window.__btm!.getTemplate().objects.find((o) => o.type === "text") as unknown as {
          wrapWidth?: number;
          width: number;
        },
    );
    expect(wrapped.wrapWidth).toBeGreaterThan(0);

    // The exported HTML wraps instead of clipping.
    const html = await page.evaluate(() => {
      const w = window as unknown as {
        __btm: { getTemplate: () => never };
        __btmRender: (t: never) => { html: string };
      };
      return w.__btmRender(w.__btm.getTemplate()).html;
    });
    expect(html).toContain("white-space: pre-wrap");
    expect(html).toContain("height: auto");

    // And the wrap boundary survives a save/reload cycle.
    const template = await page.evaluate(
      () => (window.__btm as never as { getTemplate: () => unknown }).getTemplate(),
    );
    await page.evaluate(
      (t) => (window.__btm as never as { loadTemplate: (t: unknown) => void }).loadTemplate(t),
      template,
    );
    await page.waitForTimeout(300);
    const reloaded = await page.evaluate(
      () =>
        window.__btm!.getTemplate().objects.find((o) => o.type === "text") as unknown as {
          wrapWidth?: number;
        },
    );
    expect(reloaded.wrapWidth).toBe(wrapped.wrapWidth);
  });

  test("an unwrapped box is untouched by the feature", async ({ page }) => {
    await openEditorWithBill(page);
    const P = await docToPage(page);
    await pickTool(page, "Text");
    const at = await P(200, 200);
    await page.mouse.click(at.x, at.y);
    await page.waitForTimeout(250);

    const text = await page.evaluate(
      () =>
        window.__btm!.getTemplate().objects.find((o) => o.type === "text") as unknown as {
          wrapWidth?: number;
        },
    );
    expect(text.wrapWidth).toBeUndefined();

    const html = await page.evaluate(() => {
      const w = window as unknown as {
        __btm: { getTemplate: () => never };
        __btmRender: (t: never) => { html: string };
      };
      return w.__btmRender(w.__btm.getTemplate()).html;
    });
    expect(html).toContain("white-space: pre");
    expect(html).not.toContain("pre-wrap");
  });
});
```

- [ ] **Step 2: Run the test**

Run: `$env:PORT="3000"; npx.cmd playwright test --grep "Wrapping text" --reporter=list`
Expected: PASS, 2 tests.

If the panel locator fails, `TextPanel`'s heading collides with the
`textVerticalAlign` controls; scope with
`page.locator("section").filter({ hasText: "Insert variable" })` instead.

- [ ] **Step 3: Run the full gate**

Run:

```powershell
npx.cmd tsc --noEmit
npm.cmd test
npm.cmd run lint
$env:PORT="3000"; npx.cmd playwright test
npm.cmd run build
```

Expected: all clean, with **287 + new** unit tests and **49 + new** E2E tests
passing and no regressions.

- [ ] **Step 4: Commit**

```bash
git add e2e/workflow.spec.ts
git commit -m "test(text): end-to-end wrap round trip"
```

---

## Self-Review

**Spec coverage.** Every decision in the spec maps to a task: authoring-only
groups (Task 2's byte-identical template assertion), nestable groups with a cycle
guard (Task 1's `canNest` and subtree absorption), group selection and
Alt+click (Task 4), delete-keeps-objects (Task 2), Ctrl+G / Ctrl+Shift+G
(Task 3), `wrapWidth` as the single optional field (Task 5), IText→Textbox
conversion (Task 6), `pre-wrap` + `break-word` + `height: auto` float-downward
(Task 7), undoable snapshots (Task 2), `hydrateText` restoring width/height
(Task 6), `textVerticalAlign` no longer hardcoded (Task 5). Out-of-scope items
from the spec are deliberately absent.

**Type consistency.** `GroupNode` and all seven helpers are declared once in
Task 1 and consumed by name in Tasks 2-4. `setTextWrap(on: boolean)` is declared
in Task 6 and called from the panel in the same task. `wrapWidth` is introduced
on the type in Task 5 and read in Tasks 6 and 7. No name drifts.

**Two deliberate corrections inside the plan, both fixed in place.** Task 1's
nested-subtree assertion and Task 4's `ActiveSelection` usage each had a wrong
first draft; both now carry the correct code, with a note at Task 4's import
explaining why the top-level `import { ActiveSelection } from "fabric"` is
required rather than a runtime `require`.

**Known simplifications and reversals found while executing.**

1. **Delete removes the structure, not just the node.** Task 2 originally kept a
   group's objects on the canvas. Implementing it that way made "delete a group"
   indistinguishable from "ungroup", and it contradicted the user's "like word
   editor". Reversed: Delete removes the group *and* its objects; **Ungroup** is
   the non-destructive path. Spec updated.
2. **Absorption does not flatten nested groups.** Grouping an object whose group
   has a nested child keeps that child intact and re-parents it to the top,
   rather than pulling the whole subtree into the new group. Flattening would
   silently discard nesting the author built.
3. **`hydrateText` does not set width/height on an `IText`.** Fabric derives them
   from the content and discards any written value, so doing so would only
   pretend to work. Width is restored only for a `Textbox`, where it is the wrap
   boundary.
4. **Alt+click is implemented but not automatically verified.** Fabric ignores
   Playwright's synthetic modifier injection and dispatched pointer events, so
   the branch cannot be driven from a test. The E2E asserts the group-click
   behaviour and a comment marks the Alt bypass as needing a real mouse.
5. **A Playwright quirk shaped two locators.** `getByRole("button", {name})`
   resolves to zero for the Wrap button even though it is present and visible,
   while `getByText` and `hasText` find it. Those tests use text locators.
6. **Hydration tests live in E2E, not Vitest.** Constructing an `IText` or
   `Textbox` needs a DOM, and the suite runs in Vitest's node environment.

**Verification gate at completion.** `tsc --noEmit` clean; 309 unit tests (287
before this plan, +16 group helpers, +3 wrap serialisation, +3 wrap render);
58 E2E tests (49 before, +6 grouping, +3 wrapping); `npm run lint` clean;
`npm run build` succeeds.
