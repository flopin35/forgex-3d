"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.mirrorId = mirrorId;
exports.resolveSketch = resolveSketch;
exports.signedArea = signedArea;
exports.pointInPolygon = pointInPolygon;
exports.findRegions = findRegions;
exports.triangulateRegion = triangulateRegion;
const sketch_1 = require("./sketch");
function mirrorId(id) {
    return `${id}~m`;
}
function baseId(id) {
    return id.endsWith('~m') ? id.slice(0, -2) : id;
}
function bezier(p0, p1, p2, p3, t) {
    const u = 1 - t;
    const a = u * u * u;
    const b = 3 * u * u * t;
    const c = 3 * u * t * t;
    const d = t * t * t;
    return [a * p0[0] + b * p1[0] + c * p2[0] + d * p3[0], a * p0[1] + b * p1[1] + c * p2[1] + d * p3[1]];
}
/**
 * Applies the mirror (across x = 0) and bends the lines at smooth dots into curves.
 * Dots on the axis are shared by both halves, so a smooth dot there makes a round
 * nose rather than a point. Curves pass through every dot (Catmull-Rom style): at a
 * smooth dot with two lines, the curve's direction runs from one neighbour to the other.
 */
function resolveSketch(sketch, mirror, curveSteps = sketch_1.DEFAULT_CURVE_STEPS) {
    const points = new Map();
    const onAxis = (x) => Math.abs(x) <= sketch_1.AXIS_EPSILON;
    for (const p of Object.values(sketch.points)) {
        points.set(p.id, [mirror && onAxis(p.x) ? 0 : p.x, p.y]);
        if (mirror && !onAxis(p.x))
            points.set(mirrorId(p.id), [-p.x, p.y]);
    }
    const mirrored = (id) => (mirror && points.has(mirrorId(id)) ? mirrorId(id) : id);
    const seen = new Set();
    const lines = [];
    const push = (a, b, lineId) => {
        if (a === b)
            return;
        const key = a < b ? `${a}|${b}` : `${b}|${a}`;
        if (seen.has(key))
            return;
        seen.add(key);
        lines.push({ a, b, lineId });
    };
    for (const line of Object.values(sketch.lines)) {
        push(line.a, line.b, line.id);
        if (mirror)
            push(mirrored(line.a), mirrored(line.b), null);
    }
    const neighbours = new Map();
    for (const { a, b } of lines) {
        if (!neighbours.has(a))
            neighbours.set(a, []);
        if (!neighbours.has(b))
            neighbours.set(b, []);
        neighbours.get(a).push(b);
        neighbours.get(b).push(a);
    }
    const steps = Math.max(1, Math.round(curveSteps));
    /** Where the curve leaving `from` towards `to` is pulled, or null for a straight start. */
    const handle = (from, to, length) => {
        if (!sketch.points[baseId(from)]?.smooth)
            return null;
        const around = neighbours.get(from) ?? [];
        if (around.length !== 2)
            return null;
        const other = around[0] === to ? around[1] : around[0];
        const pf = points.get(from);
        const pt = points.get(to);
        const po = points.get(other);
        const dx = pt[0] - po[0];
        const dy = pt[1] - po[1];
        const d = Math.hypot(dx, dy);
        if (d < 1e-12)
            return null;
        return [pf[0] + (dx / d) * (length / 3), pf[1] + (dy / d) * (length / 3)];
    };
    const segments = [];
    const paths = [];
    for (const { a, b, lineId } of lines) {
        const pa = points.get(a);
        const pb = points.get(b);
        const length = Math.hypot(pb[0] - pa[0], pb[1] - pa[1]);
        const ha = handle(a, b, length);
        const hb = handle(b, a, length);
        if (!ha && !hb) {
            segments.push([a, b]);
            paths.push({ a, b, points: [pa, pb], lineId });
            continue;
        }
        const c1 = ha ?? pa;
        const c2 = hb ?? pb;
        const path = [pa];
        let previous = a;
        for (let k = 1; k < steps; k++) {
            const id = `${a}>${b}:${k}`;
            const p = bezier(pa, c1, c2, pb, k / steps);
            points.set(id, p);
            path.push(p);
            segments.push([previous, id]);
            previous = id;
        }
        segments.push([previous, b]);
        path.push(pb);
        paths.push({ a, b, points: path, lineId });
    }
    return { points, segments, paths };
}
function signedArea(loop, points) {
    let sum = 0;
    for (let i = 0; i < loop.length; i++) {
        const [x1, y1] = points.get(loop[i]);
        const [x2, y2] = points.get(loop[(i + 1) % loop.length]);
        sum += x1 * y2 - x2 * y1;
    }
    return sum / 2;
}
function pointInPolygon(point, polygon) {
    let inside = false;
    for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
        const [xi, yi] = polygon[i];
        const [xj, yj] = polygon[j];
        if (yi > point[1] !== yj > point[1] && point[0] < ((xj - xi) * (point[1] - yi)) / (yj - yi) + xi)
            inside = !inside;
    }
    return inside;
}
function cross(o, a, b) {
    return (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
}
/** A point strictly inside a counter-clockwise polygon (centre of its first ear). */
function interiorPoint(polygon) {
    const n = polygon.length;
    for (let i = 0; i < n; i++) {
        const a = polygon[(i - 1 + n) % n];
        const b = polygon[i];
        const c = polygon[(i + 1) % n];
        if (cross(a, b, c) <= 1e-14)
            continue;
        const centre = [(a[0] + b[0] + c[0]) / 3, (a[1] + b[1] + c[1]) / 3];
        if (pointInPolygon(centre, polygon))
            return centre;
    }
    return polygon[0];
}
/**
 * Finds the filled regions of a planar line drawing by tracing its faces
 * (each half-edge turns to the next edge clockwise around its end dot).
 * Nesting is even-odd: a shape inside a filled shape is a hole, a shape inside
 * a hole is filled again. Lines that do not close a loop are ignored here.
 */
function findRegions(resolved) {
    const { points } = resolved;
    const neighbours = new Map();
    for (const [a, b] of resolved.segments) {
        if (!points.has(a) || !points.has(b))
            continue;
        const pa = points.get(a);
        const pb = points.get(b);
        if (pa[0] === pb[0] && pa[1] === pb[1])
            continue;
        if (!neighbours.has(a))
            neighbours.set(a, new Set());
        if (!neighbours.has(b))
            neighbours.set(b, new Set());
        neighbours.get(a).add(b);
        neighbours.get(b).add(a);
    }
    // Drop dangling lines: they cannot bound an area.
    const degree = new Map([...neighbours].map(([id, set]) => [id, set.size]));
    const stack = [...degree].filter(([, d]) => d <= 1).map(([id]) => id);
    const removed = new Set();
    while (stack.length) {
        const id = stack.pop();
        if (removed.has(id))
            continue;
        removed.add(id);
        for (const other of neighbours.get(id) ?? []) {
            if (removed.has(other))
                continue;
            const d = (degree.get(other) ?? 0) - 1;
            degree.set(other, d);
            if (d <= 1)
                stack.push(other);
        }
    }
    // Neighbours of each remaining dot sorted counter-clockwise by angle.
    const sorted = new Map();
    for (const [id, set] of neighbours) {
        if (removed.has(id))
            continue;
        const [x, y] = points.get(id);
        const list = [...set].filter((n) => !removed.has(n));
        list.sort((m, n) => {
            const pm = points.get(m);
            const pn = points.get(n);
            return Math.atan2(pm[1] - y, pm[0] - x) - Math.atan2(pn[1] - y, pn[0] - x);
        });
        sorted.set(id, list);
    }
    const visited = new Set();
    const faces = [];
    for (const [start, list] of sorted) {
        for (const next of list) {
            const startKey = `${start}>${next}`;
            if (visited.has(startKey))
                continue;
            const loop = [];
            let a = start;
            let b = next;
            let guard = 0;
            while (!visited.has(`${a}>${b}`) && guard++ < 100_000) {
                visited.add(`${a}>${b}`);
                loop.push(a);
                const around = sorted.get(b);
                const index = around.indexOf(a);
                const c = around[(index - 1 + around.length) % around.length];
                a = b;
                b = c;
            }
            if (loop.length < 3 || new Set(loop).size !== loop.length)
                continue;
            const area = signedArea(loop, points);
            if (area > 1e-12)
                faces.push({ loop, area, polygon: loop.map((id) => points.get(id)) });
        }
    }
    // Even-odd nesting by containment of an interior sample point.
    const samples = faces.map((face) => interiorPoint(face.polygon));
    const depth = faces.map((face, i) => faces.reduce((count, other, j) => count + (j !== i && other.area > face.area && pointInPolygon(samples[i], other.polygon) ? 1 : 0), 0));
    const regions = [];
    faces.forEach((face, i) => {
        if (depth[i] % 2 !== 0)
            return;
        const holes = [];
        faces.forEach((other, j) => {
            if (depth[j] !== depth[i] + 1 || !pointInPolygon(samples[j], face.polygon))
                return;
            holes.push([...other.loop].reverse());
        });
        regions.push({ outer: face.loop, holes, area: face.area - holes.reduce((s, h) => s + Math.abs(signedArea(h, points)), 0) });
    });
    return regions;
}
function segmentsCross(a, b, c, d) {
    const d1 = cross(c, d, a);
    const d2 = cross(c, d, b);
    const d3 = cross(a, b, c);
    const d4 = cross(a, b, d);
    return ((d1 > 1e-12 && d2 < -1e-12) || (d1 < -1e-12 && d2 > 1e-12)) && ((d3 > 1e-12 && d4 < -1e-12) || (d3 < -1e-12 && d4 > 1e-12));
}
/**
 * Triangulates a region with holes: each hole is joined to the outline by a bridge
 * to a visible outline dot, then the single combined outline is ear-clipped.
 * Returns triangles as dot-id triples, counter-clockwise.
 */
function triangulateRegion(region, points) {
    let ring = [...region.outer];
    const holes = [...region.holes].sort((h1, h2) => Math.max(...h2.map((id) => points.get(id)[0])) - Math.max(...h1.map((id) => points.get(id)[0])));
    const allEdges = () => {
        const edges = [];
        const loops = [ring, ...holes];
        for (const loop of loops) {
            for (let i = 0; i < loop.length; i++)
                edges.push([points.get(loop[i]), points.get(loop[(i + 1) % loop.length])]);
        }
        return edges;
    };
    for (const hole of holes) {
        const holeStart = hole.reduce((best, id, i) => (points.get(id)[0] > points.get(hole[best])[0] ? i : best), 0);
        const m = points.get(hole[holeStart]);
        const edges = allEdges();
        let bestIndex = -1;
        let bestDistance = Infinity;
        ring.forEach((id, i) => {
            const p = points.get(id);
            const distance = Math.hypot(p[0] - m[0], p[1] - m[1]);
            if (distance >= bestDistance)
                return;
            if (edges.some(([e1, e2]) => segmentsCross(m, p, e1, e2)))
                return;
            bestDistance = distance;
            bestIndex = i;
        });
        if (bestIndex < 0)
            bestIndex = 0;
        const rotatedHole = [...hole.slice(holeStart), ...hole.slice(0, holeStart)];
        ring = [...ring.slice(0, bestIndex + 1), ...rotatedHole, rotatedHole[0], ...ring.slice(bestIndex)];
    }
    // Ear clipping over positions; the bridge repeats two dots, which is allowed here.
    const remaining = ring.map((_, i) => i);
    const pos = (i) => points.get(ring[i]);
    const triangles = [];
    let guard = 0;
    while (remaining.length > 3 && guard++ < ring.length * ring.length * 2) {
        let clipped = false;
        for (let k = 0; k < remaining.length; k++) {
            const ia = remaining[(k - 1 + remaining.length) % remaining.length];
            const ib = remaining[k];
            const ic = remaining[(k + 1) % remaining.length];
            const a = pos(ia);
            const b = pos(ib);
            const c = pos(ic);
            if (cross(a, b, c) <= 1e-14)
                continue;
            let blocked = false;
            for (const other of remaining) {
                if (other === ia || other === ib || other === ic)
                    continue;
                const p = pos(other);
                if ((p[0] === a[0] && p[1] === a[1]) || (p[0] === b[0] && p[1] === b[1]) || (p[0] === c[0] && p[1] === c[1]))
                    continue;
                if (cross(a, b, p) > 0 && cross(b, c, p) > 0 && cross(c, a, p) > 0) {
                    blocked = true;
                    break;
                }
            }
            if (blocked)
                continue;
            triangles.push([ring[ia], ring[ib], ring[ic]]);
            remaining.splice(k, 1);
            clipped = true;
            break;
        }
        if (!clipped) {
            // Collinear leftovers: drop the flattest corner and carry on.
            remaining.splice(0, 1);
        }
    }
    if (remaining.length === 3)
        triangles.push([ring[remaining[0]], ring[remaining[1]], ring[remaining[2]]]);
    return triangles.filter(([a, b, c]) => a !== b && b !== c && a !== c && cross(points.get(a), points.get(b), points.get(c)) > 1e-14);
}
