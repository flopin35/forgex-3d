import { cross, length, normalize, sub, type Vec3 } from '../math/vec3';
import type { ConstructionGraph } from './constructionGraph';
import { newellNormal, triangulatePolygon } from './polygon';

/** Renderer-agnostic buffers derived from a construction graph. */
export interface MeshData {
  /** Non-indexed triangle positions (x, y, z per corner). */
  positions: Float32Array;
  /** Flat normals, one per corner. */
  normals: Float32Array;
  /** Line segment endpoints for every graph edge. */
  edgePositions: Float32Array;
  /** One point per vertex, in the same order as `vertexIds`. */
  pointPositions: Float32Array;
  vertexIds: string[];
  triangleCount: number;
}

/** Rebuilds the full renderable mesh from the editable source. */
export function buildMeshData(graph: ConstructionGraph): MeshData {
  const positions: number[] = [];
  const normals: number[] = [];

  for (const face of Object.values(graph.faces)) {
    const points = face.vertexIds.map((id) => graph.vertices[id].position);
    const faceNormal = normalize(newellNormal(points));
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
