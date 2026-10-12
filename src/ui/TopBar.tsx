import { useSyncExternalStore } from 'react';
import { boardStore } from '../app/boardState';
import { isDrawn } from '../app/drawing';
import { useActions, useEditor } from '../app/EditorContext';
import { isConstructionMesh } from '../core/scene/types';
import { TEMPLATES } from '../core/scene/templates';
import { GRID_PRESETS } from '../core/units';
import { BrandMark, Icon } from './icons';
import { Menu, type MenuEntry } from './Menu';

export function TopBar() {
  const actions = useActions();
  const history = useEditor((s) => s.history);
  const editMode = useEditor((s) => s.editMode);
  const settings = useEditor((s) => s.settings);
  const project = useEditor((s) => s.project);
  const dirty = useEditor((s) => s.dirty);
  const hasSelection = useEditor((s) => s.selectedId !== null);
  const canEditPoints = useEditor((s) => isConstructionMesh(s.selectedId ? s.scene.objects[s.selectedId] : null));
  const isBlueprint = useEditor((s) => isDrawn(s.selectedId ? s.scene.objects[s.selectedId] : null));
  const board = useSyncExternalStore(boardStore.subscribe, boardStore.getState);
  const pointsMode = editMode === 'points';

  const fileMenu: MenuEntry[] = [
    { label: 'New project', shortcut: 'Ctrl+N', onSelect: () => void actions.newProject() },
    { label: 'Open…', shortcut: 'Ctrl+O', onSelect: () => void actions.openProject() },
    { separator: true },
    { label: 'Save', shortcut: 'Ctrl+S', onSelect: () => void actions.saveProject() },
    { label: 'Save as…', shortcut: 'Ctrl+Shift+S', onSelect: () => void actions.saveProjectAs() },
    { separator: true },
    { label: 'Export model (.glb)…', shortcut: 'Ctrl+E', onSelect: () => void actions.exportGlb() },
  ];
  const editMenu: MenuEntry[] = [
    { label: history.undoLabel ? `Undo ${history.undoLabel}` : 'Undo', shortcut: 'Ctrl+Z', onSelect: actions.undo, disabled: !history.canUndo },
    { label: history.redoLabel ? `Redo ${history.redoLabel}` : 'Redo', shortcut: 'Ctrl+Y', onSelect: actions.redo, disabled: !history.canRedo },
    { separator: true },
    { label: 'Duplicate', shortcut: 'Ctrl+D', onSelect: actions.duplicateSelection, disabled: !hasSelection },
    { label: 'Group', shortcut: 'Ctrl+G', onSelect: actions.groupSelection, disabled: !hasSelection },
    { label: 'Delete object', onSelect: actions.deleteSelection, disabled: !hasSelection },
    { separator: true },
    { label: 'Mirror drawing / symmetric body', shortcut: 'M', onSelect: actions.toggleMirror, disabled: !isBlueprint },
    { label: 'Smooth or sharpen picked dots', shortcut: 'S', onSelect: () => void actions.toggleSmoothPicked(), disabled: !isBlueprint },
    { label: 'Convert drawing to points', onSelect: () => actions.convertToPoints(), disabled: !isBlueprint },
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
    { separator: true },
    { label: 'Cube', onSelect: () => actions.addPart('cube') },
    { label: 'Plane', onSelect: () => actions.addPart('plane') },
    { label: 'Sphere', onSelect: () => actions.addPart('sphere') },
    { label: 'Cylinder', onSelect: () => actions.addPart('cylinder') },
    { separator: true },
    { label: 'Empty group', onSelect: () => actions.addPart('group') },
  ];
  const viewMenu: MenuEntry[] = [
    { label: board.sidebar ? 'Hide scene panels' : 'Show scene panels', shortcut: 'Ctrl+B', onSelect: () => boardStore.set({ sidebar: !board.sidebar }) },
    { label: board.turntable ? 'Stop turntable' : 'Turntable spin', shortcut: 'T', onSelect: actions.toggleTurntable },
    { label: 'Frame selection', shortcut: 'F', onSelect: actions.frameSelection },
    { separator: true },
    { label: 'Board and 3D side by side', onSelect: () => boardStore.set({ split: 0.5 }) },
    { label: 'Bigger board', onSelect: () => boardStore.set({ split: 0.62 }) },
    { label: 'Bigger 3D view', onSelect: () => boardStore.set({ split: 0.38 }) },
  ];

  return (
    <header className="topbar">
      <div className="brand">
        <BrandMark />
        <span className="brand-name">FORGEX 3D</span>
      </div>
      <nav className="menubar" aria-label="Main menu">
        <Menu label="File" entries={fileMenu} />
        <Menu label="Edit" entries={editMenu} />
        <Menu label="Create" entries={createMenu} />
        <Menu label="View" entries={viewMenu} />
      </nav>

      <div className="toolbar" role="toolbar" aria-label="History and 3D snapping">
        <div className="tool-group">
          <button type="button" className="icon-button" onClick={actions.undo} disabled={!history.canUndo} title={`Undo ${history.undoLabel ?? ''} (Ctrl+Z)`}>
            <Icon name="undo" />
          </button>
          <button type="button" className="icon-button" onClick={actions.redo} disabled={!history.canRedo} title={`Redo ${history.redoLabel ?? ''} (Ctrl+Y)`}>
            <Icon name="redo" />
          </button>
        </div>

        <div className="tool-group snap-group" title="Snapping for the 3D move, rotate and scale tools">
          <button
            type="button"
            className={`icon-button ${settings.snapEnabled ? 'is-active' : ''}`}
            aria-pressed={settings.snapEnabled}
            onClick={() => actions.store.updateSettings({ snapEnabled: !settings.snapEnabled })}
            title="Snap 3D moves to the grid"
          >
            <Icon name="snap" />
          </button>
          <label className="compact-select" title="3D grid size and move snap">
            <span className="visually-hidden">3D grid size</span>
            <select value={settings.gridSize} onChange={(event) => actions.store.updateSettings({ gridSize: Number(event.target.value) })}>
              {GRID_PRESETS.map((preset) => (
                <option key={preset.size} value={preset.size}>
                  {preset.label}
                </option>
              ))}
            </select>
          </label>
          <label className="compact-select" title="Rotation snap">
            <span className="visually-hidden">Rotation snap</span>
            <select
              value={settings.rotationSnapDegrees}
              onChange={(event) => actions.store.updateSettings({ rotationSnapDegrees: Number(event.target.value) })}
            >
              {[5, 10, 15, 30, 45, 90].map((deg) => (
                <option key={deg} value={deg}>
                  {deg}°
                </option>
              ))}
            </select>
          </label>
        </div>
      </div>

      <div className="project-title" title={project.path ?? 'Not saved yet'}>
        <span className="project-name">{project.name}</span>
        {dirty && <span className="dirty-dot" aria-label="Unsaved changes" />}
      </div>
      <button type="button" className="text-button" onClick={() => void actions.saveProject()} disabled={!dirty && project.path !== null} title="Save (Ctrl+S)">
        <Icon name="save" size={14} />
        Save
      </button>
      <button type="button" className="text-button is-primary" onClick={() => void actions.exportGlb()} title="Export a .glb for Blender or Roblox Studio (Ctrl+E)">
        <Icon name="export" size={14} />
        Export
      </button>
      <button
        type="button"
        className={`icon-button ${board.sidebar ? 'is-active' : ''}`}
        onClick={() => boardStore.set({ sidebar: !board.sidebar })}
        aria-pressed={board.sidebar}
        title="Scene and properties panels (Ctrl+B)"
      >
        <Icon name="sidebar" />
      </button>
    </header>
  );
}
