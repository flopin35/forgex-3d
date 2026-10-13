import { useEffect, useRef, useSyncExternalStore } from 'react';
import { boardStore } from '../app/boardState';
import { useActions, useEditor } from '../app/EditorContext';
import { uiStore } from '../app/uiState';
import type { ToolMode } from '../core/editor/editorStore';
import { isLocked } from '../core/scene/scene';
import { isConstructionMesh } from '../core/scene/types';
import { GRID_PRESETS } from '../core/units';
import { Icon, type IconName } from '../ui/icons';
import { ShapeCard } from '../ui/ShapeCard';
import { ViewportEngine } from './ViewportEngine';

const TOOLS: { tool: ToolMode; label: string; key: string; icon: IconName }[] = [
  { tool: 'select', label: 'Select', key: 'Q', icon: 'select' },
  { tool: 'translate', label: 'Move', key: 'W', icon: 'move' },
  { tool: 'rotate', label: 'Rotate', key: 'E', icon: 'rotate' },
  { tool: 'scale', label: 'Scale', key: 'R', icon: 'scale' },
];

export function Viewport() {
  const actions = useActions();
  const hostRef = useRef<HTMLDivElement>(null);
  const editMode = useEditor((s) => s.editMode);
  const tool = useEditor((s) => s.tool);
  const settings = useEditor((s) => s.settings);
  const objectCount = useEditor((s) => s.scene.rootIds.length);
  const selected = useEditor((s) => (s.selectedId ? s.scene.objects[s.selectedId] ?? null : null));
  const selectedLocked = useEditor((s) => isLocked(s.scene, s.selectedId));
  const parentName = useEditor((s) => {
    const object = s.selectedId ? s.scene.objects[s.selectedId] : undefined;
    return object?.parentId ? s.scene.objects[object.parentId]?.name ?? null : null;
  });
  const selectedVertexId = useEditor((s) => s.selectedVertexId);
  const canEditPoints = isConstructionMesh(selected);
  const turntable = useSyncExternalStore(boardStore.subscribe, () => boardStore.getState().turntable);
  const drawerOpen = useSyncExternalStore(uiStore.subscribe, () => uiStore.getState().drawerOpen);

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    let engine: ViewportEngine;
    try {
      engine = new ViewportEngine(host, actions.store);
    } catch (error) {
      actions.store.log('error', 'The 3D view could not start. Your graphics driver may not support WebGL 2.', String(error));
      return;
    }
    actions.attachViewport(engine);
    return () => {
      actions.attachViewport(null);
      engine.dispose();
    };
  }, [actions]);

  const pointsMode = editMode === 'points';

  return (
    <section className={`viewport ${drawerOpen ? 'has-drawer' : ''}`} aria-label="3D view">
      <div ref={hostRef} className="viewport-host" />

      <div className="view-toolbar" role="toolbar" aria-label="3D tools">
        <div className="tool-cluster">
          {TOOLS.map((item) => {
            const unavailable = pointsMode && (item.tool === 'rotate' || item.tool === 'scale');
            const active = tool === item.tool || (pointsMode && item.tool === 'translate' && tool !== 'select');
            return (
              <button
                key={item.tool}
                type="button"
                className={`icon-button ${active ? 'is-active' : ''}`}
                aria-pressed={active}
                onClick={() => actions.setTool(item.tool)}
                disabled={unavailable}
                title={unavailable ? `${item.label} works on whole objects; points move only` : `${item.label} (${item.key})`}
              >
                <Icon name={item.icon} />
              </button>
            );
          })}
          <button
            type="button"
            className={`icon-button ${pointsMode ? 'is-active' : ''}`}
            onClick={actions.togglePointsMode}
            disabled={!canEditPoints && !pointsMode}
            aria-pressed={pointsMode}
            title="Edit points of a point-built object (Tab)"
          >
            <Icon name="points" />
          </button>
        </div>
        <div className="tool-cluster" title="Snapping for move, rotate and scale in 3D">
          <button
            type="button"
            className={`icon-button ${settings.snapEnabled ? 'is-active' : ''}`}
            aria-pressed={settings.snapEnabled}
            onClick={() => actions.store.updateSettings({ snapEnabled: !settings.snapEnabled })}
            title={settings.snapEnabled ? '3D snapping on' : '3D snapping off'}
          >
            <Icon name="magnet" />
          </button>
          <label className="compact-select" title="3D grid size and move step">
            <span className="visually-hidden">3D grid size</span>
            <select value={settings.gridSize} onChange={(event) => actions.store.updateSettings({ gridSize: Number(event.target.value) })}>
              {GRID_PRESETS.map((preset) => (
                <option key={preset.size} value={preset.size}>
                  {preset.label}
                </option>
              ))}
            </select>
          </label>
          <label className="compact-select" title="Rotation step">
            <span className="visually-hidden">Rotation step</span>
            <select value={settings.rotationSnapDegrees} onChange={(event) => actions.store.updateSettings({ rotationSnapDegrees: Number(event.target.value) })}>
              {[5, 10, 15, 30, 45, 90].map((deg) => (
                <option key={deg} value={deg}>
                  {deg}°
                </option>
              ))}
            </select>
          </label>
        </div>
        <div className="tool-cluster">
          <button type="button" className="icon-button" onClick={actions.frameSelection} title="Frame the selection (F)">
            <Icon name="frame" />
          </button>
          <button type="button" className={`icon-button ${turntable ? 'is-active' : ''}`} onClick={actions.toggleTurntable} aria-pressed={turntable} title="Turntable: spin the view (T)">
            <Icon name="turntable" />
          </button>
        </div>
      </div>

      {pointsMode && (
        <div className="viewport-hud" aria-live="polite">
          <span className="mode-chip">Points</span>
          <span>{selectedVertexId ? `Vertex ${selectedVertexId}` : 'Click a point to select it'}</span>
        </div>
      )}

      <ShapeCard />

      {selected && !pointsMode && (
        <div className="selection-chip">
          <span className="selection-name" title={selected.name}>
            {parentName && <span className="selection-parent">{parentName} › </span>}
            {selected.name}
          </span>
          <button
            type="button"
            className={`icon-button is-small ${selected.locked ? 'is-active' : ''}`}
            aria-pressed={!!selected.locked}
            onClick={() => actions.toggleLock(selected.id)}
            title={selected.locked ? 'Unlock (Ctrl+L)' : selectedLocked ? 'Inside a locked group' : 'Lock against changes (Ctrl+L)'}
          >
            <Icon name={selectedLocked ? 'lock' : 'unlock'} size={14} />
          </button>
          <button type="button" className="text-button is-small" onClick={() => uiStore.set({ drawerOpen: true, drawerTab: 'properties' })}>
            Properties
          </button>
        </div>
      )}

      {objectCount === 0 && (
        <div className="viewport-empty">
          <p className="viewport-empty-title">Your object appears here</p>
          <p>Close an outline on the board and it turns solid. Left-drag to orbit, right-drag to pan, wheel to zoom.</p>
        </div>
      )}
    </section>
  );
}
