import type { Vec3 } from '../math/vec3';
import { addEdge, addFace, addVertex, createEmptyGraph, type ConstructionGraph } from './constructionGraph';
import { fillClosedLoops } from './loops';

/**
 * Builds a cube the way FORGEX models are meant to be built: 8 vertices,
 * 12 connecting edges, then the 6 faces are generated from the closed loops.
 */
export function buildCubeGraph(size = 1): ConstructionGraph {
  const h = size / 2;
  const corners: Vec3[] = [
    [-h, -h, -h], [h, -h, -h], [h, -h, h], [-h, -h, h],
    [-h, h, -h], [h, h, -h], [h, h, h], [-h, h, h],
  ];
  let graph = createEmptyGraph();
  const ids: string[] = [];
  for (const corner of corners) {
    const result = addVertex(graph, corner);
    graph = result.graph;
    ids.push(result.vertexId);
  }
  const links: [number, number][] = [
    [0, 1], [1, 2], [2, 3], [3, 0],
    [4, 5], [5, 6], [6, 7], [7, 4],
    [0, 4], [1, 5], [2, 6], [3, 7],
  ];
  for (const [a, b] of links) graph = addEdge(graph, ids[a], ids[b]).graph;
  return fillClosedLoops(graph).graph;
}

/** A flat square on the ground plane (XZ), facing +Y. */
export function buildPlaneGraph(size = 1): ConstructionGraph {
  const h = size / 2;
  const corners: Vec3[] = [[-h, 0, -h], [-h, 0, h], [h, 0, h], [h, 0, -h]];
  let graph = createEmptyGraph();
  const ids: string[] = [];
  for (const corner of corners) {
    const result = addVertex(graph, corner);
    graph = result.graph;
    ids.push(result.vertexId);
  }
  for (let i = 0; i < 4; i++) graph = addEdge(graph, ids[i], ids[(i + 1) % 4]).graph;
  return addFace(graph, ids).graph;
}
