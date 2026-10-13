"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.MAX_REFERENCE_CHARS = void 0;
exports.createReference = createReference;
exports.readReferences = readReferences;
const vec3_1 = require("../math/vec3");
const sketch_1 = require("../sketch/sketch");
/** Pictures larger than this (as text) are refused, to keep project files sensible. */
exports.MAX_REFERENCE_CHARS = 24 * 1024 * 1024;
function createReference(options) {
    const width = options.width ?? 4.5;
    return {
        id: options.id,
        plane: options.plane,
        name: options.name.slice(0, 200),
        src: options.src,
        aspect: options.aspect > 0 && Number.isFinite(options.aspect) ? options.aspect : 1,
        x: 0,
        y: (width * (options.aspect > 0 ? options.aspect : 1)) / 2,
        width,
        opacity: 0.5,
        flip: false,
        visible: true,
    };
}
function isRecord(value) {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}
/** Reads the reference pictures of a project. Bad entries are skipped with a warning. */
function readReferences(raw, warnings) {
    if (raw === undefined)
        return [];
    if (!Array.isArray(raw)) {
        warnings.push('The reference pictures list was invalid and was skipped.');
        return [];
    }
    const out = [];
    const ids = new Set();
    raw.forEach((item, i) => {
        const ok = isRecord(item) &&
            typeof item.id === 'string' &&
            item.id.length > 0 &&
            item.id.length <= 64 &&
            !ids.has(item.id) &&
            sketch_1.SKETCH_PLANES.includes(item.plane) &&
            typeof item.src === 'string' &&
            /^data:image\/(png|jpeg|webp|gif|svg\+xml);/.test(item.src) &&
            item.src.length <= exports.MAX_REFERENCE_CHARS &&
            [item.aspect, item.x, item.y, item.width, item.opacity].every(vec3_1.isFiniteNumber) &&
            item.aspect > 0 &&
            item.width > 0;
        if (!ok) {
            warnings.push(`Reference picture ${i + 1} was invalid and was skipped.`);
            return;
        }
        const record = item;
        ids.add(record.id);
        out.push({
            id: record.id,
            plane: record.plane,
            name: typeof record.name === 'string' ? record.name.slice(0, 200) : 'Reference',
            src: record.src,
            aspect: record.aspect,
            x: record.x,
            y: record.y,
            width: record.width,
            opacity: Math.min(1, Math.max(0, record.opacity)),
            flip: record.flip === true,
            visible: record.visible !== false,
        });
    });
    return out;
}
