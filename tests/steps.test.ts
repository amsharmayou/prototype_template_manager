import { describe, expect, it } from "vitest";

import {
  STEP_COMPLETE,
  STEP_LABELS,
  STEP_ORDER,
  firstIncomplete,
  nextStep,
  stepDone,
  type StepFacts,
} from "@/lib/client/steps";

const facts = (over: Partial<StepFacts> = {}): StepFacts => ({
  hasReference: false,
  objectCount: 0,
  dataFieldCount: 0,
  testedOnce: false,
  savedOnce: false,
  ...over,
});

describe("step completion", () => {
  it("starts with nothing done", () => {
    expect(stepDone(facts())).toEqual({
      bill: false,
      trace: false,
      mark: false,
      test: false,
      share: false,
    });
  });

  it("a bill photo completes only the first step", () => {
    const done = stepDone(facts({ hasReference: true }));
    expect(done).toEqual({
      bill: true,
      trace: false,
      mark: false,
      test: false,
      share: false,
    });
  });

  it("drawn objects complete trace but not mark", () => {
    const done = stepDone(facts({ hasReference: true, objectCount: 3 }));
    expect(done.bill).toBe(true);
    expect(done.trace).toBe(true);
    expect(done.mark).toBe(false);
  });

  it("a single data field is enough for mark", () => {
    expect(stepDone(facts({ dataFieldCount: 1 })).mark).toBe(true);
  });

  it("testing and saving are their own facts", () => {
    const done = stepDone(facts({ testedOnce: true, savedOnce: true }));
    expect(done.test).toBe(true);
    expect(done.share).toBe(true);
  });

  it("returns the first incomplete step in reading order", () => {
    expect(firstIncomplete(stepDone(facts()))).toBe("bill");
    expect(firstIncomplete(stepDone(facts({ hasReference: true })))).toBe("trace");
    // A fact out of order (a field with nothing traced) must not skip trace:
    // the path walks the order, not the facts.
    expect(
      firstIncomplete(stepDone(facts({ dataFieldCount: 2 }))),
    ).toBe("bill");
  });

  it("is null once everything is done", () => {
    expect(
      firstIncomplete(
        stepDone(
          facts({
            hasReference: true,
            objectCount: 1,
            dataFieldCount: 1,
            testedOnce: true,
            savedOnce: true,
          }),
        ),
      ),
    ).toBeNull();
  });

  it("every step in the order has a predicate and a label", () => {
    expect(STEP_ORDER).toEqual(["bill", "trace", "mark", "test", "share"]);
    for (const step of STEP_ORDER) {
      expect(typeof STEP_COMPLETE[step]).toBe("function");
      expect(STEP_LABELS[step].length).toBeGreaterThan(0);
    }
  });
});

describe("nextStep", () => {
  it("moves one step forward and stops at the end", () => {
    expect(nextStep("bill")).toBe("trace");
    expect(nextStep("mark")).toBe("test");
    expect(nextStep("share")).toBeNull();
  });
});
