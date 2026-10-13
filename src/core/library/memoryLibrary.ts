import {
  isLibraryFileName,
  LibraryError,
  libraryEntry,
  libraryFileName,
  parseLibraryPart,
  serializeLibraryPart,
  type LibraryEntry,
  type LibraryPart,
  type LibraryStore,
} from './libraryPart';

/** Text storage the library can sit on (browser localStorage, or a plain map in tests). */
export interface TextStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

const INDEX_KEY = 'forgex.library.index.v1';
const PART_KEY = (file: string) => `forgex.library.part.${file}`;

/** A library kept in key-value storage: the browser preview's version of the Library folder. */
export class StorageLibrary implements LibraryStore {
  constructor(
    private readonly storage: TextStorage,
    private readonly where = 'browser storage',
  ) {}

  location(): string {
    return this.where;
  }

  private index(): string[] {
    try {
      const raw = JSON.parse(this.storage.getItem(INDEX_KEY) ?? '[]') as unknown;
      return Array.isArray(raw) ? raw.filter((file): file is string => typeof file === 'string' && isLibraryFileName(file)) : [];
    } catch {
      return [];
    }
  }

  async list(): Promise<LibraryEntry[]> {
    const out: LibraryEntry[] = [];
    for (const file of this.index()) {
      const text = this.storage.getItem(PART_KEY(file));
      if (!text) continue;
      const parsed = parseLibraryPart(text);
      if (parsed.ok) out.push(libraryEntry(file, parsed.part));
    }
    return out.sort((a, b) => a.name.localeCompare(b.name));
  }

  async read(file: string): Promise<LibraryPart> {
    const text = isLibraryFileName(file) ? this.storage.getItem(PART_KEY(file)) : null;
    if (!text) throw new LibraryError(`There is no part called ${file} in My Parts.`);
    const parsed = parseLibraryPart(text);
    if (!parsed.ok) throw new LibraryError(`${file} could not be read: ${parsed.errors.join(' ')}`);
    return parsed.part;
  }

  async write(part: LibraryPart, overwrite: boolean): Promise<string> {
    const file = libraryFileName(part.name);
    const files = this.index();
    if (files.includes(file) && !overwrite) throw new LibraryError(`My Parts already has ${file}. Choose another name or replace it.`);
    try {
      this.storage.setItem(PART_KEY(file), serializeLibraryPart(part));
    } catch {
      throw new LibraryError('Browser storage is full, so the part was not saved.');
    }
    if (!files.includes(file)) this.storage.setItem(INDEX_KEY, JSON.stringify([...files, file]));
    return file;
  }

  async remove(file: string): Promise<void> {
    this.storage.removeItem(PART_KEY(file));
    this.storage.setItem(INDEX_KEY, JSON.stringify(this.index().filter((item) => item !== file)));
  }
}

/** In-memory text storage for tests and for browsers that block localStorage. */
export class MemoryStorage implements TextStorage {
  private readonly map = new Map<string, string>();
  getItem(key: string): string | null {
    return this.map.get(key) ?? null;
  }
  setItem(key: string, value: string): void {
    this.map.set(key, value);
  }
  removeItem(key: string): void {
    this.map.delete(key);
  }
}
