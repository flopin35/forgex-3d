"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.STARTER_SWORD_OUTLINE = void 0;
exports.createEmptyDocument = createEmptyDocument;
exports.createDefaultDocument = createDefaultDocument;
exports.createStarterDocument = createStarterDocument;
exports.createCarDocument = createCarDocument;
const parts_1 = require("../scene/parts");
const templates_1 = require("../scene/templates");
const sketch_1 = require("../sketch/sketch");
const projectFile_1 = require("./projectFile");
function documentWith(objects) {
    const scene = {
        objects: Object.fromEntries(objects.map((object) => [object.id, object])),
        rootIds: objects.filter((object) => object.parentId === null).map((object) => object.id),
    };
    return { scene, settings: { ...projectFile_1.DEFAULT_SETTINGS }, camera: null };
}
/** An empty project (used when an AI tool or the user starts from scratch). */
function createEmptyDocument() {
    return documentWith([]);
}
/** A project with one point-built cube resting on the grid (the Cube Test scene). */
function createDefaultDocument() {
    return documentWith([(0, parts_1.createPartObject)('cube')]);
}
/** Right half of a sword outline, from the tip down to the pommel; the mirror draws the left half. */
exports.STARTER_SWORD_OUTLINE = [
    [0, 1.6],
    [0.08, 1.44],
    [0.08, 0.5],
    [0.32, 0.5],
    [0.32, 0.4],
    [0.045, 0.4],
    [0.045, 0.1],
    [0.09, 0.1],
    [0.09, 0],
    [0, 0],
];
/** What the app opens with: a mirrored sword blueprint, extruded, so the board and the 3D view both show something. */
function createStarterDocument() {
    const sketch = (0, sketch_1.addPolyline)((0, sketch_1.createSketch)('front'), exports.STARTER_SWORD_OUTLINE, false).sketch;
    const sword = (0, parts_1.createBlueprintObject)({
        name: 'Sword',
        sketch,
        shape: { mode: 'extrude', depth: 0.06, mirror: true },
        color: '#9fc3e8',
    });
    return documentWith([sword]);
}
/** What the app opens with: a ready-made supercar whose body, cabin and wheels are all drawings. */
function createCarDocument() {
    return { ...documentWith((0, templates_1.createTemplate)('supercar')), camera: { position: [-5.7, 3.1, 8.2], target: [0.7, 0.5, 0.6] } };
}
