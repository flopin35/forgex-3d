import type { SceneObject } from '../core/scene/types';
import type { SketchFragment } from '../core/sketch/edit';

/**
 * The app's own clipboard for Ctrl+C / Ctrl+V: picked dots (pasted into any drawing, in
 * this project or the next one opened) or a whole object with its children.
 */
export type ClipboardContent = { kind: 'dots'; fragment: SketchFragment; origin: [number, number] } | { kind: 'objects'; name: string; objects: readonly SceneObject[] };

let content: ClipboardContent | null = null;
let pasteCount = 0;

export const clipboard = {
  get(): ClipboardContent | null {
    return content;
  },
  set(next: ClipboardContent): void {
    content = next;
    pasteCount = 0;
  },
  /** How many times the current content has been pasted; each paste lands a step further along. */
  nextPasteIndex(): number {
    pasteCount += 1;
    return pasteCount;
  },
};
