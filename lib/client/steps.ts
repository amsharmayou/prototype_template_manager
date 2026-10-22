/**
 * The five-step path, derived from real editor facts.
 *
 * Nothing here is stored state: a step is done because the document shows it, so
 * the guide cannot claim something the editor cannot.
 */
export type StepId = "bill" | "trace" | "mark" | "test" | "share";

export const STEP_ORDER: StepId[] = ["bill", "trace", "mark", "test", "share"];

export const STEP_LABELS: Record<StepId, string> = {
  bill: "Your bill",
  trace: "Trace",
  mark: "Mark data",
  test: "Test",
  share: "Save & share",
};

export interface StepFacts {
  /** A bill photo is loaded as the reference. */
  hasReference: boolean;
  /** At least one object has been drawn. */
  objectCount: number;
  /**
   * Something dynamic exists: a data-field box, an image slot, a text token,
   * or a repeating band on the selected table. Counted from the traced objects
   * themselves, so re-typing or re-labelling a field is an edit, not progress.
   */
  dataFieldCount: number;
  /** Fill & print was opened at least once since the editor opened. */
  testedOnce: boolean;
  /** Save was used at least once since the editor opened. */
  savedOnce: boolean;
}

export const STEP_COMPLETE: Record<StepId, (facts: StepFacts) => boolean> = {
  bill: (f) => f.hasReference,
  trace: (f) => f.objectCount > 0,
  mark: (f) => f.dataFieldCount > 0,
  test: (f) => f.testedOnce,
  share: (f) => f.savedOnce,
};

export function stepDone(facts: StepFacts): Record<StepId, boolean> {
  const done = {} as Record<StepId, boolean>;
  for (const step of STEP_ORDER) done[step] = STEP_COMPLETE[step](facts);
  return done;
}

/** The first step in reading order that is not complete, or null. */
export function firstIncomplete(done: Record<StepId, boolean>): StepId | null {
  for (const step of STEP_ORDER) if (!done[step]) return step;
  return null;
}

/** The step after `step` in reading order, or null at the end of the path. */
export function nextStep(step: StepId): StepId | null {
  const index = STEP_ORDER.indexOf(step);
  return index >= 0 && index < STEP_ORDER.length - 1
    ? STEP_ORDER[index + 1]
    : null;
}
