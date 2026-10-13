"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.vec3 = vec3;
exports.add = add;
exports.sub = sub;
exports.scale = scale;
exports.dot = dot;
exports.cross = cross;
exports.length = length;
exports.distance = distance;
exports.normalize = normalize;
exports.equals = equals;
exports.isFiniteNumber = isFiniteNumber;
exports.isVec3 = isVec3;
exports.roundTo = roundTo;
exports.cleanVec3 = cleanVec3;
exports.snapScalar = snapScalar;
function vec3(x = 0, y = 0, z = 0) {
    return [x, y, z];
}
function add(a, b) {
    return [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
}
function sub(a, b) {
    return [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
}
function scale(a, s) {
    return [a[0] * s, a[1] * s, a[2] * s];
}
function dot(a, b) {
    return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
}
function cross(a, b) {
    return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
}
function length(a) {
    return Math.hypot(a[0], a[1], a[2]);
}
function distance(a, b) {
    return length(sub(a, b));
}
/** Returns a unit vector, or [0, 0, 0] when the input has no length. */
function normalize(a) {
    const len = length(a);
    return len > 0 ? [a[0] / len, a[1] / len, a[2] / len] : [0, 0, 0];
}
function equals(a, b, epsilon = 1e-9) {
    return Math.abs(a[0] - b[0]) <= epsilon && Math.abs(a[1] - b[1]) <= epsilon && Math.abs(a[2] - b[2]) <= epsilon;
}
function isFiniteNumber(value) {
    return typeof value === 'number' && Number.isFinite(value);
}
function isVec3(value) {
    return Array.isArray(value) && value.length === 3 && value.every(isFiniteNumber);
}
/** Rounds to a fixed number of decimals and removes negative zero. */
function roundTo(value, decimals = 6) {
    const factor = 10 ** decimals;
    const rounded = Math.round(value * factor) / factor;
    return Object.is(rounded, -0) ? 0 : rounded;
}
function cleanVec3(v, decimals = 6) {
    return [roundTo(v[0], decimals), roundTo(v[1], decimals), roundTo(v[2], decimals)];
}
/** Snaps a value to the nearest multiple of `step`. A step of 0 or less leaves it unchanged. */
function snapScalar(value, step) {
    if (!(step > 0))
        return value;
    return roundTo(Math.round(value / step) * step, 9);
}
