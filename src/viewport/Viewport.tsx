import { useEffect, useRef, useSyncExternalStore } from 'react';
import { boardStore } from '../app/boardState';
import { useActions, useEditor } from '../app/EditorContext';
import type { ToolMode } from '../core/editor/editorStore';
import { isConstructionMesh } from '../core/scene/types';
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
  const objectCount = useEditor((s) => s.scene.rootIds.length);
  const selectedName = useEditor((s) => (s.selectedId ? s.scene.objects[s.selectedId]?.name ?? null : null));
  const selectedVertexId = useEditor((s) => s.selectedVertexId);
  const canEditPoints = useEditor((s) => isConstructionMesh(s.selectedId ? s.scene.objects[s.selectedId] : null));
  const turntable = useSyncExternalStore(boardStore.subscribe, () => boardStore.getState().turntable);

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    let engine: ViewportEngine;
    try {
      engine = new ViewportEngine(host, actions.store);
    } catch (error) {
      actions.store.log('error', 'The 3D viewport could not start. Your graphics driver may not support WebGL 2.', String(error));
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
    <section className="viewport" aria-label="3D view">
      <div ref={hostRef} className="viewport-host" />

      <div className="view-toolbar" role="toolbar" aria-label="3D tools">
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
        <span className="toolbar-separator" />
        <button
          type="button"
          className={`icon-button ${pointsMode ? 'is-active is-points' : ''}`}
          onClick={actions.togglePointsMode}
          disabled={!canEditPoints && !pointsMode}
          aria-pressed={pointsMode}
          title="Edit points of a point-built object (Tab)"
        >
          <Icon name="points" />
        </button>
        <button type="button" className="icon-button" onClick={actions.frameSelection} title="Frame the selection (F)">
          <Icon name="frame" />
        </button>
        <button
          type="button"
          className={`icon-button ${turntable ? 'is-active' : ''}`}
          onClick={actions.toggleTurntable}
          aria-pressed={turntable}
          title="Turntable: spin the view (T)"
        >
          <Icon name="turntable" />
        </button>
      </div>

      {pointsMode && (
        <div className="viewport-hud" aria-live="polite">
          <span className="mode-chip mode-chip--points">Points: {selectedName ?? ''}</span>
          <span className="hud-item">{selectedVertexId ? `Vertex ${selectedVertexId}` : 'Click a point to select it'}</span>
        </div>
      )}

      <ShapeCard />

      {objectCount === 0 && (
        <div className="viewport-empty">
          <Icon name="shapeExtrude" size={34} />
          <p className="viewport-empty-title">Your 3D object appears here</p>
          <p>Draw on the board, or add a part or a ready-made car from the Create menu.</p>
        </div>
      )}
      <div className="viewport-help">
        <span>Left-drag orbit</span>
        <span>Right-drag pan</span>
        <span>Wheel zoom</span>
        <span>F frame</span>
      </div>
    </section>
  );
}
