import { readScene, serializeScene } from '../project/projectFile';
import { cloneSubtree, collectSubtree } from '../scene/scene';
import type { Scene, SceneObject } from '../scene/types';
import { APP_NAME, APP_VERSION } from '../version';

/**
 * My Parts: a shared library of reusable objects (a wheel, a door, a whole car) kept in
 * one folder outside any project, so every project, and an AI assistant working through
 * the MCP server, can drop them in. One part per `.forgexpart` file.
 */

export const LIBRARY_PART_FORMAT = 'forgex-part';
export const LIBRARY_PART_VERSION = 1;
export const LIBRARY_EXTENSION = 'forgexpart';
/** The folder inside the FORGEX projects folder (Documents\FORGEX 3D\Library on Windows). */
export const LIBRARY_FOLDER_NAME = 'Library';
const MAX_THUMBNAIL_CHARS = 600_000;
export const MAX_LIBRARY_PART_BYTES = 64 * 1024 * 1024;

export interface LibraryPart {
  readonly name: string;
  readonly description: string;
  /** ISO date and time it was saved. */
  readonly createdAt: string;
  /** The part as a small scene: one root object (with any children). */
  readonly scene: Scene;
  /** A small JPEG picture of the part, as a data URL. */
  readonly thumbnail?: string;
}

/** One file in the library folder, as listed. */
export interface LibraryEntry {
  /** File name inside the library folder, such as "Sport wheel.forgexpart". */
  readonly file: string;
  readonly name: string;
  readonly description: string;
  readonly createdAt: string;
  readonly objectCount: number;
  readonly thumbnail?: string;
}

export class LibraryError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'LibraryError';
  }
}

/**
 * Takes an object and its children out of a scene as a library part. The part is moved
 * so it stands at the origin on the ground plane (its height is kept).
 */
export function libraryPartFromScene(
  scene: Scene,
  id: string,
  options: { name?: string; description?: string; thumbnail?: string; now?: Date } = {},
): LibraryPart {
  const subtree = collectSubtree(scene, id);
  const root = subtree[0];
  const objects: Record<string, SceneObject> = {};
  for (const object of subtree) objects[object.id] = object;
  const [, y] = root.transform.position;
  // A part always arrives unlocked, at its own place in the hierarchy.
  const { locked: _locked, ...unlocked } = root;
  void _locked;
  objects[root.id] = { ...unlocked, parentId: null, transform: { ...root.transform, position: [0, y, 0] } } as SceneObject;
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

export function serializeLibraryPart(part: LibraryPart): string {
  const file = {
    format: LIBRARY_PART_FORMAT,
    version: LIBRARY_PART_VERSION,
    generator: `${APP_NAME} ${APP_VERSION}`,
    name: part.name,
    description: part.description,
    createdAt: part.createdAt,
    scene: serializeScene(part.scene),
    ...(part.thumbnail ? { thumbnail: part.thumbnail } : {}),
  };
  return `${JSON.stringify(file, null, 1)}\n`;
}

export type LibraryParseResult = { ok: true; part: LibraryPart } | { ok: false; errors: string[] };

/** Reads a .forgexpart file. Never throws. */
export function parseLibraryPart(text: string): LibraryParseResult {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch (error) {
    return { ok: false, errors: [`The file is not valid JSON: ${(error as Error).message}`] };
  }
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return { ok: false, errors: ['This is not a FORGEX part file.'] };
  const data = raw as Record<string, unknown>;
  if (data.format !== LIBRARY_PART_FORMAT) return { ok: false, errors: ['This is not a FORGEX part file.'] };
  if (!Number.isInteger(data.version) || (data.version as number) < 1) return { ok: false, errors: ['The part format version is missing or invalid.'] };
  if ((data.version as number) > LIBRARY_PART_VERSION) {
    return { ok: false, errors: [`This part was saved by a newer FORGEX 3D (format version ${data.version as number}).`] };
  }
  const errors: string[] = [];
  if (typeof data.name !== 'string' || !data.name.trim()) errors.push('The part needs a name.');
  const scene = readScene(data.scene, 'scene', errors);
  if (scene && scene.rootIds.length !== 1) errors.push('A part holds exactly one root object.');
  if (errors.length || !scene) return { ok: false, errors };
  const thumbnail = typeof data.thumbnail === 'string' && data.thumbnail.startsWith('data:image/') && data.thumbnail.length <= MAX_THUMBNAIL_CHARS ? data.thumbnail : undefined;
  return {
    ok: true,
    part: {
      name: (data.name as string).trim().slice(0, 120),
      description: typeof data.description === 'string' ? data.description.slice(0, 500) : '',
      createdAt: typeof data.createdAt === 'string' ? data.createdAt.slice(0, 40) : '',
      scene,
      ...(thumbnail ? { thumbnail } : {}),
    },
  };
}

/** A listing entry for a part read from `file`. */
export function libraryEntry(file: string, part: LibraryPart): LibraryEntry {
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
export function instantiateLibraryPart(part: LibraryPart, createId: () => string): SceneObject[] {
  return cloneSubtree(part.scene, part.scene.rootIds[0], createId);
}

/** A safe file name for a part: "Sport wheel" becomes "Sport wheel.forgexpart". */
export function libraryFileName(name: string): string {
  const base = name
    .normalize('NFKD')
    .replace(/[^\w\s.-]/g, '')
    .replace(/\s+/g, ' ')
    .replace(/^[\s.]+|[\s.]+$/g, '')
    .slice(0, 60);
  const reserved = /^(con|prn|aux|nul|com\d|lpt\d)$/i.test(base);
  return `${base && !reserved ? base : 'Part'}.${LIBRARY_EXTENSION}`;
}

/** True for a plain part file name (no folders), as the library accepts. */
export function isLibraryFileName(file: string): boolean {
  return /^[\w\s.-]{1,80}$/.test(file) && file.toLowerCase().endsWith(`.${LIBRARY_EXTENSION}`) && !file.startsWith('.');
}

/** Finds a part in a listing by file name or by name (case-insensitive). */
export function findLibraryEntry(entries: readonly LibraryEntry[], ref: string): LibraryEntry | undefined {
  const key = ref.trim().toLowerCase();
  return (
    entries.find((entry) => entry.file.toLowerCase() === key) ??
    entries.find((entry) => entry.name.toLowerCase() === key) ??
    entries.find((entry) => entry.file.toLowerCase() === `${key}.${LIBRARY_EXTENSION}`)
  );
}

/**
 * Where parts are read and written: a folder on disk (the desktop app and the MCP
 * server), or browser storage (the browser preview).
 */
export interface LibraryStore {
  /** Where the library lives, for messages: a folder path or "browser storage". */
  location(): string;
  list(): Promise<LibraryEntry[]>;
  read(file: string): Promise<LibraryPart>;
  /** Writes a part and returns the file name used. Refuses to replace a file unless `overwrite` is true. */
  write(part: LibraryPart, overwrite: boolean): Promise<string>;
  remove(file: string): Promise<void>;
}
