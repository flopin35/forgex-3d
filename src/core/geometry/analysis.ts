import { getTopology, graphCounts, type ConstructionGraph } from './constructionGraph';
import { findInconsistentEdges } from './orientation';
import { analyzePolygon } from './polygon';

export type IssueSeverity = 'info' | 'warning' | 'error';

export interface GraphIssue {
  severity: IssueSeverity;
  code:
    | 'loose-vertex'
    | 'wire-edge'
    | 'open-boundary'
    | 'non-manifold-edge'
    | 'non-planar-face'
    | 'degenerate-face'
    | 'inconsistent-normals';
  message: string;
  elementIds: string[];
}

export interface GraphReport {
  vertices: number;
  edges: number;
  faces: number;
  triangles: number;
  /** Every edge borders exactly two faces: a watertight shell. */
  closed: boolean;
  issues: GraphIssue[];
}

function plural(count: number, one: string, many: string): string {
  return `${count} ${count === 1 ? one : many}`;
}

/** Checks a construction graph against the geometry invariants and reports what it finds. */
export function analyzeGraph(graph: ConstructionGraph): GraphReport {
  const counts = graphCounts(graph);
  const topology = getTopology(graph);
  const issues: GraphIssue[] = [];

  const loose = Object.keys(graph.vertices).filter((id) => !topology.edgesByVertex.has(id));
  if (loose.length) {
    issues.push({
      severity: 'info',
      code: 'loose-vertex',
      message: `${plural(loose.length, 'vertex is', 'vertices are')} not connected to any edge.`,
      elementIds: loose,
    });
  }

  const wire: string[] = [];
  const boundary: string[] = [];
  const nonManifold: string[] = [];
  for (const edge of Object.values(graph.edges)) {
    const users = topology.facesByEdge.get(edge.id)?.length ?? 0;
    if (users === 0) wire.push(edge.id);
    else if (users === 1) boundary.push(edge.id);
    else if (users > 2) nonManifold.push(edge.id);
  }
  if (wire.length && counts.faces > 0) {
    issues.push({
      severity: 'info',
      code: 'wire-edge',
      message: `${plural(wire.length, 'edge borders', 'edges border')} no face.`,
      elementIds: wire,
    });
  }
  if (boundary.length) {
    issues.push({
      severity: 'info',
      code: 'open-boundary',
      message: `${plural(boundary.length, 'edge is', 'edges are')} an open boundary (one face).`,
      elementIds: boundary,
    });
  }
  if (nonManifold.length) {
    issues.push({
      severity: 'warning',
      code: 'non-manifold-edge',
      message: `${plural(nonManifold.length, 'edge borders', 'edges border')} more than two faces.`,
      elementIds: nonManifold,
    });
  }

  const nonPlanar: string[] = [];
  const degenerate: string[] = [];
  for (const face of Object.values(graph.faces)) {
    const analysis = analyzePolygon(face.vertexIds.map((id) => graph.vertices[id].position));
    if (analysis.degenerate) degenerate.push(face.id);
    else if (!analysis.planar) nonPlanar.push(face.id);
  }
  if (degenerate.length) {
    issues.push({
      severity: 'warning',
      code: 'degenerate-face',
      message: `${plural(degenerate.length, 'face has', 'faces have')} zero area.`,
      elementIds: degenerate,
    });
  }
  if (nonPlanar.length) {
    issues.push({
      severity: 'warning',
      code: 'non-planar-face',
      message: `${plural(nonPlanar.length, 'face is', 'faces are')} no longer flat; shown as triangles.`,
      elementIds: nonPlanar,
    });
  }

  const inconsistent = findInconsistentEdges(graph);
  if (inconsistent.length) {
    issues.push({
      severity: 'warning',
      code: 'inconsistent-normals',
      message: `${plural(inconsistent.length, 'edge joins faces', 'edges join faces')} facing opposite ways. Use Recalculate normals.`,
      elementIds: inconsistent,
    });
  }

  const closed = counts.faces > 0 && counts.edges > 0 && wire.length === 0 && boundary.length === 0 && nonManifold.length === 0;
  return { ...counts, closed, issues };
}
