import {
  cleanTransform,
  composeMatrix,
  decomposeMatrix,
  identityMatrix,
  invertAffine,
  multiplyMatrices,
  type Mat4,
  type Transform,
} from '../math/transform';
import type { Scene, SceneObject } from './types';

export class SceneError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SceneError';
  }
}

export function createEmptyScene(): Scene {
  return { objects: {}, rootIds: [] };
}

export function requireObject(scene: Scene, id: string): SceneObject {
  const object = scene.objects[id];
  if (!object) throw new SceneError(`Object ${id} is not in the scene.`);
  return object;
}

export function siblingIds(scene: Scene, parentId: string | null): readonly string[] {
  return parentId === null ? scene.rootIds : requireObject(scene, parentId).childIds;
}

export function indexInParent(scene: Scene, id: string): number {
  return siblingIds(scene, requireObject(scene, id).parentId).indexOf(id);
}

/** True when `ancestorId` is `id` itself or any of its parents. */
export function isSelfOrAncestor(scene: Scene, ancestorId: string, id: string): boolean {
  let current: string | null = id;
  while (current !== null) {
    if (current === ancestorId) return true;
    current = scene.objects[current]?.parentId ?? null;
  }
  return false;
}

/** The object and all its descendants, parents before children. */
export function collectSubtree(scene: Scene, id: string): SceneObject[] {
  const out: SceneObject[] = [];
  const visit = (objectId: string) => {
    const object = requireObject(scene, objectId);
    out.push(object);
    object.childIds.forEach(visit);
  };
  visit(id);
  return out;
}

function withSiblings(scene: Scene, parentId: string | null, ids: readonly string[]): Scene {
  if (parentId === null) return { ...scene, rootIds: ids };
  const parent = requireObject(scene, parentId);
  return { ...scene, objects: { ...scene.objects, [parentId]: { ...parent, childIds: ids } } };
}

function insertAt(list: readonly string[], id: string, index?: number): string[] {
  const next = [...list];
  const at = index === undefined ? next.length : Math.max(0, Math.min(index, next.length));
  next.splice(at, 0, id);
  return next;
}

/**
 * Inserts an object with its descendants. `subtree[0]` is the root; the others keep
 * their own parent links. `index` is the position among the new siblings.
 */
export function insertSubtree(scene: Scene, subtree: readonly SceneObject[], parentId: string | null, index?: number): Scene {
  if (subtree.length === 0) throw new SceneError('Nothing to insert.');
  if (parentId !== null) requireObject(scene, parentId);
  const objects: Record<string, SceneObject> = { ...scene.objects };
  subtree.forEach((object, i) => {
    if (objects[object.id]) throw new SceneError(`Object id ${object.id} is already in use.`);
    objects[object.id] = i === 0 ? { ...object, parentId } : object;
  });
  const next: Scene = { ...scene, objects };
  return withSiblings(next, parentId, insertAt(siblingIds(next, parentId), subtree[0].id, index));
}

export interface RemovedSubtree {
  scene: Scene;
  removed: SceneObject[];
  parentId: string | null;
  index: number;
}

export function removeSubtree(scene: Scene, id: string): RemovedSubtree {
  const root = requireObject(scene, id);
  const removed = collectSubtree(scene, id);
  const objects: Record<string, SceneObject> = { ...scene.objects };
  for (const object of removed) delete objects[object.id];
  const siblings = siblingIds(scene, root.parentId);
  const index = siblings.indexOf(id);
  const next = withSiblings({ ...scene, objects }, root.parentId, siblings.filter((s) => s !== id));
  return { scene: next, removed, parentId: root.parentId, index };
}

export function updateObject(scene: Scene, id: string, update: (object: SceneObject) => SceneObject): Scene {
  const object = requireObject(scene, id);
  const next = update(object);
  if (next === object) return scene;
  return { ...scene, objects: { ...scene.objects, [id]: next } };
}

export function setObjectTransform(scene: Scene, id: string, transform: Transform): Scene {
  return updateObject(scene, id, (object) => ({ ...object, transform }));
}

export function localMatrix(object: SceneObject): Mat4 {
  return composeMatrix(object.transform);
}

export function worldMatrix(scene: Scene, id: string | null): Mat4 {
  let matrix = identityMatrix();
  let current = id;
  while (current !== null) {
    const object = requireObject(scene, current);
    matrix = multiplyMatrices(localMatrix(object), matrix);
    current = object.parentId;
  }
  return matrix;
}

/**
 * Moves an object to a new parent and/or position among its siblings.
 * `index` counts siblings after the object has been taken out of its old place.
 * With `preserveWorld`, the object stays where it is in the world.
 */
export function moveObject(
  scene: Scene,
  id: string,
  parentId: string | null,
  index?: number,
  preserveWorld = true,
): Scene {
  const object = requireObject(scene, id);
  if (parentId !== null && isSelfOrAncestor(scene, id, parentId)) {
    throw new SceneError('An object cannot be placed inside itself or one of its children.');
  }
  let transform = object.transform;
  if (preserveWorld && parentId !== object.parentId) {
    const world = worldMatrix(scene, id);
    const parentInverse = invertAffine(worldMatrix(scene, parentId));
    if (parentInverse) transform = cleanTransform(decomposeMatrix(multiplyMatrices(parentInverse, world)));
  }
  const oldSiblings = siblingIds(scene, object.parentId).filter((s) => s !== id);
  let next = withSiblings(scene, object.parentId, oldSiblings);
  next = { ...next, objects: { ...next.objects, [id]: { ...requireObject(next, id), parentId, transform } } };
  return withSiblings(next, parentId, insertAt(siblingIds(next, parentId), id, index));
}

export type DropPosition = 'before' | 'after' | 'inside';

/** Works out where a hierarchy drag-and-drop lands. Returns null when the drop is not allowed. */
export function planDrop(
  scene: Scene,
  draggedId: string,
  targetId: string | null,
  position: DropPosition,
): { parentId: string | null; index: number } | null {
  if (!scene.objects[draggedId]) return null;
  if (targetId === null) {
    return { parentId: null, index: scene.rootIds.filter((id) => id !== draggedId).length };
  }
  const target = scene.objects[targetId];
  if (!target || isSelfOrAncestor(scene, draggedId, targetId)) return null;
  if (position === 'inside') {
    return { parentId: targetId, index: target.childIds.filter((id) => id !== draggedId).length };
  }
  const siblings = siblingIds(scene, target.parentId).filter((id) => id !== draggedId);
  const targetIndex = siblings.indexOf(targetId);
  return { parentId: target.parentId, index: position === 'before' ? targetIndex : targetIndex + 1 };
}

export interface TreeRow {
  id: string;
  depth: number;
}

/** The hierarchy in display order, skipping the children of collapsed objects. */
export function flattenTree(scene: Scene, collapsed: ReadonlySet<string> = new Set()): TreeRow[] {
  const rows: TreeRow[] = [];
  const visit = (id: string, depth: number) => {
    const object = scene.objects[id];
    if (!object) return;
    rows.push({ id, depth });
    if (!collapsed.has(id)) object.childIds.forEach((child) => visit(child, depth + 1));
  };
  scene.rootIds.forEach((id) => visit(id, 0));
  return rows;
}

/** Returns `base`, or `base 2`, `base 3`... whichever is free. */
export function uniqueName(scene: Scene, base: string): string {
  const taken = new Set(Object.values(scene.objects).map((o) => o.name));
  if (!taken.has(base)) return base;
  for (let n = 2; ; n++) {
    const candidate = `${base} ${n}`;
    if (!taken.has(candidate)) return candidate;
  }
}

/** Deep-copies an object and its descendants with fresh ids. The root keeps its original parent. */
export function cloneSubtree(scene: Scene, id: string, createId: () => string): SceneObject[] {
  const source = collectSubtree(scene, id);
  const idMap = new Map(source.map((o) => [o.id, createId()]));
  return source.map((object) => ({
    ...object,
    id: idMap.get(object.id)!,
    parentId: object.parentId !== null && idMap.has(object.parentId) ? idMap.get(object.parentId)! : object.parentId,
    childIds: object.childIds.map((child) => idMap.get(child)!),
  }));
}
