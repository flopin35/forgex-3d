import { describe, expect, it } from 'vitest';
import { CompositeCommand } from '../commands/command';
import {
  AddObjectsCommand,
  DeleteObjectCommand,
  MoveObjectCommand,
  RenameObjectCommand,
  SetColorCommand,
  SetTransformCommand,
  SetVisibilityCommand,
} from '../commands/sceneCommands';
import { CommandHistory } from '../history/history';
import { decomposeMatrix } from '../math/transform';
import { createPartObject } from '../scene/parts';
import { cloneSubtree, flattenTree, planDrop, uniqueName, worldMatrix } from '../scene/scene';
import type { Scene } from '../scene/types';
import { EditorStore } from './editorStore';

function emptyStore(): EditorStore {
  const scene: Scene = { objects: {}, rootIds: [] };
  return new EditorStore({ scene, settings: { gridSize: 1, snapEnabled: true, rotationSnapDegrees: 15 }, camera: null });
}

function add(store: EditorStore, part: Parameters<typeof createPartObject>[0], name?: string, x = 0) {
  const object = createPartObject(part, { name, groundPosition: [x, 0] });
  expect(store.execute(new AddObjectsCommand([object]))).toBe(true);
  return object;
}

describe('editor store', () => {
  it('starts with a point-built cube and no unsaved changes', () => {
    const store = new EditorStore();
    const state = store.getState();
    expect(state.scene.rootIds).toHaveLength(1);
    expect(state.dirty).toBe(false);
    expect(state.history.canUndo).toBe(false);
  });

  it('creates, selects, transforms and deletes objects with full undo and redo', () => {
    const store = emptyStore();
    const cube = add(store, 'cube');
    expect(store.getState().selectedId).toBe(cube.id);

    const before = cube.transform;
    const after = { ...before, position: [2, 0.5, -1] as [number, number, number] };
    store.execute(new SetTransformCommand(cube.id, before, after, 'Move'));
    store.execute(new SetTransformCommand(cube.id, after, { ...after, rotation: [0, 90, 0] }, 'Rotate'));
    store.execute(new SetTransformCommand(cube.id, { ...after, rotation: [0, 90, 0] }, { ...after, rotation: [0, 90, 0], scale: [2, 2, 2] }, 'Scale'));
    expect(store.getState().scene.objects[cube.id].transform.scale).toEqual([2, 2, 2]);

    store.execute(new DeleteObjectCommand(cube.id, cube.name));
    expect(store.getState().scene.objects[cube.id]).toBeUndefined();
    expect(store.getState().selectedId).toBeNull();

    store.undo();
    expect(store.getState().scene.objects[cube.id].transform.scale).toEqual([2, 2, 2]);
    expect(store.getState().selectedId).toBe(cube.id);
    store.undo();
    store.undo();
    store.undo();
    expect(store.getState().scene.objects[cube.id].transform).toEqual(before);
    store.undo();
    expect(store.getState().scene.rootIds).toHaveLength(0);
    expect(store.getState().dirty).toBe(false);

    for (let i = 0; i < 5; i++) store.redo();
    expect(store.getState().scene.objects[cube.id]).toBeUndefined();
    expect(store.getState().history.canRedo).toBe(false);
  });

  it('clears redo after a new command', () => {
    const store = emptyStore();
    add(store, 'cube');
    store.undo();
    expect(store.getState().history.canRedo).toBe(true);
    add(store, 'sphere');
    expect(store.getState().history.canRedo).toBe(false);
  });

  it('tracks unsaved changes against the saved revision', () => {
    const store = emptyStore();
    const cube = add(store, 'cube');
    const settings = store.getState().settings;
    store.markSaved('Test', 'C:\\Test.forgex', store.revision, settings);
    expect(store.getState().dirty).toBe(false);
    store.execute(new RenameObjectCommand(cube.id, cube.name, 'Body'));
    expect(store.getState().dirty).toBe(true);
    store.undo();
    expect(store.getState().dirty).toBe(false);
    store.updateSettings({ gridSize: 0.5 });
    expect(store.getState().dirty).toBe(true);
  });

  it('keeps edits made during a save marked as unsaved', () => {
    const store = emptyStore();
    const cube = add(store, 'cube');
    const revisionAtSave = store.revision;
    const settings = store.getState().settings;
    store.execute(new RenameObjectCommand(cube.id, cube.name, 'Edited mid-save'));
    store.markSaved('Test', null, revisionAtSave, settings);
    expect(store.getState().dirty).toBe(true);
  });

  it('logs a failed command without changing history', () => {
    const store = emptyStore();
    expect(store.execute(new RenameObjectCommand('missing', 'a', 'b'))).toBe(false);
    expect(store.getState().history.canUndo).toBe(false);
    expect(store.getState().messages.at(-1)?.level).toBe('error');
  });

  it('only enters points mode for point-built objects', () => {
    const store = emptyStore();
    add(store, 'sphere');
    expect(store.setEditMode('points')).toBe(false);
    add(store, 'cube');
    expect(store.setEditMode('points')).toBe(true);
    store.selectVertex('v3');
    expect(store.getState().selectedVertexId).toBe('v3');
    store.select(null);
    expect(store.getState().editMode).toBe('object');
  });

  it('toggles visibility and colour with undo', () => {
    const store = emptyStore();
    const cube = add(store, 'cube');
    store.execute(new SetVisibilityCommand(cube.id, false, cube.name));
    store.execute(new SetColorCommand(cube.id, '#3d9fe8', '#ff0000'));
    const object = store.getState().scene.objects[cube.id];
    expect(object.visible).toBe(false);
    expect(object.kind === 'mesh' && object.material.color).toBe('#ff0000');
    store.undo();
    store.undo();
    expect(store.getState().scene.objects[cube.id].visible).toBe(true);
  });
});

describe('hierarchy', () => {
  it('re-parents an object while keeping its world position', () => {
    const store = emptyStore();
    const group = createPartObject('group', { groundPosition: [3, 0] });
    store.execute(new AddObjectsCommand([group]));
    store.execute(
      new SetTransformCommand(group.id, group.transform, { position: [3, 1, 0], rotation: [0, 90, 0], scale: [2, 2, 2] }),
    );
    const cube = add(store, 'cube', 'Wheel', 1);
    const worldBefore = worldMatrix(store.getState().scene, cube.id);

    const drop = planDrop(store.getState().scene, cube.id, group.id, 'inside')!;
    store.execute(new MoveObjectCommand(cube.id, drop.parentId, drop.index));
    const scene = store.getState().scene;
    expect(scene.objects[cube.id].parentId).toBe(group.id);
    expect(scene.objects[group.id].childIds).toEqual([cube.id]);
    const worldAfter = worldMatrix(scene, cube.id);
    worldAfter.forEach((v, i) => expect(v).toBeCloseTo(worldBefore[i], 5));
    expect(decomposeMatrix(worldAfter).position[0]).toBeCloseTo(1, 5);

    store.undo();
    expect(store.getState().scene.objects[cube.id].parentId).toBeNull();
    expect(store.getState().scene.objects[cube.id].transform).toEqual(cube.transform);
  });

  it('refuses to drop an object inside its own child', () => {
    const store = emptyStore();
    const parent = createPartObject('group');
    store.execute(new AddObjectsCommand([parent]));
    const child = add(store, 'cube');
    store.execute(new MoveObjectCommand(child.id, parent.id, 0));
    expect(planDrop(store.getState().scene, parent.id, child.id, 'inside')).toBeNull();
    expect(store.execute(new MoveObjectCommand(parent.id, child.id, 0))).toBe(false);
  });

  it('reorders siblings and lists the tree in order', () => {
    const store = emptyStore();
    const a = add(store, 'cube', 'A');
    const b = add(store, 'cube', 'B');
    const c = add(store, 'cube', 'C');
    const drop = planDrop(store.getState().scene, c.id, a.id, 'before')!;
    store.execute(new MoveObjectCommand(c.id, drop.parentId, drop.index));
    expect(store.getState().scene.rootIds).toEqual([c.id, a.id, b.id]);
    expect(flattenTree(store.getState().scene).map((r) => r.id)).toEqual([c.id, a.id, b.id]);
  });

  it('deletes a parent with its children and restores both', () => {
    const store = emptyStore();
    const parent = createPartObject('group', { name: 'Car' });
    store.execute(new AddObjectsCommand([parent]));
    const wheel = add(store, 'cylinder', 'Wheel');
    store.execute(new MoveObjectCommand(wheel.id, parent.id, 0));
    store.execute(new DeleteObjectCommand(parent.id, 'Car'));
    expect(Object.keys(store.getState().scene.objects)).toHaveLength(0);
    store.undo();
    expect(store.getState().scene.objects[parent.id].childIds).toEqual([wheel.id]);
    expect(store.getState().scene.objects[wheel.id].parentId).toBe(parent.id);
  });

  it('duplicates a branch with fresh ids and unique names', () => {
    const store = emptyStore();
    const parent = createPartObject('group', { name: 'Car' });
    store.execute(new AddObjectsCommand([parent]));
    const wheel = add(store, 'cylinder', 'Wheel');
    store.execute(new MoveObjectCommand(wheel.id, parent.id, 0));
    let n = 0;
    const copy = cloneSubtree(store.getState().scene, parent.id, () => `copy_${++n}`);
    expect(copy.map((o) => o.id)).toEqual(['copy_1', 'copy_2']);
    expect(copy[1].parentId).toBe('copy_1');
    expect(uniqueName(store.getState().scene, 'Car')).toBe('Car 2');
    store.execute(new CompositeCommand('Duplicate Car', [new AddObjectsCommand([{ ...copy[0], name: 'Car 2' }, ...copy.slice(1)])], 'copy_1'));
    expect(store.getState().scene.rootIds).toHaveLength(2);
    expect(store.getState().selectedId).toBe('copy_1');
  });
});

describe('command history', () => {
  it('trims the oldest entries without confusing the saved state', () => {
    const history = new CommandHistory(2);
    const noop = { label: 'noop', apply: (s: Scene) => s, revert: (s: Scene) => s };
    history.record(noop, null, null);
    history.record(noop, null, null);
    history.record(noop, null, null);
    expect(history.undoEntries).toHaveLength(2);
    history.undo();
    history.undo();
    expect(history.canUndo).toBe(false);
    expect(history.revision).toBe(1);
    expect(history.revision).not.toBe(0);
  });
});
