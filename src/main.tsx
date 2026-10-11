import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import { EditorStore } from './core/editor/editorStore';
import { createPlatformFiles } from './platform/files';
import './styles.css';

async function start() {
  const files = await createPlatformFiles();
  const store = new EditorStore();
  store.log(
    'info',
    files.kind === 'desktop'
      ? 'FORGEX 3D is ready. Select the cube and press Tab to edit its points.'
      : 'Running as a browser preview: Save downloads the .forgex file instead of writing it in place.',
  );
  createRoot(document.getElementById('root')!).render(
    <StrictMode>
      <App store={store} files={files} />
    </StrictMode>,
  );
}

void start();
