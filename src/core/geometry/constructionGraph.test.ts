import { describe, expect, it } from 'vitest';
import type { Vec3 } from '../math/vec3';
import { analyzeGraph } from './analysis';
import { buildCubeGraph, buildPlaneGraph } from './builders';
import {
  addEdge,
  addFace,
  addVertex,
  createEmptyGraph,
  GeometryError,
  getTopology,
  moveVertex,
  removeEdge,
  removeVertex,
  reverseLoop,
  type ConstructionGraph,
} from './constructionGraph';
import { graphFromJson, graphToJson } from './graphJson';
import { fillClosedLoops, findClosedLoops } from './loops';
import { buildMeshData } from './meshData';
import { findInconsistentEdges, orientFaces } from './orientation';
import { analyzePolygon, triangulatePolygon } from './polygon';

function withVertices(points: Vec3[]): { graph: ConstructionGraph; ids: string[] } {
  let graph = createEmptyGraph();
  const ids: string[] = [];
  for (const p of points) {
    const r = addVertex(graph, p);
    graph = r.graph;
    ids.push(r.vertexId);
  }
  return { graph, ids };
}

function connectLoop(graph: ConstructionGraph, ids: string[]): ConstructionGraph {
  let g = graph;
  for (let i = 0; i < ids.length; i++) g = addEdge(g, ids[i], ids[(i + 1) % ids.length]).graph;
  return g;
}

function expectGeometryError(fn: () => unknown, code: string): void {
  try {
    fn();
  } catch (error) {
    expect(error).toBeInstanceOf(GeometryError);
    expect((error as GeometryError).code).toBe(code);
    return;
  }
  throw new Error(`Expected a GeometryError with code ${code}`);
}

const square: Vec3[] = [[0, 0, 0], [1, 0, 0], [1, 0, 1], [0, 0, 1]];

describe('geometry invariants', () => {
  it('assigns stable sequential ids that are never reused', () => {
    const { graph, ids } = withVertices(square);
    expect(ids).toEqual(['v1', 'v2', 'v3', 'v4']);
    const removed = removeVertex(graph, 'v4');
    expect(addVertex(removed, [5, 5, 5]).vertexId).toBe('v5');
  });

  it('rejects a vertex with a non-finite position', () => {
    expectGeometryError(() => addVertex(createEmptyGraph(), [0, Number.NaN, 0]), 'invalid-position');
  });

  it('keeps one edge per vertex pair', () => {
    const { graph } = withVertices(square);
    const first = addEdge(graph, 'v1', 'v2');
    const again = addEdge(first.graph, 'v2', 'v1');
    expect(again.created).toBe(false);
    expect(again.edgeId).toBe(first.edgeId);
    expect(Object.keys(again.graph.edges)).toHaveLength(1);
  });

  it('rejects self-loop edges and edges to missing vertices', () => {
    const { graph } = withVertices(square);
    expectGeometryError(() => addEdge(graph, 'v1', 'v1'), 'self-loop');
    expectGeometryError(() => addEdge(graph, 'v1', 'v99'), 'missing-vertex');
  });

  it('rejects invalid loops as faces', () => {
    const { graph: base, ids } = withVertices(square);
    const graph = connectLoop(base, ids);
    expectGeometryError(() => addFace(graph, ['v1', 'v2']), 'too-few-vertices');
    expectGeometryError(() => addFace(graph, ['v1', 'v2', 'v1']), 'repeated-vertex');
    expectGeometryError(() => addFace(graph, ['v1', 'v2', 'v4']), 'missing-edge');
    const filled = addFace(graph, ids).graph;
    expectGeometryError(() => addFace(filled, ['v2', 'v3', 'v4', 'v1']), 'duplicate-face');
  });

  it('rejects zero-area, non-planar and self-crossing loops', () => {
    const line = withVertices([[0, 0, 0], [1, 0, 0], [2, 0, 0]]);
    expectGeometryError(() => addFace(connectLoop(line.graph, line.ids), line.ids), 'zero-area');

    const bent = withVertices([[0, 0, 0], [1, 0, 0], [1, 0.5, 1], [0, 0, 1]]);
    expectGeometryError(() => addFace(connectLoop(bent.graph, bent.ids), bent.ids), 'non-planar');

    // An uneven bow-tie: its outline crosses itself but still encloses net area.
    const bowtie = withVertices([[0, 0, 0], [2, 0, 1], [2, 0, 0], [0, 0, 2]]);
    expectGeometryError(() => addFace(connectLoop(bowtie.graph, bowtie.ids), bowtie.ids), 'self-intersecting');
  });

  it('refuses a third face on one edge (non-manifold)', () => {
    let { graph, ids } = withVertices([[0, 0, 0], [1, 0, 0], [0, 1, 0], [0, 0, 1], [0, -1, 0]]);
    const [a, b, c, d, e] = ids;
    for (const [x, y] of [[a, b], [b, c], [c, a], [b, d], [d, a], [b, e], [e, a]]) graph = addEdge(graph, x, y).graph;
    graph = addFace(graph, [a, b, c]).graph;
    graph = addFace(graph, [a, d, b]).graph;
    expectGeometryError(() => addFace(graph, [a, b, e]), 'non-manifold-edge');
  });

  it('removes dependent edges and faces with a vertex or edge', () => {
    const cube = buildCubeGraph();
    const withoutVertex = removeVertex(cube, 'v1');
    expect(Object.keys(withoutVertex.edges)).toHaveLength(9);
    expect(Object.keys(withoutVertex.faces)).toHaveLength(3);
    const edgeId = Object.keys(cube.edges)[0];
    const withoutEdge = removeEdge(cube, edgeId);
    expect(Object.keys(withoutEdge.faces)).toHaveLength(4);
  });

  it('reports loose vertices without treating them as errors', () => {
    const { graph } = withVertices(square);
    const report = analyzeGraph(graph);
    expect(report.issues.map((i) => i.code)).toEqual(['loose-vertex']);
    expect(report.issues[0].severity).toBe('info');
  });

  it('allows a face to bend after an edit and reports it', () => {
    const plane = buildPlaneGraph();
    const bent = moveVertex(plane, 'v3', [0.5, 0.4, 0.5]);
    const report = analyzeGraph(bent);
    expect(report.issues.find((i) => i.code === 'non-planar-face')?.severity).toBe('warning');
    expect(buildMeshData(bent).triangleCount).toBe(2);
  });

  it('flags a face collapsed to zero area by an edit', () => {
    const plane = buildPlaneGraph();
    const collapsed = moveVertex(moveVertex(plane, 'v3', [-0.5, 0, -0.5]), 'v4', [-0.5, 0, -0.5]);
    expect(analyzeGraph(collapsed).issues.some((i) => i.code === 'degenerate-face')).toBe(true);
  });
});

describe('loop detection', () => {
  it('finds the 4 cells of a flat 2x2 grid and not the loops around them', () => {
    const pts: Vec3[] = [];
    for (let z = 0; z <= 2; z++) for (let x = 0; x <= 2; x++) pts.push([x, 0, z]);
    let { graph, ids } = withVertices(pts);
    const at = (x: number, z: number) => ids[z * 3 + x];
    for (let z = 0; z <= 2; z++) for (let x = 0; x < 2; x++) graph = addEdge(graph, at(x, z), at(x + 1, z)).graph;
    for (let x = 0; x <= 2; x++) for (let z = 0; z < 2; z++) graph = addEdge(graph, at(x, z), at(x, z + 1)).graph;
    const { loops } = findClosedLoops(graph);
    expect(loops).toHaveLength(4);
    const filled = fillClosedLoops(graph).graph;
    const report = analyzeGraph(filled);
    expect(report.faces).toBe(4);
    expect(report.issues.find((i) => i.code === 'inconsistent-normals')).toBeUndefined();
    for (const face of Object.values(filled.faces)) {
      const n = analyzePolygon(face.vertexIds.map((id) => filled.vertices[id].position)).normal;
      expect(n[1]).toBeCloseTo(1);
    }
  });

  it('builds a triangular prism: 2 triangles and 3 quads', () => {
    let { graph, ids } = withVertices([
      [0, 0, 0], [1, 0, 0], [0.5, 0, 1],
      [0, 1, 0], [1, 1, 0], [0.5, 1, 1],
    ]);
    graph = connectLoop(graph, ids.slice(0, 3));
    graph = connectLoop(graph, ids.slice(3));
    for (let i = 0; i < 3; i++) graph = addEdge(graph, ids[i], ids[i + 3]).graph;
    const filled = fillClosedLoops(graph).graph;
    const report = analyzeGraph(filled);
    expect(report.faces).toBe(5);
    expect(report.closed).toBe(true);
    expect(report.issues).toEqual([]);
  });

  it('does not refill loops that are already faces', () => {
    const cube = buildCubeGraph();
    expect(findClosedLoops(cube).loops).toHaveLength(0);
    expect(fillClosedLoops(cube).faceIds).toHaveLength(0);
  });
});

describe('normals', () => {
  it('orients a closed cube outward', () => {
    const cube = buildCubeGraph(2);
    for (const face of Object.values(cube.faces)) {
      const analysis = analyzePolygon(face.vertexIds.map((id) => cube.vertices[id].position));
      const outward = analysis.centroid.map((c) => Math.sign(Math.round(c)));
      expect(analysis.normal.map(Math.round)).toEqual(outward);
    }
  });

  it('repairs a face with flipped winding', () => {
    const cube = buildCubeGraph();
    const faceId = Object.keys(cube.faces)[0];
    const broken: ConstructionGraph = {
      ...cube,
      faces: { ...cube.faces, [faceId]: { id: faceId, vertexIds: reverseLoop(cube.faces[faceId].vertexIds) } },
    };
    expect(findInconsistentEdges(broken)).toHaveLength(4);
    const fixed = orientFaces(broken);
    expect(fixed.flipped).toEqual([faceId]);
    expect(fixed.graph.faces).toEqual(cube.faces);
  });
});

describe('triangulation and mesh output', () => {
  it('triangulates a concave L-shaped polygon into 4 triangles inside the outline', () => {
    const l: Vec3[] = [[0, 0, 0], [0, 0, 2], [1, 0, 2], [1, 0, 1], [2, 0, 1], [2, 0, 0]];
    const tris = triangulatePolygon(l);
    expect(tris).toHaveLength(12);
    let area = 0;
    for (let t = 0; t < tris.length; t += 3) area += analyzePolygon([l[tris[t]], l[tris[t + 1]], l[tris[t + 2]]]).area;
    expect(area).toBeCloseTo(3);
  });

  it('produces 12 triangles, 12 edge segments and 8 points for a cube', () => {
    const data = buildMeshData(buildCubeGraph());
    expect(data.triangleCount).toBe(12);
    expect(data.positions.length).toBe(12 * 9);
    expect(data.edgePositions.length).toBe(12 * 6);
    expect(data.vertexIds).toHaveLength(8);
  });

  it('reuses topology when only positions change', () => {
    const cube = buildCubeGraph();
    const topology = getTopology(cube);
    expect(getTopology(moveVertex(cube, 'v1', [-1, -1, -1]))).toBe(topology);
  });
});

describe('graph files', () => {
  it('round-trips through JSON exactly', () => {
    const cube = buildCubeGraph();
    const errors: string[] = [];
    const back = graphFromJson(JSON.parse(JSON.stringify(graphToJson(cube))), 'graph', errors);
    expect(errors).toEqual([]);
    expect(back).toEqual(cube);
  });

  it('rejects structural problems with readable messages', () => {
    const errors: string[] = [];
    const result = graphFromJson(
      {
        vertices: [{ id: 'v1', position: [0, 0, 0] }, { id: 'v1', position: [1, 0, 0] }, { id: 'v2', position: [1, 0, 0] }],
        edges: [{ id: 'e1', a: 'v1', b: 'v1' }, { id: 'e2', a: 'v1', b: 'v9' }],
        faces: [{ id: 'f1', vertices: ['v1', 'v2', 'v3'] }],
      },
      'source',
      errors,
    );
    expect(result).toBeNull();
    expect(errors.some((e) => e.includes('used twice'))).toBe(true);
    expect(errors.some((e) => e.includes('to itself'))).toBe(true);
    expect(errors.some((e) => e.includes('two existing vertices'))).toBe(true);
    expect(errors.some((e) => e.includes('f1'))).toBe(true);
  });
});
