import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import { EditorStore } from './core/editor/editorStore';
import { boardStore } from './app/boardState';
import { createCarDocument } from './core/project/defaultDocument';
import { createPlatformFiles } from './platform/files';
import './styles.css';

async function start() {
  const files = await createPlatformFiles();
  const store = new EditorStore(createCarDocument());
  // Open with the example car's body selected, so the board shows its side view next to the 3D car.
  const body = Object.values(store.getState().scene.objects).find((object) => object.name === 'Body');
  store.select(body?.id ?? null);
  boardStore.set({ bodyView: 'side', tool: 'curve' });
  store.log(
    'info',
    files.kind === 'desktop'
      ? 'FORGEX 3D is ready. This supercar is built from drawings: change its side, top and front views on the board, or start your own from the Create menu.'
      : 'Running as a browser preview: Save and Export download files instead of writing them in place.',
  );
  createRoot(document.getElementById('root')!).render(
    <StrictMode>
      <App store={store} files={files} />
    </StrictMode>,
  );
}

void start();
