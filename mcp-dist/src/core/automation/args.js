"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.asArgs = asArgs;
exports.optString = optString;
exports.reqString = reqString;
exports.optBool = optBool;
exports.optInt = optInt;
exports.toVec3 = toVec3;
exports.optVec3 = optVec3;
exports.optEnum = optEnum;
exports.reqEnum = reqEnum;
exports.optColor = optColor;
exports.optArray = optArray;
exports.toIndex = toIndex;
exports.round = round;
exports.roundVec = roundVec;
exports.isNumberArray = isNumberArray;
const vec3_1 = require("../math/vec3");
const toolTypes_1 = require("./toolTypes");
function asArgs(raw) {
    if (raw === undefined || raw === null)
        return {};
    if (typeof raw !== 'object' || Array.isArray(raw))
        throw new toolTypes_1.ToolError('Tool arguments must be a JSON object.');
    return raw;
}
function optString(args, key, maxLength = 200) {
    const value = args[key];
    if (value === undefined || value === null)
        return undefined;
    if (typeof value !== 'string')
        throw new toolTypes_1.ToolError(`${key} must be text.`);
    const trimmed = value.trim();
    if (!trimmed)
        throw new toolTypes_1.ToolError(`${key} must not be empty.`);
    if (trimmed.length > maxLength)
        throw new toolTypes_1.ToolError(`${key} must be at most ${maxLength} characters.`);
    return trimmed;
}
function reqString(args, key, maxLength = 200) {
    const value = optString(args, key, maxLength);
    if (value === undefined)
        throw new toolTypes_1.ToolError(`${key} is required.`);
    return value;
}
function optBool(args, key) {
    const value = args[key];
    if (value === undefined || value === null)
        return undefined;
    if (typeof value !== 'boolean')
        throw new toolTypes_1.ToolError(`${key} must be true or false.`);
    return value;
}
function optInt(args, key, min, max) {
    const value = args[key];
    if (value === undefined || value === null)
        return undefined;
    if (!Number.isInteger(value) || value < min || value > max) {
        throw new toolTypes_1.ToolError(`${key} must be a whole number from ${min} to ${max}.`);
    }
    return value;
}
function toVec3(value, label) {
    if (!(0, vec3_1.isVec3)(value))
        throw new toolTypes_1.ToolError(`${label} must be [x, y, z] with three finite numbers.`);
    return [value[0], value[1], value[2]];
}
function optVec3(args, key) {
    const value = args[key];
    if (value === undefined || value === null)
        return undefined;
    return toVec3(value, key);
}
function optEnum(args, key, allowed) {
    const value = args[key];
    if (value === undefined || value === null)
        return undefined;
    if (typeof value !== 'string' || !allowed.includes(value)) {
        throw new toolTypes_1.ToolError(`${key} must be one of: ${allowed.join(', ')}.`);
    }
    return value;
}
function reqEnum(args, key, allowed) {
    const value = optEnum(args, key, allowed);
    if (value === undefined)
        throw new toolTypes_1.ToolError(`${key} is required (one of: ${allowed.join(', ')}).`);
    return value;
}
/** Accepts #rrggbb, rrggbb or #rgb; returns lowercase #rrggbb. */
function optColor(args, key) {
    const value = args[key];
    if (value === undefined || value === null)
        return undefined;
    if (typeof value === 'string') {
        const hex = value.trim().replace(/^#/, '');
        if (/^[0-9a-fA-F]{6}$/.test(hex))
            return `#${hex.toLowerCase()}`;
        if (/^[0-9a-fA-F]{3}$/.test(hex))
            return `#${[...hex].map((c) => c + c).join('').toLowerCase()}`;
    }
    throw new toolTypes_1.ToolError(`${key} must be a hex colour such as #3d9fe8.`);
}
function optArray(args, key, maxItems) {
    const value = args[key];
    if (value === undefined || value === null)
        return undefined;
    if (!Array.isArray(value))
        throw new toolTypes_1.ToolError(`${key} must be a list.`);
    if (value.length > maxItems)
        throw new toolTypes_1.ToolError(`${key} can hold at most ${maxItems} items per call.`);
    return value;
}
function toIndex(value, count, label) {
    if (!Number.isInteger(value) || value < 0 || value >= count) {
        throw new toolTypes_1.ToolError(`${label} must be a vertex index from 0 to ${count - 1}.`);
    }
    return value;
}
/** Rounds for readable output. */
function round(value, decimals = 4) {
    const factor = 10 ** decimals;
    const result = Math.round(value * factor) / factor;
    return Object.is(result, -0) ? 0 : result;
}
function roundVec(v, decimals = 4) {
    return v.map((n) => round(n, decimals));
}
function isNumberArray(value) {
    return Array.isArray(value) && value.every(vec3_1.isFiniteNumber);
}
