import { useEffect, useMemo } from 'react';
import { EditorProvider } from './app/EditorContext';
import { EditorActions } from './app/editorActions';
import { startMcpBridge } from './app/mcpBridge';
import { useShortcuts } from './app/useShortcuts';
import type { EditorStore } from './core/editor/editorStore';
import { APP_NAME } from './core/version';
import type { PlatformFiles } from './platform/files';
import { DiagnosticsPanel } from './ui/DiagnosticsPanel';
import { HierarchyPanel } from './ui/HierarchyPanel';
import { Inspector } from './ui/Inspector';
import { PartsLibrary } from './ui/PartsLibrary';
import { StatusBar } from './ui/StatusBar';
import { TopBar } from './ui/TopBar';
import { Viewport } from './viewport/Viewport';

export function App({ store, files }: { store: EditorStore; files: PlatformFiles }) {
  const actions = useMemo(() => new EditorActions(store, files), [store, files]);
  useShortcuts(actions);

  // Window title shows the project name and an unsaved marker.
  useEffect(() => {
    let lastTitle = '';
    const update = () => {
      const { project, dirty } = store.getState();
      const title = `${dirty ? '● ' : ''}${project.name} — ${APP_NAME}`;
      if (title === lastTitle) return;
      lastTitle = title;
      void files.setTitle(title).catch(() => undefined);
    };
    update();
    return store.subscribe(update);
  }, [store, files]);

  // Ask before closing with unsaved changes.
  useEffect(() => files.installCloseGuard(() => store.getState().dirty), [store, files]);

  // Let AI assistants work in the open project through the FORGEX MCP server.
  useEffect(() => startMcpBridge(actions), [actions]);

  return (
    <EditorProvider actions={actions}>
      <div className="app">
        <TopBar />
        <main className="workspace">
          <PartsLibrary />
          <Viewport />
          <div className="sidebar">
            <HierarchyPanel />
            <Inspector />
          </div>
        </main>
        <DiagnosticsPanel />
        <StatusBar />
      </div>
    </EditorProvider>
  );
}
