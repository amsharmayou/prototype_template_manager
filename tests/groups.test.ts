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
    expect(canNest("b", "a", groups)).toBe(false);
    expect(canNest("a", "a", groups)).toBe(false);
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
    expect(out.map((x) => x.id).sort()).toEqual(["n1"]);
    expect(out[0]!.members.sort()).toEqual(["o1", "o2", "o3"]);
  });

  it("leaves a group nested below an absorbed one intact", () => {
    // `b` does not itself hold o1, so absorbing `a` must not flatten the
    // nesting the author built. `b` survives with its own member, re-parented
    // to the top level because its parent is gone.
    const before = [g("a", null, ["o1"]), g("b", "a", ["o2"])];
    const out = groupObjects(["o1"], "n1", "Block", before);
    expect(out.map((x) => x.id).sort()).toEqual(["b", "n1"]);
    expect(out.find((x) => x.id === "n1")!.members).toEqual(["o1"]);
    const b = out.find((x) => x.id === "b")!;
    expect(b.members).toEqual(["o2"]);
    expect(b.parentId).toBeNull();
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

  it("lifts a nested child's members up when the outer group goes", () => {
    // Removing `a` takes `b` with it, and b's member must land on a's heir
    // rather than vanish with it.
    const before = [
      g("root", null, ["o1"]),
      g("a", "root", ["o2"]),
      g("b", "a", ["o3"]),
    ];
    const out = ungroup("a", before);
    expect(out.map((x) => x.id)).toEqual(["root"]);
    expect(out[0]!.members.sort()).toEqual(["o1", "o2", "o3"]);
  });

  it("removes nested groups too, leaving members loose with no heir", () => {
    // Removing `a` takes its whole subtree, `b` included. With no surviving
    // parent to inherit them, both members simply become loose objects.
    const before = [g("a", null, ["o1"]), g("b", "a", ["o2"])];
    const out = ungroup("a", before);
    expect(out).toEqual([]);
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
