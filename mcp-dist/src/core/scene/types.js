"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.HEX_COLOR = exports.SMOOTH_SHADING_ANGLE = exports.PRIMITIVE_KINDS = void 0;
exports.isConstructionMesh = isConstructionMesh;
exports.isSketchMesh = isSketchMesh;
exports.isBodyMesh = isBodyMesh;
exports.sourceGraphOf = sourceGraphOf;
exports.meshGraphOf = meshGraphOf;
const modifiers_1 = require("../geometry/modifiers");
const body_1 = require("../sketch/body");
const generate_1 = require("../sketch/generate");
exports.PRIMITIVE_KINDS = ['sphere', 'cylinder'];
/** Angle under which neighbouring faces are shaded as one smooth surface. */
exports.SMOOTH_SHADING_ANGLE = 50;
function isConstructionMesh(object) {
    return !!object && object.kind === 'mesh' && object.source.type === 'construction';
}
function isSketchMesh(object) {
    return !!object && object.kind === 'mesh' && object.source.type === 'sketch';
}
function isBodyMesh(object) {
    return !!object && object.kind === 'mesh' && object.source.type === 'body';
}
/** The graph an object's source describes, before modifiers: edited directly, or generated from drawings. */
function sourceGraphOf(object) {
    if (!object || object.kind !== 'mesh')
        return null;
    switch (object.source.type) {
        case 'construction':
            return object.source.graph;
        case 'sketch':
            return (0, generate_1.generateShape)(object.source.sketch, object.source.shape).graph;
        case 'body':
            return (0, body_1.generateBody)(object.source.views, object.source.body).graph;
        default:
            return null;
    }
}
/** The vertices, edges and faces an object shows and exports: its source graph with modifiers applied. */
function meshGraphOf(object) {
    const graph = sourceGraphOf(object);
    if (!graph || !object || object.kind !== 'mesh')
        return graph;
    return (0, modifiers_1.applyModifiers)(graph, object.modifiers);
}
exports.HEX_COLOR = /^#[0-9a-fA-F]{6}$/;
