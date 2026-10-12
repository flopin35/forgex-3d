import type { Vec3 } from '../math/vec3';
import { pairKey, type ConstructionGraph, type GraphEdge, type GraphFace, type GraphVertex } from './constructionGraph';
import { analyzePolygon } from './polygon';

/**
 * Fast, mutable builder for generated geometry (extrude, revolve...). It enforces the
 * same invariants as the editing operations (one edge per vertex pair, no self-loops,
 * faces with at least 3 distinct vertices and area, at most 2 faces per edge) but in
 * linear time, then freezes into an immutable ConstructionGraph.
 */
export class GraphBuilder {
  private readonly vertices: Record<string, GraphVertex> = {};
  private readonly edges: Record<string, GraphEdge> = {};
  private readonly faces: Record<string, GraphFace> = {};
  private readonly edgeByPair = new Map<string, string>();
  private readonly edgeUse = new Map<string, number>();
  private nextVertex = 1;
  private nextEdge = 1;
  private nextFace = 1;
  /** Faces that broke an invariant and were left out. */
  skippedFaces = 0;

  vertex(position: Vec3): string {
    const id = `v${this.nextVertex++}`;
    this.vertices[id] = { id, position: [position[0], position[1], position[2]] };
    return id;
  }

  edge(a: string, b: string): string | null {
    if (a === b) return null;
    const key = pairKey(a, b);
    const existing = this.edgeByPair.get(key);
    if (existing) return existing;
    const id = `e${this.nextEdge++}`;
    this.edges[id] = { id, a, b };
    this.edgeByPair.set(key, id);
    return id;
  }

  /** Adds a face (creating its edges). Returns false and counts a skip if it breaks an invariant. */
  face(loop: readonly string[]): boolean {
    const ids = loop.filter((id, i) => id !== loop[(i + 1) % loop.length]);
    if (ids.length < 3 || new Set(ids).size !== ids.length) {
      this.skippedFaces++;
      return false;
    }
    if (analyzePolygon(ids.map((id) => this.vertices[id].position)).degenerate) {
      this.skippedFaces++;
      return false;
    }
    const keys = ids.map((id, i) => pairKey(id, ids[(i + 1) % ids.length]));
    if (keys.some((key) => (this.edgeUse.get(key) ?? 0) >= 2)) {
      this.skippedFaces++;
      return false;
    }
    ids.forEach((id, i) => this.edge(id, ids[(i + 1) % ids.length]));
    keys.forEach((key) => this.edgeUse.set(key, (this.edgeUse.get(key) ?? 0) + 1));
    const id = `f${this.nextFace++}`;
    this.faces[id] = { id, vertexIds: ids };
    return true;
  }

  build(): ConstructionGraph {
    return {
      vertices: this.vertices,
      edges: this.edges,
      faces: this.faces,
      counters: { vertex: this.nextVertex, edge: this.nextEdge, face: this.nextFace },
    };
  }
}
