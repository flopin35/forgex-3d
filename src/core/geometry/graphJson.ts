import { isVec3, type Vec3 } from '../math/vec3';
import { pairKey, type ConstructionGraph, type GraphEdge, type GraphFace, type GraphVertex } from './constructionGraph';

/** The construction graph as it is written into a .forgex file. */
export interface ConstructionGraphJson {
  vertices: { id: string; position: Vec3 }[];
  edges: { id: string; a: string; b: string }[];
  faces: { id: string; vertices: string[] }[];
}

export function graphToJson(graph: ConstructionGraph): ConstructionGraphJson {
  return {
    vertices: Object.values(graph.vertices).map((v) => ({ id: v.id, position: [...v.position] })),
    edges: Object.values(graph.edges).map((e) => ({ id: e.id, a: e.a, b: e.b })),
    faces: Object.values(graph.faces).map((f) => ({ id: f.id, vertices: [...f.vertexIds] })),
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isId(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0 && value.length <= 64;
}

function nextCounter(ids: Iterable<string>, prefix: string): number {
  let max = 0;
  const pattern = new RegExp(`^${prefix}(\\d+)$`);
  for (const id of ids) {
    const match = pattern.exec(id);
    if (match) max = Math.max(max, Number(match[1]));
  }
  return max + 1;
}

/**
 * Reads a construction graph from file data, enforcing the structural invariants.
 * Problems are appended to `errors` (prefixed with `path`); returns null if any were found.
 */
export function graphFromJson(raw: unknown, path: string, errors: string[]): ConstructionGraph | null {
  const startErrors = errors.length;
  if (!isRecord(raw)) {
    errors.push(`${path} must be an object with vertices, edges and faces.`);
    return null;
  }
  const { vertices: rawVertices, edges: rawEdges, faces: rawFaces } = raw;
  if (!Array.isArray(rawVertices) || !Array.isArray(rawEdges) || !Array.isArray(rawFaces)) {
    errors.push(`${path} needs vertices, edges and faces arrays.`);
    return null;
  }

  const vertices: Record<string, GraphVertex> = {};
  rawVertices.forEach((item, i) => {
    const at = `${path}.vertices[${i}]`;
    if (!isRecord(item) || !isId(item.id)) return void errors.push(`${at} needs a text id.`);
    if (vertices[item.id]) return void errors.push(`${at}: vertex id ${item.id} is used twice.`);
    if (!isVec3(item.position)) return void errors.push(`${at}: position must be three finite numbers.`);
    vertices[item.id] = { id: item.id, position: [item.position[0], item.position[1], item.position[2]] };
  });

  const edges: Record<string, GraphEdge> = {};
  const pairs = new Set<string>();
  rawEdges.forEach((item, i) => {
    const at = `${path}.edges[${i}]`;
    if (!isRecord(item) || !isId(item.id)) return void errors.push(`${at} needs a text id.`);
    if (edges[item.id]) return void errors.push(`${at}: edge id ${item.id} is used twice.`);
    const { a, b } = item;
    if (!isId(a) || !isId(b) || !vertices[a] || !vertices[b]) {
      return void errors.push(`${at}: edge ${item.id} must connect two existing vertices.`);
    }
    if (a === b) return void errors.push(`${at}: edge ${item.id} connects vertex ${a} to itself.`);
    const key = pairKey(a, b);
    if (pairs.has(key)) return void errors.push(`${at}: vertices ${a} and ${b} are connected twice.`);
    pairs.add(key);
    edges[item.id] = { id: item.id, a, b };
  });

  const faces: Record<string, GraphFace> = {};
  rawFaces.forEach((item, i) => {
    const at = `${path}.faces[${i}]`;
    if (!isRecord(item) || !isId(item.id)) return void errors.push(`${at} needs a text id.`);
    if (faces[item.id]) return void errors.push(`${at}: face id ${item.id} is used twice.`);
    const loop = item.vertices;
    if (!Array.isArray(loop) || loop.length < 3 || !loop.every(isId)) {
      return void errors.push(`${at}: face ${item.id} needs a loop of at least 3 vertex ids.`);
    }
    if (new Set(loop).size !== loop.length) return void errors.push(`${at}: face ${item.id} repeats a vertex.`);
    for (let k = 0; k < loop.length; k++) {
      const a = loop[k];
      const b = loop[(k + 1) % loop.length];
      if (!vertices[a]) return void errors.push(`${at}: face ${item.id} uses missing vertex ${a}.`);
      if (!pairs.has(pairKey(a, b))) {
        return void errors.push(`${at}: face ${item.id} has no edge between ${a} and ${b}.`);
      }
    }
    faces[item.id] = { id: item.id, vertexIds: [...loop] };
  });

  if (errors.length > startErrors) return null;
  return {
    vertices,
    edges,
    faces,
    counters: {
      vertex: nextCounter(Object.keys(vertices), 'v'),
      edge: nextCounter(Object.keys(edges), 'e'),
      face: nextCounter(Object.keys(faces), 'f'),
    },
  };
}
