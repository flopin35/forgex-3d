import { fileNameFromPath } from '../core/project/paths';
import type { PlatformFiles } from './files';

function download(blob: Blob, name: string): void {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = name;
  document.body.append(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/**
 * Used when the editor runs in a normal browser (npm run dev without Tauri).
 * Opening uses a file picker; saving downloads the .forgex file.
 */
export function createBrowserFiles(): PlatformFiles {
  return {
    kind: 'browser',

    openProjectFile() {
      return new Promise((resolve, reject) => {
        const input = document.createElement('input');
        input.type = 'file';
        input.accept = '.forgex,application/json';
        input.addEventListener('change', () => {
          const file = input.files?.[0];
          if (!file) return resolve(null);
          file.text().then((contents) => resolve({ name: file.name, path: null, contents }), reject);
        });
        input.addEventListener('cancel', () => resolve(null));
        input.click();
      });
    },

    async readProjectAt() {
      throw new Error('Opening a project by path needs the desktop app (npm run desktop).');
    },

    async chooseSavePath(suggestedName) {
      return suggestedName;
    },

    async writeProjectFile(path, contents) {
      download(new Blob([contents], { type: 'application/json' }), fileNameFromPath(path));
    },

    async chooseExportPath(suggestedName) {
      return suggestedName;
    },

    async writeExportFile(path, bytes) {
      download(new Blob([bytes], { type: 'model/gltf-binary' }), fileNameFromPath(path));
    },

    async confirm(title, message) {
      return window.confirm(`${title}\n\n${message}`);
    },

    async setTitle(title) {
      document.title = title;
    },

    installCloseGuard(isDirty) {
      const handler = (event: BeforeUnloadEvent) => {
        if (!isDirty()) return;
        event.preventDefault();
        event.returnValue = '';
      };
      window.addEventListener('beforeunload', handler);
      return () => window.removeEventListener('beforeunload', handler);
    },
  };
}
