"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.SceneError = void 0;
exports.createEmptyScene = createEmptyScene;
exports.requireObject = requireObject;
exports.siblingIds = siblingIds;
exports.indexInParent = indexInParent;
exports.isSelfOrAncestor = isSelfOrAncestor;
exports.isLocked = isLocked;
exports.collectSubtree = collectSubtree;
exports.insertSubtree = insertSubtree;
exports.removeSubtree = removeSubtree;
exports.updateObject = updateObject;
exports.setObjectTransform = setObjectTransform;
exports.localMatrix = localMatrix;
exports.worldMatrix = worldMatrix;
exports.moveObject = moveObject;
exports.planDrop = planDrop;
exports.flattenTree = flattenTree;
exports.uniqueName = uniqueName;
exports.cloneSubtree = cloneSubtree;
exports.sceneBounds = sceneBounds;
exports.clearSpotX = clearSpotX;
const transform_1 = require("../math/transform");
const types_1 = require("./types");
class SceneError extends Error {
    constructor(message) {
        super(message);
        this.name = 'SceneError';
    }
}
exports.SceneError = SceneError;
function createEmptyScene() {
    return { objects: {}, rootIds: [] };
}
function requireObject(scene, id) {
    const object = scene.objects[id];
    if (!object)
        throw new SceneError(`Object ${id} is not in the scene.`);
    return object;
}
function siblingIds(scene, parentId) {
    return parentId === null ? scene.rootIds : requireObject(scene, parentId).childIds;
}
function indexInParent(scene, id) {
    return siblingIds(scene, requireObject(scene, id).parentId).indexOf(id);
}
/** True when `ancestorId` is `id` itself or any of its parents. */
function isSelfOrAncestor(scene, ancestorId, id) {
    let current = id;
    while (current !== null) {
        if (current === ancestorId)
            return true;
        current = scene.objects[current]?.parentId ?? null;
    }
    return false;
}
/** True when the object or any of its parents is locked. */
function isLocked(scene, id) {
    let current = id;
    while (current !== null) {
        const object = scene.objects[current];
        if (!object)
            return false;
        if (object.locked)
            return true;
        current = object.parentId;
    }
    return false;
}
/** The object and all its descendants, parents before children. */
function collectSubtree(scene, id) {
    const out = [];
    const visit = (objectId) => {
        const object = requireObject(scene, objectId);
        out.push(object);
        object.childIds.forEach(visit);
    };
    visit(id);
    return out;
}
function withSiblings(scene, parentId, ids) {
    if (parentId === null)
        return { ...scene, rootIds: ids };
    const parent = requireObject(scene, parentId);
    return { ...scene, objects: { ...scene.objects, [parentId]: { ...parent, childIds: ids } } };
}
function insertAt(list, id, index) {
    const next = [...list];
    const at = index === undefined ? next.length : Math.max(0, Math.min(index, next.length));
    next.splice(at, 0, id);
    return next;
}
/**
 * Inserts an object with its descendants. `subtree[0]` is the root; the others keep
 * their own parent links. `index` is the position among the new siblings.
 */
function insertSubtree(scene, subtree, parentId, index) {
    if (subtree.length === 0)
        throw new SceneError('Nothing to insert.');
    if (parentId !== null)
        requireObject(scene, parentId);
    const objects = { ...scene.objects };
    subtree.forEach((object, i) => {
        if (objects[object.id])
            throw new SceneError(`Object id ${object.id} is already in use.`);
        objects[object.id] = i === 0 ? { ...object, parentId } : object;
    });
    const next = { ...scene, objects };
    return withSiblings(next, parentId, insertAt(siblingIds(next, parentId), subtree[0].id, index));
}
function removeSubtree(scene, id) {
    const root = requireObject(scene, id);
    const removed = collectSubtree(scene, id);
    const objects = { ...scene.objects };
    for (const object of removed)
        delete objects[object.id];
    const siblings = siblingIds(scene, root.parentId);
    const index = siblings.indexOf(id);
    const next = withSiblings({ ...scene, objects }, root.parentId, siblings.filter((s) => s !== id));
    return { scene: next, removed, parentId: root.parentId, index };
}
function updateObject(scene, id, update) {
    const object = requireObject(scene, id);
    const next = update(object);
    if (next === object)
        return scene;
    return { ...scene, objects: { ...scene.objects, [id]: next } };
}
function setObjectTransform(scene, id, transform) {
    return updateObject(scene, id, (object) => ({ ...object, transform }));
}
function localMatrix(object) {
    return (0, transform_1.composeMatrix)(object.transform);
}
function worldMatrix(scene, id) {
    let matrix = (0, transform_1.identityMatrix)();
    let current = id;
    while (current !== null) {
        const object = requireObject(scene, current);
        matrix = (0, transform_1.multiplyMatrices)(localMatrix(object), matrix);
        current = object.parentId;
    }
    return matrix;
}
/**
 * Moves an object to a new parent and/or position among its siblings.
 * `index` counts siblings after the object has been taken out of its old place.
 * With `preserveWorld`, the object stays where it is in the world.
 */
function moveObject(scene, id, parentId, index, preserveWorld = true) {
    const object = requireObject(scene, id);
    if (parentId !== null && isSelfOrAncestor(scene, id, parentId)) {
        throw new SceneError('An object cannot be placed inside itself or one of its children.');
    }
    let transform = object.transform;
    if (preserveWorld && parentId !== object.parentId) {
        const world = worldMatrix(scene, id);
        const parentInverse = (0, transform_1.invertAffine)(worldMatrix(scene, parentId));
        if (parentInverse)
            transform = (0, transform_1.cleanTransform)((0, transform_1.decomposeMatrix)((0, transform_1.multiplyMatrices)(parentInverse, world)));
    }
    const oldSiblings = siblingIds(scene, object.parentId).filter((s) => s !== id);
    let next = withSiblings(scene, object.parentId, oldSiblings);
    next = { ...next, objects: { ...next.objects, [id]: { ...requireObject(next, id), parentId, transform } } };
    return withSiblings(next, parentId, insertAt(siblingIds(next, parentId), id, index));
}
/** Works out where a hierarchy drag-and-drop lands. Returns null when the drop is not allowed. */
function planDrop(scene, draggedId, targetId, position) {
    if (!scene.objects[draggedId])
        return null;
    if (targetId === null) {
        return { parentId: null, index: scene.rootIds.filter((id) => id !== draggedId).length };
    }
    const target = scene.objects[targetId];
    if (!target || isSelfOrAncestor(scene, draggedId, targetId))
        return null;
    if (position === 'inside') {
        return { parentId: targetId, index: target.childIds.filter((id) => id !== draggedId).length };
    }
    const siblings = siblingIds(scene, target.parentId).filter((id) => id !== draggedId);
    const targetIndex = siblings.indexOf(targetId);
    return { parentId: target.parentId, index: position === 'before' ? targetIndex : targetIndex + 1 };
}
/** The hierarchy in display order, skipping the children of collapsed objects. */
function flattenTree(scene, collapsed = new Set()) {
    const rows = [];
    const visit = (id, depth) => {
        const object = scene.objects[id];
        if (!object)
            return;
        rows.push({ id, depth });
        if (!collapsed.has(id))
            object.childIds.forEach((child) => visit(child, depth + 1));
    };
    scene.rootIds.forEach((id) => visit(id, 0));
    return rows;
}
/** Returns `base`, or `base 2`, `base 3`... whichever is free. */
function uniqueName(scene, base) {
    const taken = new Set(Object.values(scene.objects).map((o) => o.name));
    if (!taken.has(base))
        return base;
    for (let n = 2;; n++) {
        const candidate = `${base} ${n}`;
        if (!taken.has(candidate))
            return candidate;
    }
}
/** Deep-copies an object and its descendants with fresh ids. The root keeps its original parent. */
function cloneSubtree(scene, id, createId) {
    const source = collectSubtree(scene, id);
    const idMap = new Map(source.map((o) => [o.id, createId()]));
    return source.map((object) => ({
        ...object,
        id: idMap.get(object.id),
        parentId: object.parentId !== null && idMap.has(object.parentId) ? idMap.get(object.parentId) : object.parentId,
        childIds: object.childIds.map((child) => idMap.get(child)),
    }));
}
/**
 * World-space bounding box of everything visible: [min, max], or null for an empty scene.
 * Parametric primitives count as their 1 m box.
 */
function sceneBounds(scene) {
    const min = [Infinity, Infinity, Infinity];
    const max = [-Infinity, -Infinity, -Infinity];
    const add = (matrix, p) => {
        const w = (0, transform_1.transformPoint)(matrix, p);
        for (let i = 0; i < 3; i++) {
            min[i] = Math.min(min[i], w[i]);
            max[i] = Math.max(max[i], w[i]);
        }
    };
    const visit = (id, parent) => {
        const object = scene.objects[id];
        if (!object || !object.visible)
            return;
        const matrix = (0, transform_1.multiplyMatrices)(parent, localMatrix(object));
        if (object.kind === 'mesh') {
            if (object.source.type === 'primitive') {
                for (const x of [-0.5, 0.5])
                    for (const y of [-0.5, 0.5])
                        for (const z of [-0.5, 0.5])
                            add(matrix, [x, y, z]);
            }
            else {
                const graph = (0, types_1.meshGraphOf)(object);
                if (graph)
                    for (const vertex of Object.values(graph.vertices))
                        add(matrix, [vertex.position[0], vertex.position[1], vertex.position[2]]);
            }
        }
        object.childIds.forEach((child) => visit(child, matrix));
    };
    scene.rootIds.forEach((id) => visit(id, (0, transform_1.identityMatrix)()));
    return min[0] <= max[0] ? [min, max] : null;
}
/**
 * An x position for the root of new objects so they stand 1 m clear of everything
 * already in the scene (to the right). The objects are measured where they are now.
 */
function clearSpotX(scene, objects) {
    const bounds = sceneBounds(scene);
    if (!bounds || objects.length === 0)
        return 0;
    const root = objects[0];
    const probe = sceneBounds({ objects: Object.fromEntries(objects.map((o) => [o.id, o])), rootIds: [root.id] });
    // How far the new objects reach left of their root's position.
    const reachLeft = probe ? root.transform.position[0] - probe[0][0] : 0.5;
    return Math.ceil(bounds[1][0] + 1 + reachLeft);
}
