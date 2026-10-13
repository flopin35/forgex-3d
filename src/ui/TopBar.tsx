import { useSyncExternalStore } from 'react';
import { boardStore } from '../app/boardState';
import { isDrawn } from '../app/drawing';
import { useActions, useEditor } from '../app/EditorContext';
import { aiLink } from '../app/mcpBridge';
import { uiStore } from '../app/uiState';
import { PARTS, type PartId } from '../core/scene/parts';
import { isConstructionMesh } from '../core/scene/types';
import { TEMPLATES } from '../core/scene/templates';
import { ActivityPopover } from './ActivityPopover';
import { BrandMark, Icon } from './icons';
import { Menu, type MenuEntry } from './Menu';

/** One slim bar: menus, the project name, quick search, and the few actions used all the time. */
export function TopBar() {
  const actions = useActions();
  const history = useEditor((s) => s.history);
  const editMode = useEditor((s) => s.editMode);
  const project = useEditor((s) => s.project);
  const dirty = useEditor((s) => s.dirty);
  const selected = useEditor((s) => (s.selectedId ? s.scene.objects[s.selectedId] ?? null : null));
  const board = useSyncExternalStore(boardStore.subscribe, boardStore.getState);
  const ui = useSyncExternalStore(uiStore.subscribe, uiStore.getState);
  const problems = useEditor((s) => s.messages.filter((m) => m.id > ui.activitySeen && (m.level === 'error' || m.level === 'warning')).length);
  const ai = useSyncExternalStore(aiLink.subscribe, aiLink.getSnapshot);
  const hasSelection = selected !== null;
  const canEditPoints = isConstructionMesh(selected);
  const isDrawing = isDrawn(selected);
  const pointsMode = editMode === 'points';

  const fileMenu: MenuEntry[] = [
    { label: 'New project', shortcut: 'Ctrl+N', onSelect: () => void actions.newProject() },
    { label: 'Open…', shortcut: 'Ctrl+O', onSelect: () => void actions.openProject() },
    { label: 'Start screen', onSelect: () => uiStore.set({ startOpen: true }) },
    { separator: true },
    { label: 'Save', shortcut: 'Ctrl+S', onSelect: () => void actions.saveProject() },
    { label: 'Save as…', shortcut: 'Ctrl+Shift+S', onSelect: () => void actions.saveProjectAs() },
    { label: 'Save a version', onSelect: () => actions.saveSnapshot() },
    { separator: true },
    { label: 'Export model (.glb)…', shortcut: 'Ctrl+E', onSelect: () => void actions.exportGlb() },
  ];
  const editMenu: MenuEntry[] = [
    { label: history.undoLabel ? `Undo ${history.undoLabel}` : 'Undo', shortcut: 'Ctrl+Z', onSelect: actions.undo, disabled: !history.canUndo },
    { label: history.redoLabel ? `Redo ${history.redoLabel}` : 'Redo', shortcut: 'Ctrl+Y', onSelect: actions.redo, disabled: !history.canRedo },
    { separator: true },
    { label: 'Copy', shortcut: 'Ctrl+C', onSelect: () => void actions.copy() },
    { label: 'Paste', shortcut: 'Ctrl+V', onSelect: () => void actions.paste() },
    { label: 'Duplicate', shortcut: 'Ctrl+D', onSelect: actions.duplicateContextual },
    { label: 'Pick every dot', shortcut: 'Ctrl+A', onSelect: () => void actions.selectAllDots(), disabled: !isDrawing },
    { separator: true },
    { label: 'Group', shortcut: 'Ctrl+G', onSelect: actions.groupSelection, disabled: !hasSelection },
    { label: selected?.locked ? 'Unlock' : 'Lock', shortcut: 'Ctrl+L', onSelect: () => actions.toggleLock(), disabled: !hasSelection },
    { label: 'Save to My Parts', onSelect: () => void actions.saveToLibrary(), disabled: !hasSelection },
    { label: 'Delete object', onSelect: actions.deleteSelection, disabled: !hasSelection },
    { separator: true },
    { label: 'Mirror drawing / symmetric body', shortcut: 'M', onSelect: actions.toggleMirror, disabled: !isDrawing },
    { label: 'Smooth or sharpen picked dots', shortcut: 'S', onSelect: () => void actions.toggleSmoothPicked(), disabled: !isDrawing },
    { label: 'Convert drawing to points', onSelect: () => actions.convertToPoints(), disabled: !isDrawing },
    { separator: true },
    { label: pointsMode ? 'Leave points mode' : 'Edit points', shortcut: 'Tab', onSelect: actions.togglePointsMode, disabled: !canEditPoints },
    { label: 'Fill closed loops', onSelect: actions.fillLoops, disabled: !canEditPoints },
    { label: 'Recalculate normals', onSelect: actions.recalculateNormals, disabled: !canEditPoints },
    { label: 'Check geometry', onSelect: actions.checkGeometry, disabled: !canEditPoints },
  ];
  const createMenu: MenuEntry[] = [
    { label: 'Blueprint seen from the front', onSelect: () => actions.startNewBlueprint('front') },
    { label: 'Blueprint seen from the side', onSelect: () => actions.startNewBlueprint('side') },
    { label: 'Blueprint seen from the top', onSelect: () => actions.startNewBlueprint('top') },
    { label: 'Body from side, top and front views', onSelect: actions.createBody },
    { separator: true },
    ...TEMPLATES.map((template) => ({ label: `${template.name} (ready-made)`, onSelect: () => actions.addTemplate(template.id) })),
    { label: 'From My Parts…', onSelect: () => uiStore.set({ drawerOpen: true, drawerTab: 'library' }) },
    { separator: true },
    ...PARTS.map((part) => ({ label: part.name, onSelect: () => actions.addPart(part.id as PartId) })),
  ];
  const viewMenu: MenuEntry[] = [
    { label: 'Parts list', shortcut: 'Ctrl+B', onSelect: () => uiStore.toggleDrawer('parts') },
    { label: 'Properties', onSelect: () => uiStore.toggleDrawer('properties') },
    { label: 'My Parts', onSelect: () => uiStore.toggleDrawer('library') },
    { label: 'Versions', onSelect: () => uiStore.toggleDrawer('versions') },
    { separator: true },
    { label: board.showSizes ? 'Hide line sizes' : 'Show line sizes', onSelect: () => boardStore.set({ showSizes: !board.showSizes }) },
    { label: board.turntable ? 'Stop turntable' : 'Turntable spin', shortcut: 'T', onSelect: actions.toggleTurntable },
    { label: 'Frame selection', shortcut: 'F', onSelect: actions.frameSelection },
    { separator: true },
    { label: 'Board and 3D the same size', onSelect: () => boardStore.set({ split: 0.5 }) },
    { label: 'Bigger board', onSelect: () => boardStore.set({ split: 0.62 }) },
    { label: 'Bigger 3D view', onSelect: () => boardStore.set({ split: 0.38 }) },
  ];
  const helpMenu: MenuEntry[] = [
    { label: 'Quick search', shortcut: 'Ctrl+K', onSelect: () => uiStore.set({ paletteOpen: true }) },
    { label: 'Keyboard shortcuts', shortcut: '?', onSelect: () => uiStore.set({ shortcutsOpen: true }) },
    { label: 'Connect an AI assistant…', onSelect: () => uiStore.set({ connectOpen: true }) },
    { label: 'Activity and history', onSelect: () => uiStore.set({ activityOpen: true }) },
  ];

  const aiState = ai.busyWith ? 'is-busy' : ai.connected ? 'is-linked' : '';
  const aiTitle = ai.busyWith ? `AI working: ${ai.busyWith}` : ai.connected ? 'An AI assistant is linked to this project' : 'Connect an AI assistant';

  return (
    <header className="topbar">
      <div className="brand" aria-label="FORGEX 3D">
        <BrandMark size={20} />
        <span className="brand-word">
          FORGEX<span className="brand-suffix">3D</span>
        </span>
      </div>
      <nav className="menubar" aria-label="Main menu">
        <Menu label="File" entries={fileMenu} />
        <Menu label="Edit" entries={editMenu} />
        <Menu label="Create" entries={createMenu} />
        <Menu label="View" entries={viewMenu} />
        <Menu label="Help" entries={helpMenu} />
      </nav>

      <div className="doc-title" title={project.path ?? 'Not saved yet'}>
        <span className="doc-name">{project.name}</span>
        {dirty && <span className="dirty-dot" role="img" aria-label="Unsaved changes" />}
      </div>

      <button type="button" className="search-trigger" onClick={() => uiStore.set({ paletteOpen: true, activityOpen: false })} title="Find any command, object or part (Ctrl+K)">
        <Icon name="search" size={15} />
        <span className="search-trigger-text">Search or run a command</span>
        <kbd>Ctrl K</kbd>
      </button>

      <div className="topbar-actions">
        <div className="button-pair">
          <button type="button" className="icon-button" onClick={actions.undo} disabled={!history.canUndo} title={`Undo ${history.undoLabel ?? ''} (Ctrl+Z)`}>
            <Icon name="undo" />
          </button>
          <button type="button" className="icon-button" onClick={actions.redo} disabled={!history.canRedo} title={`Redo ${history.redoLabel ?? ''} (Ctrl+Y)`}>
            <Icon name="redo" />
          </button>
        </div>
        <div className="popover-anchor">
          <button
            type="button"
            className={`icon-button ${ui.activityOpen ? 'is-active' : ''}`}
            aria-pressed={ui.activityOpen}
            aria-label="Activity"
            onClick={() => uiStore.set({ activityOpen: !ui.activityOpen })}
            title="Activity: messages, history and performance"
          >
            <Icon name="pulse" />
            {problems > 0 && <span className="count-badge">{problems}</span>}
          </button>
          {ui.activityOpen && <ActivityPopover />}
        </div>
        <button type="button" className={`ai-button ${aiState}`} onClick={() => uiStore.set({ connectOpen: true })} title={aiTitle}>
          <span className="ai-dot" aria-hidden="true" />
          <span>{ai.busyWith ? 'AI working' : ai.connected ? 'AI linked' : 'Connect AI'}</span>
        </button>
        <span className="topbar-divider" aria-hidden="true" />
        <button
          type="button"
          className={`text-button ${ui.drawerOpen ? 'is-on' : ''}`}
          onClick={() => uiStore.toggleDrawer()}
          aria-pressed={ui.drawerOpen}
          title="Parts list, properties, My Parts and versions (Ctrl+B)"
        >
          <Icon name="sidebar" size={15} />
          Parts
        </button>
        <button type="button" className="text-button" onClick={() => void actions.saveProject()} disabled={!dirty && project.path !== null} title="Save (Ctrl+S)">
          Save
        </button>
        <button type="button" className="text-button is-primary" onClick={() => void actions.exportGlb()} title="Export a .glb for Blender or Roblox Studio (Ctrl+E)">
          <Icon name="export" size={15} />
          Export
        </button>
      </div>
    </header>
  );
}
