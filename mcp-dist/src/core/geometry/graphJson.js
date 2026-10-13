"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.graphToJson = graphToJson;
exports.graphFromJson = graphFromJson;
const vec3_1 = require("../math/vec3");
const constructionGraph_1 = require("./constructionGraph");
function graphToJson(graph) {
    return {
        vertices: Object.values(graph.vertices).map((v) => ({ id: v.id, position: [...v.position] })),
        edges: Object.values(graph.edges).map((e) => ({ id: e.id, a: e.a, b: e.b })),
        faces: Object.values(graph.faces).map((f) => ({ id: f.id, vertices: [...f.vertexIds] })),
    };
}
function isRecord(value) {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}
function isId(value) {
    return typeof value === 'string' && value.length > 0 && value.length <= 64;
}
function nextCounter(ids, prefix) {
    let max = 0;
    const pattern = new RegExp(`^${prefix}(\\d+)$`);
    for (const id of ids) {
        const match = pattern.exec(id);
        if (match)
            max = Math.max(max, Number(match[1]));
    }
    return max + 1;
}
/**
 * Reads a construction graph from file data, enforcing the structural invariants.
 * Problems are appended to `errors` (prefixed with `path`); returns null if any were found.
 */
function graphFromJson(raw, path, errors) {
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
    const vertices = {};
    rawVertices.forEach((item, i) => {
        const at = `${path}.vertices[${i}]`;
        if (!isRecord(item) || !isId(item.id))
            return void errors.push(`${at} needs a text id.`);
        if (vertices[item.id])
            return void errors.push(`${at}: vertex id ${item.id} is used twice.`);
        if (!(0, vec3_1.isVec3)(item.position))
            return void errors.push(`${at}: position must be three finite numbers.`);
        vertices[item.id] = { id: item.id, position: [item.position[0], item.position[1], item.position[2]] };
    });
    const edges = {};
    const pairs = new Set();
    rawEdges.forEach((item, i) => {
        const at = `${path}.edges[${i}]`;
        if (!isRecord(item) || !isId(item.id))
            return void errors.push(`${at} needs a text id.`);
        if (edges[item.id])
            return void errors.push(`${at}: edge id ${item.id} is used twice.`);
        const { a, b } = item;
        if (!isId(a) || !isId(b) || !vertices[a] || !vertices[b]) {
            return void errors.push(`${at}: edge ${item.id} must connect two existing vertices.`);
        }
        if (a === b)
            return void errors.push(`${at}: edge ${item.id} connects vertex ${a} to itself.`);
        const key = (0, constructionGraph_1.pairKey)(a, b);
        if (pairs.has(key))
            return void errors.push(`${at}: vertices ${a} and ${b} are connected twice.`);
        pairs.add(key);
        edges[item.id] = { id: item.id, a, b };
    });
    const faces = {};
    rawFaces.forEach((item, i) => {
        const at = `${path}.faces[${i}]`;
        if (!isRecord(item) || !isId(item.id))
            return void errors.push(`${at} needs a text id.`);
        if (faces[item.id])
            return void errors.push(`${at}: face id ${item.id} is used twice.`);
        const loop = item.vertices;
        if (!Array.isArray(loop) || loop.length < 3 || !loop.every(isId)) {
            return void errors.push(`${at}: face ${item.id} needs a loop of at least 3 vertex ids.`);
        }
        if (new Set(loop).size !== loop.length)
            return void errors.push(`${at}: face ${item.id} repeats a vertex.`);
        for (let k = 0; k < loop.length; k++) {
            const a = loop[k];
            const b = loop[(k + 1) % loop.length];
            if (!vertices[a])
                return void errors.push(`${at}: face ${item.id} uses missing vertex ${a}.`);
            if (!pairs.has((0, constructionGraph_1.pairKey)(a, b))) {
                return void errors.push(`${at}: face ${item.id} has no edge between ${a} and ${b}.`);
            }
        }
        faces[item.id] = { id: item.id, vertexIds: [...loop] };
    });
    if (errors.length > startErrors)
        return null;
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
