import { useEffect, useRef } from 'react';
import { useActions, useEditor } from '../app/EditorContext';
import { ViewportEngine } from './ViewportEngine';

const TOOL_NAMES = { select: 'Select', translate: 'Move', rotate: 'Rotate', scale: 'Scale' } as const;

export function Viewport() {
  const actions = useActions();
  const hostRef = useRef<HTMLDivElement>(null);
  const editMode = useEditor((s) => s.editMode);
  const tool = useEditor((s) => s.tool);
  const snapEnabled = useEditor((s) => s.settings.snapEnabled);
  const gridSize = useEditor((s) => s.settings.gridSize);
  const objectCount = useEditor((s) => s.scene.rootIds.length);
  const selectedName = useEditor((s) => (s.selectedId ? s.scene.objects[s.selectedId]?.name ?? null : null));
  const selectedVertexId = useEditor((s) => s.selectedVertexId);

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
  const activeTool = pointsMode && tool !== 'select' ? 'translate' : tool;

  return (
    <section className="viewport" aria-label="3D viewport">
      <div ref={hostRef} className="viewport-host" />
      <div className="viewport-hud" aria-live="polite">
        <span className={`mode-chip ${pointsMode ? 'mode-chip--points' : ''}`}>
          {pointsMode ? `Points: ${selectedName ?? ''}` : 'Object mode'}
        </span>
        <span className="hud-item">{TOOL_NAMES[activeTool]}</span>
        <span className="hud-item">{snapEnabled ? `Snap ${gridSize} m` : 'Snap off'}</span>
        {pointsMode && <span className="hud-item">{selectedVertexId ? `Vertex ${selectedVertexId}` : 'Click a point to select it'}</span>}
      </div>
      {objectCount === 0 && (
        <div className="viewport-empty">
          <p>The scene is empty.</p>
          <p>Add a part from the library on the left.</p>
        </div>
      )}
      <div className="viewport-help">
        <span>Left-drag orbit</span>
        <span>Right-drag pan</span>
        <span>Wheel zoom</span>
        <span>F frame</span>
        <span>Tab edit points</span>
      </div>
    </section>
  );
}
