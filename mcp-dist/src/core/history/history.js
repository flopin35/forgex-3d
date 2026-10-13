"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.CommandHistory = void 0;
/**
 * In-memory undo/redo stacks. Every entry has a unique sequence number, so the
 * editor can tell whether the current state matches the last save.
 */
class CommandHistory {
    limit;
    undoStack = [];
    redoStack = [];
    seq = 0;
    /** Revision of the oldest state still reachable by undo. */
    baseSeq = 0;
    constructor(limit = 500) {
        this.limit = limit;
    }
    record(command, selectionBefore, selectionAfter) {
        const entry = { seq: ++this.seq, command, selectionBefore, selectionAfter };
        this.undoStack.push(entry);
        this.redoStack = [];
        while (this.undoStack.length > this.limit) {
            const dropped = this.undoStack.shift();
            this.baseSeq = dropped.seq;
        }
        return entry;
    }
    /** Moves the newest entry to the redo stack and returns it for reverting. */
    undo() {
        const entry = this.undoStack.pop();
        if (entry)
            this.redoStack.push(entry);
        return entry;
    }
    /** Moves the newest undone entry back and returns it for re-applying. */
    redo() {
        const entry = this.redoStack.pop();
        if (entry)
            this.undoStack.push(entry);
        return entry;
    }
    /** Identifies the current state. Equal revisions mean identical scenes. */
    get revision() {
        return this.undoStack.length > 0 ? this.undoStack[this.undoStack.length - 1].seq : this.baseSeq;
    }
    get canUndo() {
        return this.undoStack.length > 0;
    }
    get canRedo() {
        return this.redoStack.length > 0;
    }
    get undoEntries() {
        return this.undoStack;
    }
    /** Redo entries, next one first. */
    get redoEntries() {
        return [...this.redoStack].reverse();
    }
    clear() {
        this.undoStack = [];
        this.redoStack = [];
        this.baseSeq = this.seq;
    }
}
exports.CommandHistory = CommandHistory;
