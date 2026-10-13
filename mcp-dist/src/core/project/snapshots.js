"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.MAX_SNAPSHOTS = void 0;
exports.createSnapshot = createSnapshot;
exports.addSnapshot = addSnapshot;
exports.renameSnapshot = renameSnapshot;
exports.removeSnapshot = removeSnapshot;
exports.nextSnapshotName = nextSnapshotName;
/** Older snapshots drop off once a project holds this many. */
exports.MAX_SNAPSHOTS = 40;
function createSnapshot(scene, name, id, now = new Date()) {
    const trimmed = name.trim().slice(0, 120);
    return { id, name: trimmed || `Snapshot ${now.toLocaleString()}`, createdAt: now.toISOString(), scene };
}
/** Adds a snapshot at the end (newest last), dropping the oldest beyond the limit. */
function addSnapshot(list, snapshot) {
    return [...list, snapshot].slice(-exports.MAX_SNAPSHOTS);
}
function renameSnapshot(list, id, name) {
    const trimmed = name.trim().slice(0, 120);
    if (!trimmed)
        return [...list];
    return list.map((snapshot) => (snapshot.id === id ? { ...snapshot, name: trimmed } : snapshot));
}
function removeSnapshot(list, id) {
    return list.filter((snapshot) => snapshot.id !== id);
}
/** The default name for the next snapshot: "Version 3". */
function nextSnapshotName(list) {
    const used = new Set(list.map((snapshot) => snapshot.name));
    for (let n = list.length + 1;; n++) {
        const name = `Version ${n}`;
        if (!used.has(name))
            return name;
    }
}
