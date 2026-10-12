import type { ConstructionGraph } from '../geometry/constructionGraph';
import { GraphBuilder } from '../geometry/graphBuilder';
import { orientFaces } from '../geometry/orientation';
import { add, scale, type Vec3 } from '../math/vec3';
import { findRegions, resolveSketch, triangulateRegion, type Region } from './regions';
import { AXIS_EPSILON, type RevolveAxis, type ShapeSettings, type Sketch, type SketchPlane } from './sketch';

/**
 * Axes of each drawing plane in the object's local space (+Y up, front faces +Z).
 * u = right on the board, v = up on the board, n = towards the viewer (u × v = n).
 */
export const PLANE_AXES: Record<SketchPlane, { u: Vec3; v: Vec3; n: Vec3 }> = {
  front: { u: [1, 0, 0], v: [0, 1, 0], n: [0, 0, 1] },
  side: { u: [0, 0, -1], v: [0, 1, 0], n: [1, 0, 0] },
  top: { u: [1, 0, 0], v: [0, 0, -1], n: [0, 1, 0] },
};

export function planeTo3d(plane: SketchPlane, x: number, y: number, offset = 0): Vec3 {
  const { u, v, n } = PLANE_AXES[plane];
  return add(add(scale(u, x), scale(v, y)), scale(n, offset));
}

export interface GeneratedShape {
  graph: ConstructionGraph;
  /** Number of filled areas found in the drawing. */
  regions: number;
  /** Faces left out because they would break a geometry rule (e.g. overlapping lines). */
  skippedFaces: number;
}

const cache = new WeakMap<Sketch, Map<string, GeneratedShape>>();

/** Builds the 3D construction graph for a drawing. Results are cached per drawing and settings. */
export function generateShape(sketch: Sketch, shape: ShapeSettings): GeneratedShape {
  const key = `${shape.mode}|${shape.depth}|${shape.segments}|${shape.mirror}|${shape.axis}|${shape.curveSteps}`;
  let byShape = cache.get(sketch);
  if (!byShape) {
    byShape = new Map();
    cache.set(sketch, byShape);
  }
  const cached = byShape.get(key);
  if (cached) return cached;
  const result =
    shape.mode === 'revolve'
      ? revolve(sketch, shape.segments, shape.axis, shape.curveSteps)
      : shape.mode === 'extrude' && shape.depth > 1e-4
        ? extrude(sketch, shape.depth, shape.mirror, shape.curveSteps)
        : flat(sketch, shape.mirror, shape.curveSteps);
  byShape.set(key, result);
  return result;
}

function capFaces(builder: GraphBuilder, region: Region, ids: Map<string, string>, points: Map<string, [number, number]>, reverse: boolean): void {
  const loops: string[][] =
    region.holes.length === 0 ? [region.outer] : triangulateRegion(region, points).map((tri) => [...tri]);
  for (const loop of loops) {
    const mapped = loop.map((id) => ids.get(id)!);
    builder.face(reverse ? [mapped[0], ...mapped.slice(1).reverse()] : mapped);
  }
}

function flat(sketch: Sketch, mirror: boolean, curveSteps: number): GeneratedShape {
  const resolved = resolveSketch(sketch, mirror, curveSteps);
  const builder = new GraphBuilder();
  const ids = new Map<string, string>();
  for (const [id, [x, y]] of resolved.points) ids.set(id, builder.vertex(planeTo3d(sketch.plane, x, y)));
  for (const [a, b] of resolved.segments) builder.edge(ids.get(a)!, ids.get(b)!);
  const regions = findRegions(resolved);
  for (const region of regions) capFaces(builder, region, ids, resolved.points, false);
  return { graph: builder.build(), regions: regions.length, skippedFaces: builder.skippedFaces };
}

function extrude(sketch: Sketch, depth: number, mirror: boolean, curveSteps: number): GeneratedShape {
  const resolved = resolveSketch(sketch, mirror, curveSteps);
  const builder = new GraphBuilder();
  const used = new Set(resolved.segments.flat());
  const front = new Map<string, string>();
  const back = new Map<string, string>();
  // Front and side drawings grow equally both ways; a top-view plan grows up from the ground like walls.
  const [frontOffset, backOffset] = sketch.plane === 'top' ? [depth, 0] : [depth / 2, -depth / 2];
  for (const [id, [x, y]] of resolved.points) {
    if (!used.has(id)) continue;
    front.set(id, builder.vertex(planeTo3d(sketch.plane, x, y, frontOffset)));
    back.set(id, builder.vertex(planeTo3d(sketch.plane, x, y, backOffset)));
  }

  const regions = findRegions(resolved);
  // How many filled sides each line has: 2 means it sits inside a solid and gets no wall.
  const filledSides = new Map<string, number>();
  const key = (a: string, b: string) => (a < b ? `${a}|${b}` : `${b}|${a}`);
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
    if ((filledSides.get(key(a, b)) ?? 0) >= 2) continue;
    builder.face([front.get(a)!, front.get(b)!, back.get(b)!, back.get(a)!]);
  }
  const graph = orientFaces(builder.build()).graph;
  return { graph, regions: regions.length, skippedFaces: builder.skippedFaces };
}

/**
 * Spins the drawing's lines around an axis, like a lathe: the board's vertical line
 * (x = 0) for vases and bottles, or its horizontal line (y = 0) for wheels and barrels.
 */
function revolve(sketch: Sketch, segments: number, axis: RevolveAxis, curveSteps: number): GeneratedShape {
  const resolved = resolveSketch(sketch, false, curveSteps);
  const builder = new GraphBuilder();
  const { u, v, n } = PLANE_AXES[sketch.plane];
  // Along: the axis direction; across: the board direction that sweeps around it.
  const [along, across] = axis === 'vertical' ? [v, u] : [u, v];
  const used = new Set(resolved.segments.flat());
  const rings = new Map<string, string[]>();
  for (const [id, [x, y]] of resolved.points) {
    if (!used.has(id)) continue;
    const [position, radius] = axis === 'vertical' ? [y, Math.abs(x)] : [x, Math.abs(y)];
    if (radius <= AXIS_EPSILON) {
      const single = builder.vertex(scale(along, position));
      rings.set(id, Array.from({ length: segments }, () => single));
      continue;
    }
    const ring: string[] = [];
    for (let k = 0; k < segments; k++) {
      const angle = (2 * Math.PI * k) / segments;
      ring.push(builder.vertex(add(scale(along, position), add(scale(across, radius * Math.cos(angle)), scale(n, radius * Math.sin(angle))))));
    }
    rings.set(id, ring);
  }
  for (const [a, b] of resolved.segments) {
    const ra = rings.get(a)!;
    const rb = rings.get(b)!;
    // A line lying on the axis sweeps no surface.
    if (ra[0] === ra[1] && rb[0] === rb[1]) continue;
    for (let k = 0; k < segments; k++) {
      const k1 = (k + 1) % segments;
      builder.face([ra[k], rb[k], rb[k1], ra[k1]]);
    }
  }
  const graph = orientFaces(builder.build()).graph;
  return { graph, regions: 0, skippedFaces: builder.skippedFaces };
}
