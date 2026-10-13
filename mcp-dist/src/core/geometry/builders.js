"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.buildCubeGraph = buildCubeGraph;
exports.buildPlaneGraph = buildPlaneGraph;
const constructionGraph_1 = require("./constructionGraph");
const loops_1 = require("./loops");
/**
 * Builds a cube the way FORGEX models are meant to be built: 8 vertices,
 * 12 connecting edges, then the 6 faces are generated from the closed loops.
 */
function buildCubeGraph(size = 1) {
    const h = size / 2;
    const corners = [
        [-h, -h, -h], [h, -h, -h], [h, -h, h], [-h, -h, h],
        [-h, h, -h], [h, h, -h], [h, h, h], [-h, h, h],
    ];
    let graph = (0, constructionGraph_1.createEmptyGraph)();
    const ids = [];
    for (const corner of corners) {
        const result = (0, constructionGraph_1.addVertex)(graph, corner);
        graph = result.graph;
        ids.push(result.vertexId);
    }
    const links = [
        [0, 1], [1, 2], [2, 3], [3, 0],
        [4, 5], [5, 6], [6, 7], [7, 4],
        [0, 4], [1, 5], [2, 6], [3, 7],
    ];
    for (const [a, b] of links)
        graph = (0, constructionGraph_1.addEdge)(graph, ids[a], ids[b]).graph;
    return (0, loops_1.fillClosedLoops)(graph).graph;
}
/** A flat square on the ground plane (XZ), facing +Y. */
function buildPlaneGraph(size = 1) {
    const h = size / 2;
    const corners = [[-h, 0, -h], [-h, 0, h], [h, 0, h], [h, 0, -h]];
    let graph = (0, constructionGraph_1.createEmptyGraph)();
    const ids = [];
    for (const corner of corners) {
        const result = (0, constructionGraph_1.addVertex)(graph, corner);
        graph = result.graph;
        ids.push(result.vertexId);
    }
    for (let i = 0; i < 4; i++)
        graph = (0, constructionGraph_1.addEdge)(graph, ids[i], ids[(i + 1) % 4]).graph;
    return (0, constructionGraph_1.addFace)(graph, ids).graph;
}
