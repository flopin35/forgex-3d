import { invoke } from '@tauri-apps/api/core';
import {
  LibraryError,
  libraryEntry,
  libraryFileName,
  parseLibraryPart,
  serializeLibraryPart,
  type LibraryEntry,
  type LibraryPart,
  type LibraryStore,
} from '../core/library/libraryPart';

/** My Parts in Documents\FORGEX 3D\Library, through the Rust shell (src-tauri/src/library_files.rs). */
export class DesktopLibrary implements LibraryStore {
  private folder = 'Documents\\FORGEX 3D\\Library';

  constructor() {
    void invoke<{ library: string }>('forgex_paths').then(
      (paths) => (this.folder = paths.library),
      () => undefined,
    );
  }

  location(): string {
    return this.folder;
  }

  async list(): Promise<LibraryEntry[]> {
    const files = await invoke<{ file: string; contents: string }[]>('library_list');
    const out: LibraryEntry[] = [];
    for (const { file, contents } of files) {
      const parsed = parseLibraryPart(contents);
      if (parsed.ok) out.push(libraryEntry(file, parsed.part));
    }
    return out.sort((a, b) => a.name.localeCompare(b.name));
  }

  async read(file: string): Promise<LibraryPart> {
    let text: string;
    try {
      text = await invoke<string>('library_read', { file });
    } catch (error) {
      throw new LibraryError(String(error));
    }
    const parsed = parseLibraryPart(text);
    if (!parsed.ok) throw new LibraryError(`${file} could not be read: ${parsed.errors.join(' ')}`);
    return parsed.part;
  }

  async write(part: LibraryPart, overwrite: boolean): Promise<string> {
    const file = libraryFileName(part.name);
    try {
      await invoke('library_write', { file, contents: serializeLibraryPart(part), overwrite });
    } catch (error) {
      throw new LibraryError(String(error));
    }
    return file;
  }

  async remove(file: string): Promise<void> {
    try {
      await invoke('library_delete', { file });
    } catch (error) {
      throw new LibraryError(String(error));
    }
  }
}
