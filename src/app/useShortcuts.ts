import { useEffect } from 'react';
import { boardStore } from './boardState';
import type { EditorActions } from './editorActions';
import { uiStore } from './uiState';

function isTyping(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  return target.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName);
}

/** The shortcut list shown in the Keyboard shortcuts sheet. */
export const SHORTCUTS: { group: string; items: [keys: string, action: string][] }[] = [
  {
    group: 'Board',
    items: [
      ['D', 'Draw corners'],
      ['C', 'Draw curves'],
      ['V', 'Pick and move dots'],
      ['B / O', 'Rectangle / circle'],
      ['1–9 while drawing', 'Type the next line’s length (Tab for its angle)'],
      ['Shift while drawing', 'Keep lines at 45° steps'],
      ['Enter, Esc or right-click', 'Stop the line'],
      ['Backspace', 'Remove the last dot, or the picked dots'],
      ['S', 'Smooth or sharpen picked dots'],
      ['M', 'Mirror the drawing'],
      ['Space + drag, wheel', 'Pan and zoom the board'],
    ],
  },
  {
    group: 'Picked dots',
    items: [
      ['Ctrl+A', 'Pick every dot'],
      ['Ctrl+C / Ctrl+V', 'Copy and paste dots (into any drawing)'],
      ['Ctrl+D', 'Duplicate dots'],
      ['Delete', 'Delete dots and lines'],
    ],
  },
  {
    group: '3D view',
    items: [
      ['Q / W / E / R', 'Select, move, rotate, scale'],
      ['F', 'Frame the selection'],
      ['T', 'Turntable spin'],
      ['Tab', 'Edit points of a point-built object'],
      ['Ctrl+L', 'Lock or unlock the selection'],
      ['Ctrl+D / Ctrl+G', 'Duplicate, group'],
    ],
  },
  {
    group: 'App',
    items: [
      ['Ctrl+K', 'Quick search: any command, object or part'],
      ['Ctrl+B', 'Parts panel'],
      ['Ctrl+Z / Ctrl+Y', 'Undo, redo'],
      ['Ctrl+S / Ctrl+Shift+S', 'Save, save as'],
      ['Ctrl+N / Ctrl+O', 'New, open'],
      ['Ctrl+E', 'Export a .glb'],
      ['?', 'This list'],
    ],
  },
];

/** Keyboard shortcuts. Single-key tools are ignored while typing in a field. */
export function useShortcuts(actions: EditorActions): void {
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const key = event.key.toLowerCase();
      const typing = isTyping(event.target);
      const ui = uiStore.getState();
      const modal = ui.paletteOpen || ui.connectOpen || ui.shortcutsOpen || ui.startOpen;

      if (event.ctrlKey || event.metaKey) {
        if (key === 'k') {
          event.preventDefault();
          uiStore.set({ paletteOpen: !ui.paletteOpen, activityOpen: false });
          return;
        }
        if (typing && ['z', 'y', 'a', 'c', 'v', 'x'].includes(key)) return;
        if (modal && key !== 's') return;
        const handlers: Record<string, () => void> = {
          z: event.shiftKey ? actions.redo : actions.undo,
          y: actions.redo,
          s: event.shiftKey ? () => void actions.saveProjectAs() : () => void actions.saveProject(),
          o: () => void actions.openProject(),
          n: () => void actions.newProject(),
          d: actions.duplicateContextual,
          g: actions.groupSelection,
          e: () => void actions.exportGlb(),
          b: () => uiStore.toggleDrawer(),
          l: () => actions.toggleLock(),
          c: () => void actions.copy(),
          v: () => void actions.paste(),
          a: () => void actions.selectAllDots(),
        };
        const handler = handlers[key];
        if (handler) {
          event.preventDefault();
          if (typing && document.activeElement instanceof HTMLElement) document.activeElement.blur();
          handler();
        }
        return;
      }

      if (key === 'escape') {
        if (uiStore.closeTopmost()) {
          event.preventDefault();
          return;
        }
        if (!typing) actions.escape();
        return;
      }
      if (typing || event.altKey || modal) return;
      if (event.key === '?') {
        uiStore.set({ shortcutsOpen: true });
        return;
      }
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
        case 'c':
          boardStore.setTool('curve');
          break;
        case 's':
          if (!actions.toggleSmoothPicked()) return;
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
        default:
          return;
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [actions]);
}
