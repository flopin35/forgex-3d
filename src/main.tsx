import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import { EditorStore } from './core/editor/editorStore';
import { createStarterDocument } from './core/project/defaultDocument';
import { createPlatformFiles } from './platform/files';
import './styles.css';

async function start() {
  const files = await createPlatformFiles();
  const store = new EditorStore(createStarterDocument());
  // Open with the example sword selected, so the board shows its drawing next to the 3D result.
  store.select(store.getState().scene.rootIds[0] ?? null);
  store.log(
    'info',
    files.kind === 'desktop'
      ? 'FORGEX 3D is ready. Draw on the board on the left and watch the object build on the right.'
      : 'Running as a browser preview: Save and Export download files instead of writing them in place.',
  );
  createRoot(document.getElementById('root')!).render(
    <StrictMode>
      <App store={store} files={files} />
    </StrictMode>,
  );
}

void start();
