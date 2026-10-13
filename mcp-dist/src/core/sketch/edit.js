"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.ALIGN_EDGES = void 0;
exports.mapPoints = mapPoints;
exports.pointsBounds = pointsBounds;
exports.pointsCentre = pointsCentre;
exports.rotatePoints = rotatePoints;
exports.scalePoints = scalePoints;
exports.flipPoints = flipPoints;
exports.alignPoints = alignPoints;
exports.distributePoints = distributePoints;
exports.copyFragment = copyFragment;
exports.pasteFragment = pasteFragment;
exports.duplicatePoints = duplicatePoints;
exports.isSketchFragment = isSketchFragment;
exports.polarPoint = polarPoint;
exports.lineLength = lineLength;
exports.lineAngle = lineAngle;
exports.setLineLength = setLineLength;
exports.setLineAngle = setLineAngle;
exports.lineAngleFromAnchor = lineAngleFromAnchor;
exports.allPointIds = allPointIds;
const vec3_1 = require("../math/vec3");
const sketch_1 = require("./sketch");
/** Positions are kept to the micrometre so repeated edits do not collect float noise. */
const clean = (value) => (0, vec3_1.roundTo)(value, 6);
function existing(sketch, ids) {
    const seen = new Set();
    const out = [];
    for (const id of ids) {
        const p = sketch.points[id];
        if (p && !seen.has(id)) {
            seen.add(id);
            out.push(p);
        }
    }
    return out;
}
/** Moves each named dot to where `map` says. Unknown ids are ignored. */
function mapPoints(sketch, ids, map) {
    const picked = existing(sketch, ids);
    if (picked.length === 0)
        return sketch;
    const points = { ...sketch.points };
    let changed = false;
    for (const p of picked) {
        const [x, y] = map(p.x, p.y);
        if (!(0, vec3_1.isFiniteNumber)(x) || !(0, vec3_1.isFiniteNumber)(y))
            throw new sketch_1.SketchError('That edit would move a dot to an invalid position.');
        const nx = clean(x);
        const ny = clean(y);
        if (nx === p.x && ny === p.y)
            continue;
        points[p.id] = { ...p, x: nx, y: ny };
        changed = true;
    }
    return changed ? { ...sketch, points } : sketch;
}
/** The box around some dots as [minX, minY, maxX, maxY], or null when none exist. */
function pointsBounds(sketch, ids) {
    const picked = existing(sketch, ids);
    if (picked.length === 0)
        return null;
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    for (const p of picked) {
        minX = Math.min(minX, p.x);
        minY = Math.min(minY, p.y);
        maxX = Math.max(maxX, p.x);
        maxY = Math.max(maxY, p.y);
    }
    return [minX, minY, maxX, maxY];
}
/** The middle of the box around some dots: the pivot for rotate, flip and scale. */
function pointsCentre(sketch, ids) {
    const box = pointsBounds(sketch, ids);
    return box ? [(box[0] + box[2]) / 2, (box[1] + box[3]) / 2] : null;
}
/** Rotates dots counter-clockwise by `degrees` around `centre` (default: their middle). */
function rotatePoints(sketch, ids, degrees, centre) {
    if (!(0, vec3_1.isFiniteNumber)(degrees))
        throw new sketch_1.SketchError('A rotation needs an angle in degrees.');
    const pivot = centre ?? pointsCentre(sketch, ids);
    if (!pivot)
        return sketch;
    // Quarter turns are exact, so a square turned 90° stays on the grid.
    const turns = degrees / 90;
    let cos;
    let sin;
    if (Number.isInteger(turns)) {
        const q = ((turns % 4) + 4) % 4;
        cos = [1, 0, -1, 0][q];
        sin = [0, 1, 0, -1][q];
    }
    else {
        const rad = (degrees * Math.PI) / 180;
        cos = Math.cos(rad);
        sin = Math.sin(rad);
    }
    const [cx, cy] = pivot;
    return mapPoints(sketch, ids, (x, y) => [cx + (x - cx) * cos - (y - cy) * sin, cy + (x - cx) * sin + (y - cy) * cos]);
}
/** Scales dots around `centre` (default: their middle). 1 keeps the size, 2 doubles it. */
function scalePoints(sketch, ids, sx, sy = sx, centre) {
    if (!(0, vec3_1.isFiniteNumber)(sx) || !(0, vec3_1.isFiniteNumber)(sy) || sx === 0 || sy === 0)
        throw new sketch_1.SketchError('A scale needs factors other than zero.');
    const pivot = centre ?? pointsCentre(sketch, ids);
    if (!pivot)
        return sketch;
    const [cx, cy] = pivot;
    return mapPoints(sketch, ids, (x, y) => [cx + (x - cx) * sx, cy + (y - cy) * sy]);
}
/** Flips dots left-right (horizontal) or upside down (vertical) around `centre` (default: their middle). */
function flipPoints(sketch, ids, direction, centre) {
    return direction === 'horizontal' ? scalePoints(sketch, ids, -1, 1, centre) : scalePoints(sketch, ids, 1, -1, centre);
}
exports.ALIGN_EDGES = ['left', 'centre', 'right', 'top', 'middle', 'bottom'];
/** Lines dots up on one edge or centre line of the box around them. */
function alignPoints(sketch, ids, edge) {
    const box = pointsBounds(sketch, ids);
    if (!box)
        return sketch;
    const [minX, minY, maxX, maxY] = box;
    switch (edge) {
        case 'left':
            return mapPoints(sketch, ids, (_, y) => [minX, y]);
        case 'centre':
            return mapPoints(sketch, ids, (_, y) => [(minX + maxX) / 2, y]);
        case 'right':
            return mapPoints(sketch, ids, (_, y) => [maxX, y]);
        case 'top':
            return mapPoints(sketch, ids, (x) => [x, maxY]);
        case 'middle':
            return mapPoints(sketch, ids, (x) => [x, (minY + maxY) / 2]);
        case 'bottom':
            return mapPoints(sketch, ids, (x) => [x, minY]);
    }
}
/** Spaces three or more dots evenly between the outermost two, keeping their order. */
function distributePoints(sketch, ids, direction) {
    const picked = existing(sketch, ids);
    if (picked.length < 3)
        return sketch;
    const axis = direction === 'horizontal' ? 'x' : 'y';
    const sorted = [...picked].sort((a, b) => a[axis] - b[axis] || (a.id < b.id ? -1 : 1));
    const first = sorted[0][axis];
    const step = (sorted[sorted.length - 1][axis] - first) / (sorted.length - 1);
    const target = new Map(sorted.map((p, i) => [p.id, first + step * i]));
    const points = { ...sketch.points };
    let changed = false;
    for (const p of sorted) {
        const value = clean(target.get(p.id));
        if (value === p[axis])
            continue;
        points[p.id] = { ...p, [axis]: value };
        changed = true;
    }
    return changed ? { ...sketch, points } : sketch;
}
/** Copies dots and the lines that join two of them. Returns null when no dot exists. */
function copyFragment(sketch, ids) {
    const picked = existing(sketch, ids);
    if (picked.length === 0)
        return null;
    const [cx, cy] = pointsCentre(sketch, ids);
    const index = new Map(picked.map((p, i) => [p.id, i]));
    const lines = [];
    for (const line of Object.values(sketch.lines)) {
        const a = index.get(line.a);
        const b = index.get(line.b);
        if (a !== undefined && b !== undefined)
            lines.push([a, b]);
    }
    return {
        plane: sketch.plane,
        points: picked.map((p) => (p.smooth ? { x: clean(p.x - cx), y: clean(p.y - cy), smooth: true } : { x: clean(p.x - cx), y: clean(p.y - cy) })),
        lines,
    };
}
/** Adds a copied fragment with its middle at `at`. Returns the new dot and line ids. */
function pasteFragment(sketch, fragment, at) {
    let next = sketch;
    const pointIds = [];
    for (const p of fragment.points) {
        const added = (0, sketch_1.addPoint)(next, clean(at[0] + p.x), clean(at[1] + p.y), !!p.smooth);
        next = added.sketch;
        pointIds.push(added.pointId);
    }
    const lineIds = [];
    for (const [a, b] of fragment.lines) {
        if (!pointIds[a] || !pointIds[b] || a === b)
            continue;
        const joined = (0, sketch_1.addLine)(next, pointIds[a], pointIds[b]);
        next = joined.sketch;
        if (joined.created)
            lineIds.push(joined.lineId);
    }
    return { sketch: next, pointIds, lineIds };
}
/** Copies dots (and their lines) and pastes them shifted by (dx, dy). */
function duplicatePoints(sketch, ids, dx, dy) {
    const fragment = copyFragment(sketch, ids);
    if (!fragment)
        return { sketch, pointIds: [], lineIds: [] };
    const [cx, cy] = pointsCentre(sketch, ids);
    return pasteFragment(sketch, fragment, [cx + dx, cy + dy]);
}
/** Checks data from a clipboard or a file before it is pasted. */
function isSketchFragment(value) {
    if (typeof value !== 'object' || value === null)
        return false;
    const f = value;
    if (f.plane !== 'front' && f.plane !== 'side' && f.plane !== 'top')
        return false;
    if (!Array.isArray(f.points) || !Array.isArray(f.lines) || f.points.length === 0 || f.points.length > 20_000)
        return false;
    const pointsOk = f.points.every((p) => typeof p === 'object' && p !== null && (0, vec3_1.isFiniteNumber)(p.x) && (0, vec3_1.isFiniteNumber)(p.y));
    const count = f.points.length;
    const linesOk = f.lines.every((l) => Array.isArray(l) && l.length === 2 && l.every((i) => Number.isInteger(i) && i >= 0 && i < count));
    return pointsOk && linesOk;
}
// -- Exact sizes --------------------------------------------------------------------------
/** A point `length` away from `from`, at `degrees` counter-clockwise from the board's x axis. */
function polarPoint(from, length, degrees) {
    const rad = (degrees * Math.PI) / 180;
    // Exact on the axes, so a typed 90° line is truly vertical.
    const quarter = degrees / 90;
    const cos = Number.isInteger(quarter) ? [1, 0, -1, 0][((quarter % 4) + 4) % 4] : Math.cos(rad);
    const sin = Number.isInteger(quarter) ? [0, 1, 0, -1][((quarter % 4) + 4) % 4] : Math.sin(rad);
    return [clean(from[0] + length * cos), clean(from[1] + length * sin)];
}
function lineEnds(sketch, lineId) {
    const line = sketch.lines[lineId];
    const a = line ? sketch.points[line.a] : undefined;
    const b = line ? sketch.points[line.b] : undefined;
    if (!line || !a || !b)
        throw new sketch_1.SketchError(`Line ${lineId} does not exist.`);
    return [a, b];
}
/** Straight distance between a line's two dots, in metres. */
function lineLength(sketch, lineId) {
    const [a, b] = lineEnds(sketch, lineId);
    return Math.hypot(b.x - a.x, b.y - a.y);
}
/** Direction from a line's first dot to its second, in degrees counter-clockwise from the x axis (−180 to 180). */
function lineAngle(sketch, lineId) {
    const [a, b] = lineEnds(sketch, lineId);
    return (0, vec3_1.roundTo)((Math.atan2(b.y - a.y, b.x - a.x) * 180) / Math.PI, 6);
}
/**
 * The dot that stays put: the named end, or with 'auto' the end with more lines on it
 * (it is more tied into the drawing), or the first dot on a tie.
 */
function fixedEnd(sketch, lineId, anchor) {
    const [a, b] = lineEnds(sketch, lineId);
    if (anchor === 'a')
        return { fixed: a, moving: b };
    if (anchor === 'b')
        return { fixed: b, moving: a };
    let degreeA = 0;
    let degreeB = 0;
    for (const line of Object.values(sketch.lines)) {
        if (line.a === a.id || line.b === a.id)
            degreeA++;
        if (line.a === b.id || line.b === b.id)
            degreeB++;
    }
    return degreeB > degreeA ? { fixed: b, moving: a } : { fixed: a, moving: b };
}
/** Makes a line exactly `length` metres long by moving one end along it. */
function setLineLength(sketch, lineId, length, anchor = 'auto') {
    if (!(0, vec3_1.isFiniteNumber)(length) || length <= 0)
        throw new sketch_1.SketchError('A line length must be more than zero.');
    const { fixed, moving } = fixedEnd(sketch, lineId, anchor);
    const current = Math.hypot(moving.x - fixed.x, moving.y - fixed.y);
    const degrees = current === 0 ? 0 : (Math.atan2(moving.y - fixed.y, moving.x - fixed.x) * 180) / Math.PI;
    const [x, y] = polarPoint([fixed.x, fixed.y], length, (0, vec3_1.roundTo)(degrees, 9));
    return mapPoints(sketch, [moving.id], () => [x, y]);
}
/** Turns a line to `degrees` (counter-clockwise from the x axis, measured from the end that stays) keeping its length. */
function setLineAngle(sketch, lineId, degrees, anchor = 'auto') {
    if (!(0, vec3_1.isFiniteNumber)(degrees))
        throw new sketch_1.SketchError('A line angle must be a number of degrees.');
    const { fixed, moving } = fixedEnd(sketch, lineId, anchor);
    const length = Math.hypot(moving.x - fixed.x, moving.y - fixed.y);
    if (length === 0)
        return sketch;
    const [x, y] = polarPoint([fixed.x, fixed.y], length, degrees);
    return mapPoints(sketch, [moving.id], () => [x, y]);
}
/** The angle of a line measured from the end that stays put, so the angle field matches what setLineAngle does. */
function lineAngleFromAnchor(sketch, lineId, anchor = 'auto') {
    const { fixed, moving } = fixedEnd(sketch, lineId, anchor);
    return (0, vec3_1.roundTo)((Math.atan2(moving.y - fixed.y, moving.x - fixed.x) * 180) / Math.PI, 6);
}
/** Every dot id, for select all. */
function allPointIds(sketch) {
    return Object.keys(sketch.points);
}
