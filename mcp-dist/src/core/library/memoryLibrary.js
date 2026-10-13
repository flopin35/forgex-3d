"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.MemoryStorage = exports.StorageLibrary = void 0;
const libraryPart_1 = require("./libraryPart");
const INDEX_KEY = 'forgex.library.index.v1';
const PART_KEY = (file) => `forgex.library.part.${file}`;
/** A library kept in key-value storage: the browser preview's version of the Library folder. */
class StorageLibrary {
    storage;
    where;
    constructor(storage, where = 'browser storage') {
        this.storage = storage;
        this.where = where;
    }
    location() {
        return this.where;
    }
    index() {
        try {
            const raw = JSON.parse(this.storage.getItem(INDEX_KEY) ?? '[]');
            return Array.isArray(raw) ? raw.filter((file) => typeof file === 'string' && (0, libraryPart_1.isLibraryFileName)(file)) : [];
        }
        catch {
            return [];
        }
    }
    async list() {
        const out = [];
        for (const file of this.index()) {
            const text = this.storage.getItem(PART_KEY(file));
            if (!text)
                continue;
            const parsed = (0, libraryPart_1.parseLibraryPart)(text);
            if (parsed.ok)
                out.push((0, libraryPart_1.libraryEntry)(file, parsed.part));
        }
        return out.sort((a, b) => a.name.localeCompare(b.name));
    }
    async read(file) {
        const text = (0, libraryPart_1.isLibraryFileName)(file) ? this.storage.getItem(PART_KEY(file)) : null;
        if (!text)
            throw new libraryPart_1.LibraryError(`There is no part called ${file} in My Parts.`);
        const parsed = (0, libraryPart_1.parseLibraryPart)(text);
        if (!parsed.ok)
            throw new libraryPart_1.LibraryError(`${file} could not be read: ${parsed.errors.join(' ')}`);
        return parsed.part;
    }
    async write(part, overwrite) {
        const file = (0, libraryPart_1.libraryFileName)(part.name);
        const files = this.index();
        if (files.includes(file) && !overwrite)
            throw new libraryPart_1.LibraryError(`My Parts already has ${file}. Choose another name or replace it.`);
        try {
            this.storage.setItem(PART_KEY(file), (0, libraryPart_1.serializeLibraryPart)(part));
        }
        catch {
            throw new libraryPart_1.LibraryError('Browser storage is full, so the part was not saved.');
        }
        if (!files.includes(file))
            this.storage.setItem(INDEX_KEY, JSON.stringify([...files, file]));
        return file;
    }
    async remove(file) {
        this.storage.removeItem(PART_KEY(file));
        this.storage.setItem(INDEX_KEY, JSON.stringify(this.index().filter((item) => item !== file)));
    }
}
exports.StorageLibrary = StorageLibrary;
/** In-memory text storage for tests and for browsers that block localStorage. */
class MemoryStorage {
    map = new Map();
    getItem(key) {
        return this.map.get(key) ?? null;
    }
    setItem(key, value) {
        this.map.set(key, value);
    }
    removeItem(key) {
        this.map.delete(key);
    }
}
exports.MemoryStorage = MemoryStorage;
