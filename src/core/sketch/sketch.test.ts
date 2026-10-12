import { describe, expect, it } from 'vitest';
import { analyzeGraph } from '../geometry/analysis';
import { buildMeshData } from '../geometry/meshData';
import { analyzePolygon } from '../geometry/polygon';
import { createStarterDocument } from '../project/defaultDocument';
import { parseProject, serializeProject } from '../project/projectFile';
import { meshGraphOf } from '../scene/types';
import { generateShape, planeTo3d } from './generate';
import { findRegions, resolveSketch, signedArea, triangulateRegion } from './regions';
import {
  addLine,
  addPoint,
  addPolyline,
  closestOnLine,
  createSketch,
  DEFAULT_SHAPE,
  movePoint,
  polygonPoints,
  rectanglePoints,
  linesBetween,
  mergePoints,
  pointDegree,
  removeItems,
  removePoint,
  splitLine,
  translatePoints,
  type ShapeSettings,
  type Sketch,
} from './sketch';

const flat: ShapeSettings = { ...DEFAULT_SHAPE, mode: 'flat' };
const extrude = (depth = 0.5, mirror = false): ShapeSettings => ({ ...DEFAULT_SHAPE, mode: 'extrude', depth, mirror });
const revolve = (segments = 16): ShapeSettings => ({ ...DEFAULT_SHAPE, mode: 'revolve', segments });

function shape(points: [number, number][], closed = true, base: Sketch = createSketch()): Sketch {
  return addPolyline(base, points, closed).sketch;
}

const square = rectanglePoints(-1, -1, 1, 1);

describe('blueprint sketch editing', () => {
  it('places dots and joins them, never duplicating a line', () => {
    let s = createSketch();
    const a = addPoint(s, 0, 0);
    const b = addPoint(a.sketch, 1, 0);
    s = addLine(b.sketch, a.pointId, b.pointId).sketch;
    const again = addLine(s, b.pointId, a.pointId);
    expect(again.created).toBe(false);
    expect(Object.keys(again.sketch.lines)).toHaveLength(1);
    expect(() => addLine(s, a.pointId, a.pointId)).toThrow('two different dots');
  });

  it('moves dots and removes them with their lines', () => {
    const s = shape(square);
    expect(movePoint(s, 'p1', 5, 5).points.p1).toEqual({ id: 'p1', x: 5, y: 5 });
    const without = removePoint(s, 'p1');
    expect(Object.keys(without.points)).toHaveLength(3);
    expect(Object.keys(without.lines)).toHaveLength(2);
  });
});

describe('board editing helpers', () => {
  it('splits a line with a new dot and keeps the shape closed', () => {
    const s = shape(square);
    const lineId = Object.keys(s.lines)[0];
    const [x, y] = closestOnLine(s, lineId, 0.1, -3);
    expect(x).toBeCloseTo(0.1);
    expect(y).toBe(-1);
    const split = splitLine(s, lineId, x, y);
    expect(Object.keys(split.sketch.lines)).toHaveLength(5);
    expect(pointDegree(split.sketch, split.pointId)).toBe(2);
    expect(findRegions(resolveSketch(split.sketch, false))).toHaveLength(1);
  });

  it('removes picked dots and lines together, and moves dots as a group', () => {
    const s = shape(square);
    const [p1, p2] = Object.keys(s.points);
    const removed = removeItems(s, [p1], [Object.keys(s.lines)[1]]);
    expect(Object.keys(removed.points)).toHaveLength(3);
    expect(Object.keys(removed.lines)).toHaveLength(1);
    expect(removeItems(s, ['nope'], ['nope'])).toBe(s);
    const moved = translatePoints(s, [p1, p2], 0.5, 0.25);
    expect(moved.points[p1]).toEqual({ id: p1, x: -0.5, y: -0.75 });
    expect(moved.points[p2]).toEqual({ id: p2, x: 1.5, y: -0.75 });
    expect(linesBetween(s, new Set([p1, p2]))).toEqual([Object.keys(s.lines)[0]]);
  });

  it('joins a dragged dot onto another dot, closing an open outline', () => {
    const open = shape([[0, 0], [1, 0], [1, 1], [0, 1], [0, 0.02]], false);
    expect(findRegions(resolveSketch(open, false))).toHaveLength(0);
    const ids = Object.keys(open.points);
    const merged = mergePoints(open, ids[4], ids[0]);
    expect(Object.keys(merged.points)).toHaveLength(4);
    expect(Object.keys(merged.lines)).toHaveLength(4);
    expect(findRegions(resolveSketch(merged, false))).toHaveLength(1);
    // Joining two ends of the same line removes the line instead of making a zero-length one.
    expect(Object.keys(mergePoints(open, ids[1], ids[0]).lines)).toHaveLength(3);
  });
});

describe('finding filled areas', () => {
  it('fills a closed loop and ignores an open line', () => {
    expect(findRegions(resolveSketch(shape(square), false))).toHaveLength(1);
    expect(findRegions(resolveSketch(shape(square, false), false))).toHaveLength(0);
  });

  it('splits a square crossed by a line into two areas', () => {
    let s = shape(square);
    s = addLine(s, 'p1', 'p3').sketch;
    const regions = findRegions(resolveSketch(s, false));
    expect(regions).toHaveLength(2);
    expect(regions.every((r) => r.holes.length === 0)).toBe(true);
  });

  it('turns a shape inside another into a hole, and a shape inside the hole into an island', () => {
    let s = shape(square);
    s = shape(rectanglePoints(-0.5, -0.5, 0.5, 0.5), true, s);
    let regions = findRegions(resolveSketch(s, false));
    expect(regions).toHaveLength(1);
    expect(regions[0].holes).toHaveLength(1);
    expect(regions[0].area).toBeCloseTo(4 - 1);

    s = shape(rectanglePoints(-0.2, -0.2, 0.2, 0.2), true, s);
    regions = findRegions(resolveSketch(s, false));
    expect(regions).toHaveLength(2);
  });

  it('keeps a dangling line out of the filled area', () => {
    let s = shape(square);
    const tail = addPoint(s, 2, 2);
    s = addLine(tail.sketch, 'p3', tail.pointId).sketch;
    expect(findRegions(resolveSketch(s, false))).toHaveLength(1);
  });

  it('closes half an outline drawn against the axis when mirrored', () => {
    // A sword-like half outline from the axis at the top to the axis at the bottom.
    const half = shape([[0, 2], [0.3, 1.5], [0.3, 0], [0.8, -0.2], [0, -0.4]], false);
    expect(findRegions(resolveSketch(half, false))).toHaveLength(0);
    const resolved = resolveSketch(half, true);
    const regions = findRegions(resolved);
    expect(regions).toHaveLength(1);
    expect(regions[0].outer).toHaveLength(8);
    expect(signedArea(regions[0].outer, resolved.points)).toBeGreaterThan(0);
  });

  it('triangulates an area with a hole without covering the hole', () => {
    let s = shape(polygonPoints(0, 0, 2, 24));
    s = shape(polygonPoints(0.3, 0, 0.8, 12), true, s);
    const resolved = resolveSketch(s, false);
    const [region] = findRegions(resolved);
    const triangles = triangulateRegion(region, resolved.points);
    const area = triangles.reduce((sum, tri) => sum + signedArea(tri, resolved.points), 0);
    expect(area).toBeCloseTo(region.area, 6);
    expect(triangles.every((tri) => signedArea(tri, resolved.points) > 0)).toBe(true);
  });
});

describe('making 3D objects from drawings', () => {
  it('maps the three drawing planes into +Y-up space', () => {
    expect(planeTo3d('front', 1, 2, 3)).toEqual([1, 2, 3]);
    expect(planeTo3d('side', 1, 2, 3)).toEqual([3, 2, -1]);
    expect(planeTo3d('top', 1, 2, 3)).toEqual([1, 3, -2]);
  });

  it('builds a flat panel facing the viewer', () => {
    const { graph } = generateShape(shape(square), flat);
    const report = analyzeGraph(graph);
    expect(report.faces).toBe(1);
    const face = Object.values(graph.faces)[0];
    const normal = analyzePolygon(face.vertexIds.map((id) => graph.vertices[id].position)).normal;
    expect(normal[2]).toBeCloseTo(1);
  });

  it('extrudes a square into a closed box', () => {
    const report = analyzeGraph(generateShape(shape(square), extrude(0.5)).graph);
    expect(report.vertices).toBe(8);
    expect(report.faces).toBe(6);
    expect(report.closed).toBe(true);
    expect(report.issues).toEqual([]);
  });

  it('extrudes a ring into a closed shell with a real hole', () => {
    let s = shape(polygonPoints(0, 0, 2, 16));
    s = shape(polygonPoints(0, 0, 1, 8), true, s);
    const report = analyzeGraph(generateShape(s, extrude(0.4)).graph);
    expect(report.closed).toBe(true);
    expect(report.issues.filter((i) => i.severity !== 'info')).toEqual([]);
  });

  it('extrudes a split square without an inner wall', () => {
    let s = shape(square);
    s = addLine(s, 'p1', 'p3').sketch;
    const report = analyzeGraph(generateShape(s, extrude(0.2)).graph);
    expect(report.faces).toBe(4 + 4);
    expect(report.closed).toBe(true);
  });

  it('turns open lines drawn from the top into walls standing on the ground', () => {
    const plan = shape([[0, 0], [4, 0], [4, 3]], false, createSketch('top'));
    const { graph } = generateShape(plan, extrude(2.5));
    const report = analyzeGraph(graph);
    expect(report.faces).toBe(2);
    expect(report.closed).toBe(false);
    const ys = Object.values(graph.vertices).map((v) => v.position[1]);
    // Plans grow up from the ground.
    expect(Math.min(...ys)).toBe(0);
    expect(Math.max(...ys)).toBeCloseTo(2.5);
  });

  it('extrudes a mirrored half outline into one symmetric solid', () => {
    const half = shape([[0, 2], [0.3, 1.5], [0.3, 0], [0.8, -0.2], [0, -0.4]], false);
    const { graph, regions } = generateShape(half, extrude(0.1, true));
    expect(regions).toBe(1);
    const report = analyzeGraph(graph);
    expect(report.closed).toBe(true);
    const xs = Object.values(graph.vertices).map((v) => v.position[0]);
    expect(Math.min(...xs)).toBeCloseTo(-0.8);
    expect(Math.max(...xs)).toBeCloseTo(0.8);
  });

  it('revolves a profile into a closed solid like a lathe', () => {
    const profile = shape([[0, 0], [0.5, 0], [0.5, 1], [0, 1]], false);
    const { graph, skippedFaces } = generateShape(profile, revolve(16));
    const report = analyzeGraph(graph);
    expect(skippedFaces).toBe(0);
    expect(report.faces).toBe(48);
    expect(report.closed).toBe(true);
    expect(report.issues).toEqual([]);
  });

  it('shows only the outline edges of a generated cap with a hole', () => {
    const frame = shape(rectanglePoints(-0.5, -0.5, 0.5, 0.5), true, shape(square));
    const { graph } = generateShape(frame, extrude(0.2));
    const all = buildMeshData(graph).edgePositions.length / 6;
    const outline = buildMeshData(graph, { featureEdgesOnly: true }).edgePositions.length / 6;
    // 8 outline edges on the front, 8 on the back, 8 corner edges along the thickness.
    expect(outline).toBe(24);
    expect(all).toBeGreaterThan(outline);
    // A 32-step revolve keeps its silhouette rings but drops the steps between the side faces.
    const cup = generateShape(shape([[0, 0], [1, 0], [1, 1]], false), revolve(32)).graph;
    expect(buildMeshData(cup, { featureEdgesOnly: true }).edgePositions.length / 6).toBe(64);
  });

  it('opens with a sword blueprint that is one clean, closed solid', () => {
    const doc = createStarterDocument();
    const sword = Object.values(doc.scene.objects)[0];
    const report = analyzeGraph(meshGraphOf(sword)!);
    expect(report.closed).toBe(true);
    expect(report.issues.filter((issue) => issue.severity !== 'info')).toEqual([]);
    expect(parseProject(serializeProject(doc)).ok).toBe(true);
  });

  it('caches results for the same drawing and settings', () => {
    const s = shape(square);
    expect(generateShape(s, extrude(0.3))).toBe(generateShape(s, extrude(0.3)));
    expect(generateShape(s, extrude(0.3))).not.toBe(generateShape(s, extrude(0.4)));
  });
});
