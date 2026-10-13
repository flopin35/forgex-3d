import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import { boardStore } from './app/boardState';
import { uiStore } from './app/uiState';
import { EditorStore } from './core/editor/editorStore';
import { createCarDocument, createEmptyDocument } from './core/project/defaultDocument';
import { createPlatformFiles } from './platform/files';
import './styles.css';

async function openedByAiAssistant(): Promise<boolean> {
  try {
    const { invoke } = await import('@tauri-apps/api/core');
    return await invoke<boolean>('opened_by_ai');
  } catch {
    return false;
  }
}

async function start() {
  const files = await createPlatformFiles();
  // `?demo=car` opens straight on the example car (used for screenshots and quick looks).
  const demo = new URLSearchParams(window.location.search).get('demo');
  const store = new EditorStore(demo === 'car' ? createCarDocument() : createEmptyDocument());
  if (demo === 'car') {
    // The example car's body selected, so the board shows its side view next to the 3D car.
    const body = Object.values(store.getState().scene.objects).find((object) => object.name === 'Body');
    store.select(body?.id ?? null);
    boardStore.set({ bodyView: 'side', tool: 'curve' });
  } else {
    // A blank board ready for the first dot, with the start screen on top, unless an AI
    // assistant opened this window: then its work shows straight away.
    boardStore.set({ tool: 'draw' });
    const openedByAi = files.kind === 'desktop' && (await openedByAiAssistant());
    uiStore.set({ startOpen: demo !== 'blank' && !openedByAi });
  }
  if (files.kind === 'browser') {
    store.log('info', 'Running as a browser preview: Save and Export download files instead of writing them in place.', undefined, { quiet: true });
  }
  createRoot(document.getElementById('root')!).render(
    <StrictMode>
      <App store={store} files={files} />
    </StrictMode>,
  );
}

void start();
