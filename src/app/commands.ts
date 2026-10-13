import { isConstructionMesh } from '../core/scene/types';
import { PARTS, type PartId } from '../core/scene/parts';
import { TEMPLATES } from '../core/scene/templates';
import type { ViewPreset } from '../core/automation/toolTypes';
import type { AlignEdge } from '../core/sketch/edit';
import { boardStore } from './boardState';
import { isDrawn } from './drawing';
import type { EditorActions } from './editorActions';
import { uiStore } from './uiState';

/** One entry in quick search (Ctrl+K). */
export interface AppCommand {
  id: string;
  title: string;
  /** Where it belongs, shown on the right of the result. */
  group: 'File' | 'Edit' | 'Draw' | 'Create' | 'View' | 'Object' | 'My Parts' | 'Versions' | 'Recent' | 'Help';
  /** Other words people may type for it. */
  keywords?: string;
  shortcut?: string;
  run: () => void;
}

const ALIGN_NAMES: Record<AlignEdge, string> = {
  left: 'left edges',
  centre: 'a vertical centre line',
  right: 'right edges',
  top: 'top edges',
  middle: 'a horizontal centre line',
  bottom: 'bottom edges',
};

const VIEW_NAMES: [ViewPreset, string][] = [
  ['front', 'Front'],
  ['back', 'Back'],
  ['left', 'Left'],
  ['right', 'Right'],
  ['top', 'Top'],
  ['bottom', 'Bottom'],
  ['perspective', 'Three-quarter'],
];

/** Every command quick search offers for the current state of the editor. */
export function buildCommands(actions: EditorActions): AppCommand[] {
  const state = actions.store.getState();
  const selected = state.selectedId ? state.scene.objects[state.selectedId] : undefined;
  const board = boardStore.getState();
  const drawing = actions.activeDrawing();
  const picks = actions.pickedPointIds(drawing).length;
  const out: AppCommand[] = [];
  const add = (command: AppCommand | false | undefined) => {
    if (command) out.push(command);
  };

  // File
  add({ id: 'new', title: 'New project', group: 'File', keywords: 'blank empty start', shortcut: 'Ctrl+N', run: () => void actions.newProject() });
  add({ id: 'open', title: 'Open a project…', group: 'File', keywords: 'load file', shortcut: 'Ctrl+O', run: () => void actions.openProject() });
  add({ id: 'save', title: 'Save', group: 'File', shortcut: 'Ctrl+S', run: () => void actions.saveProject() });
  add({ id: 'save-as', title: 'Save as…', group: 'File', keywords: 'copy rename', shortcut: 'Ctrl+Shift+S', run: () => void actions.saveProjectAs() });
  add({ id: 'export', title: 'Export model (.glb) for Blender or Roblox', group: 'File', keywords: 'gltf glb download', shortcut: 'Ctrl+E', run: () => void actions.exportGlb() });
  add({ id: 'start', title: 'Show the start screen', group: 'File', keywords: 'welcome home templates', run: () => uiStore.set({ startOpen: true }) });

  // Edit
  add(state.history.canUndo && { id: 'undo', title: `Undo ${state.history.undoLabel ?? ''}`.trim(), group: 'Edit', shortcut: 'Ctrl+Z', run: actions.undo });
  add(state.history.canRedo && { id: 'redo', title: `Redo ${state.history.redoLabel ?? ''}`.trim(), group: 'Edit', shortcut: 'Ctrl+Y', run: actions.redo });
  add((picks > 0 || !!selected) && { id: 'copy', title: picks ? 'Copy picked dots' : `Copy ${selected?.name}`, group: 'Edit', shortcut: 'Ctrl+C', run: () => void actions.copy() });
  add({ id: 'paste', title: 'Paste', group: 'Edit', shortcut: 'Ctrl+V', run: () => void actions.paste() });
  add((picks > 0 || !!selected) && { id: 'duplicate', title: picks ? 'Duplicate picked dots' : `Duplicate ${selected?.name}`, group: 'Edit', keywords: 'copy clone', shortcut: 'Ctrl+D', run: actions.duplicateContextual });
  add(!!selected && { id: 'group', title: `Group ${selected?.name}`, group: 'Object', shortcut: 'Ctrl+G', run: actions.groupSelection });
  add(!!selected && { id: 'lock', title: `${selected?.locked ? 'Unlock' : 'Lock'} ${selected?.name}`, group: 'Object', keywords: 'protect freeze', shortcut: 'Ctrl+L', run: () => actions.toggleLock() });
  add(!!selected && { id: 'hide', title: `${selected?.visible ? 'Hide' : 'Show'} ${selected?.name}`, group: 'Object', keywords: 'visibility', run: () => actions.setVisibility(selected!.id, !selected!.visible) });
  add(!!selected && { id: 'delete', title: `Delete ${selected?.name}`, group: 'Object', keywords: 'remove', run: actions.deleteSelection });
  add(!!selected && { id: 'save-part', title: `Save ${selected?.name} to My Parts`, group: 'My Parts', keywords: 'library reuse', run: () => void actions.saveToLibrary() });
  add(!!selected && { id: 'frame', title: `Frame ${selected?.name}`, group: 'View', keywords: 'zoom focus', shortcut: 'F', run: actions.frameSelection });
  add(isConstructionMesh(selected) && { id: 'points', title: state.editMode === 'points' ? 'Leave points mode' : 'Edit points', group: 'Object', keywords: 'vertices', shortcut: 'Tab', run: actions.togglePointsMode });
  add(isDrawn(selected) && { id: 'convert', title: `Convert ${selected?.name} to points`, group: 'Object', keywords: 'mesh vertices', run: () => actions.convertToPoints() });

  // Drawing
  add({ id: 'tool-draw', title: 'Draw corners (straight lines)', group: 'Draw', keywords: 'pen line', shortcut: 'D', run: () => boardStore.setTool('draw') });
  add({ id: 'tool-curve', title: 'Draw curves', group: 'Draw', keywords: 'smooth pen bezier', shortcut: 'C', run: () => boardStore.setTool('curve') });
  add({ id: 'tool-select', title: 'Pick and move dots', group: 'Draw', keywords: 'select', shortcut: 'V', run: () => boardStore.setTool('select') });
  add({ id: 'tool-rect', title: 'Rectangle', group: 'Draw', keywords: 'box square', shortcut: 'B', run: () => boardStore.setTool('rectangle') });
  add({ id: 'tool-circle', title: 'Circle', group: 'Draw', keywords: 'round polygon', shortcut: 'O', run: () => boardStore.setTool('circle') });
  add(!!drawing && { id: 'select-all', title: 'Pick every dot', group: 'Draw', keywords: 'select all', shortcut: 'Ctrl+A', run: () => void actions.selectAllDots() });
  add(!!drawing && { id: 'mirror', title: drawing?.object.source.type === 'body' ? 'Symmetric body on or off' : 'Mirror drawing on or off', group: 'Draw', keywords: 'mirror symmetry symmetric half', shortcut: 'M', run: actions.toggleMirror });
  add({ id: 'sizes', title: board.showSizes ? 'Hide line sizes' : 'Show line sizes', group: 'Draw', keywords: 'dimensions lengths measure', run: () => boardStore.set({ showSizes: !board.showSizes }) });
  add({ id: 'snap', title: board.snap ? 'Turn board snapping off' : 'Turn board snapping on', group: 'Draw', keywords: 'grid magnet', run: () => boardStore.set({ snap: !board.snap }) });
  if (picks > 0) {
    add({ id: 'smooth', title: 'Smooth or sharpen picked dots', group: 'Draw', keywords: 'curve corner', shortcut: 'S', run: () => void actions.toggleSmoothPicked() });
    add({ id: 'rot-l', title: 'Rotate picked dots 90° left', group: 'Draw', keywords: 'turn', run: () => void actions.rotatePicked(90) });
    add({ id: 'rot-r', title: 'Rotate picked dots 90° right', group: 'Draw', keywords: 'turn', run: () => void actions.rotatePicked(-90) });
    add({ id: 'flip-h', title: 'Flip picked dots left to right', group: 'Draw', keywords: 'mirror', run: () => void actions.flipPicked('horizontal') });
    add({ id: 'flip-v', title: 'Flip picked dots upside down', group: 'Draw', keywords: 'mirror', run: () => void actions.flipPicked('vertical') });
    add({ id: 'scale-up', title: 'Scale picked dots up 2×', group: 'Draw', keywords: 'bigger grow', run: () => void actions.scalePicked(2) });
    add({ id: 'scale-down', title: 'Scale picked dots down to half', group: 'Draw', keywords: 'smaller shrink', run: () => void actions.scalePicked(0.5) });
    for (const edge of Object.keys(ALIGN_NAMES) as AlignEdge[]) {
      add(picks > 1 && { id: `align-${edge}`, title: `Align picked dots on ${ALIGN_NAMES[edge]}`, group: 'Draw', keywords: 'line up', run: () => void actions.alignPicked(edge) });
    }
    add(picks > 2 && { id: 'space-h', title: 'Space picked dots evenly across', group: 'Draw', keywords: 'distribute', run: () => void actions.distributePicked('horizontal') });
    add(picks > 2 && { id: 'space-v', title: 'Space picked dots evenly up and down', group: 'Draw', keywords: 'distribute', run: () => void actions.distributePicked('vertical') });
    add({ id: 'delete-dots', title: 'Delete picked dots and lines', group: 'Draw', keywords: 'remove', shortcut: 'Delete', run: () => void actions.deleteBoardSelection() });
  }

  // Create
  add({ id: 'bp-front', title: 'New blueprint seen from the front', group: 'Create', keywords: 'drawing sketch', run: () => actions.startNewBlueprint('front') });
  add({ id: 'bp-side', title: 'New blueprint seen from the side', group: 'Create', keywords: 'drawing sketch', run: () => actions.startNewBlueprint('side') });
  add({ id: 'bp-top', title: 'New blueprint seen from the top', group: 'Create', keywords: 'drawing sketch plan floor', run: () => actions.startNewBlueprint('top') });
  add({ id: 'body', title: 'New body from side, top and front views', group: 'Create', keywords: 'car hull loft fuselage', run: actions.createBody });
  for (const template of TEMPLATES) add({ id: `tpl-${template.id}`, title: `Add a ready-made ${template.name.toLowerCase()}`, group: 'Create', keywords: 'car template example', run: () => actions.addTemplate(template.id) });
  for (const part of PARTS) add({ id: `part-${part.id}`, title: `Add ${part.name.toLowerCase()}`, group: 'Create', keywords: 'primitive part shape', run: () => actions.addPart(part.id as PartId) });

  // View
  add({ id: 'drawer-parts', title: 'Parts list', group: 'View', keywords: 'scene hierarchy outliner objects', shortcut: 'Ctrl+B', run: () => uiStore.toggleDrawer('parts') });
  add({ id: 'drawer-props', title: 'Properties', group: 'View', keywords: 'inspector transform position colour', run: () => uiStore.toggleDrawer('properties') });
  add({ id: 'drawer-library', title: 'My Parts', group: 'My Parts', keywords: 'library reuse saved', run: () => uiStore.toggleDrawer('library') });
  add({ id: 'drawer-versions', title: 'Versions', group: 'Versions', keywords: 'snapshots history restore', run: () => uiStore.toggleDrawer('versions') });
  add({ id: 'snapshot', title: 'Save a version of this scene', group: 'Versions', keywords: 'snapshot checkpoint backup', run: () => actions.saveSnapshot() });
  for (const snapshot of state.snapshots) {
    add({ id: `restore-${snapshot.id}`, title: `Restore version “${snapshot.name}”`, group: 'Versions', keywords: 'snapshot go back', run: () => actions.restoreSnapshot(snapshot.id) });
  }
  add({ id: 'turntable', title: board.turntable ? 'Stop the turntable' : 'Spin the 3D view (turntable)', group: 'View', keywords: 'rotate orbit', shortcut: 'T', run: actions.toggleTurntable });
  add({ id: 'activity', title: 'Activity: messages and history', group: 'View', keywords: 'log errors undo list performance', run: () => uiStore.set({ activityOpen: true }) });
  for (const [view, label] of VIEW_NAMES) add({ id: `view-${view}`, title: `Look from the ${label.toLowerCase()}`, group: 'View', keywords: 'camera angle', run: () => actions.setViewPreset(view) });
  add({ id: 'split-even', title: 'Board and 3D view the same size', group: 'View', keywords: 'layout split', run: () => boardStore.set({ split: 0.5 }) });
  add({ id: 'split-board', title: 'Bigger board', group: 'View', keywords: 'layout split', run: () => boardStore.set({ split: 0.62 }) });
  add({ id: 'split-3d', title: 'Bigger 3D view', group: 'View', keywords: 'layout split', run: () => boardStore.set({ split: 0.38 }) });

  // Objects by name
  for (const object of Object.values(state.scene.objects)) {
    const parent = object.parentId ? state.scene.objects[object.parentId] : undefined;
    add({ id: `obj-${object.id}`, title: `Go to ${parent ? `${parent.name} › ` : ''}${object.name}`, group: 'Object', keywords: 'select find', run: () => actions.selectAndFrame(object.id) });
  }

  // Help
  add({ id: 'connect', title: 'Connect an AI assistant (Claude, MCP)', group: 'Help', keywords: 'mcp claude ai codex vs code setup', run: () => uiStore.set({ connectOpen: true }) });
  add({ id: 'shortcuts', title: 'Keyboard shortcuts', group: 'Help', keywords: 'keys hotkeys help', shortcut: '?', run: () => uiStore.set({ shortcutsOpen: true }) });
  return out;
}

/**
 * Scores how well `query` matches `text`. Each typed word must appear in the text, or be
 * the initials of words in it ("nb" for "new blueprint"). Word starts score highest.
 * Returns 0 for no match.
 */
export function matchScore(query: string, text: string): number {
  const words = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
  if (words.length === 0) return 1;
  const t = text.toLowerCase();
  const initials = t
    .split(/[^a-z0-9]+/)
    .filter(Boolean)
    .map((word) => word[0])
    .join('');
  let score = 0;
  for (const word of words) {
    const at = t.indexOf(word);
    if (at >= 0) {
      const wordStart = at === 0 || /[^a-z0-9]/.test(t[at - 1]);
      score += (wordStart ? 10 : 4) + Math.min(word.length, 6);
    } else if (word.length >= 2 && initials.includes(word)) {
      score += 6;
    } else {
      return 0;
    }
  }
  // Shorter texts win ties: "Mirror" beats "Mirror drawing across the vertical axis".
  return score + Math.max(0, 3 - t.length / 50);
}
