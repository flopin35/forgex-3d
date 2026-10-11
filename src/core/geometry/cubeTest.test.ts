/**
 * The FORGEX Cube Test (blueprint section 6). It passes only when every step works, in order:
 * 1. Create 8 vertices and connect them with 12 edges.
 * 2. Detect the closed loops and generate the 6 faces from them.
 * 3. Move one vertex; the connected faces follow.
 * 4. Undo; the vertex and faces return exactly.
 * 5. Save the construction to a .forgex file.
 * 6. Reopen it with every vertex, edge, face and ID intact.
 */
import { describe, expect, it } from 'vitest';
import { SetGraphCommand } from '../commands/sceneCommands';
import { EditorStore } from '../editor/editorStore';
import { identityTransform } from '../math/transform';
import type { Vec3 } from '../math/vec3';
import { DEFAULT_SETTINGS, parseProject, serializeProject } from '../project/projectFile';
import type { MeshObject, Scene } from '../scene/types';
import { analyzeGraph } from './analysis';
import { addEdge, addVertex, createEmptyGraph, getTopology, moveVertex, type ConstructionGraph } from './constructionGraph';
import { findClosedLoops, fillClosedLoops } from './loops';
import { buildMeshData } from './meshData';

function graphOf(store: EditorStore, id: string): ConstructionGraph {
  const object = store.getState().scene.objects[id] as MeshObject;
  if (object.source.type !== 'construction') throw new Error('not point-built');
  return object.source.graph;
}

describe('The FORGEX Cube Test', () => {
  it('builds, edits, undoes, saves and reopens a cube without losing topology', () => {
    // 1. Eight vertices and twelve edges.
    const corners: Vec3[] = [
      [-0.5, -0.5, -0.5], [0.5, -0.5, -0.5], [0.5, -0.5, 0.5], [-0.5, -0.5, 0.5],
      [-0.5, 0.5, -0.5], [0.5, 0.5, -0.5], [0.5, 0.5, 0.5], [-0.5, 0.5, 0.5],
    ];
    let graph = createEmptyGraph();
    const v: string[] = [];
    for (const corner of corners) {
      const result = addVertex(graph, corner);
      graph = result.graph;
      v.push(result.vertexId);
    }
    const links: [number, number][] = [
      [0, 1], [1, 2], [2, 3], [3, 0], [4, 5], [5, 6], [6, 7], [7, 4], [0, 4], [1, 5], [2, 6], [3, 7],
    ];
    for (const [a, b] of links) graph = addEdge(graph, v[a], v[b]).graph;
    expect(Object.keys(graph.vertices)).toHaveLength(8);
    expect(Object.keys(graph.edges)).toHaveLength(12);
    expect(Object.keys(graph.faces)).toHaveLength(0);

    // 2. Detect loops and generate faces.
    const { loops } = findClosedLoops(graph);
    expect(loops).toHaveLength(6);
    expect(loops.every((loop) => loop.length === 4)).toBe(true);
    graph = fillClosedLoops(graph).graph;
    const built = analyzeGraph(graph);
    expect(built.faces).toBe(6);
    expect(built.triangles).toBe(12);
    expect(built.closed).toBe(true);
    expect(built.issues).toEqual([]);
    for (const edgeId of Object.keys(graph.edges)) {
      expect(getTopology(graph).facesByEdge.get(edgeId)).toHaveLength(2);
    }

    // Put the cube into an editor scene, as the app does.
    const cube: MeshObject = {
      id: 'obj_cube',
      name: 'Cube',
      kind: 'mesh',
      parentId: null,
      childIds: [],
      transform: { ...identityTransform(), position: [0, 0.5, 0] },
      visible: true,
      material: { color: '#3d9fe8' },
      source: { type: 'construction', graph },
    };
    const scene: Scene = { objects: { [cube.id]: cube }, rootIds: [cube.id] };
    const store = new EditorStore({ scene, settings: { ...DEFAULT_SETTINGS }, camera: null });
    const original = graphOf(store, cube.id);
    const originalMesh = buildMeshData(original);

    // 3. Move one vertex; the connected faces follow.
    const corner = v[6];
    const moved = moveVertex(original, corner, [0.9, 0.8, 0.7]);
    expect(store.execute(new SetGraphCommand(cube.id, original, moved, `Move vertex ${corner}`))).toBe(true);
    const edited = graphOf(store, cube.id);
    expect(edited.vertices[corner].position).toEqual([0.9, 0.8, 0.7]);
    const touching = getTopology(edited).facesByVertex.get(corner)!;
    expect(touching).toHaveLength(3);
    const editedMesh = buildMeshData(edited);
    expect(Array.from(editedMesh.positions)).not.toEqual(Array.from(originalMesh.positions));
    expect(editedMesh.positions.some((value) => Math.abs(value - 0.9) < 1e-6)).toBe(true);
    expect(Object.keys(edited.faces)).toEqual(Object.keys(original.faces));
    expect(store.getState().dirty).toBe(true);

    // 4. Undo; the vertex and faces return exactly.
    expect(store.undo()).toBe(true);
    const restored = graphOf(store, cube.id);
    expect(restored).toEqual(original);
    expect(Array.from(buildMeshData(restored).positions)).toEqual(Array.from(originalMesh.positions));
    expect(store.getState().dirty).toBe(false);

    // Redo the edit so the saved file holds an edited cube.
    expect(store.redo()).toBe(true);
    const beforeSave = graphOf(store, cube.id);

    // 5. Save to .forgex text.
    const text = serializeProject(store.toDocument());
    expect(text).toContain('"format": "forgex-project"');

    // 6. Reopen with every vertex, edge, face and ID intact.
    const reopened = parseProject(text);
    if (!reopened.ok) throw new Error(reopened.errors.join('\n'));
    const loaded = reopened.document.scene.objects[cube.id] as MeshObject;
    expect(loaded.source.type).toBe('construction');
    if (loaded.source.type !== 'construction') return;
    const loadedGraph = loaded.source.graph;
    expect(loadedGraph.vertices).toEqual(beforeSave.vertices);
    expect(loadedGraph.edges).toEqual(beforeSave.edges);
    expect(loadedGraph.faces).toEqual(beforeSave.faces);
    expect(loadedGraph.counters).toEqual(beforeSave.counters);
    expect(loaded.transform).toEqual(cube.transform);

    // The reopened cube is still editable, and new IDs never collide with old ones.
    const extra = addVertex(loadedGraph, [2, 0, 0]);
    expect(loadedGraph.vertices[extra.vertexId]).toBeUndefined();
    expect(extra.vertexId).toBe('v9');
  });
});
