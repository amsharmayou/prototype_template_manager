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

/**
 * Every group that transitively contains `memberId`, innermost first.
 *
 * Built as one upward walk per direct hit rather than a recursive flatten: an
 * object is a direct member of exactly one group, so the first hit is the
 * innermost owner and its parent chain is the whole ancestry.
 */
export function ancestorsOf(memberId: string, groups: GroupNode[]): string[] {
  const direct = groups.find((g) => g.members.includes(memberId));
  if (!direct) return [];
  const out: string[] = [];
  let current: GroupNode | undefined = direct;
  const guard = new Set<string>();
  while (current && !guard.has(current.id)) {
    guard.add(current.id);
    out.push(current.id);
    current = current.parentId ? byId(groups, current.parentId) : undefined;
  }
  return out;
}

/** The group that directly holds `objectId`, or null. */
export function groupOf(objectId: string, groups: GroupNode[]): GroupNode | null {
  return groups.find((g) => g.members.includes(objectId)) ?? null;
}

/** Every group id in the subtree rooted at `rootId`, including rootId. */
export function subtreeIds(rootId: string, groups: GroupNode[]): string[] {
  const out: string[] = [];
  const walk = (id: string): void => {
    if (out.includes(id)) return;
    out.push(id);
    for (const g of groups) {
      if (g.parentId === id) walk(g.id);
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
  // Walking up from the proposed parent must never reach the child, or the
  // child would become its own ancestor.
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
  if (wanted.length === 0) return groups;

  // Absorption is deliberately limited to the groups that *directly* hold a
  // wanted object. A group nested below one of those is not flattened into the
  // new group: the author built that nesting, and pulling it apart would be a
  // surprise. Such a group simply survives with its parent link repaired.
  const absorbed = groups.filter((g) => g.members.some((m) => wanted.includes(m)));
  const absorbedIds = new Set(absorbed.map((g) => g.id));

  const promoted = new Set<string>(wanted);
  for (const g of absorbed) {
    for (const m of g.members) promoted.add(m);
  }

  const survivors = groups
    .filter((g) => !absorbedIds.has(g.id))
    .map((g) => ({
      ...g,
      members: g.members.filter(
        (m) => !absorbedIds.has(m) && !wanted.includes(m),
      ),
      parentId: g.parentId && absorbedIds.has(g.parentId) ? null : g.parentId,
    }));

  return [
    ...survivors,
    { id: newId, name, parentId: null, members: [...promoted].sort() },
  ];
}

/**
 * Removes `groupId`. Its members move up to the removed group's own parent, so
 * unwrapping never orphans an object into limbo. With no surviving parent they
 * simply become loose objects on the canvas.
 */
export function ungroup(groupId: string, groups: GroupNode[]): GroupNode[] {
  const target = byId(groups, groupId);
  if (!target) return groups;
  const removedIds = new Set(subtreeIds(groupId, groups));
  const heir =
    target.parentId && !removedIds.has(target.parentId) ? target.parentId : null;
  const orphans: string[] = [];
  for (const id of removedIds) {
    for (const m of byId(groups, id)?.members ?? []) {
      if (!orphans.includes(m)) orphans.push(m);
    }
  }
  return groups
    .filter((g) => !removedIds.has(g.id))
    .map((g) => {
      const parentId = g.parentId && removedIds.has(g.parentId) ? heir : g.parentId;
      const members = [...g.members];
      if (heir !== null && g.id === heir) {
        for (const m of orphans) if (!members.includes(m)) members.push(m);
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
  const groupIds = new Set(groups.map((g) => g.id));
  const first = groups
    .map((g) => ({
      ...g,
      members: g.members.filter((m) => live.has(m) || groupIds.has(m)),
      parentId: g.parentId && groupIds.has(g.parentId) ? g.parentId : null,
    }))
    .filter((g) => g.members.length > 0);
  const keptIds = new Set(first.map((g) => g.id));
  return first.filter((g) => g.parentId === null || keptIds.has(g.parentId));
}
