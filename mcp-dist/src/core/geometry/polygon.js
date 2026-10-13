"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.PLANARITY_TOLERANCE = void 0;
exports.newellNormal = newellNormal;
exports.planeBasis = planeBasis;
exports.projectToPlane = projectToPlane;
exports.isSelfIntersecting2d = isSelfIntersecting2d;
exports.analyzePolygon = analyzePolygon;
exports.pointInPolygon2d = pointInPolygon2d;
exports.triangulatePolygon = triangulatePolygon;
const vec3_1 = require("../math/vec3");
/** Relative tolerance used for planarity, scaled by the polygon's size. */
exports.PLANARITY_TOLERANCE = 1e-5;
function newellNormal(points) {
    let nx = 0;
    let ny = 0;
    let nz = 0;
    for (let i = 0; i < points.length; i++) {
        const [xi, yi, zi] = points[i];
        const [xj, yj, zj] = points[(i + 1) % points.length];
        nx += (yi - yj) * (zi + zj);
        ny += (zi - zj) * (xi + xj);
        nz += (xi - xj) * (yi + yj);
    }
    return [nx, ny, nz];
}
function boundingDiagonal(points) {
    const min = [Infinity, Infinity, Infinity];
    const max = [-Infinity, -Infinity, -Infinity];
    for (const p of points) {
        for (let k = 0; k < 3; k++) {
            min[k] = Math.min(min[k], p[k]);
            max[k] = Math.max(max[k], p[k]);
        }
    }
    return points.length ? (0, vec3_1.length)((0, vec3_1.sub)(max, min)) : 0;
}
/** Builds a right-handed 2D basis (u, v) on the plane with normal n, so u × v = n. */
function planeBasis(n) {
    const helper = Math.abs(n[1]) < 0.9 ? [0, 1, 0] : [1, 0, 0];
    const u = (0, vec3_1.normalize)((0, vec3_1.cross)(helper, n));
    const v = (0, vec3_1.cross)(n, u);
    return { u, v };
}
function projectToPlane(points, normal) {
    const { u, v } = planeBasis(normal);
    return points.map((p) => [(0, vec3_1.dot)(p, u), (0, vec3_1.dot)(p, v)]);
}
function orient2d(a, b, c) {
    return (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
}
function onSegment(a, b, p, eps) {
    return (Math.min(a[0], b[0]) - eps <= p[0] &&
        p[0] <= Math.max(a[0], b[0]) + eps &&
        Math.min(a[1], b[1]) - eps <= p[1] &&
        p[1] <= Math.max(a[1], b[1]) + eps);
}
function segmentsIntersect(p1, p2, p3, p4, eps) {
    const d1 = orient2d(p3, p4, p1);
    const d2 = orient2d(p3, p4, p2);
    const d3 = orient2d(p1, p2, p3);
    const d4 = orient2d(p1, p2, p4);
    if (((d1 > eps && d2 < -eps) || (d1 < -eps && d2 > eps)) && ((d3 > eps && d4 < -eps) || (d3 < -eps && d4 > eps))) {
        return true;
    }
    if (Math.abs(d1) <= eps && onSegment(p3, p4, p1, eps))
        return true;
    if (Math.abs(d2) <= eps && onSegment(p3, p4, p2, eps))
        return true;
    if (Math.abs(d3) <= eps && onSegment(p1, p2, p3, eps))
        return true;
    if (Math.abs(d4) <= eps && onSegment(p1, p2, p4, eps))
        return true;
    return false;
}
function isSelfIntersecting2d(points, size) {
    const n = points.length;
    if (n < 4)
        return false;
    const eps = Math.max(1e-12, (size * 1e-9) ** 2);
    for (let i = 0; i < n; i++) {
        const a1 = points[i];
        const a2 = points[(i + 1) % n];
        for (let j = i + 1; j < n; j++) {
            // Skip the segment itself and its neighbours, which share an endpoint.
            if (j === i || (j + 1) % n === i || (i + 1) % n === j)
                continue;
            if (segmentsIntersect(a1, a2, points[j], points[(j + 1) % n], eps))
                return true;
        }
    }
    return false;
}
function analyzePolygon(points) {
    const raw = newellNormal(points);
    const rawLength = (0, vec3_1.length)(raw);
    const area = rawLength / 2;
    const size = boundingDiagonal(points);
    let centroid = [0, 0, 0];
    for (const p of points)
        centroid = (0, vec3_1.add)(centroid, p);
    centroid = points.length ? (0, vec3_1.scale)(centroid, 1 / points.length) : centroid;
    const areaEpsilon = Math.max(1e-14, (size * 1e-7) ** 2);
    const degenerate = points.length < 3 || area <= areaEpsilon;
    const normal = degenerate ? [0, 0, 0] : (0, vec3_1.scale)(raw, 1 / rawLength);
    let maxPlaneDistance = 0;
    if (!degenerate) {
        for (const p of points) {
            maxPlaneDistance = Math.max(maxPlaneDistance, Math.abs((0, vec3_1.dot)((0, vec3_1.sub)(p, centroid), normal)));
        }
    }
    const planar = !degenerate && maxPlaneDistance <= Math.max(1e-9, exports.PLANARITY_TOLERANCE * size);
    const selfIntersecting = !degenerate && isSelfIntersecting2d(projectToPlane(points, normal), size);
    return { normal, area, centroid, size, maxPlaneDistance, planar, degenerate, selfIntersecting };
}
function pointInPolygon2d(point, polygon) {
    let inside = false;
    for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
        const [xi, yi] = polygon[i];
        const [xj, yj] = polygon[j];
        const crosses = yi > point[1] !== yj > point[1] && point[0] < ((xj - xi) * (point[1] - yi)) / (yj - yi) + xi;
        if (crosses)
            inside = !inside;
    }
    return inside;
}
function pointInTriangle(p, a, b, c) {
    const d1 = orient2d(a, b, p);
    const d2 = orient2d(b, c, p);
    const d3 = orient2d(c, a, p);
    return d1 >= 0 && d2 >= 0 && d3 >= 0;
}
/**
 * Triangulates a simple polygon by ear clipping on its best-fit plane.
 * Returns index triples in the polygon's own winding, so triangle normals
 * match the face normal. Falls back to a fan if the outline is degenerate.
 */
function triangulatePolygon(points) {
    const n = points.length;
    if (n < 3)
        return [];
    if (n === 3)
        return [0, 1, 2];
    const normal = (0, vec3_1.normalize)(newellNormal(points));
    if ((0, vec3_1.length)(normal) === 0)
        return fan(n);
    const p2 = projectToPlane(points, normal);
    const size = boundingDiagonal(points);
    const eps = Math.max(1e-14, (size * 1e-9) ** 2);
    const remaining = Array.from({ length: n }, (_, i) => i);
    const triangles = [];
    let guard = 0;
    while (remaining.length > 3 && guard++ < n * n) {
        let clipped = false;
        for (let i = 0; i < remaining.length; i++) {
            const ia = remaining[(i - 1 + remaining.length) % remaining.length];
            const ib = remaining[i];
            const ic = remaining[(i + 1) % remaining.length];
            if (orient2d(p2[ia], p2[ib], p2[ic]) <= eps)
                continue;
            let blocked = false;
            for (const k of remaining) {
                if (k === ia || k === ib || k === ic)
                    continue;
                if (pointInTriangle(p2[k], p2[ia], p2[ib], p2[ic])) {
                    blocked = true;
                    break;
                }
            }
            if (blocked)
                continue;
            triangles.push(ia, ib, ic);
            remaining.splice(i, 1);
            clipped = true;
            break;
        }
        if (!clipped)
            break;
    }
    if (remaining.length === 3) {
        triangles.push(remaining[0], remaining[1], remaining[2]);
    }
    else if (remaining.length > 3) {
        for (let i = 1; i < remaining.length - 1; i++)
            triangles.push(remaining[0], remaining[i], remaining[i + 1]);
    }
    return triangles;
}
function fan(n) {
    const out = [];
    for (let i = 1; i < n - 1; i++)
        out.push(0, i, i + 1);
    return out;
}
