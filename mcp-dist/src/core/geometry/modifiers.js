"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.NO_MODIFIERS = exports.SUBDIVISION_FACE_BUDGET = exports.MAX_SUBDIVISION = exports.MIRROR_AXES = void 0;
exports.cleanModifiers = cleanModifiers;
exports.hasModifiers = hasModifiers;
exports.mirrorGraph = mirrorGraph;
exports.subdivideOnce = subdivideOnce;
exports.subdivide = subdivide;
exports.applyModifiers = applyModifiers;
const constructionGraph_1 = require("./constructionGraph");
const graphBuilder_1 = require("./graphBuilder");
exports.MIRROR_AXES = ['none', 'x', 'y', 'z'];
exports.MAX_SUBDIVISION = 3;
/** Subdivision stops early rather than build more faces than this. */
exports.SUBDIVISION_FACE_BUDGET = 250_000;
exports.NO_MODIFIERS = { mirror: 'none', subdivide: 0 };
function cleanModifiers(raw) {
    const mirror = exports.MIRROR_AXES.includes(raw?.mirror) ? raw.mirror : 'none';
    const levels = typeof raw?.subdivide === 'number' && Number.isFinite(raw.subdivide) ? Math.round(raw.subdivide) : 0;
    return { mirror, subdivide: Math.min(exports.MAX_SUBDIVISION, Math.max(0, levels)) };
}
function hasModifiers(modifiers) {
    return !!modifiers && (modifiers.mirror !== 'none' || modifiers.subdivide > 0);
}
const AXIS_INDEX = { x: 0, y: 1, z: 2 };
const PLANE_EPSILON = 1e-6;
/**
 * Mirrors a graph across a local axis plane. Vertices on the plane are shared, so the
 * halves join; faces lying flat in the plane are dropped because they would end up
 * inside the joined shape.
 */
function mirrorGraph(graph, axis) {
    const index = AXIS_INDEX[axis];
    const builder = new graphBuilder_1.GraphBuilder();
    const original = new Map();
    const copy = new Map();
    const onPlane = (id) => Math.abs(graph.vertices[id].position[index]) <= PLANE_EPSILON;
    for (const vertex of Object.values(graph.vertices)) {
        const position = [...vertex.position];
        if (onPlane(vertex.id))
            position[index] = 0;
        const id = builder.vertex(position);
        original.set(vertex.id, id);
        if (onPlane(vertex.id)) {
            copy.set(vertex.id, id);
        }
        else {
            const flipped = [...position];
            flipped[index] = -flipped[index];
            copy.set(vertex.id, builder.vertex(flipped));
        }
    }
    const topology = (0, constructionGraph_1.getTopology)(graph);
    for (const face of Object.values(graph.faces)) {
        if (face.vertexIds.every(onPlane))
            continue;
        builder.face(face.vertexIds.map((id) => original.get(id)));
        builder.face([...face.vertexIds].reverse().map((id) => copy.get(id)));
    }
    // Lines that bound no face (wire edges) are copied too.
    for (const edge of Object.values(graph.edges)) {
        if (topology.facesByEdge.get(edge.id)?.length)
            continue;
        builder.edge(original.get(edge.a), original.get(edge.b));
        builder.edge(copy.get(edge.a), copy.get(edge.b));
    }
    return builder.build();
}
function average(points) {
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
function subdivideOnce(graph) {
    const faces = Object.values(graph.faces);
    if (faces.length === 0)
        return graph;
    const topology = (0, constructionGraph_1.getTopology)(graph);
    const pos = (id) => graph.vertices[id].position;
    const facePoint = new Map();
    for (const face of faces)
        facePoint.set(face.id, average(face.vertexIds.map(pos)));
    const edgePoint = new Map();
    const edgeIdOf = (a, b) => topology.edgeByPair.get((0, constructionGraph_1.pairKey)(a, b)) ?? null;
    for (const edge of Object.values(graph.edges)) {
        const users = topology.facesByEdge.get(edge.id) ?? [];
        if (users.length === 0)
            continue;
        const mid = average([pos(edge.a), pos(edge.b)]);
        edgePoint.set(edge.id, users.length === 2 ? average([pos(edge.a), pos(edge.b), facePoint.get(users[0]), facePoint.get(users[1])]) : mid);
    }
    const vertexPoint = new Map();
    for (const vertex of Object.values(graph.vertices)) {
        const adjacentFaces = topology.facesByVertex.get(vertex.id) ?? [];
        if (adjacentFaces.length === 0)
            continue;
        const edges = (topology.edgesByVertex.get(vertex.id) ?? []).filter((id) => (topology.facesByEdge.get(id)?.length ?? 0) > 0);
        const boundary = edges.filter((id) => topology.facesByEdge.get(id).length === 1);
        const nonManifold = edges.some((id) => topology.facesByEdge.get(id).length > 2);
        const p = vertex.position;
        if (nonManifold) {
            vertexPoint.set(vertex.id, p);
        }
        else if (boundary.length > 0) {
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
        }
        else {
            const n = edges.length;
            const f = average(adjacentFaces.map((id) => facePoint.get(id)));
            const r = average(edges.map((id) => {
                const e = graph.edges[id];
                return average([pos(e.a), pos(e.b)]);
            }));
            vertexPoint.set(vertex.id, [(f[0] + 2 * r[0] + (n - 3) * p[0]) / n, (f[1] + 2 * r[1] + (n - 3) * p[1]) / n, (f[2] + 2 * r[2] + (n - 3) * p[2]) / n]);
        }
    }
    const builder = new graphBuilder_1.GraphBuilder();
    const vertexIds = new Map();
    const edgeIds = new Map();
    const faceIds = new Map();
    for (const [id, p] of vertexPoint)
        vertexIds.set(id, builder.vertex(p));
    for (const [id, p] of edgePoint)
        edgeIds.set(id, builder.vertex(p));
    for (const [id, p] of facePoint)
        faceIds.set(id, builder.vertex(p));
    for (const face of faces) {
        const loop = face.vertexIds;
        const k = loop.length;
        for (let i = 0; i < k; i++) {
            const previous = loop[(i - 1 + k) % k];
            const current = loop[i];
            const next = loop[(i + 1) % k];
            const eNext = edgeIdOf(current, next);
            const ePrevious = edgeIdOf(previous, current);
            if (!eNext || !ePrevious)
                continue;
            builder.face([vertexIds.get(current), edgeIds.get(eNext), faceIds.get(face.id), edgeIds.get(ePrevious)]);
        }
    }
    return builder.build();
}
function subdivide(graph, levels) {
    let current = graph;
    for (let level = 0; level < levels; level++) {
        const faceCount = Object.values(current.faces).reduce((sum, face) => sum + face.vertexIds.length, 0);
        if (faceCount > exports.SUBDIVISION_FACE_BUDGET)
            break;
        current = subdivideOnce(current);
    }
    return current;
}
const cache = new WeakMap();
/** The graph an object shows after its modifiers. Cached per source graph and settings. */
function applyModifiers(graph, modifiers) {
    if (!modifiers || !hasModifiers(modifiers))
        return graph;
    const key = `${modifiers.mirror}|${modifiers.subdivide}`;
    let byKey = cache.get(graph);
    if (!byKey) {
        byKey = new Map();
        cache.set(graph, byKey);
    }
    const cached = byKey.get(key);
    if (cached)
        return cached;
    let result = graph;
    if (modifiers.mirror !== 'none')
        result = mirrorGraph(result, modifiers.mirror);
    if (modifiers.subdivide > 0)
        result = subdivide(result, modifiers.subdivide);
    byKey.set(key, result);
    return result;
}
