"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.BLUEPRINT_COLORS = exports.PARTS = void 0;
exports.getPart = getPart;
exports.createBlueprintObject = createBlueprintObject;
exports.createBodyObject = createBodyObject;
exports.createPartObject = createPartObject;
const builders_1 = require("../geometry/builders");
const ids_1 = require("../ids");
const transform_1 = require("../math/transform");
const body_1 = require("../sketch/body");
const sketch_1 = require("../sketch/sketch");
exports.PARTS = [
    {
        id: 'cube',
        name: 'Cube',
        category: 'Point-built',
        description: '8 connected points and 6 faces. Press Tab to edit its vertices.',
        restingHeight: 0.5,
    },
    {
        id: 'plane',
        name: 'Plane',
        category: 'Point-built',
        description: '4 connected points and one face, lying on the ground.',
        restingHeight: 0,
    },
    {
        id: 'sphere',
        name: 'Sphere',
        category: 'Parametric',
        description: 'Smooth sphere, 1 m across.',
        restingHeight: 0.5,
    },
    {
        id: 'cylinder',
        name: 'Cylinder',
        category: 'Parametric',
        description: 'Smooth cylinder, 1 m tall and 1 m across.',
        restingHeight: 0.5,
    },
    {
        id: 'group',
        name: 'Group',
        category: 'Structure',
        description: 'An empty parent for organising objects in the hierarchy.',
        restingHeight: 0,
    },
];
const PART_COLORS = {
    cube: '#3d9fe8',
    plane: '#7d93ab',
    sphere: '#e4a23c',
    cylinder: '#55b888',
};
function getPart(id) {
    const part = exports.PARTS.find((p) => p.id === id);
    if (!part)
        throw new Error(`Unknown part ${id}`);
    return part;
}
exports.BLUEPRINT_COLORS = ['#3d9fe8', '#e4a23c', '#55b888', '#e0565b', '#a77be0', '#62cbff'];
function generatedBase(options) {
    return {
        id: options.id ?? (0, ids_1.createObjectId)(),
        name: options.name,
        kind: 'mesh',
        parentId: null,
        childIds: [],
        visible: true,
        transform: { ...(0, transform_1.identityTransform)(), ...options.transform },
        material: options.smooth === false ? { color: options.color ?? exports.BLUEPRINT_COLORS[0] } : { color: options.color ?? exports.BLUEPRINT_COLORS[0], smooth: true },
        ...(options.modifiers ? { modifiers: options.modifiers } : {}),
    };
}
/** A blueprint object: a drawing on a plane that becomes 3D through its shape settings. */
function createBlueprintObject(options) {
    return {
        ...generatedBase(options),
        source: {
            type: 'sketch',
            sketch: options.sketch ?? (0, sketch_1.createSketch)(options.plane ?? 'front'),
            shape: (0, sketch_1.clampShape)({ ...sketch_1.DEFAULT_SHAPE, ...options.shape }),
        },
    };
}
/** A body object: side, top and front drawings lofted into one smooth solid. */
function createBodyObject(options) {
    return {
        ...generatedBase(options),
        source: { type: 'body', views: options.views ?? (0, body_1.createBodyViews)(), body: (0, body_1.clampBody)({ ...body_1.DEFAULT_BODY, ...options.body }) },
    };
}
function createPartObject(partId, options = {}) {
    const part = getPart(partId);
    const [x, z] = options.groundPosition ?? [0, 0];
    const position = [x, part.restingHeight, z];
    const base = {
        id: options.id ?? (0, ids_1.createObjectId)(),
        name: options.name ?? part.name,
        parentId: null,
        childIds: [],
        transform: { ...(0, transform_1.identityTransform)(), position },
        visible: true,
    };
    switch (partId) {
        case 'group':
            return { ...base, kind: 'group' };
        case 'cube':
            return { ...base, kind: 'mesh', source: { type: 'construction', graph: (0, builders_1.buildCubeGraph)(1) }, material: { color: PART_COLORS.cube } };
        case 'plane':
            return { ...base, kind: 'mesh', source: { type: 'construction', graph: (0, builders_1.buildPlaneGraph)(1) }, material: { color: PART_COLORS.plane } };
        case 'sphere':
        case 'cylinder':
            return { ...base, kind: 'mesh', source: { type: 'primitive', primitive: partId }, material: { color: PART_COLORS[partId] } };
    }
}
