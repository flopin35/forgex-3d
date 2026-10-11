import { isVec3, type Vec3 } from '../math/vec3';
import { analyzePolygon } from './polygon';

/**
 * The construction graph is the editable source of a point-built mesh:
 * vertices, the edges that connect them, and faces bounded by closed loops of edges.
 * Rendered triangles are always derived from it; they are never the source of truth.
 */
export interface GraphVertex {
  readonly id: string;
  readonly position: Vec3;
}

export interface GraphEdge {
  readonly id: string;
  readonly a: string;
  readonly b: string;
}

export interface GraphFace {
  readonly id: string;
  /** The boundary loop in order. Counter-clockwise around the normal (right-hand rule). */
  readonly vertexIds: readonly string[];
}

export interface GraphCounters {
  readonly vertex: number;
  readonly edge: number;
  readonly face: number;
}

export interface ConstructionGraph {
  readonly vertices: Readonly<Record<string, GraphVertex>>;
  readonly edges: Readonly<Record<string, GraphEdge>>;
  readonly faces: Readonly<Record<string, GraphFace>>;
  /** The next number used for each kind of ID (v1, e1, f1...). IDs are never reused. */
  readonly counters: GraphCounters;
}

export type GeometryErrorCode =
  | 'missing-vertex'
  | 'missing-edge'
  | 'missing-face'
  | 'self-loop'
  | 'invalid-position'
  | 'too-few-vertices'
  | 'repeated-vertex'
  | 'non-planar'
  | 'zero-area'
  | 'self-intersecting'
  | 'duplicate-face'
  | 'non-manifold-edge';

export class GeometryError extends Error {
  constructor(
    readonly code: GeometryErrorCode,
    message: string,
  ) {
    super(message);
    this.name = 'GeometryError';
  }
}

export function createEmptyGraph(): ConstructionGraph {
  return { vertices: {}, edges: {}, faces: {}, counters: { vertex: 1, edge: 1, face: 1 } };
}

// ---------------------------------------------------------------------------
// Topology index (cached per immutable graph instance)
// ---------------------------------------------------------------------------

export interface Topology {
  edgeByPair: Map<string, string>;
  edgesByVertex: Map<string, string[]>;
  facesByEdge: Map<string, string[]>;
  facesByVertex: Map<string, string[]>;
}

const topologyCache = new WeakMap<ConstructionGraph, Topology>();

export function pairKey(a: string, b: string): string {
  return a < b ? `${a}\u0000${b}` : `${b}\u0000${a}`;
}

function pushTo(map: Map<string, string[]>, key: string, value: string): void {
  const list = map.get(key);
  if (list) list.push(value);
  else map.set(key, [value]);
}

export function getTopology(graph: ConstructionGraph): Topology {
  const cached = topologyCache.get(graph);
  if (cached) return cached;
  const topology: Topology = {
    edgeByPair: new Map(),
    edgesByVertex: new Map(),
    facesByEdge: new Map(),
    facesByVertex: new Map(),
  };
  for (const edge of Object.values(graph.edges)) {
    topology.edgeByPair.set(pairKey(edge.a, edge.b), edge.id);
    pushTo(topology.edgesByVertex, edge.a, edge.id);
    pushTo(topology.edgesByVertex, edge.b, edge.id);
  }
  for (const face of Object.values(graph.faces)) {
    const loop = face.vertexIds;
    for (let i = 0; i < loop.length; i++) {
      pushTo(topology.facesByVertex, loop[i], face.id);
      const edgeId = topology.edgeByPair.get(pairKey(loop[i], loop[(i + 1) % loop.length]));
      if (edgeId) pushTo(topology.facesByEdge, edgeId, face.id);
    }
  }
  topologyCache.set(graph, topology);
  return topology;
}

/** Carries a cached topology across an edit that only moved vertices. */
function shareTopology(from: ConstructionGraph, to: ConstructionGraph): ConstructionGraph {
  const cached = topologyCache.get(from);
  if (cached) topologyCache.set(to, cached);
  return to;
}

export function findEdge(graph: ConstructionGraph, a: string, b: string): GraphEdge | undefined {
  const id = getTopology(graph).edgeByPair.get(pairKey(a, b));
  return id ? graph.edges[id] : undefined;
}

export function facePositions(graph: ConstructionGraph, face: GraphFace): Vec3[] {
  return face.vertexIds.map((id) => graph.vertices[id].position);
}

// ---------------------------------------------------------------------------
// Vertices
// ---------------------------------------------------------------------------

function requireVertex(graph: ConstructionGraph, id: string): GraphVertex {
  const vertex = graph.vertices[id];
  if (!vertex) throw new GeometryError('missing-vertex', `Vertex ${id} does not exist.`);
  return vertex;
}

function requirePosition(position: Vec3): Vec3 {
  if (!isVec3(position)) throw new GeometryError('invalid-position', 'A vertex position must be three finite numbers.');
  return [position[0], position[1], position[2]];
}

export function addVertex(graph: ConstructionGraph, position: Vec3): { graph: ConstructionGraph; vertexId: string } {
  const id = `v${graph.counters.vertex}`;
  const vertex: GraphVertex = { id, position: requirePosition(position) };
  return {
    vertexId: id,
    graph: {
      ...graph,
      vertices: { ...graph.vertices, [id]: vertex },
      counters: { ...graph.counters, vertex: graph.counters.vertex + 1 },
    },
  };
}

export function moveVertex(graph: ConstructionGraph, vertexId: string, position: Vec3): ConstructionGraph {
  requireVertex(graph, vertexId);
  const next: ConstructionGraph = {
    ...graph,
    vertices: { ...graph.vertices, [vertexId]: { id: vertexId, position: requirePosition(position) } },
  };
  return shareTopology(graph, next);
}

/** Removes a vertex together with every edge and face that depends on it. */
export function removeVertex(graph: ConstructionGraph, vertexId: string): ConstructionGraph {
  requireVertex(graph, vertexId);
  const topology = getTopology(graph);
  const doomedEdges = new Set(topology.edgesByVertex.get(vertexId) ?? []);
  const doomedFaces = new Set(topology.facesByVertex.get(vertexId) ?? []);
  const vertices = { ...graph.vertices };
  delete vertices[vertexId];
  return {
    ...graph,
    vertices,
    edges: omit(graph.edges, doomedEdges),
    faces: omit(graph.faces, doomedFaces),
  };
}

// ---------------------------------------------------------------------------
// Edges
// ---------------------------------------------------------------------------

/**
 * Connects two vertices. Invariants: both vertices exist, they are different,
 * and there is at most one edge per vertex pair (an existing edge is returned).
 */
export function addEdge(
  graph: ConstructionGraph,
  a: string,
  b: string,
): { graph: ConstructionGraph; edgeId: string; created: boolean } {
  requireVertex(graph, a);
  requireVertex(graph, b);
  if (a === b) throw new GeometryError('self-loop', 'An edge needs two different vertices.');
  const existing = findEdge(graph, a, b);
  if (existing) return { graph, edgeId: existing.id, created: false };
  const id = `e${graph.counters.edge}`;
  return {
    edgeId: id,
    created: true,
    graph: {
      ...graph,
      edges: { ...graph.edges, [id]: { id, a, b } },
      counters: { ...graph.counters, edge: graph.counters.edge + 1 },
    },
  };
}

/** Removes an edge and every face that uses it. */
export function removeEdge(graph: ConstructionGraph, edgeId: string): ConstructionGraph {
  if (!graph.edges[edgeId]) throw new GeometryError('missing-edge', `Edge ${edgeId} does not exist.`);
  const doomedFaces = new Set(getTopology(graph).facesByEdge.get(edgeId) ?? []);
  return { ...graph, edges: omit(graph.edges, new Set([edgeId])), faces: omit(graph.faces, doomedFaces) };
}

// ---------------------------------------------------------------------------
// Faces
// ---------------------------------------------------------------------------

export interface LoopCheckOptions {
  /** Require the loop to be flat. True when a face is created; edits may bend it later. */
  requirePlanar?: boolean;
}

export function cycleKey(vertexIds: readonly string[]): string {
  return [...vertexIds].sort().join('\u0000');
}

/** Throws a GeometryError describing the first invariant the loop breaks. */
export function checkLoop(graph: ConstructionGraph, vertexIds: readonly string[], options: LoopCheckOptions = {}): void {
  const requirePlanar = options.requirePlanar ?? true;
  if (vertexIds.length < 3) throw new GeometryError('too-few-vertices', 'A face needs at least 3 vertices.');
  const seen = new Set<string>();
  for (const id of vertexIds) {
    requireVertex(graph, id);
    if (seen.has(id)) throw new GeometryError('repeated-vertex', `Vertex ${id} appears twice in the loop.`);
    seen.add(id);
  }
  const topology = getTopology(graph);
  for (let i = 0; i < vertexIds.length; i++) {
    const a = vertexIds[i];
    const b = vertexIds[(i + 1) % vertexIds.length];
    const edgeId = topology.edgeByPair.get(pairKey(a, b));
    if (!edgeId) throw new GeometryError('missing-edge', `Vertices ${a} and ${b} are not connected by an edge.`);
    const usage = topology.facesByEdge.get(edgeId)?.length ?? 0;
    if (usage >= 2) {
      throw new GeometryError('non-manifold-edge', `Edge ${edgeId} already borders two faces; a third would make it non-manifold.`);
    }
  }
  const key = cycleKey(vertexIds);
  for (const face of Object.values(graph.faces)) {
    if (face.vertexIds.length === vertexIds.length && cycleKey(face.vertexIds) === key) {
      throw new GeometryError('duplicate-face', `Face ${face.id} already fills this loop.`);
    }
  }
  const analysis = analyzePolygon(vertexIds.map((id) => graph.vertices[id].position));
  if (analysis.degenerate) throw new GeometryError('zero-area', 'The loop encloses no area.');
  if (requirePlanar && !analysis.planar) throw new GeometryError('non-planar', 'The loop’s points are not on one plane.');
  if (analysis.selfIntersecting) throw new GeometryError('self-intersecting', 'The loop’s outline crosses itself.');
}

export function addFace(
  graph: ConstructionGraph,
  vertexIds: readonly string[],
  options: LoopCheckOptions = {},
): { graph: ConstructionGraph; faceId: string } {
  checkLoop(graph, vertexIds, options);
  const id = `f${graph.counters.face}`;
  return {
    faceId: id,
    graph: {
      ...graph,
      faces: { ...graph.faces, [id]: { id, vertexIds: [...vertexIds] } },
      counters: { ...graph.counters, face: graph.counters.face + 1 },
    },
  };
}

export function removeFace(graph: ConstructionGraph, faceId: string): ConstructionGraph {
  if (!graph.faces[faceId]) throw new GeometryError('missing-face', `Face ${faceId} does not exist.`);
  return { ...graph, faces: omit(graph.faces, new Set([faceId])) };
}

/** Reverses a face's winding, keeping its first vertex first. */
export function reverseLoop(vertexIds: readonly string[]): string[] {
  return [vertexIds[0], ...vertexIds.slice(1).reverse()];
}

function omit<T>(record: Readonly<Record<string, T>>, ids: Set<string>): Record<string, T> {
  if (ids.size === 0) return { ...record };
  const out: Record<string, T> = {};
  for (const [key, value] of Object.entries(record)) if (!ids.has(key)) out[key] = value;
  return out;
}

export function graphCounts(graph: ConstructionGraph): {
  vertices: number;
  edges: number;
  faces: number;
  triangles: number;
} {
  let triangles = 0;
  for (const face of Object.values(graph.faces)) triangles += Math.max(0, face.vertexIds.length - 2);
  return {
    vertices: Object.keys(graph.vertices).length,
    edges: Object.keys(graph.edges).length,
    faces: Object.keys(graph.faces).length,
    triangles,
  };
}
