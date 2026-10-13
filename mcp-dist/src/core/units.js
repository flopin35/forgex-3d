"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.GRID_PRESETS = exports.METERS_PER_BLENDER_UNIT = exports.METERS_PER_ROBLOX_STUD = exports.WORLD_CONVENTIONS = void 0;
exports.metersToStuds = metersToStuds;
exports.studsToMeters = studsToMeters;
exports.yUpToZUp = yUpToZUp;
exports.zUpToYUp = zUpToYUp;
/**
 * FORGEX 3D world conventions. Everything inside the editor uses these.
 * Exporters convert at the boundary, never inside the editor.
 */
exports.WORLD_CONVENTIONS = {
    lengthUnit: 'meters',
    upAxis: '+Y',
    forwardAxis: '+Z',
    handedness: 'right',
    rotation: 'degrees-xyz',
};
/** Roblox: 1 stud = 0.28 m (https://create.roblox.com/docs/physics/units). */
exports.METERS_PER_ROBLOX_STUD = 0.28;
/** Blender's default scene uses 1 unit = 1 m. */
exports.METERS_PER_BLENDER_UNIT = 1;
function metersToStuds(meters) {
    return meters / exports.METERS_PER_ROBLOX_STUD;
}
function studsToMeters(studs) {
    return studs * exports.METERS_PER_ROBLOX_STUD;
}
/**
 * Converts a +Y-up position to Blender's +Z-up axes. This matches what Blender's
 * glTF importer does: glTF (x, y, z) becomes Blender (x, -z, y).
 */
function yUpToZUp([x, y, z]) {
    return [x, 0 - z, y];
}
function zUpToYUp([x, y, z]) {
    return [x, z, 0 - y];
}
exports.GRID_PRESETS = [
    { size: 0.05, label: '0.05 m' },
    { size: 0.1, label: '0.1 m' },
    { size: 0.25, label: '0.25 m' },
    { size: exports.METERS_PER_ROBLOX_STUD, label: '0.28 m (1 stud)' },
    { size: 0.5, label: '0.5 m' },
    { size: 1, label: '1 m' },
    { size: 2, label: '2 m' },
];
