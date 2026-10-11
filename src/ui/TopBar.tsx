import { useActions, useEditor } from '../app/EditorContext';
import type { ToolMode } from '../core/editor/editorStore';
import { isConstructionMesh } from '../core/scene/types';
import { GRID_PRESETS } from '../core/units';
import { BrandMark, Icon, type IconName } from './icons';
import { Menu, type MenuEntry } from './Menu';

const TOOLS: { tool: ToolMode; label: string; key: string; icon: IconName }[] = [
  { tool: 'select', label: 'Select', key: 'Q', icon: 'select' },
  { tool: 'translate', label: 'Move', key: 'W', icon: 'move' },
  { tool: 'rotate', label: 'Rotate', key: 'E', icon: 'rotate' },
  { tool: 'scale', label: 'Scale', key: 'R', icon: 'scale' },
];

export function TopBar() {
  const actions = useActions();
  const history = useEditor((s) => s.history);
  const tool = useEditor((s) => s.tool);
  const editMode = useEditor((s) => s.editMode);
  const settings = useEditor((s) => s.settings);
  const project = useEditor((s) => s.project);
  const dirty = useEditor((s) => s.dirty);
  const hasSelection = useEditor((s) => s.selectedId !== null);
  const canEditPoints = useEditor((s) => isConstructionMesh(s.selectedId ? s.scene.objects[s.selectedId] : null));
  const pointsMode = editMode === 'points';

  const fileMenu: MenuEntry[] = [
    { label: 'New project', shortcut: 'Ctrl+N', onSelect: () => void actions.newProject() },
    { label: 'Open…', shortcut: 'Ctrl+O', onSelect: () => void actions.openProject() },
    { separator: true },
    { label: 'Save', shortcut: 'Ctrl+S', onSelect: () => void actions.saveProject() },
    { label: 'Save as…', shortcut: 'Ctrl+Shift+S', onSelect: () => void actions.saveProjectAs() },
  ];
  const editMenu: MenuEntry[] = [
    { label: history.undoLabel ? `Undo ${history.undoLabel}` : 'Undo', shortcut: 'Ctrl+Z', onSelect: actions.undo, disabled: !history.canUndo },
    { label: history.redoLabel ? `Redo ${history.redoLabel}` : 'Redo', shortcut: 'Ctrl+Y', onSelect: actions.redo, disabled: !history.canRedo },
    { separator: true },
    { label: 'Duplicate', shortcut: 'Ctrl+D', onSelect: actions.duplicateSelection, disabled: !hasSelection },
    { label: 'Group', shortcut: 'Ctrl+G', onSelect: actions.groupSelection, disabled: !hasSelection },
    { label: 'Delete', shortcut: 'Del', onSelect: actions.deleteSelection, disabled: !hasSelection },
    { separator: true },
    { label: pointsMode ? 'Leave points mode' : 'Edit points', shortcut: 'Tab', onSelect: actions.togglePointsMode, disabled: !canEditPoints },
    { label: 'Fill closed loops', onSelect: actions.fillLoops, disabled: !canEditPoints },
    { label: 'Recalculate normals', onSelect: actions.recalculateNormals, disabled: !canEditPoints },
    { label: 'Check geometry', onSelect: actions.checkGeometry, disabled: !canEditPoints },
  ];
  const createMenu: MenuEntry[] = [
    { label: 'Cube', onSelect: () => actions.addPart('cube') },
    { label: 'Plane', onSelect: () => actions.addPart('plane') },
    { label: 'Sphere', onSelect: () => actions.addPart('sphere') },
    { label: 'Cylinder', onSelect: () => actions.addPart('cylinder') },
    { separator: true },
    { label: 'Empty group', onSelect: () => actions.addPart('group') },
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
      </nav>

      <div className="toolbar" role="toolbar" aria-label="Editing tools">
        <div className="tool-group">
          <button type="button" className="icon-button" onClick={actions.undo} disabled={!history.canUndo} title={`Undo ${history.undoLabel ?? ''} (Ctrl+Z)`}>
            <Icon name="undo" />
          </button>
          <button type="button" className="icon-button" onClick={actions.redo} disabled={!history.canRedo} title={`Redo ${history.redoLabel ?? ''} (Ctrl+Y)`}>
            <Icon name="redo" />
          </button>
        </div>

        <div className="tool-group" role="radiogroup" aria-label="Transform tool">
          {TOOLS.map((item) => {
            const unavailable = pointsMode && (item.tool === 'rotate' || item.tool === 'scale');
            return (
              <button
                key={item.tool}
                type="button"
                role="radio"
                aria-checked={tool === item.tool}
                className={`icon-button ${tool === item.tool ? 'is-active' : ''}`}
                onClick={() => actions.setTool(item.tool)}
                disabled={unavailable}
                title={unavailable ? `${item.label} works on whole objects; points move only` : `${item.label} (${item.key})`}
              >
                <Icon name={item.icon} />
              </button>
            );
          })}
        </div>

        <div className="tool-group">
          <button
            type="button"
            className={`icon-button ${pointsMode ? 'is-active is-points' : ''}`}
            onClick={actions.togglePointsMode}
            disabled={!canEditPoints && !pointsMode}
            aria-pressed={pointsMode}
            title="Edit points (Tab)"
          >
            <Icon name="points" />
          </button>
          <button type="button" className="icon-button" onClick={actions.frameSelection} title="Frame selection (F)">
            <Icon name="frame" />
          </button>
        </div>

        <div className="tool-group snap-group">
          <button
            type="button"
            className={`icon-button ${settings.snapEnabled ? 'is-active' : ''}`}
            aria-pressed={settings.snapEnabled}
            onClick={() => actions.store.updateSettings({ snapEnabled: !settings.snapEnabled })}
            title="Snap to grid"
          >
            <Icon name="snap" />
          </button>
          <label className="compact-select" title="Grid size and move snap">
            <span className="visually-hidden">Grid size</span>
            <select
              value={settings.gridSize}
              onChange={(event) => actions.store.updateSettings({ gridSize: Number(event.target.value) })}
            >
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
        <button type="button" className="text-button" onClick={() => void actions.saveProject()} disabled={!dirty && project.path !== null}>
          <Icon name="save" size={14} />
          Save
        </button>
      </div>
    </header>
  );
}
