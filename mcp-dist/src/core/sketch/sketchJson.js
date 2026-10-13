"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.viewToJson = viewToJson;
exports.sketchToJson = sketchToJson;
exports.viewFromJson = viewFromJson;
exports.sketchFromJson = sketchFromJson;
const vec3_1 = require("../math/vec3");
const sketch_1 = require("./sketch");
function viewToJson(sketch) {
    return {
        points: Object.values(sketch.points).map((p) => (p.smooth ? { id: p.id, x: p.x, y: p.y, smooth: true } : { id: p.id, x: p.x, y: p.y })),
        lines: Object.values(sketch.lines).map((l) => ({ id: l.id, a: l.a, b: l.b })),
    };
}
function sketchToJson(sketch, shape) {
    return {
        plane: sketch.plane,
        ...viewToJson(sketch),
        shape: { ...shape },
    };
}
function isRecord(value) {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}
function isId(value) {
    return typeof value === 'string' && value.length > 0 && value.length <= 64;
}
function nextCounter(ids, prefix) {
    let max = 0;
    const pattern = new RegExp(`^${prefix}(\\d+)$`);
    for (const id of ids) {
        const match = pattern.exec(id);
        if (match)
            max = Math.max(max, Number(match[1]));
    }
    return max + 1;
}
/** Reads the dots and lines of one drawing. Problems go into `errors`; returns null if there were any. */
function viewFromJson(raw, plane, path, errors) {
    const start = errors.length;
    if (!isRecord(raw) || !Array.isArray(raw.points) || !Array.isArray(raw.lines)) {
        errors.push(`${path} needs points and lines lists.`);
        return null;
    }
    const points = {};
    raw.points.forEach((item, i) => {
        const at = `${path}.points[${i}]`;
        if (!isRecord(item) || !isId(item.id))
            return void errors.push(`${at} needs a text id.`);
        if (points[item.id])
            return void errors.push(`${at}: dot id ${item.id} is used twice.`);
        if (!(0, vec3_1.isFiniteNumber)(item.x) || !(0, vec3_1.isFiniteNumber)(item.y))
            return void errors.push(`${at}: x and y must be finite numbers.`);
        if (item.smooth !== undefined && typeof item.smooth !== 'boolean')
            return void errors.push(`${at}: smooth must be true or false.`);
        points[item.id] = item.smooth ? { id: item.id, x: item.x, y: item.y, smooth: true } : { id: item.id, x: item.x, y: item.y };
    });
    const lines = {};
    const pairs = new Set();
    raw.lines.forEach((item, i) => {
        const at = `${path}.lines[${i}]`;
        if (!isRecord(item) || !isId(item.id))
            return void errors.push(`${at} needs a text id.`);
        if (lines[item.id])
            return void errors.push(`${at}: line id ${item.id} is used twice.`);
        const { a, b } = item;
        if (!isId(a) || !isId(b) || !points[a] || !points[b])
            return void errors.push(`${at}: line ${item.id} must join two existing dots.`);
        if (a === b)
            return void errors.push(`${at}: line ${item.id} joins dot ${a} to itself.`);
        const key = a < b ? `${a}|${b}` : `${b}|${a}`;
        if (pairs.has(key))
            return void errors.push(`${at}: dots ${a} and ${b} are joined twice.`);
        pairs.add(key);
        lines[item.id] = { id: item.id, a, b };
    });
    if (errors.length > start)
        return null;
    return { plane, points, lines, counters: { point: nextCounter(Object.keys(points), 'p'), line: nextCounter(Object.keys(lines), 'l') } };
}
/** Reads a blueprint from file data. Problems go into `errors`; returns null if there were any. */
function sketchFromJson(raw, path, errors) {
    const start = errors.length;
    if (!isRecord(raw)) {
        errors.push(`${path} must describe a blueprint.`);
        return null;
    }
    if (!sketch_1.SKETCH_PLANES.includes(raw.plane))
        errors.push(`${path}.plane must be one of: ${sketch_1.SKETCH_PLANES.join(', ')}.`);
    const sketch = viewFromJson(raw, raw.plane ?? 'front', path, errors);
    const shapeRaw = isRecord(raw.shape) ? raw.shape : {};
    if (!sketch_1.SHAPE_MODES.includes(shapeRaw.mode))
        errors.push(`${path}.shape.mode must be one of: ${sketch_1.SHAPE_MODES.join(', ')}.`);
    if (errors.length > start || !sketch)
        return null;
    return { sketch, shape: (0, sketch_1.clampShape)(shapeRaw) };
}
