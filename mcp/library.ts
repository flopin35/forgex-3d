import { mkdir, readdir, readFile, stat, unlink } from 'node:fs/promises';
import { join } from 'node:path';
import {
  isLibraryFileName,
  LibraryError,
  libraryEntry,
  libraryFileName,
  LIBRARY_FOLDER_NAME,
  MAX_LIBRARY_PART_BYTES,
  parseLibraryPart,
  serializeLibraryPart,
  type LibraryEntry,
  type LibraryPart,
  type LibraryStore,
} from '../src/core/library/libraryPart';
import { writeFileAtomically } from './atomic';

/** My Parts on disk: one .forgexpart file per part in <projects folder>\Library, shared with the app. */
export class FolderLibrary implements LibraryStore {
  readonly folder: string;

  constructor(projectsFolder: string) {
    this.folder = join(projectsFolder, LIBRARY_FOLDER_NAME);
  }

  location(): string {
    return this.folder;
  }

  private path(file: string): string {
    if (!isLibraryFileName(file)) throw new LibraryError(`${file} is not a part file name.`);
    return join(this.folder, file);
  }

  async list(): Promise<LibraryEntry[]> {
    let files: string[];
    try {
      files = await readdir(this.folder);
    } catch {
      return [];
    }
    const out: LibraryEntry[] = [];
    for (const file of files.filter(isLibraryFileName)) {
      try {
        const info = await stat(join(this.folder, file));
        if (info.size > MAX_LIBRARY_PART_BYTES) continue;
        const parsed = parseLibraryPart(await readFile(join(this.folder, file), 'utf8'));
        if (parsed.ok) out.push(libraryEntry(file, parsed.part));
      } catch {
        // A file that cannot be read is left out of the list.
      }
    }
    return out.sort((a, b) => a.name.localeCompare(b.name));
  }

  async read(file: string): Promise<LibraryPart> {
    let text: string;
    try {
      text = await readFile(this.path(file), 'utf8');
    } catch (error) {
      if (error instanceof LibraryError) throw error;
      throw new LibraryError(`There is no part called ${file} in My Parts.`);
    }
    const parsed = parseLibraryPart(text);
    if (!parsed.ok) throw new LibraryError(`${file} could not be read: ${parsed.errors.join(' ')}`);
    return parsed.part;
  }

  async write(part: LibraryPart, overwrite: boolean): Promise<string> {
    const file = libraryFileName(part.name);
    const target = this.path(file);
    await mkdir(this.folder, { recursive: true });
    if (!overwrite) {
      const taken = await stat(target).then(
        () => true,
        () => false,
      );
      if (taken) throw new LibraryError(`My Parts already has ${file}. Choose another name, or pass overwrite true to replace it.`);
    }
    await writeFileAtomically(target, serializeLibraryPart(part));
    return file;
  }

  async remove(file: string): Promise<void> {
    await unlink(this.path(file));
  }
}
