"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.LibraryError = exports.MAX_LIBRARY_PART_BYTES = exports.LIBRARY_FOLDER_NAME = exports.LIBRARY_EXTENSION = exports.LIBRARY_PART_VERSION = exports.LIBRARY_PART_FORMAT = void 0;
exports.libraryPartFromScene = libraryPartFromScene;
exports.serializeLibraryPart = serializeLibraryPart;
exports.parseLibraryPart = parseLibraryPart;
exports.libraryEntry = libraryEntry;
exports.instantiateLibraryPart = instantiateLibraryPart;
exports.libraryFileName = libraryFileName;
exports.isLibraryFileName = isLibraryFileName;
exports.findLibraryEntry = findLibraryEntry;
const projectFile_1 = require("../project/projectFile");
const scene_1 = require("../scene/scene");
const version_1 = require("../version");
/**
 * My Parts: a shared library of reusable objects (a wheel, a door, a whole car) kept in
 * one folder outside any project, so every project, and an AI assistant working through
 * the MCP server, can drop them in. One part per `.forgexpart` file.
 */
exports.LIBRARY_PART_FORMAT = 'forgex-part';
exports.LIBRARY_PART_VERSION = 1;
exports.LIBRARY_EXTENSION = 'forgexpart';
/** The folder inside the FORGEX projects folder (Documents\FORGEX 3D\Library on Windows). */
exports.LIBRARY_FOLDER_NAME = 'Library';
const MAX_THUMBNAIL_CHARS = 600_000;
exports.MAX_LIBRARY_PART_BYTES = 64 * 1024 * 1024;
class LibraryError extends Error {
    constructor(message) {
        super(message);
        this.name = 'LibraryError';
    }
}
exports.LibraryError = LibraryError;
/**
 * Takes an object and its children out of a scene as a library part. The part is moved
 * so it stands at the origin on the ground plane (its height is kept).
 */
function libraryPartFromScene(scene, id, options = {}) {
    const subtree = (0, scene_1.collectSubtree)(scene, id);
    const root = subtree[0];
    const objects = {};
    for (const object of subtree)
        objects[object.id] = object;
    const [, y] = root.transform.position;
    // A part always arrives unlocked, at its own place in the hierarchy.
    const { locked: _locked, ...unlocked } = root;
    void _locked;
    objects[root.id] = { ...unlocked, parentId: null, transform: { ...root.transform, position: [0, y, 0] } };
    const name = (options.name ?? root.name).trim().slice(0, 120) || root.name;
    const thumbnail = options.thumbnail && options.thumbnail.startsWith('data:image/') && options.thumbnail.length <= MAX_THUMBNAIL_CHARS ? options.thumbnail : undefined;
    return {
        name,
        description: (options.description ?? '').trim().slice(0, 500),
        createdAt: (options.now ?? new Date()).toISOString(),
        scene: { objects, rootIds: [root.id] },
        ...(thumbnail ? { thumbnail } : {}),
    };
}
function serializeLibraryPart(part) {
    const file = {
        format: exports.LIBRARY_PART_FORMAT,
        version: exports.LIBRARY_PART_VERSION,
        generator: `${version_1.APP_NAME} ${version_1.APP_VERSION}`,
        name: part.name,
        description: part.description,
        createdAt: part.createdAt,
        scene: (0, projectFile_1.serializeScene)(part.scene),
        ...(part.thumbnail ? { thumbnail: part.thumbnail } : {}),
    };
    return `${JSON.stringify(file, null, 1)}\n`;
}
/** Reads a .forgexpart file. Never throws. */
function parseLibraryPart(text) {
    let raw;
    try {
        raw = JSON.parse(text);
    }
    catch (error) {
        return { ok: false, errors: [`The file is not valid JSON: ${error.message}`] };
    }
    if (typeof raw !== 'object' || raw === null || Array.isArray(raw))
        return { ok: false, errors: ['This is not a FORGEX part file.'] };
    const data = raw;
    if (data.format !== exports.LIBRARY_PART_FORMAT)
        return { ok: false, errors: ['This is not a FORGEX part file.'] };
    if (!Number.isInteger(data.version) || data.version < 1)
        return { ok: false, errors: ['The part format version is missing or invalid.'] };
    if (data.version > exports.LIBRARY_PART_VERSION) {
        return { ok: false, errors: [`This part was saved by a newer FORGEX 3D (format version ${data.version}).`] };
    }
    const errors = [];
    if (typeof data.name !== 'string' || !data.name.trim())
        errors.push('The part needs a name.');
    const scene = (0, projectFile_1.readScene)(data.scene, 'scene', errors);
    if (scene && scene.rootIds.length !== 1)
        errors.push('A part holds exactly one root object.');
    if (errors.length || !scene)
        return { ok: false, errors };
    const thumbnail = typeof data.thumbnail === 'string' && data.thumbnail.startsWith('data:image/') && data.thumbnail.length <= MAX_THUMBNAIL_CHARS ? data.thumbnail : undefined;
    return {
        ok: true,
        part: {
            name: data.name.trim().slice(0, 120),
            description: typeof data.description === 'string' ? data.description.slice(0, 500) : '',
            createdAt: typeof data.createdAt === 'string' ? data.createdAt.slice(0, 40) : '',
            scene,
            ...(thumbnail ? { thumbnail } : {}),
        },
    };
}
/** A listing entry for a part read from `file`. */
function libraryEntry(file, part) {
    return {
        file,
        name: part.name,
        description: part.description,
        createdAt: part.createdAt,
        objectCount: Object.keys(part.scene.objects).length,
        ...(part.thumbnail ? { thumbnail: part.thumbnail } : {}),
    };
}
/** Copies a part's objects with fresh ids, root first, ready to add to a scene. */
function instantiateLibraryPart(part, createId) {
    return (0, scene_1.cloneSubtree)(part.scene, part.scene.rootIds[0], createId);
}
/** A safe file name for a part: "Sport wheel" becomes "Sport wheel.forgexpart". */
function libraryFileName(name) {
    const base = name
        .normalize('NFKD')
        .replace(/[^\w\s.-]/g, '')
        .replace(/\s+/g, ' ')
        .replace(/^[\s.]+|[\s.]+$/g, '')
        .slice(0, 60);
    const reserved = /^(con|prn|aux|nul|com\d|lpt\d)$/i.test(base);
    return `${base && !reserved ? base : 'Part'}.${exports.LIBRARY_EXTENSION}`;
}
/** True for a plain part file name (no folders), as the library accepts. */
function isLibraryFileName(file) {
    return /^[\w\s.-]{1,80}$/.test(file) && file.toLowerCase().endsWith(`.${exports.LIBRARY_EXTENSION}`) && !file.startsWith('.');
}
/** Finds a part in a listing by file name or by name (case-insensitive). */
function findLibraryEntry(entries, ref) {
    const key = ref.trim().toLowerCase();
    return (entries.find((entry) => entry.file.toLowerCase() === key) ??
        entries.find((entry) => entry.name.toLowerCase() === key) ??
        entries.find((entry) => entry.file.toLowerCase() === `${key}.${exports.LIBRARY_EXTENSION}`));
}
