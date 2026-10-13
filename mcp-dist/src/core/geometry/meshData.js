"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.buildMeshData = buildMeshData;
const vec3_1 = require("../math/vec3");
const polygon_1 = require("./polygon");
const SMOOTH_DOT = Math.cos((25 * Math.PI) / 180);
function edgeKey(a, b) {
    return a < b ? `${a}|${b}` : `${b}|${a}`;
}
/** Rebuilds the full renderable mesh from the editable source. */
function buildMeshData(graph, options = {}) {
    const positions = [];
    const normals = [];
    const edgeFaces = new Map();
    const faces = Object.values(graph.faces);
    // Area-weighted (raw Newell) and unit normal of every face.
    const rawNormals = faces.map((face) => (0, polygon_1.newellNormal)(face.vertexIds.map((id) => graph.vertices[id].position)));
    const unitNormals = rawNormals.map((n) => (0, vec3_1.normalize)(n));
    const smoothCos = options.smoothAngle && options.smoothAngle > 0 ? Math.cos((Math.min(options.smoothAngle, 180) * Math.PI) / 180) : null;
    const facesByVertex = new Map();
    if (smoothCos !== null) {
        faces.forEach((face, i) => {
            for (const id of face.vertexIds) {
                const list = facesByVertex.get(id);
                if (list)
                    list.push(i);
                else
                    facesByVertex.set(id, [i]);
            }
        });
    }
    /** The shading normal of face `fi` at vertex `id`. */
    const cornerNormal = (fi, id) => {
        const own = unitNormals[fi];
        let sum = [0, 0, 0];
        for (const other of facesByVertex.get(id) ?? []) {
            if (other !== fi && (0, vec3_1.dot)(own, unitNormals[other]) < smoothCos)
                continue;
            const r = rawNormals[other];
            sum = [sum[0] + r[0], sum[1] + r[1], sum[2] + r[2]];
        }
        return (0, vec3_1.length)(sum) > 1e-12 ? (0, vec3_1.normalize)(sum) : own;
    };
    for (const [fi, face] of faces.entries()) {
        const points = face.vertexIds.map((id) => graph.vertices[id].position);
        const faceNormal = unitNormals[fi];
        const corners = smoothCos !== null ? face.vertexIds.map((id) => cornerNormal(fi, id)) : null;
        if (options.featureEdgesOnly) {
            face.vertexIds.forEach((id, i) => {
                const key = edgeKey(id, face.vertexIds[(i + 1) % face.vertexIds.length]);
                const list = edgeFaces.get(key);
                if (list)
                    list.push(faceNormal);
                else
                    edgeFaces.set(key, [faceNormal]);
            });
        }
        const triangles = (0, polygon_1.triangulatePolygon)(points);
        for (let t = 0; t < triangles.length; t += 3) {
            const a = points[triangles[t]];
            const b = points[triangles[t + 1]];
            const c = points[triangles[t + 2]];
            const raw = (0, vec3_1.cross)((0, vec3_1.sub)(b, a), (0, vec3_1.sub)(c, a));
            const flatNormal = (0, vec3_1.length)(raw) > 1e-12 ? (0, vec3_1.normalize)(raw) : faceNormal;
            for (let k = 0; k < 3; k++) {
                const p = points[triangles[t + k]];
                const n = corners ? corners[triangles[t + k]] : flatNormal;
                positions.push(p[0], p[1], p[2]);
                normals.push(n[0], n[1], n[2]);
            }
        }
    }
    // Where shading is smooth across an edge, no line is drawn there either.
    const featureDot = smoothCos !== null ? Math.min(SMOOTH_DOT, smoothCos) : SMOOTH_DOT;
    const edgePositions = [];
    for (const edge of Object.values(graph.edges)) {
        if (options.featureEdgesOnly) {
            const adjacent = edgeFaces.get(edgeKey(edge.a, edge.b));
            if (adjacent && adjacent.length === 2 && (0, vec3_1.dot)(adjacent[0], adjacent[1]) > featureDot)
                continue;
        }
        const a = graph.vertices[edge.a].position;
        const b = graph.vertices[edge.b].position;
        edgePositions.push(a[0], a[1], a[2], b[0], b[1], b[2]);
    }
    const vertexIds = Object.keys(graph.vertices);
    const pointPositions = new Float32Array(vertexIds.length * 3);
    vertexIds.forEach((id, i) => pointPositions.set(graph.vertices[id].position, i * 3));
    return {
        positions: new Float32Array(positions),
        normals: new Float32Array(normals),
        edgePositions: new Float32Array(edgePositions),
        pointPositions,
        vertexIds,
        triangleCount: positions.length / 9,
    };
}
