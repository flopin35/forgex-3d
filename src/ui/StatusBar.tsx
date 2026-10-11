import { useSyncExternalStore } from 'react';
import { useActions, useEditor } from '../app/EditorContext';
import { aiLink } from '../app/mcpBridge';
import { perfStats } from '../app/perfStats';

function ms(value: number): string {
  return value < 10 ? value.toFixed(1) : Math.round(value).toString();
}

export function StatusBar() {
  const { files } = useActions();
  const objectCount = useEditor((s) => Object.keys(s.scene.objects).length);
  const selectedName = useEditor((s) => (s.selectedId ? s.scene.objects[s.selectedId]?.name ?? null : null));
  const path = useEditor((s) => s.project.path);
  const dirty = useEditor((s) => s.dirty);
  const perf = useSyncExternalStore(perfStats.subscribe, perfStats.getSnapshot);
  const ai = useSyncExternalStore(aiLink.subscribe, aiLink.getSnapshot);

  return (
    <footer className="statusbar">
      <span>{objectCount === 1 ? '1 object' : `${objectCount} objects`}</span>
      <span>{selectedName ? `Selected: ${selectedName}` : 'Nothing selected'}</span>
      <span className="status-spacer" />
      <span title="Last render time, last mesh rebuild time and scene triangle count (performance budgets)">
        Render {ms(perf.renderMs)} ms
      </span>
      <span>Rebuild {ms(perf.rebuildMs)} ms</span>
      <span>{perf.triangles.toLocaleString()} triangles</span>
      <span className="status-spacer" />
      {ai.connected && (
        <span className={`status-ai ${ai.busyWith ? 'is-busy' : ''}`} title="An AI assistant is linked through the FORGEX MCP server">
          {ai.busyWith ? `AI working: ${ai.busyWith}` : 'AI linked'}
        </span>
      )}
      {files.kind === 'browser' && <span className="status-badge">Browser preview</span>}
      <span className={dirty ? 'status-dirty' : ''}>{dirty ? 'Unsaved changes' : 'Saved'}</span>
      <span className="status-path" title={path ?? undefined}>
        {path ?? 'Not saved to disk yet'}
      </span>
    </footer>
  );
}
