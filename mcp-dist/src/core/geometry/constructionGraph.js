"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.GeometryError = void 0;
exports.createEmptyGraph = createEmptyGraph;
exports.pairKey = pairKey;
exports.getTopology = getTopology;
exports.findEdge = findEdge;
exports.facePositions = facePositions;
exports.addVertex = addVertex;
exports.moveVertex = moveVertex;
exports.removeVertex = removeVertex;
exports.addEdge = addEdge;
exports.removeEdge = removeEdge;
exports.cycleKey = cycleKey;
exports.checkLoop = checkLoop;
exports.addFace = addFace;
exports.removeFace = removeFace;
exports.reverseLoop = reverseLoop;
exports.graphCounts = graphCounts;
const vec3_1 = require("../math/vec3");
const polygon_1 = require("./polygon");
class GeometryError extends Error {
    code;
    constructor(code, message) {
        super(message);
        this.code = code;
        this.name = 'GeometryError';
    }
}
exports.GeometryError = GeometryError;
function createEmptyGraph() {
    return { vertices: {}, edges: {}, faces: {}, counters: { vertex: 1, edge: 1, face: 1 } };
}
const topologyCache = new WeakMap();
function pairKey(a, b) {
    return a < b ? `${a}\u0000${b}` : `${b}\u0000${a}`;
}
function pushTo(map, key, value) {
    const list = map.get(key);
    if (list)
        list.push(value);
    else
        map.set(key, [value]);
}
function getTopology(graph) {
    const cached = topologyCache.get(graph);
    if (cached)
        return cached;
    const topology = {
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
            if (edgeId)
                pushTo(topology.facesByEdge, edgeId, face.id);
        }
    }
    topologyCache.set(graph, topology);
    return topology;
}
/** Carries a cached topology across an edit that only moved vertices. */
function shareTopology(from, to) {
    const cached = topologyCache.get(from);
    if (cached)
        topologyCache.set(to, cached);
    return to;
}
function findEdge(graph, a, b) {
    const id = getTopology(graph).edgeByPair.get(pairKey(a, b));
    return id ? graph.edges[id] : undefined;
}
function facePositions(graph, face) {
    return face.vertexIds.map((id) => graph.vertices[id].position);
}
// ---------------------------------------------------------------------------
// Vertices
// ---------------------------------------------------------------------------
function requireVertex(graph, id) {
    const vertex = graph.vertices[id];
    if (!vertex)
        throw new GeometryError('missing-vertex', `Vertex ${id} does not exist.`);
    return vertex;
}
function requirePosition(position) {
    if (!(0, vec3_1.isVec3)(position))
        throw new GeometryError('invalid-position', 'A vertex position must be three finite numbers.');
    return [position[0], position[1], position[2]];
}
function addVertex(graph, position) {
    const id = `v${graph.counters.vertex}`;
    const vertex = { id, position: requirePosition(position) };
    return {
        vertexId: id,
        graph: {
            ...graph,
            vertices: { ...graph.vertices, [id]: vertex },
            counters: { ...graph.counters, vertex: graph.counters.vertex + 1 },
        },
    };
}
function moveVertex(graph, vertexId, position) {
    requireVertex(graph, vertexId);
    const next = {
        ...graph,
        vertices: { ...graph.vertices, [vertexId]: { id: vertexId, position: requirePosition(position) } },
    };
    return shareTopology(graph, next);
}
/** Removes a vertex together with every edge and face that depends on it. */
function removeVertex(graph, vertexId) {
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
function addEdge(graph, a, b) {
    requireVertex(graph, a);
    requireVertex(graph, b);
    if (a === b)
        throw new GeometryError('self-loop', 'An edge needs two different vertices.');
    const existing = findEdge(graph, a, b);
    if (existing)
        return { graph, edgeId: existing.id, created: false };
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
function removeEdge(graph, edgeId) {
    if (!graph.edges[edgeId])
        throw new GeometryError('missing-edge', `Edge ${edgeId} does not exist.`);
    const doomedFaces = new Set(getTopology(graph).facesByEdge.get(edgeId) ?? []);
    return { ...graph, edges: omit(graph.edges, new Set([edgeId])), faces: omit(graph.faces, doomedFaces) };
}
function cycleKey(vertexIds) {
    return [...vertexIds].sort().join('\u0000');
}
/** Throws a GeometryError describing the first invariant the loop breaks. */
function checkLoop(graph, vertexIds, options = {}) {
    const requirePlanar = options.requirePlanar ?? true;
    if (vertexIds.length < 3)
        throw new GeometryError('too-few-vertices', 'A face needs at least 3 vertices.');
    const seen = new Set();
    for (const id of vertexIds) {
        requireVertex(graph, id);
        if (seen.has(id))
            throw new GeometryError('repeated-vertex', `Vertex ${id} appears twice in the loop.`);
        seen.add(id);
    }
    const topology = getTopology(graph);
    for (let i = 0; i < vertexIds.length; i++) {
        const a = vertexIds[i];
        const b = vertexIds[(i + 1) % vertexIds.length];
        const edgeId = topology.edgeByPair.get(pairKey(a, b));
        if (!edgeId)
            throw new GeometryError('missing-edge', `Vertices ${a} and ${b} are not connected by an edge.`);
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
    const analysis = (0, polygon_1.analyzePolygon)(vertexIds.map((id) => graph.vertices[id].position));
    if (analysis.degenerate)
        throw new GeometryError('zero-area', 'The loop encloses no area.');
    if (requirePlanar && !analysis.planar)
        throw new GeometryError('non-planar', 'The loop’s points are not on one plane.');
    if (analysis.selfIntersecting)
        throw new GeometryError('self-intersecting', 'The loop’s outline crosses itself.');
}
function addFace(graph, vertexIds, options = {}) {
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
function removeFace(graph, faceId) {
    if (!graph.faces[faceId])
        throw new GeometryError('missing-face', `Face ${faceId} does not exist.`);
    return { ...graph, faces: omit(graph.faces, new Set([faceId])) };
}
/** Reverses a face's winding, keeping its first vertex first. */
function reverseLoop(vertexIds) {
    return [vertexIds[0], ...vertexIds.slice(1).reverse()];
}
function omit(record, ids) {
    if (ids.size === 0)
        return { ...record };
    const out = {};
    for (const [key, value] of Object.entries(record))
        if (!ids.has(key))
            out[key] = value;
    return out;
}
function graphCounts(graph) {
    let triangles = 0;
    for (const face of Object.values(graph.faces))
        triangles += Math.max(0, face.vertexIds.length - 2);
    return {
        vertices: Object.keys(graph.vertices).length,
        edges: Object.keys(graph.edges).length,
        faces: Object.keys(graph.faces).length,
        triangles,
    };
}
