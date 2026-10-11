import { dot, sub } from '../math/vec3';
import {
  addFace,
  cycleKey,
  GeometryError,
  getTopology,
  pairKey,
  type ConstructionGraph,
  type Topology,
} from './constructionGraph';
import { orientFaces } from './orientation';
import { analyzePolygon, pointInPolygon2d, projectToPlane } from './polygon';

export interface LoopSearchOptions {
  /** Longest loop considered, in vertices. */
  maxLength?: number;
  /** Upper bound on search steps, so very dense graphs cannot stall the editor. */
  maxSteps?: number;
}

export interface LoopSearchResult {
  loops: string[][];
  /** True when the search stopped at `maxSteps` before checking every path. */
  truncated: boolean;
}

/**
 * Finds closed loops that can become faces. A loop qualifies when it:
 * - runs only along edges that border fewer than two faces,
 * - has no chord (no edge joining two non-neighbouring loop vertices),
 * - is flat, encloses area and does not cross itself,
 * - contains no other vertex inside it on the same plane,
 * - is not already a face.
 * These rules find the 6 faces of a cube and the cells of a flat grid,
 * while rejecting the larger loops that run around them.
 */
export function findClosedLoops(graph: ConstructionGraph, options: LoopSearchOptions = {}): LoopSearchResult {
  const maxLength = options.maxLength ?? 12;
  const maxSteps = options.maxSteps ?? 200_000;
  const topology = getTopology(graph);

  const vertexIds = Object.keys(graph.vertices);
  const order = new Map(vertexIds.map((id, i) => [id, i]));
  const adjacency = new Map<string, string[]>();
  for (const edge of Object.values(graph.edges)) {
    if ((topology.facesByEdge.get(edge.id)?.length ?? 0) >= 2) continue;
    if (!adjacency.has(edge.a)) adjacency.set(edge.a, []);
    if (!adjacency.has(edge.b)) adjacency.set(edge.b, []);
    adjacency.get(edge.a)!.push(edge.b);
    adjacency.get(edge.b)!.push(edge.a);
  }

  const existing = new Set(Object.values(graph.faces).map((face) => cycleKey(face.vertexIds)));
  const loops: string[][] = [];
  const found = new Set<string>();
  let steps = 0;
  let truncated = false;

  for (const start of vertexIds) {
    if (truncated) break;
    const startOrder = order.get(start)!;
    const path = [start];
    const onPath = new Set(path);

    const visit = (current: string): void => {
      for (const next of adjacency.get(current) ?? []) {
        if (truncated) return;
        if (next === start) {
          // Each cycle is reported once: lowest-ordered vertex first, one direction only.
          if (path.length >= 3 && order.get(path[1])! < order.get(path[path.length - 1])!) {
            const key = cycleKey(path);
            if (!found.has(key) && !existing.has(key) && isFaceCandidate(graph, topology, path)) {
              found.add(key);
              loops.push([...path]);
            }
          }
          continue;
        }
        if (onPath.has(next) || order.get(next)! <= startOrder || path.length >= maxLength) continue;
        if (++steps > maxSteps) {
          truncated = true;
          return;
        }
        path.push(next);
        onPath.add(next);
        visit(next);
        path.pop();
        onPath.delete(next);
      }
    };
    visit(start);
  }

  loops.sort((a, b) => a.length - b.length);
  return { loops, truncated };
}

function isFaceCandidate(graph: ConstructionGraph, topology: Topology, loop: readonly string[]): boolean {
  const n = loop.length;
  for (let i = 0; i < n; i++) {
    for (let j = i + 2; j < n; j++) {
      if (i === 0 && j === n - 1) continue;
      if (topology.edgeByPair.has(pairKey(loop[i], loop[j]))) return false;
    }
  }

  const points = loop.map((id) => graph.vertices[id].position);
  const analysis = analyzePolygon(points);
  if (!analysis.planar || analysis.degenerate || analysis.selfIntersecting) return false;

  // Reject loops that surround another vertex lying on the same plane.
  const tolerance = Math.max(1e-9, 1e-5 * analysis.size);
  const onLoop = new Set(loop);
  const outline = projectToPlane(points, analysis.normal);
  for (const vertex of Object.values(graph.vertices)) {
    if (onLoop.has(vertex.id)) continue;
    if (Math.abs(dot(sub(vertex.position, analysis.centroid), analysis.normal)) > tolerance) continue;
    const [projected] = projectToPlane([vertex.position], analysis.normal);
    if (pointInPolygon2d(projected, outline)) return false;
  }
  return true;
}

export interface FillResult {
  graph: ConstructionGraph;
  faceIds: string[];
  /** Loops that were found but could not become faces (e.g. they would overload an edge). */
  skipped: number;
  truncated: boolean;
}

/** Fills every qualifying closed loop with a face, then orients all faces consistently. */
export function fillClosedLoops(graph: ConstructionGraph, options: LoopSearchOptions = {}): FillResult {
  const { loops, truncated } = findClosedLoops(graph, options);
  let next = graph;
  const faceIds: string[] = [];
  let skipped = 0;
  for (const loop of loops) {
    try {
      const result = addFace(next, loop);
      next = result.graph;
      faceIds.push(result.faceId);
    } catch (error) {
      if (error instanceof GeometryError) skipped++;
      else throw error;
    }
  }
  if (faceIds.length > 0) next = orientFaces(next).graph;
  return { graph: next, faceIds, skipped, truncated };
}
