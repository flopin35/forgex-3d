"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.BODY_LIMITS = exports.DEFAULT_BODY = exports.BODY_VIEWS = void 0;
exports.clampBody = clampBody;
exports.createBodyViews = createBodyViews;
exports.viewOutline = viewOutline;
exports.bodyExtents = bodyExtents;
exports.generateBody = generateBody;
const graphBuilder_1 = require("../geometry/graphBuilder");
const orientation_1 = require("../geometry/orientation");
const vec3_1 = require("../math/vec3");
const regions_1 = require("./regions");
const sketch_1 = require("./sketch");
exports.BODY_VIEWS = ['side', 'top', 'front'];
exports.DEFAULT_BODY = { stations: 48, sectionPoints: 40, roundness: 4, symmetric: true, curveSteps: sketch_1.DEFAULT_CURVE_STEPS };
exports.BODY_LIMITS = {
    stations: [4, 200],
    sectionPoints: [8, 160],
    roundness: [1.5, 12],
};
function clampNumber(value, [min, max], fallback, round) {
    const n = (0, vec3_1.isFiniteNumber)(value) ? value : fallback;
    return Math.min(max, Math.max(min, round ? Math.round(n) : n));
}
function clampBody(raw) {
    return {
        stations: clampNumber(raw.stations, exports.BODY_LIMITS.stations, exports.DEFAULT_BODY.stations, true),
        sectionPoints: clampNumber(raw.sectionPoints, exports.BODY_LIMITS.sectionPoints, exports.DEFAULT_BODY.sectionPoints, true),
        roundness: clampNumber(raw.roundness, exports.BODY_LIMITS.roundness, exports.DEFAULT_BODY.roundness, false),
        symmetric: raw.symmetric !== false,
        curveSteps: clampNumber(raw.curveSteps, [sketch_1.MIN_CURVE_STEPS, sketch_1.MAX_CURVE_STEPS], sketch_1.DEFAULT_CURVE_STEPS, true),
    };
}
function createBodyViews() {
    return { side: (0, sketch_1.createSketch)('side'), top: (0, sketch_1.createSketch)('top'), front: (0, sketch_1.createSketch)('front') };
}
/** The outline of a view's largest filled area, in board coordinates, or null when nothing is closed. */
function viewOutline(sketch, mirror, curveSteps) {
    const resolved = (0, regions_1.resolveSketch)(sketch, mirror, curveSteps);
    const regions = (0, regions_1.findRegions)(resolved);
    if (regions.length === 0)
        return null;
    const largest = regions.reduce((best, region) => (region.area > best.area ? region : best));
    return largest.outer.map((id) => resolved.points.get(id));
}
/** Where a line at `value` crosses a polygon: the other coordinate of each crossing, sorted. */
function crossings(polygon, along, value) {
    const other = along === 0 ? 1 : 0;
    const out = [];
    for (let i = 0; i < polygon.length; i++) {
        const a = polygon[i];
        const b = polygon[(i + 1) % polygon.length];
        const lo = Math.min(a[along], b[along]);
        const hi = Math.max(a[along], b[along]);
        if (value < lo || value >= hi || hi === lo)
            continue;
        const t = (value - a[along]) / (b[along] - a[along]);
        out.push(a[other] + t * (b[other] - a[other]));
    }
    return out.sort((m, n) => m - n);
}
function extent(polygon, index) {
    let min = Infinity;
    let max = -Infinity;
    for (const p of polygon) {
        min = Math.min(min, p[index]);
        max = Math.max(max, p[index]);
    }
    return [min, max];
}
/** Resamples a closed polygon to exactly `count` points, keeping its corners when it has fewer. */
function resample(polygon, count) {
    if (polygon.length >= count) {
        const lengths = polygon.map((p, i) => {
            const q = polygon[(i + 1) % polygon.length];
            return Math.hypot(q[0] - p[0], q[1] - p[1]);
        });
        const total = lengths.reduce((s, l) => s + l, 0);
        const out = [];
        let edge = 0;
        let walked = 0;
        for (let k = 0; k < count; k++) {
            const target = (total * k) / count;
            while (edge < polygon.length - 1 && walked + lengths[edge] < target)
                walked += lengths[edge++];
            const p = polygon[edge];
            const q = polygon[(edge + 1) % polygon.length];
            const t = lengths[edge] > 0 ? (target - walked) / lengths[edge] : 0;
            out.push([p[0] + t * (q[0] - p[0]), p[1] + t * (q[1] - p[1])]);
        }
        return out;
    }
    const out = [...polygon];
    while (out.length < count) {
        let longest = 0;
        let best = -1;
        for (let i = 0; i < out.length; i++) {
            const p = out[i];
            const q = out[(i + 1) % out.length];
            const l = Math.hypot(q[0] - p[0], q[1] - p[1]);
            if (l > best) {
                best = l;
                longest = i;
            }
        }
        const p = out[longest];
        const q = out[(longest + 1) % out.length];
        out.splice(longest + 1, 0, [(p[0] + q[0]) / 2, (p[1] + q[1]) / 2]);
    }
    return out;
}
/** The cross-section as [u, v] pairs: u from -1 (left) to 1 (right), v from 0 (bottom) to 1 (top). */
function sectionShape(front, settings) {
    const m = settings.sectionPoints;
    if (front) {
        const [x0, x1] = extent(front, 0);
        const [y0, y1] = extent(front, 1);
        const cx = (x0 + x1) / 2;
        const hw = (x1 - x0) / 2;
        const h = y1 - y0;
        if (hw > 1e-9 && h > 1e-9) {
            // Start at the dot nearest the bottom centre so the seam sits underneath.
            let start = 0;
            let best = Infinity;
            front.forEach(([x, y], i) => {
                const d = Math.hypot((x - cx) / hw, (y - y0) / h);
                if (d < best) {
                    best = d;
                    start = i;
                }
            });
            const rotated = [...front.slice(start), ...front.slice(0, start)];
            return resample(rotated, m).map(([x, y]) => [(x - cx) / hw, (y - y0) / h]);
        }
    }
    const exponent = 2 / settings.roundness;
    return Array.from({ length: m }, (_, k) => {
        // Start at the bottom centre and go round counter-clockwise.
        const angle = -Math.PI / 2 + (2 * Math.PI * k) / m;
        const c = Math.cos(angle);
        const s = Math.sin(angle);
        const u = Math.sign(c) * Math.abs(c) ** exponent;
        const w = Math.sign(s) * Math.abs(s) ** exponent;
        return [u, (w + 1) / 2];
    });
}
/** The outlines of a body's views mapped into object space (+Y up, front faces +Z). */
function outlines(views, settings) {
    const side = viewOutline(views.side, false, settings.curveSteps);
    const top = viewOutline(views.top, settings.symmetric, settings.curveSteps);
    const front = viewOutline(views.front, settings.symmetric, settings.curveSteps);
    return { side, top, front };
}
/** Bounding ranges of each view, used to line the views up on the board. */
function bodyExtents(views, settings) {
    const { side, top, front } = outlines(views, settings);
    const negate = ([a, b]) => [-b, -a];
    return {
        // Side view: board x is -Z, board y is Y.
        side: side ? { z: negate(extent(side, 0)), y: extent(side, 1) } : null,
        // Top view: board x is X, board y is -Z.
        top: top ? { x: extent(top, 0), z: negate(extent(top, 1)) } : null,
        front: front ? { x: extent(front, 0), y: extent(front, 1) } : null,
    };
}
const cache = new WeakMap();
function generateBody(views, settings) {
    const key = `${settings.stations}|${settings.sectionPoints}|${settings.roundness}|${settings.symmetric}|${settings.curveSteps}`;
    let byKey = cache.get(views);
    if (!byKey) {
        byKey = new Map();
        cache.set(views, byKey);
    }
    const cached = byKey.get(key);
    if (cached)
        return cached;
    const result = buildBody(views, settings);
    byKey.set(key, result);
    return result;
}
function buildBody(views, settings) {
    const { side, top, front } = outlines(views, settings);
    const closed = { side: !!side, top: !!top, front: !!front };
    const empty = (message) => ({ graph: new graphBuilder_1.GraphBuilder().build(), stations: 0, closed, message });
    if (!side)
        return empty('Draw the side view as a closed outline (Side tab).');
    if (!top) {
        return empty(settings.symmetric
            ? 'Draw the top view (Top tab): the right half of the outline, from the centre line round to the centre line.'
            : 'Draw the top view as a closed outline (Top tab).');
    }
    // Length ranges in object z: side board x is -z, top board y is -z.
    const [sx0, sx1] = extent(side, 0);
    const [ty0, ty1] = extent(top, 1);
    const z0 = Math.max(-sx1, -ty1);
    const z1 = Math.min(-sx0, -ty0);
    if (!(z1 - z0 > 1e-6))
        return empty('The side and top views do not overlap along the length. Line them up front to back.');
    const section = sectionShape(front, settings);
    const builder = new graphBuilder_1.GraphBuilder();
    const rings = [];
    const n = settings.stations;
    for (let i = 0; i < n; i++) {
        // Slices bunch up towards the nose and tail, where the outline turns fastest.
        const t = (1 - Math.cos((Math.PI * (i + 0.5)) / n)) / 2;
        const z = z1 - t * (z1 - z0);
        const ys = crossings(side, 0, -z);
        const xs = crossings(top, 1, -z);
        if (ys.length < 2 || xs.length < 2)
            continue;
        const yLow = ys[0];
        const yHigh = ys[ys.length - 1];
        const xLow = xs[0];
        const xHigh = xs[xs.length - 1];
        if (yHigh - yLow < 1e-5 || xHigh - xLow < 1e-5)
            continue;
        const cx = (xLow + xHigh) / 2;
        const hw = (xHigh - xLow) / 2;
        rings.push(section.map(([u, v]) => builder.vertex([cx + u * hw, yLow + v * (yHigh - yLow), z])));
    }
    if (rings.length < 2)
        return empty('The outlines are too thin to build a body. Make the side and top views taller and wider.');
    const m = section.length;
    for (let i = 0; i + 1 < rings.length; i++) {
        for (let k = 0; k < m; k++) {
            const k1 = (k + 1) % m;
            builder.face([rings[i][k], rings[i][k1], rings[i + 1][k1], rings[i + 1][k]]);
        }
    }
    builder.face(rings[0]);
    builder.face([...rings[rings.length - 1]].reverse());
    const graph = (0, orientation_1.orientFaces)(builder.build()).graph;
    return { graph, stations: rings.length, closed, message: null };
}
