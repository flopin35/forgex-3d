"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.findClosedLoops = findClosedLoops;
exports.fillClosedLoops = fillClosedLoops;
const vec3_1 = require("../math/vec3");
const constructionGraph_1 = require("./constructionGraph");
const orientation_1 = require("./orientation");
const polygon_1 = require("./polygon");
/**
 * Finds closed loops that can become faces. A loop qualifies when it:
 * - runs only along edges that border fewer than two faces,
 * - has no chord (no edge joining two non-neighbouring loop vertices),
 * - is flat, encloses area and does not cross itself,
 * - contains no other vertex inside it on the same plane,
 * - is not already a face.
 * These rules find the 6 faces of a cube and the cells of a flat grid,
 * while rejecting the larger loops that run around them.
 */
function findClosedLoops(graph, options = {}) {
    const maxLength = options.maxLength ?? 12;
    const maxSteps = options.maxSteps ?? 200_000;
    const topology = (0, constructionGraph_1.getTopology)(graph);
    const vertexIds = Object.keys(graph.vertices);
    const order = new Map(vertexIds.map((id, i) => [id, i]));
    const adjacency = new Map();
    for (const edge of Object.values(graph.edges)) {
        if ((topology.facesByEdge.get(edge.id)?.length ?? 0) >= 2)
            continue;
        if (!adjacency.has(edge.a))
            adjacency.set(edge.a, []);
        if (!adjacency.has(edge.b))
            adjacency.set(edge.b, []);
        adjacency.get(edge.a).push(edge.b);
        adjacency.get(edge.b).push(edge.a);
    }
    const existing = new Set(Object.values(graph.faces).map((face) => (0, constructionGraph_1.cycleKey)(face.vertexIds)));
    const loops = [];
    const found = new Set();
    let steps = 0;
    let truncated = false;
    for (const start of vertexIds) {
        if (truncated)
            break;
        const startOrder = order.get(start);
        const path = [start];
        const onPath = new Set(path);
        const visit = (current) => {
            for (const next of adjacency.get(current) ?? []) {
                if (truncated)
                    return;
                if (next === start) {
                    // Each cycle is reported once: lowest-ordered vertex first, one direction only.
                    if (path.length >= 3 && order.get(path[1]) < order.get(path[path.length - 1])) {
                        const key = (0, constructionGraph_1.cycleKey)(path);
                        if (!found.has(key) && !existing.has(key) && isFaceCandidate(graph, topology, path)) {
                            found.add(key);
                            loops.push([...path]);
                        }
                    }
                    continue;
                }
                if (onPath.has(next) || order.get(next) <= startOrder || path.length >= maxLength)
                    continue;
                if (++steps > maxSteps) {
                    truncated = true;
                    return;
                }
                path.push(next);
                onPath.add(next);
                visit(next);
                path.pop();
                onPath.delete(next);
            }
        };
        visit(start);
    }
    loops.sort((a, b) => a.length - b.length);
    return { loops, truncated };
}
function isFaceCandidate(graph, topology, loop) {
    const n = loop.length;
    for (let i = 0; i < n; i++) {
        for (let j = i + 2; j < n; j++) {
            if (i === 0 && j === n - 1)
                continue;
            if (topology.edgeByPair.has((0, constructionGraph_1.pairKey)(loop[i], loop[j])))
                return false;
        }
    }
    const points = loop.map((id) => graph.vertices[id].position);
    const analysis = (0, polygon_1.analyzePolygon)(points);
    if (!analysis.planar || analysis.degenerate || analysis.selfIntersecting)
        return false;
    // Reject loops that surround another vertex lying on the same plane.
    const tolerance = Math.max(1e-9, 1e-5 * analysis.size);
    const onLoop = new Set(loop);
    const outline = (0, polygon_1.projectToPlane)(points, analysis.normal);
    for (const vertex of Object.values(graph.vertices)) {
        if (onLoop.has(vertex.id))
            continue;
        if (Math.abs((0, vec3_1.dot)((0, vec3_1.sub)(vertex.position, analysis.centroid), analysis.normal)) > tolerance)
            continue;
        const [projected] = (0, polygon_1.projectToPlane)([vertex.position], analysis.normal);
        if ((0, polygon_1.pointInPolygon2d)(projected, outline))
            return false;
    }
    return true;
}
/** Fills every qualifying closed loop with a face, then orients all faces consistently. */
function fillClosedLoops(graph, options = {}) {
    const { loops, truncated } = findClosedLoops(graph, options);
    let next = graph;
    const faceIds = [];
    let skipped = 0;
    for (const loop of loops) {
        try {
            const result = (0, constructionGraph_1.addFace)(next, loop);
            next = result.graph;
            faceIds.push(result.faceId);
        }
        catch (error) {
            if (error instanceof constructionGraph_1.GeometryError)
                skipped++;
            else
                throw error;
        }
    }
    if (faceIds.length > 0)
        next = (0, orientation_1.orientFaces)(next).graph;
    return { graph: next, faceIds, skipped, truncated };
}
