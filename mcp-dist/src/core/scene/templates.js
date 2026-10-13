"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.TEMPLATES = void 0;
exports.createTemplate = createTemplate;
exports.getTemplate = getTemplate;
const ids_1 = require("../ids");
const transform_1 = require("../math/transform");
const body_1 = require("../sketch/body");
const sketch_1 = require("../sketch/sketch");
const parts_1 = require("./parts");
exports.TEMPLATES = [
    { id: 'supercar', name: 'Supercar', description: 'Low mid-engine sports car: lofted body and cabin, arches, four detailed wheels.' },
    { id: 'saloon', name: 'Luxury saloon', description: 'Long, tall limousine: upright grille, long bonnet, big wheels, lights.' },
];
/** One drawing from a list of dots. Open chains are for mirrored halves (centre line to centre line). */
function drawing(plane, dots, closed) {
    return (0, sketch_1.addPolyline)((0, sketch_1.createSketch)(plane), dots.map(([x, y]) => [x, y]), closed, (i) => dots[i][2] === true).sketch;
}
function views(side, top, front) {
    const empty = (0, body_1.createBodyViews)();
    return {
        side: side.length ? drawing('side', side, true) : empty.side,
        top: top.length ? drawing('top', top, false) : empty.top,
        front: front.length ? drawing('front', front, false) : empty.front,
    };
}
function group(name, transform, children) {
    const object = {
        id: (0, ids_1.createObjectId)(),
        name,
        kind: 'group',
        parentId: null,
        childIds: [],
        visible: true,
        transform: { ...(0, transform_1.identityTransform)(), ...transform },
    };
    return { object, children };
}
function leaf(object) {
    return { object, children: [] };
}
/** Flattens a tree into scene objects (parents before children) with matching links. */
function flatten(root) {
    const out = [];
    const visit = (node, parentId) => {
        out.push({ ...node.object, parentId, childIds: node.children.map((child) => child.object.id) });
        node.children.forEach((child) => visit(child, node.object.id));
    };
    visit(root, null);
    return out;
}
function blueprint(name, color, plane, dots, closed, shape, transform = {}) {
    return leaf((0, parts_1.createBlueprintObject)({ name, color, sketch: drawing(plane, dots, closed), shape, transform }));
}
function body(name, color, v, settings) {
    return leaf((0, parts_1.createBodyObject)({ name, color, views: v, body: settings }));
}
/** A wheel: tyre and rim barrel revolved around the axle (local X), plus extruded spokes on the outer face (-X). */
function wheel(name, position, outward, radius, width, spokes, rimColor) {
    const half = width / 2;
    const bead = radius * 0.66;
    const tyre = [
        [-half + 0.01, bead],
        [-half, bead + 0.035, true],
        [-half, radius - 0.03, true],
        [-half + 0.025, radius, true],
        [half - 0.025, radius, true],
        [half, radius - 0.03, true],
        [half, bead + 0.035, true],
        [half - 0.01, bead],
    ];
    const barrel = [
        [-half + 0.005, 0],
        [-half + 0.005, bead - 0.005],
        [half - 0.03, bead - 0.005],
        [half - 0.03, 0],
    ];
    // A star of spokes on the side plane (board x is -Z, y is Y), centred on the axle.
    const star = [];
    const outer = bead - 0.02;
    const inner = outer * 0.32;
    for (let i = 0; i < spokes * 2; i++) {
        const angle = Math.PI / 2 + (i * Math.PI) / spokes;
        const r = i % 2 === 0 ? outer : inner;
        star.push([r * Math.cos(angle), r * Math.sin(angle)]);
    }
    const hub = (0, sketch_1.polygonPoints)(0, 0, inner * 0.6, 16).map(([x, y]) => [x, y]);
    return group(name, { position, rotation: [0, outward === 1 ? 180 : 0, 0] }, [
        blueprint('Tyre', '#1b1e22', 'front', tyre, true, { mode: 'revolve', axis: 'horizontal', segments: 48 }),
        blueprint('Rim', '#5d646d', 'front', barrel, false, { mode: 'revolve', axis: 'horizontal', segments: 48 }),
        blueprint('Spokes', rimColor, 'side', star, true, { mode: 'extrude', depth: 0.03 }, { position: [-half - 0.005, 0, 0] }),
        blueprint('Hub', '#9aa1a9', 'side', hub, true, { mode: 'extrude', depth: 0.05 }, { position: [-half - 0.01, 0, 0] }),
    ]);
}
function wheels(frontZ, rearZ, track, radius, width, spokes, rimColor) {
    return group('Wheels', {}, [
        wheel('Wheel front left', [-track, radius, frontZ], -1, radius, width, spokes, rimColor),
        wheel('Wheel front right', [track, radius, frontZ], 1, radius, width, spokes, rimColor),
        wheel('Wheel rear left', [-track, radius, rearZ], -1, radius, width, spokes, rimColor),
        wheel('Wheel rear right', [track, radius, rearZ], 1, radius, width, spokes, rimColor),
    ]);
}
/** A wheel arch cut into the bottom of a side outline (board x is -Z), listed from the rear of the arch to its front. */
function arch(centreX, centreY, r, sill) {
    return [
        [centreX + r + 0.03, sill],
        [centreX + r, centreY, true],
        [centreX + r * 0.71, centreY + r * 0.71, true],
        [centreX, centreY + r, true],
        [centreX - r * 0.71, centreY + r * 0.71, true],
        [centreX - r, centreY, true],
        [centreX - r - 0.03, sill],
    ];
}
function supercar() {
    const paint = '#f2a51a';
    const glass = '#16212d';
    const bodySide = [
        [-2.32, 0.34],
        [-2.28, 0.47, true],
        [-1.95, 0.6, true],
        [-1.25, 0.73, true],
        [-0.85, 0.79],
        [0.1, 0.85, true],
        [0.95, 0.91, true],
        [1.9, 0.96, true],
        [2.26, 0.98],
        [2.33, 0.86, true],
        [2.3, 0.42, true],
        [2.15, 0.21],
        ...arch(1.35, 0.36, 0.41, 0.2),
        ...arch(-1.45, 0.36, 0.4, 0.19),
        [-2.15, 0.2],
    ];
    const bodyTop = [
        [0, -2.34, true],
        [0.55, -2.3, true],
        [0.86, -2.1, true],
        [0.98, -1.7, true],
        [0.97, -1.15, true],
        [0.93, -0.4, true],
        [0.97, 0.4, true],
        [1.02, 1.1, true],
        [1.01, 1.75, true],
        [0.92, 2.2, true],
        [0.55, 2.33, true],
        [0, 2.34, true],
    ];
    const bodyFront = [[0, 0], [0.9, 0], [1, 0.1, true], [1, 0.55, true], [0.9, 0.85, true], [0.55, 0.98, true], [0, 1, true]];
    const cabinSide = [[-0.95, 0.74], [-0.3, 1.1, true], [0.3, 1.14, true], [0.95, 1.02, true], [1.45, 0.88], [1.45, 0.74]];
    const cabinTop = [[0, -0.98, true], [0.5, -0.92, true], [0.7, -0.45, true], [0.74, 0.4, true], [0.7, 1.1, true], [0.45, 1.46, true], [0, 1.48, true]];
    const cabinFront = [[0, 0], [0.8, 0], [0.72, 0.4, true], [0.52, 0.92, true], [0, 1, true]];
    const taillight = [[-0.85, 0.62], [0.85, 0.62], [0.85, 0.7], [-0.85, 0.7]];
    const intake = [[-0.75, 0.24], [0.75, 0.24], [0.68, 0.36], [-0.68, 0.36]];
    return group('Supercar', {}, [
        body('Body', paint, views(bodySide, bodyTop, bodyFront), { stations: 72, sectionPoints: 48 }),
        body('Cabin', glass, views(cabinSide, cabinTop, cabinFront), { stations: 40, sectionPoints: 36 }),
        blueprint('Taillight', '#d62f2f', 'front', taillight, true, { mode: 'extrude', depth: 0.02 }, { position: [0, 0, -2.335] }),
        blueprint('Front intake', '#111417', 'front', intake, true, { mode: 'extrude', depth: 0.02 }, { position: [0, 0, 2.29] }),
        wheels(1.45, -1.35, 0.86, 0.36, 0.26, 5, '#d4d8dd'),
    ]);
}
function saloon() {
    const paint = '#1f2d4a';
    const glass = '#121a24';
    const bodySide = [
        [-2.86, 0.32],
        [-2.88, 0.95, true],
        [-2.78, 1.06],
        [-1.1, 1.08],
        [0.2, 1.02, true],
        [1.9, 1.0, true],
        [2.7, 0.98],
        [2.86, 0.86, true],
        [2.84, 0.4, true],
        [2.7, 0.26],
        ...arch(1.65, 0.42, 0.47, 0.24),
        ...arch(-1.8, 0.42, 0.47, 0.23),
        [-2.75, 0.28],
    ];
    const bodyTop = [[0, -2.88, true], [0.7, -2.86, true], [0.95, -2.7, true], [1, -2.2, true], [1, 2.3, true], [0.96, 2.75, true], [0.7, 2.86, true], [0, 2.87, true]];
    const bodyFront = [[0, 0], [0.95, 0], [1, 0.12, true], [1, 0.8, true], [0.94, 0.97, true], [0.6, 1, true], [0, 1, true]];
    const cabinSide = [[-1.25, 1.02], [-0.55, 1.5, true], [0.3, 1.56, true], [1.25, 1.48, true], [1.85, 1.1, true], [1.98, 0.98], [-1.25, 0.98]];
    const cabinTop = [[0, -1.3, true], [0.7, -1.24, true], [0.86, -0.7, true], [0.88, 0.6, true], [0.84, 1.6, true], [0.55, 2, true], [0, 2.02, true]];
    const cabinFront = [[0, 0], [0.88, 0], [0.8, 0.5, true], [0.62, 0.95, true], [0, 1, true]];
    const grille = [[-0.36, 0.48], [0.36, 0.48], [0.36, 0.95], [0.3, 1.0, true], [-0.3, 1.0, true], [-0.36, 0.95]];
    const lamp = [[0.55, 0.78], [0.9, 0.78], [0.9, 0.92, true], [0.55, 0.92, true]];
    const tail = [[0.68, 0.6], [0.95, 0.6], [0.95, 0.86, true], [0.68, 0.86, true]];
    return group('Luxury saloon', {}, [
        body('Body', paint, views(bodySide, bodyTop, bodyFront), { stations: 80, sectionPoints: 48, roundness: 6 }),
        body('Cabin', glass, views(cabinSide, cabinTop, cabinFront), { stations: 44, sectionPoints: 36 }),
        blueprint('Grille', '#cfd3d8', 'front', grille, true, { mode: 'extrude', depth: 0.04 }, { position: [0, 0, 2.885] }),
        blueprint('Headlights', '#f4f1e6', 'front', lamp, true, { mode: 'extrude', depth: 0.02, mirror: true }, { position: [0, 0, 2.885] }),
        blueprint('Taillights', '#c42a2a', 'front', tail, true, { mode: 'extrude', depth: 0.02, mirror: true }, { position: [0, 0, -2.865] }),
        wheels(1.8, -1.65, 0.86, 0.42, 0.28, 6, '#e3e6ea'),
    ]);
}
/** Builds a template as scene objects: the top group first, then every part. */
function createTemplate(id, options = {}) {
    const root = id === 'supercar' ? supercar() : saloon();
    const [x, z] = options.groundPosition ?? [0, 0];
    root.object = { ...root.object, transform: { ...root.object.transform, position: [x, 0, z] } };
    return flatten(root);
}
function getTemplate(id) {
    const found = exports.TEMPLATES.find((template) => template.id === id);
    if (!found)
        throw new Error(`Unknown template ${id}`);
    return found;
}
