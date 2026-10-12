import { useEffect } from 'react';
import { boardStore } from './boardState';
import type { EditorActions } from './editorActions';

function isTyping(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  return target.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName);
}

/** Keyboard shortcuts from the blueprint. Single-key tools are ignored while typing in a field. */
export function useShortcuts(actions: EditorActions): void {
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const key = event.key.toLowerCase();
      const typing = isTyping(event.target);

      if (event.ctrlKey || event.metaKey) {
        if (typing && (key === 'z' || key === 'y' || key === 'a' || key === 'c' || key === 'v' || key === 'x')) return;
        const handlers: Record<string, () => void> = {
          z: event.shiftKey ? actions.redo : actions.undo,
          y: actions.redo,
          s: event.shiftKey ? () => void actions.saveProjectAs() : () => void actions.saveProject(),
          o: () => void actions.openProject(),
          n: () => void actions.newProject(),
          d: actions.duplicateSelection,
          g: actions.groupSelection,
          e: () => void actions.exportGlb(),
          b: () => boardStore.set({ sidebar: !boardStore.getState().sidebar }),
        };
        const handler = handlers[key];
        if (handler) {
          event.preventDefault();
          if (typing && document.activeElement instanceof HTMLElement) document.activeElement.blur();
          handler();
        }
        return;
      }

      if (typing || event.altKey) return;
      switch (key) {
        case 'q':
          actions.setTool('select');
          break;
        case 'w':
          actions.setTool('translate');
          break;
        case 'e':
          actions.setTool('rotate');
          break;
        case 'r':
          actions.setTool('scale');
          break;
        case 'f':
          actions.frameSelection();
          break;
        case 'd':
          boardStore.setTool('draw');
          break;
        case 'v':
          boardStore.setTool('select');
          break;
        case 'b':
          boardStore.setTool('rectangle');
          break;
        case 'o':
          boardStore.setTool('circle');
          break;
        case 'm':
          actions.toggleMirror();
          break;
        case 't':
          actions.toggleTurntable();
          break;
        case 'enter':
          boardStore.set({ chainFrom: null });
          break;
        case 'delete':
          actions.deleteContextual();
          break;
        case 'backspace':
          // Backspace removes picked dots and lines, or steps back while drawing; never a whole object.
          if (!actions.deleteBoardSelection() && !actions.stepBackChain()) return;
          break;
        case 'tab':
          event.preventDefault();
          actions.togglePointsMode();
          break;
        case 'escape':
          actions.escape();
          break;
        default:
          return;
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [actions]);
}
