import { add, cross, dot, type Vec3 } from '../math/vec3';
import { getTopology, pairKey, reverseLoop, type ConstructionGraph, type GraphFace } from './constructionGraph';
import { newellNormal } from './polygon';

/** True when the loop runs from `a` straight to `b`. */
export function loopRunsEdge(loop: readonly string[], a: string, b: string): boolean {
  for (let i = 0; i < loop.length; i++) {
    if (loop[i] === a && loop[(i + 1) % loop.length] === b) return true;
  }
  return false;
}

/**
 * Makes face windings consistent: faces that share an edge must run it in
 * opposite directions. Closed shells are then turned so normals point outward
 * (positive volume). Open surfaces face the positive direction of their dominant
 * axis, so a floor faces +Y. Faces across non-manifold edges are not propagated.
 */
export function orientFaces(graph: ConstructionGraph): { graph: ConstructionGraph; flipped: string[] } {
  const topology = getTopology(graph);
  const faces = graph.faces;
  const reversed = new Map<string, boolean>();
  const visited = new Set<string>();
  const finalFlip = new Set<string>();

  const effectiveLoop = (face: GraphFace): readonly string[] =>
    reversed.get(face.id) ? reverseLoop(face.vertexIds) : face.vertexIds;

  for (const seed of Object.values(faces)) {
    if (visited.has(seed.id)) continue;
    const component: string[] = [];
    const queue = [seed.id];
    visited.add(seed.id);
    reversed.set(seed.id, false);

    while (queue.length > 0) {
      const faceId = queue.shift()!;
      component.push(faceId);
      const loop = effectiveLoop(faces[faceId]);
      for (let i = 0; i < loop.length; i++) {
        const a = loop[i];
        const b = loop[(i + 1) % loop.length];
        const edgeId = topology.edgeByPair.get(pairKey(a, b));
        const neighbours = edgeId ? topology.facesByEdge.get(edgeId) ?? [] : [];
        if (neighbours.length !== 2) continue;
        const otherId = neighbours[0] === faceId ? neighbours[1] : neighbours[0];
        if (visited.has(otherId)) continue;
        // Consistent winding means the neighbour must run b -> a.
        reversed.set(otherId, loopRunsEdge(faces[otherId].vertexIds, a, b));
        visited.add(otherId);
        queue.push(otherId);
      }
    }

    const closed = component.every((faceId) => {
      const loop = faces[faceId].vertexIds;
      return loop.every((a, i) => {
        const edgeId = topology.edgeByPair.get(pairKey(a, loop[(i + 1) % loop.length]));
        return edgeId !== undefined && (topology.facesByEdge.get(edgeId)?.length ?? 0) === 2;
      });
    });

    let flipComponent = false;
    if (closed) {
      let volume = 0;
      for (const faceId of component) {
        const points = effectiveLoop(faces[faceId]).map((id) => graph.vertices[id].position);
        for (let i = 1; i < points.length - 1; i++) volume += dot(points[0], cross(points[i], points[i + 1]));
      }
      flipComponent = volume < 0;
    } else {
      let sum: Vec3 = [0, 0, 0];
      for (const faceId of component) {
        sum = add(sum, newellNormal(effectiveLoop(faces[faceId]).map((id) => graph.vertices[id].position)));
      }
      const axis = [0, 1, 2].reduce((best, k) => (Math.abs(sum[k]) > Math.abs(sum[best]) ? k : best), 1);
      flipComponent = sum[axis] < 0;
    }

    for (const faceId of component) {
      if (reversed.get(faceId) !== flipComponent) finalFlip.add(faceId);
    }
  }

  if (finalFlip.size === 0) return { graph, flipped: [] };
  const nextFaces: Record<string, GraphFace> = { ...faces };
  for (const faceId of finalFlip) {
    nextFaces[faceId] = { id: faceId, vertexIds: reverseLoop(faces[faceId].vertexIds) };
  }
  return { graph: { ...graph, faces: nextFaces }, flipped: [...finalFlip] };
}

/** Edges whose two faces run them in the same direction (inconsistent normals). */
export function findInconsistentEdges(graph: ConstructionGraph): string[] {
  const topology = getTopology(graph);
  const out: string[] = [];
  for (const edge of Object.values(graph.edges)) {
    const users = topology.facesByEdge.get(edge.id) ?? [];
    if (users.length !== 2) continue;
    const [f1, f2] = users.map((id) => graph.faces[id].vertexIds);
    if (loopRunsEdge(f1, edge.a, edge.b) === loopRunsEdge(f2, edge.a, edge.b)) out.push(edge.id);
  }
  return out;
}
