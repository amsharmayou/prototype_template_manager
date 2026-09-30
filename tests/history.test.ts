import { describe, expect, it } from "vitest";

import { HistoryStack } from "@/lib/canvas/history";

interface Doc {
  n: number;
}

const d = (n: number): string => JSON.stringify({ n });

describe("HistoryStack", () => {
  it("undoes to the state before the change", () => {
    const h = new HistoryStack<string>();
    h.push({ label: "add", before: d(0), after: d(1) });
    const entry = h.undo();
    expect(entry?.before).toBe(d(0));
    expect(h.canUndo).toBe(false);
    expect(h.canRedo).toBe(true);
  });

  it("redoes to the state after the change", () => {
    const h = new HistoryStack<string>();
    h.push({ label: "add", before: d(0), after: d(1) });
    h.undo();
    const entry = h.redo();
    expect(entry?.after).toBe(d(1));
    expect(h.canRedo).toBe(false);
  });

  it("walks a multi step history forwards and back", () => {
    const h = new HistoryStack<string>();
    h.push({ label: "a", before: d(0), after: d(1) });
    h.push({ label: "b", before: d(1), after: d(2) });
    h.push({ label: "c", before: d(2), after: d(3) });
    expect(h.size).toBe(3);

    expect(h.undo()!.before).toBe(d(2));
    expect(h.undo()!.before).toBe(d(1));
    expect(h.undo()!.before).toBe(d(0));
    expect(h.undo()).toBeNull();

    expect(h.redo()!.after).toBe(d(1));
    expect(h.redo()!.after).toBe(d(2));
    expect(h.redo()!.after).toBe(d(3));
  });

  it("discards the redo branch when a new change is made", () => {
    const h = new HistoryStack<string>();
    h.push({ label: "a", before: d(0), after: d(1) });
    h.undo();
    expect(h.canRedo).toBe(true);
    h.push({ label: "new", before: d(0), after: d(9) });
    expect(h.canRedo).toBe(false);
  });

  it("drops the oldest entry beyond the limit", () => {
    const h = new HistoryStack<Doc>(3);
    for (let i = 0; i < 5; i++) {
      h.push({ label: `s${i}`, before: { n: i }, after: { n: i + 1 } });
    }
    expect(h.size).toBe(3);
    // Entries s0 and s1 were discarded, so undo only reaches n=2.
    expect(h.undo()!.before.n).toBe(4);
    expect(h.undo()!.before.n).toBe(3);
    expect(h.undo()!.before.n).toBe(2);
    expect(h.undo()).toBeNull();
  });

  it("clear empties both stacks", () => {
    const h = new HistoryStack<string>();
    h.push({ label: "a", before: d(0), after: d(1) });
    h.undo();
    h.clear();
    expect(h.canUndo).toBe(false);
    expect(h.canRedo).toBe(false);
    expect(h.size).toBe(0);
  });

  it("returns null when there is nothing to redo", () => {
    const h = new HistoryStack<string>();
    expect(h.redo()).toBeNull();
    expect(h.undo()).toBeNull();
  });
});
