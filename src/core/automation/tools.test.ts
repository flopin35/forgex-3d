import { describe, expect, it } from 'vitest';
import { EditorStore } from '../editor/editorStore';
import { createEmptyDocument } from '../project/defaultDocument';
import { parseProject, serializeProject } from '../project/projectFile';
import { isConstructionMesh, type MeshObject } from '../scene/types';
import { runTool, TOOL_SPECS } from './tools';
import { ToolError, type ToolContext, type ToolHost } from './toolTypes';
import { MemoryStorage, StorageLibrary } from '../library/memoryLibrary';

function context(): ToolContext {
  const store = new EditorStore(createEmptyDocument());
  const host: ToolHost = {
    status: () => ({ mode: 'file', detail: 'Test host.' }),
    newProject: async () => 'new',
    openProject: async () => 'open',
    saveProject: async () => 'saved',
    library: new StorageLibrary(new MemoryStorage(), 'test library'),
  };
  return { store, host };
}

/** Pulls the JSON block that follows a tool's summary line. */
function details(text: string): any {
  const start = text.indexOf('\n');
  return JSON.parse(text.slice(start + 1));
}

async function expectToolError(promise: Promise<unknown>, fragment: string): Promise<void> {
  try {
    await promise;
  } catch (error) {
    expect(error).toBeInstanceOf(ToolError);
    expect((error as Error).message).toContain(fragment);
    return;
  }
  throw new Error(`Expected a ToolError containing "${fragment}"`);
}

const CUBE_VERTICES = [
  [-0.5, -0.5, -0.5], [0.5, -0.5, -0.5], [0.5, -0.5, 0.5], [-0.5, -0.5, 0.5],
  [-0.5, 0.5, -0.5], [0.5, 0.5, -0.5], [0.5, 0.5, 0.5], [-0.5, 0.5, 0.5],
];
const CUBE_EDGES = [[0, 1], [1, 2], [2, 3], [3, 0], [4, 5], [5, 6], [6, 7], [7, 4], [0, 4], [1, 5], [2, 6], [3, 7]];

describe('automation tools', () => {
  it('publishes valid, uniquely named tool specs', () => {
    const names = TOOL_SPECS.map((t) => t.name);
    expect(new Set(names).size).toBe(names.length);
    for (const spec of TOOL_SPECS) {
      expect(spec.name).toMatch(/^[a-z_]{1,64}$/);
      expect(spec.description.length).toBeGreaterThan(20);
      expect((spec.inputSchema as { type: string }).type).toBe('object');
    }
  });

  it('runs the Cube Test through the tools: build, edit, undo, save, reopen', async () => {
    const ctx = context();
    const built = await runTool('create_point_mesh', { name: 'Crate', vertices: CUBE_VERTICES, edges: CUBE_EDGES, position: [0, 0.5, 0] }, ctx);
    const info = details(built.text);
    expect(info.vertexIds).toHaveLength(8);
    expect(info.geometry.faces).toBe(6);
    expect(info.geometry.closed).toBe(true);
    expect(info.geometry.problems).toEqual([]);

    await runTool('edit_point_mesh', { object: 'Crate', move_vertices: [{ vertex: 'v7', offset: [0.25, 0.25, 0] }] }, ctx);
    const moved = ctx.store.getState().scene.objects[info.id] as MeshObject;
    expect(isConstructionMesh(moved) && moved.source.graph.vertices.v7.position).toEqual([0.75, 0.75, 0.5]);

    const undo = await runTool('undo', {}, ctx);
    expect(undo.text).toContain('edit points of Crate');
    const restored = ctx.store.getState().scene.objects[info.id] as MeshObject;
    expect(isConstructionMesh(restored) && restored.source.graph.vertices.v7.position).toEqual([0.5, 0.5, 0.5]);

    const reopened = parseProject(serializeProject(ctx.store.toDocument()));
    expect(reopened.ok).toBe(true);
  });

  it('builds a flat floor from explicit faces and fixes their winding', async () => {
    const ctx = context();
    const out = await runTool(
      'create_point_mesh',
      { name: 'Floor', vertices: [[0, 0, 0], [1, 0, 0], [1, 0, 1], [0, 0, 1]], faces: [[0, 1, 2, 3]] },
      ctx,
    );
    const info = details(out.text);
    expect(info.geometry.faces).toBe(1);
    expect(info.geometry.edges).toBe(4);
    const floor = ctx.store.getState().scene.objects[info.id] as MeshObject;
    if (!isConstructionMesh(floor)) throw new Error('not point-built');
    // Faces up (+Y): the loop is counter-clockwise seen from above.
    expect(floor.source.graph.faces.f1.vertexIds).toEqual(['v1', 'v4', 'v3', 'v2']);
  });

  it('rejects bent faces unless allowed, with a hint', async () => {
    const ctx = context();
    const bent = { name: 'Bent', vertices: [[0, 0, 0], [1, 0, 0], [1, 0.4, 1], [0, 0, 1]], faces: [[0, 1, 2, 3]] };
    await expectToolError(runTool('create_point_mesh', bent, ctx), 'allow_non_planar');
    const ok = await runTool('create_point_mesh', { ...bent, allow_non_planar: true }, ctx);
    expect(details(ok.text).geometry.problems.join(' ')).toContain('no longer flat');
  });

  it('extends a mesh with new vertices referenced by index', async () => {
    const ctx = context();
    await runTool('create_point_mesh', { name: 'Base', vertices: [[0, 0, 0], [1, 0, 0], [1, 0, 1], [0, 0, 1]], edges: [[0, 1], [1, 2], [2, 3], [3, 0]] }, ctx);
    const out = await runTool(
      'edit_point_mesh',
      { object: 'Base', add_vertices: [[0.5, 1, 0.5]], add_faces: [['v1', 'v2', 0], ['v2', 'v3', 0], ['v3', 'v4', 0], ['v4', 'v1', 0]] },
      ctx,
    );
    const info = details(out.text);
    expect(info.addedVertexIds).toEqual(['v5']);
    expect(info.geometry.faces).toBe(5);
    expect(info.geometry.problems).toEqual([]);
  });

  it('adds parts, transforms, groups and lists them', async () => {
    const ctx = context();
    await runTool('add_part', { part: 'cube', name: 'Body', scale: [2, 0.5, 3], color: '#e0565b' }, ctx);
    await runTool('add_part', { part: 'cylinder', name: 'Wheel', position: [1, 0.3, 1], rotation: [0, 0, 90] }, ctx);
    await runTool('duplicate_object', { object: 'Wheel', offset: [-2, 0, 0] }, ctx);
    await runTool('group_objects', { objects: ['Body', 'Wheel', 'Wheel 2'], name: 'Kart' }, ctx);
    await runTool('set_transform', { object: 'Kart', position: [5, 0, 0] }, ctx);

    const listed = details((await runTool('list_objects', {}, ctx)).text);
    expect(listed).toHaveLength(1);
    expect(listed[0].name).toBe('Kart');
    expect(listed[0].children.map((c: { name: string }) => c.name)).toEqual(['Body', 'Wheel', 'Wheel 2']);
    expect(listed[0].children[0].color).toBe('#e0565b');

    const wheel = details((await runTool('get_object', { object: 'Wheel 2' }, ctx)).text);
    expect(wheel.worldPosition[0]).toBeCloseTo(4);
    expect(ctx.store.getState().history.past.length).toBe(5);
  });

  it('reports clear errors for unknown objects, ambiguous names and bad arguments', async () => {
    const ctx = context();
    await expectToolError(runTool('set_color', { object: 'Ghost', color: '#ffffff' }, ctx), 'No object is called');
    await runTool('add_part', { part: 'sphere' }, ctx);
    await expectToolError(runTool('set_color', { object: 'Sphere', color: 'blue' }, ctx), 'hex colour');
    await expectToolError(runTool('set_transform', { object: 'Sphere', position: [0, 1] }, ctx), '[x, y, z]');
    await expectToolError(runTool('edit_point_mesh', { object: 'Sphere' }, ctx), 'not point-built');
    await expectToolError(runTool('add_part', { part: 'teapot' }, ctx), 'part must be one of');
    await expectToolError(runTool('capture_viewport', {}, ctx), 'need the FORGEX 3D app');
    await expectToolError(runTool('no_such_tool', {}, ctx), 'Unknown tool');
  });

  it('deletes with undo and keeps the reopened file valid', async () => {
    const ctx = context();
    await runTool('add_part', { part: 'plane', name: 'Ground', scale: [10, 1, 10] }, ctx);
    await runTool('delete_object', { object: 'Ground' }, ctx);
    expect(ctx.store.getState().scene.rootIds).toHaveLength(0);
    await runTool('undo', {}, ctx);
    expect(ctx.store.getState().scene.rootIds).toHaveLength(1);
    const status = await runTool('get_status', {}, ctx);
    expect(status.text).toContain('1 object');
  });
});

describe('blueprint tools', () => {
  it('draws a mirrored sword blade outline and extrudes it into one closed solid', async () => {
    const ctx = context();
    const out = await runTool(
      'create_blueprint',
      {
        name: 'Sword',
        points: [[0, 1.2], [0.06, 1.05], [0.06, 0.2], [0.25, 0.15], [0.25, 0.1], [0, 0.1]],
        closed: false,
        shape: { mode: 'extrude', depth: 0.04, mirror: true },
      },
      ctx,
    );
    const info = details(out.text);
    expect(info.filledAreas).toBe(1);
    expect(info.geometry.closed).toBe(true);
    expect(info.geometry.problems).toEqual([]);
  });

  it('revolves a profile, then edits it and converts it to points', async () => {
    const ctx = context();
    await runTool('create_blueprint', { name: 'Vase', points: [[0, 0], [0.3, 0], [0.4, 0.5], [0.2, 1]], closed: false, shape: { mode: 'revolve', segments: 24 } }, ctx);
    const edited = details((await runTool('edit_blueprint', { object: 'Vase', add_points: [[0, 1]], add_lines: [['p4', 0]] }, ctx)).text);
    expect(edited.addedPointIds).toEqual(['p5']);
    expect(edited.geometry.closed).toBe(true);
    const listed = details((await runTool('list_objects', {}, ctx)).text);
    expect(listed[0].type).toBe('blueprint');
    await runTool('convert_to_points', { object: 'Vase' }, ctx);
    expect(details((await runTool('list_objects', {}, ctx)).text)[0].type).toBe('point-built');
    await runTool('undo', {}, ctx);
    expect(details((await runTool('list_objects', {}, ctx)).text)[0].type).toBe('blueprint');
  });

  it('saves blueprints in the file and reads version 1 files', async () => {
    const ctx = context();
    await runTool('create_blueprint', { name: 'Sign', plane: 'side', points: [[0, 0], [1, 0], [1, 0.5], [0, 0.5]], shape: { mode: 'flat' } }, ctx);
    const text = serializeProject(ctx.store.toDocument());
    const reopened = parseProject(text);
    if (!reopened.ok) throw new Error(reopened.errors.join('\n'));
    expect(reopened.document).toEqual(ctx.store.toDocument());

    const v1 = JSON.parse(serializeProject(createEmptyDocument()));
    v1.version = 1;
    const old = parseProject(JSON.stringify(v1));
    expect(old.ok).toBe(true);
    if (old.ok) expect(old.migratedFrom).toBe(1);
  });
});

describe('car modelling tools', () => {
  it('lofts a car body from side, top and front outlines and edits one view', async () => {
    const ctx = context();
    const out = await runTool(
      'create_body',
      {
        name: 'Coupe',
        side: [[-2.2, 0.3], [-2.1, 0.6], [-0.6, 0.85], [0.4, 1.25], [1.6, 1.0], [2.2, 0.8], [2.2, 0.3]],
        top: [[0, -2.2], [0.8, -2.0], [0.95, 0], [0.85, 2.0], [0, 2.2]],
        front: [[0, 0], [0.95, 0], [1, 0.4], [0.6, 1], [0, 1]],
        body: { stations: 32, section_points: 24 },
      },
      ctx,
    );
    const info = details(out.text);
    expect(info.closedViews).toEqual({ side: true, top: true, front: true });
    expect(info.geometry.closed).toBe(true);
    expect(info.geometry.faces).toBe(31 * 24 + 2);
    const listed = details((await runTool('list_objects', {}, ctx)).text);
    expect(listed[0].type).toBe('body');
    await expectToolError(runTool('edit_blueprint', { object: 'Coupe', add_points: [[0, 0]] }, ctx), 'view');
    const edited = details((await runTool('edit_blueprint', { object: 'Coupe', view: 'side', move_points: [{ point: 'p4', offset: [0, 0.1] }], sharp_points: ['p1'] }, ctx)).text);
    expect(edited.geometry.closed).toBe(true);
    const body = details((await runTool('get_object', { object: 'Coupe' }, ctx)).text);
    expect(body.views.side.points[3].y).toBeCloseTo(1.35);
    expect(body.views.side.points[0].smooth).toBeUndefined();
    expect(body.views.side.points[1].smooth).toBe(true);
  });

  it('adds a complete supercar and repaints its body', async () => {
    const ctx = context();
    const out = await runTool('add_template', { template: 'supercar', color: '#c0392b', position: [3, 0, 0] }, ctx);
    const tree = details(out.text);
    expect(tree[0].name).toBe('Supercar');
    expect(tree[0].position).toEqual([3, 0, 0]);
    const body = tree[0].children.find((c: { name: string }) => c.name === 'Body');
    expect(body.color).toBe('#c0392b');
    expect(tree[0].children.find((c: { name: string }) => c.name === 'Wheels').children).toHaveLength(4);
    await runTool('undo', {}, ctx);
    expect(ctx.store.getState().scene.rootIds).toHaveLength(0);
  });

  it('smooths a cube with subdivision and mirrors it, as one undo step', async () => {
    const ctx = context();
    await runTool('add_part', { part: 'cube', name: 'Block' }, ctx);
    const out = details((await runTool('set_modifiers', { object: 'Block', subdivide: 2, smooth_shading: true }, ctx)).text);
    expect(out.modifiers).toEqual({ mirror: 'none', subdivide: 2 });
    expect(out.smoothShading).toBe(true);
    expect(out.geometry.faces).toBe(96);
    expect(out.geometry.closed).toBe(true);
    await runTool('undo', {}, ctx);
    const block = details((await runTool('get_object', { object: 'Block', include_geometry: false }, ctx)).text);
    expect(block.modifiers).toBeUndefined();
    expect(block.smoothShading).toBeUndefined();
  });

  it('draws curved blueprints and wheels revolved around the horizontal axis', async () => {
    const ctx = context();
    const out = details(
      (await runTool('create_blueprint', {
        name: 'Tyre',
        points: [[-0.1, 0.25], [0.1, 0.25], [0.1, 0.35], [-0.1, 0.35]],
        smooth: [2, 3],
        shape: { mode: 'revolve', axis: 'horizontal', segments: 24, curve_steps: 4 },
      }, ctx)).text,
    );
    expect(out.shape.axis).toBe('horizontal');
    expect(out.geometry.closed).toBe(true);
    const tyre = details((await runTool('get_object', { object: 'Tyre' }, ctx)).text);
    expect(tyre.points.filter((p: { smooth?: boolean }) => p.smooth)).toHaveLength(2);
  });

  it('locks objects against edits and unlocks them again', async () => {
    const ctx = context();
    await runTool('add_part', { part: 'cube', name: 'Crate' }, ctx);
    await runTool('set_lock', { object: 'Crate', locked: true }, ctx);
    await expectToolError(runTool('set_transform', { object: 'Crate', position: [1, 0, 0] }, ctx), 'locked');
    await expectToolError(runTool('delete_object', { object: 'Crate' }, ctx), 'locked');
    expect(details((await runTool('get_object', { object: 'Crate', include_geometry: false }, ctx)).text).locked).toBe(true);
    await runTool('set_lock', { object: 'Crate', locked: false }, ctx);
    await runTool('set_transform', { object: 'Crate', position: [1, 0, 0] }, ctx);
    await runTool('undo', { steps: 2 }, ctx);
    expect(Object.values(ctx.store.getState().scene.objects)[0].locked).toBe(true);
  });

  it('saves and restores snapshots, and undo returns to the scene before', async () => {
    const ctx = context();
    await runTool('add_part', { part: 'cube', name: 'Crate' }, ctx);
    const saved = await runTool('save_snapshot', { name: 'One crate' }, ctx);
    expect(saved.text).toContain('One crate');
    await runTool('add_part', { part: 'sphere', name: 'Ball' }, ctx);
    expect(Object.keys(ctx.store.getState().scene.objects)).toHaveLength(2);
    await runTool('restore_snapshot', { snapshot: 'one crate' }, ctx);
    expect(Object.values(ctx.store.getState().scene.objects).map((o) => o.name)).toEqual(['Crate']);
    await runTool('undo', {}, ctx);
    expect(Object.keys(ctx.store.getState().scene.objects)).toHaveLength(2);
    expect(details((await runTool('list_snapshots', {}, ctx)).text)).toHaveLength(1);
    await expectToolError(runTool('restore_snapshot', { snapshot: 'nope' }, ctx), 'list_snapshots');
  });

  it('shares parts between projects through My Parts', async () => {
    const ctx = context();
    await runTool('add_template', { template: 'supercar' }, ctx);
    const car = Object.values(ctx.store.getState().scene.objects).find((o) => o.parentId === null)!;
    await runTool('save_to_library', { object: car.id, name: 'Coupe', description: 'Two doors' }, ctx);
    await expectToolError(runTool('save_to_library', { object: car.id, name: 'Coupe' }, ctx), 'already has');
    const listed = details((await runTool('list_library', {}, ctx)).text);
    expect(listed[0]).toMatchObject({ name: 'Coupe', file: 'Coupe.forgexpart' });

    // A second project on the same library.
    const other: ToolContext = { store: new EditorStore(createEmptyDocument()), host: ctx.host };
    await runTool('add_part', { part: 'cube', name: 'Garage' }, other);
    const added = details((await runTool('add_from_library', { part: 'coupe' }, other)).text);
    expect(added.name).toBe('Coupe');
    expect(added.position[0]).toBeGreaterThan(1);
    expect(Object.keys(other.store.getState().scene.objects).length).toBe(Object.keys(ctx.store.getState().scene.objects).length + 1);
    await expectToolError(runTool('add_from_library', { part: 'tractor' }, other), 'list_library');
  });
});
