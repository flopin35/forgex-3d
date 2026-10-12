import type { Vec3 } from '../math/vec3';
import { getTopology, pairKey, type ConstructionGraph } from './constructionGraph';
import { GraphBuilder } from './graphBuilder';

/**
 * Non-destructive modifiers: they change how an object looks and exports, never its
 * editable source. Mirror runs first, then subdivision, as in Blender.
 */
export type MirrorAxis = 'none' | 'x' | 'y' | 'z';
export const MIRROR_AXES: readonly MirrorAxis[] = ['none', 'x', 'y', 'z'];
export const MAX_SUBDIVISION = 3;
/** Subdivision stops early rather than build more faces than this. */
export const SUBDIVISION_FACE_BUDGET = 250_000;

export interface MeshModifiers {
  /** Copy the mesh across this local axis (x = 0, y = 0 or z = 0 plane) and join the halves. */
  readonly mirror: MirrorAxis;
  /** Catmull-Clark smoothing levels, 0 to 3. Each level splits every face into quads and rounds the shape. */
  readonly subdivide: number;
}

export const NO_MODIFIERS: MeshModifiers = { mirror: 'none', subdivide: 0 };

export function cleanModifiers(raw: Partial<MeshModifiers> | undefined | null): MeshModifiers {
  const mirror = MIRROR_AXES.includes(raw?.mirror as MirrorAxis) ? (raw!.mirror as MirrorAxis) : 'none';
  const levels = typeof raw?.subdivide === 'number' && Number.isFinite(raw.subdivide) ? Math.round(raw.subdivide) : 0;
  return { mirror, subdivide: Math.min(MAX_SUBDIVISION, Math.max(0, levels)) };
}

export function hasModifiers(modifiers: MeshModifiers | undefined | null): boolean {
  return !!modifiers && (modifiers.mirror !== 'none' || modifiers.subdivide > 0);
}

const AXIS_INDEX = { x: 0, y: 1, z: 2 } as const;
const PLANE_EPSILON = 1e-6;

/**
 * Mirrors a graph across a local axis plane. Vertices on the plane are shared, so the
 * halves join; faces lying flat in the plane are dropped because they would end up
 * inside the joined shape.
 */
export function mirrorGraph(graph: ConstructionGraph, axis: Exclude<MirrorAxis, 'none'>): ConstructionGraph {
  const index = AXIS_INDEX[axis];
  const builder = new GraphBuilder();
  const original = new Map<string, string>();
  const copy = new Map<string, string>();
  const onPlane = (id: string) => Math.abs(graph.vertices[id].position[index]) <= PLANE_EPSILON;
  for (const vertex of Object.values(graph.vertices)) {
    const position: Vec3 = [...vertex.position];
    if (onPlane(vertex.id)) position[index] = 0;
    const id = builder.vertex(position);
    original.set(vertex.id, id);
    if (onPlane(vertex.id)) {
      copy.set(vertex.id, id);
    } else {
      const flipped: Vec3 = [...position];
      flipped[index] = -flipped[index];
      copy.set(vertex.id, builder.vertex(flipped));
    }
  }
  const topology = getTopology(graph);
  for (const face of Object.values(graph.faces)) {
    if (face.vertexIds.every(onPlane)) continue;
    builder.face(face.vertexIds.map((id) => original.get(id)!));
    builder.face([...face.vertexIds].reverse().map((id) => copy.get(id)!));
  }
  // Lines that bound no face (wire edges) are copied too.
  for (const edge of Object.values(graph.edges)) {
    if (topology.facesByEdge.get(edge.id)?.length) continue;
    builder.edge(original.get(edge.a)!, original.get(edge.b)!);
    builder.edge(copy.get(edge.a)!, copy.get(edge.b)!);
  }
  return builder.build();
}

function average(points: readonly Vec3[]): Vec3 {
  let x = 0;
  let y = 0;
  let z = 0;
  for (const p of points) {
    x += p[0];
    y += p[1];
    z += p[2];
  }
  const n = points.length || 1;
  return [x / n, y / n, z / n];
}

/**
 * One level of Catmull-Clark subdivision. Every face becomes quads (one per corner)
 * and the surface is pulled smooth. Open boundaries are smoothed along themselves,
 * and corners of an open surface stay put. Lines that bound no face are left out.
 */
export function subdivideOnce(graph: ConstructionGraph): ConstructionGraph {
  const faces = Object.values(graph.faces);
  if (faces.length === 0) return graph;
  const topology = getTopology(graph);
  const pos = (id: string) => graph.vertices[id].position;
  const facePoint = new Map<string, Vec3>();
  for (const face of faces) facePoint.set(face.id, average(face.vertexIds.map(pos)));

  const edgePoint = new Map<string, Vec3>();
  const edgeIdOf = (a: string, b: string) => topology.edgeByPair.get(pairKey(a, b)) ?? null;
  for (const edge of Object.values(graph.edges)) {
    const users = topology.facesByEdge.get(edge.id) ?? [];
    if (users.length === 0) continue;
    const mid = average([pos(edge.a), pos(edge.b)]);
    edgePoint.set(edge.id, users.length === 2 ? average([pos(edge.a), pos(edge.b), facePoint.get(users[0])!, facePoint.get(users[1])!]) : mid);
  }

  const vertexPoint = new Map<string, Vec3>();
  for (const vertex of Object.values(graph.vertices)) {
    const adjacentFaces = topology.facesByVertex.get(vertex.id) ?? [];
    if (adjacentFaces.length === 0) continue;
    const edges = (topology.edgesByVertex.get(vertex.id) ?? []).filter((id) => (topology.facesByEdge.get(id)?.length ?? 0) > 0);
    const boundary = edges.filter((id) => topology.facesByEdge.get(id)!.length === 1);
    const nonManifold = edges.some((id) => topology.facesByEdge.get(id)!.length > 2);
    const p = vertex.position;
    if (nonManifold) {
      vertexPoint.set(vertex.id, p);
    } else if (boundary.length > 0) {
      // Corners of an open surface (a dot used by a single face) and odd boundaries stay put.
      if (boundary.length !== 2 || adjacentFaces.length === 1) {
        vertexPoint.set(vertex.id, p);
        continue;
      }
      const [a, b] = boundary.map((id) => {
        const e = graph.edges[id];
        return pos(e.a === vertex.id ? e.b : e.a);
      });
      vertexPoint.set(vertex.id, [0.75 * p[0] + 0.125 * (a[0] + b[0]), 0.75 * p[1] + 0.125 * (a[1] + b[1]), 0.75 * p[2] + 0.125 * (a[2] + b[2])]);
    } else {
      const n = edges.length;
      const f = average(adjacentFaces.map((id) => facePoint.get(id)!));
      const r = average(
        edges.map((id) => {
          const e = graph.edges[id];
          return average([pos(e.a), pos(e.b)]);
        }),
      );
      vertexPoint.set(vertex.id, [(f[0] + 2 * r[0] + (n - 3) * p[0]) / n, (f[1] + 2 * r[1] + (n - 3) * p[1]) / n, (f[2] + 2 * r[2] + (n - 3) * p[2]) / n]);
    }
  }

  const builder = new GraphBuilder();
  const vertexIds = new Map<string, string>();
  const edgeIds = new Map<string, string>();
  const faceIds = new Map<string, string>();
  for (const [id, p] of vertexPoint) vertexIds.set(id, builder.vertex(p));
  for (const [id, p] of edgePoint) edgeIds.set(id, builder.vertex(p));
  for (const [id, p] of facePoint) faceIds.set(id, builder.vertex(p));
  for (const face of faces) {
    const loop = face.vertexIds;
    const k = loop.length;
    for (let i = 0; i < k; i++) {
      const previous = loop[(i - 1 + k) % k];
      const current = loop[i];
      const next = loop[(i + 1) % k];
      const eNext = edgeIdOf(current, next);
      const ePrevious = edgeIdOf(previous, current);
      if (!eNext || !ePrevious) continue;
      builder.face([vertexIds.get(current)!, edgeIds.get(eNext)!, faceIds.get(face.id)!, edgeIds.get(ePrevious)!]);
    }
  }
  return builder.build();
}

export function subdivide(graph: ConstructionGraph, levels: number): ConstructionGraph {
  let current = graph;
  for (let level = 0; level < levels; level++) {
    const faceCount = Object.values(current.faces).reduce((sum, face) => sum + face.vertexIds.length, 0);
    if (faceCount > SUBDIVISION_FACE_BUDGET) break;
    current = subdivideOnce(current);
  }
  return current;
}

const cache = new WeakMap<ConstructionGraph, Map<string, ConstructionGraph>>();

/** The graph an object shows after its modifiers. Cached per source graph and settings. */
export function applyModifiers(graph: ConstructionGraph, modifiers: MeshModifiers | undefined | null): ConstructionGraph {
  if (!modifiers || !hasModifiers(modifiers)) return graph;
  const key = `${modifiers.mirror}|${modifiers.subdivide}`;
  let byKey = cache.get(graph);
  if (!byKey) {
    byKey = new Map();
    cache.set(graph, byKey);
  }
  const cached = byKey.get(key);
  if (cached) return cached;
  let result = graph;
  if (modifiers.mirror !== 'none') result = mirrorGraph(result, modifiers.mirror);
  if (modifiers.subdivide > 0) result = subdivide(result, modifiers.subdivide);
  byKey.set(key, result);
  return result;
}
