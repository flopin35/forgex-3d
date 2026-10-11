import type { Command } from '../commands/command';

export interface HistoryEntry {
  readonly seq: number;
  readonly command: Command;
  readonly selectionBefore: string | null;
  readonly selectionAfter: string | null;
}

/**
 * In-memory undo/redo stacks. Every entry has a unique sequence number, so the
 * editor can tell whether the current state matches the last save.
 */
export class CommandHistory {
  private undoStack: HistoryEntry[] = [];
  private redoStack: HistoryEntry[] = [];
  private seq = 0;
  /** Revision of the oldest state still reachable by undo. */
  private baseSeq = 0;

  constructor(readonly limit = 500) {}

  record(command: Command, selectionBefore: string | null, selectionAfter: string | null): HistoryEntry {
    const entry: HistoryEntry = { seq: ++this.seq, command, selectionBefore, selectionAfter };
    this.undoStack.push(entry);
    this.redoStack = [];
    while (this.undoStack.length > this.limit) {
      const dropped = this.undoStack.shift()!;
      this.baseSeq = dropped.seq;
    }
    return entry;
  }

  /** Moves the newest entry to the redo stack and returns it for reverting. */
  undo(): HistoryEntry | undefined {
    const entry = this.undoStack.pop();
    if (entry) this.redoStack.push(entry);
    return entry;
  }

  /** Moves the newest undone entry back and returns it for re-applying. */
  redo(): HistoryEntry | undefined {
    const entry = this.redoStack.pop();
    if (entry) this.undoStack.push(entry);
    return entry;
  }

  /** Identifies the current state. Equal revisions mean identical scenes. */
  get revision(): number {
    return this.undoStack.length > 0 ? this.undoStack[this.undoStack.length - 1].seq : this.baseSeq;
  }

  get canUndo(): boolean {
    return this.undoStack.length > 0;
  }

  get canRedo(): boolean {
    return this.redoStack.length > 0;
  }

  get undoEntries(): readonly HistoryEntry[] {
    return this.undoStack;
  }

  /** Redo entries, next one first. */
  get redoEntries(): readonly HistoryEntry[] {
    return [...this.redoStack].reverse();
  }

  clear(): void {
    this.undoStack = [];
    this.redoStack = [];
    this.baseSeq = this.seq;
  }
}
