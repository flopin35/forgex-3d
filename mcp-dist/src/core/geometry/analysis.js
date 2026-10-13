"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.analyzeGraph = analyzeGraph;
const constructionGraph_1 = require("./constructionGraph");
const orientation_1 = require("./orientation");
const polygon_1 = require("./polygon");
function plural(count, one, many) {
    return `${count} ${count === 1 ? one : many}`;
}
/** Checks a construction graph against the geometry invariants and reports what it finds. */
function analyzeGraph(graph) {
    const counts = (0, constructionGraph_1.graphCounts)(graph);
    const topology = (0, constructionGraph_1.getTopology)(graph);
    const issues = [];
    const loose = Object.keys(graph.vertices).filter((id) => !topology.edgesByVertex.has(id));
    if (loose.length) {
        issues.push({
            severity: 'info',
            code: 'loose-vertex',
            message: `${plural(loose.length, 'vertex is', 'vertices are')} not connected to any edge.`,
            elementIds: loose,
        });
    }
    const wire = [];
    const boundary = [];
    const nonManifold = [];
    for (const edge of Object.values(graph.edges)) {
        const users = topology.facesByEdge.get(edge.id)?.length ?? 0;
        if (users === 0)
            wire.push(edge.id);
        else if (users === 1)
            boundary.push(edge.id);
        else if (users > 2)
            nonManifold.push(edge.id);
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
    const nonPlanar = [];
    const degenerate = [];
    for (const face of Object.values(graph.faces)) {
        const analysis = (0, polygon_1.analyzePolygon)(face.vertexIds.map((id) => graph.vertices[id].position));
        if (analysis.degenerate)
            degenerate.push(face.id);
        else if (!analysis.planar)
            nonPlanar.push(face.id);
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
    const inconsistent = (0, orientation_1.findInconsistentEdges)(graph);
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
