import { cross, dot, length, normalize, sub, type Vec3 } from '../math/vec3';
import type { ConstructionGraph } from './constructionGraph';
import { newellNormal, triangulatePolygon } from './polygon';

/** Renderer-agnostic buffers derived from a construction graph. */
export interface MeshData {
  /** Non-indexed triangle positions (x, y, z per corner). */
  positions: Float32Array;
  /** Flat normals, one per corner. */
  normals: Float32Array;
  /** Line segment endpoints for every graph edge (or only the feature edges, see options). */
  edgePositions: Float32Array;
  /** One point per vertex, in the same order as `vertexIds`. */
  pointPositions: Float32Array;
  vertexIds: string[];
  triangleCount: number;
}

export interface MeshDataOptions {
  /**
   * Leave out edges between two faces that meet almost flat (under 25°): the seams
   * inside a triangulated cap and the steps around a revolved or round shape, so
   * generated meshes show only their real outline and creases.
   */
  featureEdgesOnly?: boolean;
}

const SMOOTH_DOT = Math.cos((25 * Math.PI) / 180);

function edgeKey(a: string, b: string): string {
  return a < b ? `${a}|${b}` : `${b}|${a}`;
}

/** Rebuilds the full renderable mesh from the editable source. */
export function buildMeshData(graph: ConstructionGraph, options: MeshDataOptions = {}): MeshData {
  const positions: number[] = [];
  const normals: number[] = [];
  const edgeFaces = new Map<string, Vec3[]>();

  for (const face of Object.values(graph.faces)) {
    const points = face.vertexIds.map((id) => graph.vertices[id].position);
    const faceNormal = normalize(newellNormal(points));
    if (options.featureEdgesOnly) {
      face.vertexIds.forEach((id, i) => {
        const key = edgeKey(id, face.vertexIds[(i + 1) % face.vertexIds.length]);
        const list = edgeFaces.get(key);
        if (list) list.push(faceNormal);
        else edgeFaces.set(key, [faceNormal]);
      });
    }
    const triangles = triangulatePolygon(points);
    for (let t = 0; t < triangles.length; t += 3) {
      const a = points[triangles[t]];
      const b = points[triangles[t + 1]];
      const c = points[triangles[t + 2]];
      const raw = cross(sub(b, a), sub(c, a));
      const n: Vec3 = length(raw) > 1e-12 ? normalize(raw) : faceNormal;
      for (const p of [a, b, c]) {
        positions.push(p[0], p[1], p[2]);
        normals.push(n[0], n[1], n[2]);
      }
    }
  }

  const edgePositions: number[] = [];
  for (const edge of Object.values(graph.edges)) {
    if (options.featureEdgesOnly) {
      const adjacent = edgeFaces.get(edgeKey(edge.a, edge.b));
      if (adjacent && adjacent.length === 2 && dot(adjacent[0], adjacent[1]) > SMOOTH_DOT) continue;
    }
    const a = graph.vertices[edge.a].position;
    const b = graph.vertices[edge.b].position;
    edgePositions.push(a[0], a[1], a[2], b[0], b[1], b[2]);
  }

  const vertexIds = Object.keys(graph.vertices);
  const pointPositions = new Float32Array(vertexIds.length * 3);
  vertexIds.forEach((id, i) => pointPositions.set(graph.vertices[id].position, i * 3));

  return {
    positions: new Float32Array(positions),
    normals: new Float32Array(normals),
    edgePositions: new Float32Array(edgePositions),
    pointPositions,
    vertexIds,
    triangleCount: positions.length / 9,
  };
}
