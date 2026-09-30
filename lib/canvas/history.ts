/**
 * Undo/redo by snapshot.
 *
 * Each entry records the state on both sides of a change, so undo and redo are
 * both plain lookups. Entries are created only at meaningful moments (a
 * completed drag, a finished edit), never per pointer-move, so dragging a
 * shape produces a single history entry rather than hundreds.
 */

export interface HistoryEntry<T> {
  label: string;
  /** State before the change. */
  before: T;
  /** State after the change. */
  after: T;
}

export class HistoryStack<T> {
  private past: HistoryEntry<T>[] = [];
  private future: HistoryEntry<T>[] = [];
  private readonly limit: number;

  constructor(limit = 100) {
    this.limit = limit;
  }

  /** Record a change, discarding any redo branch. */
  push(entry: HistoryEntry<T>): void {
    this.past.push(entry);
    if (this.past.length > this.limit) this.past.shift();
    this.future = [];
  }

  undo(): HistoryEntry<T> | null {
    const entry = this.past.pop();
    if (entry) this.future.push(entry);
    return entry ?? null;
  }

  redo(): HistoryEntry<T> | null {
    const entry = this.future.pop();
    if (entry) this.past.push(entry);
    return entry ?? null;
  }

  get canUndo(): boolean {
    return this.past.length > 0;
  }

  get canRedo(): boolean {
    return this.future.length > 0;
  }

  clear(): void {
    this.past = [];
    this.future = [];
  }

  get size(): number {
    return this.past.length;
  }
}
