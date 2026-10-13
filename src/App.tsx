import { useEffect, useMemo, useRef, useSyncExternalStore, type PointerEvent as ReactPointerEvent } from 'react';
import { boardStore } from './app/boardState';
import { EditorProvider } from './app/EditorContext';
import { EditorActions } from './app/editorActions';
import { startMcpBridge } from './app/mcpBridge';
import { uiStore } from './app/uiState';
import { useShortcuts } from './app/useShortcuts';
import { SketchBoard } from './board/SketchBoard';
import type { EditorStore } from './core/editor/editorStore';
import { APP_NAME } from './core/version';
import type { PlatformFiles } from './platform/files';
import { CommandPalette } from './ui/CommandPalette';
import { ConnectPanel } from './ui/ConnectPanel';
import { Drawer } from './ui/Drawer';
import { ShortcutsSheet } from './ui/ShortcutsSheet';
import { StartScreen } from './ui/StartScreen';
import { Toasts } from './ui/Toasts';
import { TopBar } from './ui/TopBar';
import { Viewport } from './viewport/Viewport';

/**
 * The calm layout: one slim bar, the board on the left and the 3D object on the right.
 * Panels (parts, properties, My Parts, versions) stay hidden in a drawer until opened,
 * and messages pop up briefly instead of filling a panel.
 */
export function App({ store, files }: { store: EditorStore; files: PlatformFiles }) {
  const actions = useMemo(() => new EditorActions(store, files), [store, files]);
  useShortcuts(actions);
  const split = useSyncExternalStore(boardStore.subscribe, () => boardStore.getState().split);
  const ui = useSyncExternalStore(uiStore.subscribe, uiStore.getState);
  const stageRef = useRef<HTMLDivElement>(null);

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

  /** Drag the divider between the board and the 3D view. */
  const onSplitterDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    const stage = stageRef.current;
    if (!stage) return;
    const handle = event.currentTarget;
    handle.setPointerCapture(event.pointerId);
    const rect = stage.getBoundingClientRect();
    const move = (moveEvent: PointerEvent) => {
      const share = (moveEvent.clientX - rect.left) / rect.width;
      boardStore.set({ split: Math.round(Math.min(0.75, Math.max(0.25, share)) * 1000) / 1000 });
    };
    const up = () => {
      handle.removeEventListener('pointermove', move);
      handle.removeEventListener('pointerup', up);
      handle.removeEventListener('pointercancel', up);
    };
    handle.addEventListener('pointermove', move);
    handle.addEventListener('pointerup', up);
    handle.addEventListener('pointercancel', up);
  };

  return (
    <EditorProvider actions={actions}>
      <div className="app">
        <TopBar />
        <main className="workspace">
          <div ref={stageRef} className="stage" style={{ gridTemplateColumns: `minmax(0, ${split}fr) 10px minmax(0, ${1 - split}fr)` }}>
            <SketchBoard />
            <div
              className="splitter"
              role="separator"
              aria-orientation="vertical"
              aria-label="Resize the board and the 3D view"
              onPointerDown={onSplitterDown}
              onDoubleClick={() => boardStore.set({ split: 0.5 })}
            >
              <span className="splitter-grip" />
            </div>
            <div className="view-bay">
              <Viewport />
              <Drawer />
            </div>
          </div>
        </main>
        <Toasts />
        {ui.startOpen && <StartScreen />}
        {ui.connectOpen && <ConnectPanel />}
        {ui.shortcutsOpen && <ShortcutsSheet />}
        {ui.paletteOpen && <CommandPalette />}
      </div>
    </EditorProvider>
  );
}
