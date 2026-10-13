"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.loopRunsEdge = loopRunsEdge;
exports.orientFaces = orientFaces;
exports.findInconsistentEdges = findInconsistentEdges;
const vec3_1 = require("../math/vec3");
const constructionGraph_1 = require("./constructionGraph");
const polygon_1 = require("./polygon");
/** True when the loop runs from `a` straight to `b`. */
function loopRunsEdge(loop, a, b) {
    for (let i = 0; i < loop.length; i++) {
        if (loop[i] === a && loop[(i + 1) % loop.length] === b)
            return true;
    }
    return false;
}
/**
 * Makes face windings consistent: faces that share an edge must run it in
 * opposite directions. Closed shells are then turned so normals point outward
 * (positive volume). Open surfaces face the positive direction of their dominant
 * axis, so a floor faces +Y. Faces across non-manifold edges are not propagated.
 */
function orientFaces(graph) {
    const topology = (0, constructionGraph_1.getTopology)(graph);
    const faces = graph.faces;
    const reversed = new Map();
    const visited = new Set();
    const finalFlip = new Set();
    const effectiveLoop = (face) => reversed.get(face.id) ? (0, constructionGraph_1.reverseLoop)(face.vertexIds) : face.vertexIds;
    for (const seed of Object.values(faces)) {
        if (visited.has(seed.id))
            continue;
        const component = [];
        const queue = [seed.id];
        visited.add(seed.id);
        reversed.set(seed.id, false);
        while (queue.length > 0) {
            const faceId = queue.shift();
            component.push(faceId);
            const loop = effectiveLoop(faces[faceId]);
            for (let i = 0; i < loop.length; i++) {
                const a = loop[i];
                const b = loop[(i + 1) % loop.length];
                const edgeId = topology.edgeByPair.get((0, constructionGraph_1.pairKey)(a, b));
                const neighbours = edgeId ? topology.facesByEdge.get(edgeId) ?? [] : [];
                if (neighbours.length !== 2)
                    continue;
                const otherId = neighbours[0] === faceId ? neighbours[1] : neighbours[0];
                if (visited.has(otherId))
                    continue;
                // Consistent winding means the neighbour must run b -> a.
                reversed.set(otherId, loopRunsEdge(faces[otherId].vertexIds, a, b));
                visited.add(otherId);
                queue.push(otherId);
            }
        }
        const closed = component.every((faceId) => {
            const loop = faces[faceId].vertexIds;
            return loop.every((a, i) => {
                const edgeId = topology.edgeByPair.get((0, constructionGraph_1.pairKey)(a, loop[(i + 1) % loop.length]));
                return edgeId !== undefined && (topology.facesByEdge.get(edgeId)?.length ?? 0) === 2;
            });
        });
        let flipComponent = false;
        if (closed) {
            let volume = 0;
            for (const faceId of component) {
                const points = effectiveLoop(faces[faceId]).map((id) => graph.vertices[id].position);
                for (let i = 1; i < points.length - 1; i++)
                    volume += (0, vec3_1.dot)(points[0], (0, vec3_1.cross)(points[i], points[i + 1]));
            }
            flipComponent = volume < 0;
        }
        else {
            let sum = [0, 0, 0];
            for (const faceId of component) {
                sum = (0, vec3_1.add)(sum, (0, polygon_1.newellNormal)(effectiveLoop(faces[faceId]).map((id) => graph.vertices[id].position)));
            }
            const axis = [0, 1, 2].reduce((best, k) => (Math.abs(sum[k]) > Math.abs(sum[best]) ? k : best), 1);
            flipComponent = sum[axis] < 0;
        }
        for (const faceId of component) {
            if (reversed.get(faceId) !== flipComponent)
                finalFlip.add(faceId);
        }
    }
    if (finalFlip.size === 0)
        return { graph, flipped: [] };
    const nextFaces = { ...faces };
    for (const faceId of finalFlip) {
        nextFaces[faceId] = { id: faceId, vertexIds: (0, constructionGraph_1.reverseLoop)(faces[faceId].vertexIds) };
    }
    return { graph: { ...graph, faces: nextFaces }, flipped: [...finalFlip] };
}
/** Edges whose two faces run them in the same direction (inconsistent normals). */
function findInconsistentEdges(graph) {
    const topology = (0, constructionGraph_1.getTopology)(graph);
    const out = [];
    for (const edge of Object.values(graph.edges)) {
        const users = topology.facesByEdge.get(edge.id) ?? [];
        if (users.length !== 2)
            continue;
        const [f1, f2] = users.map((id) => graph.faces[id].vertexIds);
        if (loopRunsEdge(f1, edge.a, edge.b) === loopRunsEdge(f2, edge.a, edge.b))
            out.push(edge.id);
    }
    return out;
}
