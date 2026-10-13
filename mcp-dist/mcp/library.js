"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.FolderLibrary = void 0;
const promises_1 = require("node:fs/promises");
const node_path_1 = require("node:path");
const libraryPart_1 = require("../src/core/library/libraryPart");
const atomic_1 = require("./atomic");
/** My Parts on disk: one .forgexpart file per part in <projects folder>\Library, shared with the app. */
class FolderLibrary {
    folder;
    constructor(projectsFolder) {
        this.folder = (0, node_path_1.join)(projectsFolder, libraryPart_1.LIBRARY_FOLDER_NAME);
    }
    location() {
        return this.folder;
    }
    path(file) {
        if (!(0, libraryPart_1.isLibraryFileName)(file))
            throw new libraryPart_1.LibraryError(`${file} is not a part file name.`);
        return (0, node_path_1.join)(this.folder, file);
    }
    async list() {
        let files;
        try {
            files = await (0, promises_1.readdir)(this.folder);
        }
        catch {
            return [];
        }
        const out = [];
        for (const file of files.filter(libraryPart_1.isLibraryFileName)) {
            try {
                const info = await (0, promises_1.stat)((0, node_path_1.join)(this.folder, file));
                if (info.size > libraryPart_1.MAX_LIBRARY_PART_BYTES)
                    continue;
                const parsed = (0, libraryPart_1.parseLibraryPart)(await (0, promises_1.readFile)((0, node_path_1.join)(this.folder, file), 'utf8'));
                if (parsed.ok)
                    out.push((0, libraryPart_1.libraryEntry)(file, parsed.part));
            }
            catch {
                // A file that cannot be read is left out of the list.
            }
        }
        return out.sort((a, b) => a.name.localeCompare(b.name));
    }
    async read(file) {
        let text;
        try {
            text = await (0, promises_1.readFile)(this.path(file), 'utf8');
        }
        catch (error) {
            if (error instanceof libraryPart_1.LibraryError)
                throw error;
            throw new libraryPart_1.LibraryError(`There is no part called ${file} in My Parts.`);
        }
        const parsed = (0, libraryPart_1.parseLibraryPart)(text);
        if (!parsed.ok)
            throw new libraryPart_1.LibraryError(`${file} could not be read: ${parsed.errors.join(' ')}`);
        return parsed.part;
    }
    async write(part, overwrite) {
        const file = (0, libraryPart_1.libraryFileName)(part.name);
        const target = this.path(file);
        await (0, promises_1.mkdir)(this.folder, { recursive: true });
        if (!overwrite) {
            const taken = await (0, promises_1.stat)(target).then(() => true, () => false);
            if (taken)
                throw new libraryPart_1.LibraryError(`My Parts already has ${file}. Choose another name, or pass overwrite true to replace it.`);
        }
        await (0, atomic_1.writeFileAtomically)(target, (0, libraryPart_1.serializeLibraryPart)(part));
        return file;
    }
    async remove(file) {
        await (0, promises_1.unlink)(this.path(file));
    }
}
exports.FolderLibrary = FolderLibrary;
