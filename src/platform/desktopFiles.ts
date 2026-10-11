import { invoke } from '@tauri-apps/api/core';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { ask, open, save } from '@tauri-apps/plugin-dialog';
import { fileNameFromPath } from '../core/project/paths';
import { PROJECT_EXTENSION } from '../core/project/projectFile';
import type { PlatformFiles } from './files';

const FILTERS = [{ name: 'FORGEX 3D project', extensions: [PROJECT_EXTENSION] }];

/** File access through the Tauri shell. Reading and writing happen in Rust (src-tauri/src/project_files.rs). */
export function createDesktopFiles(): PlatformFiles {
  const appWindow = getCurrentWindow();

  return {
    kind: 'desktop',

    async openProjectFile() {
      const selected = await open({ title: 'Open FORGEX 3D project', multiple: false, directory: false, filters: FILTERS });
      if (!selected) return null;
      const path = Array.isArray(selected) ? selected[0] : selected;
      if (!path) return null;
      const contents = await invoke<string>('read_project_file', { path });
      return { name: fileNameFromPath(path), path, contents };
    },

    readProjectAt(path) {
      return invoke<string>('read_project_file', { path });
    },

    async chooseSavePath(suggestedName) {
      return save({ title: 'Save FORGEX 3D project', defaultPath: suggestedName, filters: FILTERS });
    },

    async writeProjectFile(path, contents) {
      await invoke('write_project_file', { path, contents });
    },

    confirm(title, message) {
      return ask(message, { title, kind: 'warning' });
    },

    async setTitle(title) {
      await appWindow.setTitle(title);
    },

    installCloseGuard(isDirty) {
      let disposed = false;
      let unlisten: (() => void) | null = null;
      void appWindow
        .onCloseRequested(async (event) => {
          if (!isDirty()) return;
          const discard = await ask('You have unsaved changes. Close FORGEX 3D and discard them?', {
            title: 'Unsaved changes',
            kind: 'warning',
          });
          if (!discard) event.preventDefault();
        })
        .then((stop) => {
          if (disposed) stop();
          else unlisten = stop;
        });
      return () => {
        disposed = true;
        unlisten?.();
      };
    },
  };
}
