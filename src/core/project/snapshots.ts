import type { Scene } from '../scene/types';

/**
 * A saved version of the scene, kept inside the project so you can jump back to it
 * later. Restoring one is an ordinary undoable change.
 */
export interface Snapshot {
  readonly id: string;
  readonly name: string;
  /** ISO date and time it was taken. */
  readonly createdAt: string;
  readonly scene: Scene;
}

/** Older snapshots drop off once a project holds this many. */
export const MAX_SNAPSHOTS = 40;

export function createSnapshot(scene: Scene, name: string, id: string, now: Date = new Date()): Snapshot {
  const trimmed = name.trim().slice(0, 120);
  return { id, name: trimmed || `Snapshot ${now.toLocaleString()}`, createdAt: now.toISOString(), scene };
}

/** Adds a snapshot at the end (newest last), dropping the oldest beyond the limit. */
export function addSnapshot(list: readonly Snapshot[], snapshot: Snapshot): Snapshot[] {
  return [...list, snapshot].slice(-MAX_SNAPSHOTS);
}

export function renameSnapshot(list: readonly Snapshot[], id: string, name: string): Snapshot[] {
  const trimmed = name.trim().slice(0, 120);
  if (!trimmed) return [...list];
  return list.map((snapshot) => (snapshot.id === id ? { ...snapshot, name: trimmed } : snapshot));
}

export function removeSnapshot(list: readonly Snapshot[], id: string): Snapshot[] {
  return list.filter((snapshot) => snapshot.id !== id);
}

/** The default name for the next snapshot: "Version 3". */
export function nextSnapshotName(list: readonly Snapshot[]): string {
  const used = new Set(list.map((snapshot) => snapshot.name));
  for (let n = list.length + 1; ; n++) {
    const name = `Version ${n}`;
    if (!used.has(name)) return name;
  }
}
