"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.SketchError = exports.AXIS_EPSILON = exports.MAX_DEPTH = exports.MAX_SEGMENTS = exports.MIN_SEGMENTS = exports.DEFAULT_SHAPE = exports.MAX_CURVE_STEPS = exports.MIN_CURVE_STEPS = exports.DEFAULT_CURVE_STEPS = exports.REVOLVE_AXES = exports.SHAPE_MODES = exports.SKETCH_PLANES = void 0;
exports.createSketch = createSketch;
exports.findLine = findLine;
exports.addPoint = addPoint;
exports.addLine = addLine;
exports.movePoint = movePoint;
exports.setPointsSmooth = setPointsSmooth;
exports.removePoint = removePoint;
exports.removeLine = removeLine;
exports.setPlane = setPlane;
exports.addPolyline = addPolyline;
exports.rectanglePoints = rectanglePoints;
exports.polygonPoints = polygonPoints;
exports.splitLine = splitLine;
exports.closestOnLine = closestOnLine;
exports.removeItems = removeItems;
exports.translatePoints = translatePoints;
exports.mergePoints = mergePoints;
exports.pointDegree = pointDegree;
exports.linesBetween = linesBetween;
exports.sketchCounts = sketchCounts;
exports.clampShape = clampShape;
const vec3_1 = require("../math/vec3");
exports.SKETCH_PLANES = ['front', 'side', 'top'];
exports.SHAPE_MODES = ['flat', 'extrude', 'revolve'];
exports.REVOLVE_AXES = ['vertical', 'horizontal'];
exports.DEFAULT_CURVE_STEPS = 10;
exports.MIN_CURVE_STEPS = 2;
exports.MAX_CURVE_STEPS = 48;
exports.DEFAULT_SHAPE = { mode: 'extrude', depth: 0.2, segments: 32, mirror: false, axis: 'vertical', curveSteps: exports.DEFAULT_CURVE_STEPS };
exports.MIN_SEGMENTS = 3;
exports.MAX_SEGMENTS = 256;
exports.MAX_DEPTH = 1000;
/** Points closer than this to the axis count as on it (shared by mirror and revolve). */
exports.AXIS_EPSILON = 1e-6;
class SketchError extends Error {
    constructor(message) {
        super(message);
        this.name = 'SketchError';
    }
}
exports.SketchError = SketchError;
function createSketch(plane = 'front') {
    return { plane, points: {}, lines: {}, counters: { point: 1, line: 1 } };
}
function linePairKey(a, b) {
    return a < b ? `${a}\u0000${b}` : `${b}\u0000${a}`;
}
function findLine(sketch, a, b) {
    const key = linePairKey(a, b);
    return Object.values(sketch.lines).find((line) => linePairKey(line.a, line.b) === key);
}
function addPoint(sketch, x, y, smooth = false) {
    if (!(0, vec3_1.isFiniteNumber)(x) || !(0, vec3_1.isFiniteNumber)(y))
        throw new SketchError('A dot needs finite x and y positions.');
    const id = `p${sketch.counters.point}`;
    return {
        pointId: id,
        sketch: {
            ...sketch,
            points: { ...sketch.points, [id]: smooth ? { id, x, y, smooth: true } : { id, x, y } },
            counters: { ...sketch.counters, point: sketch.counters.point + 1 },
        },
    };
}
/** Joins two dots. Joining already-joined dots returns the existing line. */
function addLine(sketch, a, b) {
    if (!sketch.points[a] || !sketch.points[b])
        throw new SketchError('A line must join two existing dots.');
    if (a === b)
        throw new SketchError('A line needs two different dots.');
    const existing = findLine(sketch, a, b);
    if (existing)
        return { sketch, lineId: existing.id, created: false };
    const id = `l${sketch.counters.line}`;
    return {
        lineId: id,
        created: true,
        sketch: {
            ...sketch,
            lines: { ...sketch.lines, [id]: { id, a, b } },
            counters: { ...sketch.counters, line: sketch.counters.line + 1 },
        },
    };
}
function movePoint(sketch, id, x, y) {
    const p = sketch.points[id];
    if (!p)
        throw new SketchError(`Dot ${id} does not exist.`);
    if (!(0, vec3_1.isFiniteNumber)(x) || !(0, vec3_1.isFiniteNumber)(y))
        throw new SketchError('A dot needs finite x and y positions.');
    return { ...sketch, points: { ...sketch.points, [id]: { ...p, x, y } } };
}
/** Makes dots smooth (curved) or sharp (corners). Unknown ids are ignored. */
function setPointsSmooth(sketch, ids, smooth) {
    const points = { ...sketch.points };
    let changed = false;
    for (const id of ids) {
        const p = sketch.points[id];
        if (!p || !!p.smooth === smooth)
            continue;
        points[id] = smooth ? { ...p, smooth: true } : { id: p.id, x: p.x, y: p.y };
        changed = true;
    }
    return changed ? { ...sketch, points } : sketch;
}
/** Removes a dot and every line attached to it. */
function removePoint(sketch, id) {
    if (!sketch.points[id])
        throw new SketchError(`Dot ${id} does not exist.`);
    const points = { ...sketch.points };
    delete points[id];
    const lines = {};
    for (const line of Object.values(sketch.lines))
        if (line.a !== id && line.b !== id)
            lines[line.id] = line;
    return { ...sketch, points, lines };
}
function removeLine(sketch, id) {
    if (!sketch.lines[id])
        throw new SketchError(`Line ${id} does not exist.`);
    const lines = { ...sketch.lines };
    delete lines[id];
    return { ...sketch, lines };
}
function setPlane(sketch, plane) {
    return plane === sketch.plane ? sketch : { ...sketch, plane };
}
/** Adds a chain of dots joined in order (closed joins the last back to the first). */
function addPolyline(sketch, points, closed, smooth = false) {
    let next = sketch;
    const ids = [];
    for (const [i, [x, y]] of points.entries()) {
        const added = addPoint(next, x, y, typeof smooth === 'function' ? smooth(i) : smooth);
        next = added.sketch;
        ids.push(added.pointId);
    }
    for (let i = 0; i + 1 < ids.length; i++)
        next = addLine(next, ids[i], ids[i + 1]).sketch;
    if (closed && ids.length >= 3)
        next = addLine(next, ids[ids.length - 1], ids[0]).sketch;
    return { sketch: next, pointIds: ids };
}
function rectanglePoints(x0, y0, x1, y1) {
    return [
        [x0, y0],
        [x1, y0],
        [x1, y1],
        [x0, y1],
    ];
}
/** Regular polygon (a circle with many sides), starting at the top. */
function polygonPoints(cx, cy, radius, sides) {
    const n = Math.max(3, Math.min(256, Math.round(sides)));
    return Array.from({ length: n }, (_, i) => {
        const angle = Math.PI / 2 + (i * 2 * Math.PI) / n;
        return [cx + radius * Math.cos(angle), cy + radius * Math.sin(angle)];
    });
}
/** Puts a new dot on a line at (x, y), splitting the line in two. */
function splitLine(sketch, lineId, x, y) {
    const line = sketch.lines[lineId];
    if (!line)
        throw new SketchError(`Line ${lineId} does not exist.`);
    // A dot added on a curve stays on the curve.
    const smooth = !!(sketch.points[line.a]?.smooth || sketch.points[line.b]?.smooth);
    const added = addPoint(removeLine(sketch, lineId), x, y, smooth);
    let next = addLine(added.sketch, line.a, added.pointId).sketch;
    next = addLine(next, added.pointId, line.b).sketch;
    return { sketch: next, pointId: added.pointId };
}
/** The point on a line closest to (x, y), kept slightly away from its ends. */
function closestOnLine(sketch, lineId, x, y) {
    const line = sketch.lines[lineId];
    const a = line ? sketch.points[line.a] : undefined;
    const b = line ? sketch.points[line.b] : undefined;
    if (!a || !b)
        throw new SketchError(`Line ${lineId} does not exist.`);
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const lengthSq = dx * dx + dy * dy;
    const t = lengthSq === 0 ? 0.5 : Math.max(0.02, Math.min(0.98, ((x - a.x) * dx + (y - a.y) * dy) / lengthSq));
    return [a.x + t * dx, a.y + t * dy];
}
/** Removes lines and dots (and the lines of removed dots). Unknown ids are ignored. */
function removeItems(sketch, pointIds, lineIds) {
    const dropPoints = new Set(pointIds.filter((id) => sketch.points[id]));
    const dropLines = new Set(lineIds);
    if (dropPoints.size === 0 && ![...dropLines].some((id) => sketch.lines[id]))
        return sketch;
    const points = {};
    for (const p of Object.values(sketch.points))
        if (!dropPoints.has(p.id))
            points[p.id] = p;
    const lines = {};
    for (const line of Object.values(sketch.lines)) {
        if (!dropLines.has(line.id) && !dropPoints.has(line.a) && !dropPoints.has(line.b))
            lines[line.id] = line;
    }
    return { ...sketch, points, lines };
}
/** Moves several dots by the same offset. */
function translatePoints(sketch, ids, dx, dy) {
    if (!(0, vec3_1.isFiniteNumber)(dx) || !(0, vec3_1.isFiniteNumber)(dy))
        throw new SketchError('A move needs finite offsets.');
    const points = { ...sketch.points };
    let moved = false;
    for (const id of ids) {
        const p = sketch.points[id];
        if (!p)
            continue;
        points[id] = { ...p, x: p.x + dx, y: p.y + dy };
        moved = true;
    }
    return moved ? { ...sketch, points } : sketch;
}
/** Joins dot `from` into dot `into`: its lines move over, duplicates and zero-length lines disappear. */
function mergePoints(sketch, from, into) {
    if (!sketch.points[from] || !sketch.points[into])
        throw new SketchError('Both dots must exist to join them.');
    if (from === into)
        return sketch;
    const points = { ...sketch.points };
    delete points[from];
    const lines = {};
    const seen = new Set();
    for (const line of Object.values(sketch.lines)) {
        const a = line.a === from ? into : line.a;
        const b = line.b === from ? into : line.b;
        if (a === b)
            continue;
        const key = linePairKey(a, b);
        if (seen.has(key))
            continue;
        seen.add(key);
        lines[line.id] = a === line.a && b === line.b ? line : { id: line.id, a, b };
    }
    return { ...sketch, points, lines };
}
/** Number of lines attached to a dot. */
function pointDegree(sketch, id) {
    let count = 0;
    for (const line of Object.values(sketch.lines))
        if (line.a === id || line.b === id)
            count++;
    return count;
}
/** Lines whose both dots are in the set. */
function linesBetween(sketch, pointIds) {
    return Object.values(sketch.lines)
        .filter((line) => pointIds.has(line.a) && pointIds.has(line.b))
        .map((line) => line.id);
}
function sketchCounts(sketch) {
    return { points: Object.keys(sketch.points).length, lines: Object.keys(sketch.lines).length };
}
function clampInt(value, min, max, fallback) {
    return Math.min(max, Math.max(min, Math.round((0, vec3_1.isFiniteNumber)(value) ? value : fallback)));
}
/** Fills in missing settings (older files) and keeps every value in range. */
function clampShape(shape) {
    return {
        mode: exports.SHAPE_MODES.includes(shape.mode) ? shape.mode : exports.DEFAULT_SHAPE.mode,
        depth: Math.min(exports.MAX_DEPTH, Math.max(0, (0, vec3_1.isFiniteNumber)(shape.depth) ? shape.depth : exports.DEFAULT_SHAPE.depth)),
        segments: clampInt(shape.segments, exports.MIN_SEGMENTS, exports.MAX_SEGMENTS, exports.DEFAULT_SHAPE.segments),
        mirror: shape.mirror === true,
        axis: exports.REVOLVE_AXES.includes(shape.axis) ? shape.axis : 'vertical',
        curveSteps: clampInt(shape.curveSteps, exports.MIN_CURVE_STEPS, exports.MAX_CURVE_STEPS, exports.DEFAULT_CURVE_STEPS),
    };
}
