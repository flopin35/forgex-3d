"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.PLANE_AXES = void 0;
exports.planeTo3d = planeTo3d;
exports.generateShape = generateShape;
const graphBuilder_1 = require("../geometry/graphBuilder");
const orientation_1 = require("../geometry/orientation");
const vec3_1 = require("../math/vec3");
const regions_1 = require("./regions");
const sketch_1 = require("./sketch");
/**
 * Axes of each drawing plane in the object's local space (+Y up, front faces +Z).
 * u = right on the board, v = up on the board, n = towards the viewer (u × v = n).
 */
exports.PLANE_AXES = {
    front: { u: [1, 0, 0], v: [0, 1, 0], n: [0, 0, 1] },
    side: { u: [0, 0, -1], v: [0, 1, 0], n: [1, 0, 0] },
    top: { u: [1, 0, 0], v: [0, 0, -1], n: [0, 1, 0] },
};
function planeTo3d(plane, x, y, offset = 0) {
    const { u, v, n } = exports.PLANE_AXES[plane];
    return (0, vec3_1.add)((0, vec3_1.add)((0, vec3_1.scale)(u, x), (0, vec3_1.scale)(v, y)), (0, vec3_1.scale)(n, offset));
}
const cache = new WeakMap();
/** Builds the 3D construction graph for a drawing. Results are cached per drawing and settings. */
function generateShape(sketch, shape) {
    const key = `${shape.mode}|${shape.depth}|${shape.segments}|${shape.mirror}|${shape.axis}|${shape.curveSteps}`;
    let byShape = cache.get(sketch);
    if (!byShape) {
        byShape = new Map();
        cache.set(sketch, byShape);
    }
    const cached = byShape.get(key);
    if (cached)
        return cached;
    const result = shape.mode === 'revolve'
        ? revolve(sketch, shape.segments, shape.axis, shape.curveSteps)
        : shape.mode === 'extrude' && shape.depth > 1e-4
            ? extrude(sketch, shape.depth, shape.mirror, shape.curveSteps)
            : flat(sketch, shape.mirror, shape.curveSteps);
    byShape.set(key, result);
    return result;
}
function capFaces(builder, region, ids, points, reverse) {
    const loops = region.holes.length === 0 ? [region.outer] : (0, regions_1.triangulateRegion)(region, points).map((tri) => [...tri]);
    for (const loop of loops) {
        const mapped = loop.map((id) => ids.get(id));
        builder.face(reverse ? [mapped[0], ...mapped.slice(1).reverse()] : mapped);
    }
}
function flat(sketch, mirror, curveSteps) {
    const resolved = (0, regions_1.resolveSketch)(sketch, mirror, curveSteps);
    const builder = new graphBuilder_1.GraphBuilder();
    const ids = new Map();
    for (const [id, [x, y]] of resolved.points)
        ids.set(id, builder.vertex(planeTo3d(sketch.plane, x, y)));
    for (const [a, b] of resolved.segments)
        builder.edge(ids.get(a), ids.get(b));
    const regions = (0, regions_1.findRegions)(resolved);
    for (const region of regions)
        capFaces(builder, region, ids, resolved.points, false);
    return { graph: builder.build(), regions: regions.length, skippedFaces: builder.skippedFaces };
}
function extrude(sketch, depth, mirror, curveSteps) {
    const resolved = (0, regions_1.resolveSketch)(sketch, mirror, curveSteps);
    const builder = new graphBuilder_1.GraphBuilder();
    const used = new Set(resolved.segments.flat());
    const front = new Map();
    const back = new Map();
    // Front and side drawings grow equally both ways; a top-view plan grows up from the ground like walls.
    const [frontOffset, backOffset] = sketch.plane === 'top' ? [depth, 0] : [depth / 2, -depth / 2];
    for (const [id, [x, y]] of resolved.points) {
        if (!used.has(id))
            continue;
        front.set(id, builder.vertex(planeTo3d(sketch.plane, x, y, frontOffset)));
        back.set(id, builder.vertex(planeTo3d(sketch.plane, x, y, backOffset)));
    }
    const regions = (0, regions_1.findRegions)(resolved);
    // How many filled sides each line has: 2 means it sits inside a solid and gets no wall.
    const filledSides = new Map();
    const key = (a, b) => (a < b ? `${a}|${b}` : `${b}|${a}`);
    for (const region of regions) {
        for (const loop of [region.outer, ...region.holes]) {
            loop.forEach((id, i) => {
                const k = key(id, loop[(i + 1) % loop.length]);
                filledSides.set(k, (filledSides.get(k) ?? 0) + 1);
            });
        }
    }
    for (const region of regions) {
        capFaces(builder, region, front, resolved.points, false);
        capFaces(builder, region, back, resolved.points, true);
    }
    for (const [a, b] of resolved.segments) {
        if ((filledSides.get(key(a, b)) ?? 0) >= 2)
            continue;
        builder.face([front.get(a), front.get(b), back.get(b), back.get(a)]);
    }
    const graph = (0, orientation_1.orientFaces)(builder.build()).graph;
    return { graph, regions: regions.length, skippedFaces: builder.skippedFaces };
}
/**
 * Spins the drawing's lines around an axis, like a lathe: the board's vertical line
 * (x = 0) for vases and bottles, or its horizontal line (y = 0) for wheels and barrels.
 */
function revolve(sketch, segments, axis, curveSteps) {
    const resolved = (0, regions_1.resolveSketch)(sketch, false, curveSteps);
    const builder = new graphBuilder_1.GraphBuilder();
    const { u, v, n } = exports.PLANE_AXES[sketch.plane];
    // Along: the axis direction; across: the board direction that sweeps around it.
    const [along, across] = axis === 'vertical' ? [v, u] : [u, v];
    const used = new Set(resolved.segments.flat());
    const rings = new Map();
    for (const [id, [x, y]] of resolved.points) {
        if (!used.has(id))
            continue;
        const [position, radius] = axis === 'vertical' ? [y, Math.abs(x)] : [x, Math.abs(y)];
        if (radius <= sketch_1.AXIS_EPSILON) {
            const single = builder.vertex((0, vec3_1.scale)(along, position));
            rings.set(id, Array.from({ length: segments }, () => single));
            continue;
        }
        const ring = [];
        for (let k = 0; k < segments; k++) {
            const angle = (2 * Math.PI * k) / segments;
            ring.push(builder.vertex((0, vec3_1.add)((0, vec3_1.scale)(along, position), (0, vec3_1.add)((0, vec3_1.scale)(across, radius * Math.cos(angle)), (0, vec3_1.scale)(n, radius * Math.sin(angle))))));
        }
        rings.set(id, ring);
    }
    for (const [a, b] of resolved.segments) {
        const ra = rings.get(a);
        const rb = rings.get(b);
        // A line lying on the axis sweeps no surface.
        if (ra[0] === ra[1] && rb[0] === rb[1])
            continue;
        for (let k = 0; k < segments; k++) {
            const k1 = (k + 1) % segments;
            builder.face([ra[k], rb[k], rb[k1], ra[k1]]);
        }
    }
    const graph = (0, orientation_1.orientFaces)(builder.build()).graph;
    return { graph, regions: 0, skippedFaces: builder.skippedFaces };
}
