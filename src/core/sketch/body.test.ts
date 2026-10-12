import { describe, expect, it } from 'vitest';
import { analyzeGraph } from '../geometry/analysis';
import type { ConstructionGraph } from '../geometry/constructionGraph';
import { createDefaultDocument } from '../project/defaultDocument';
import { parseProject, serializeProject } from '../project/projectFile';
import { createTemplate } from '../scene/templates';
import { meshGraphOf, type Scene } from '../scene/types';
import { bodyExtents, createBodyViews, DEFAULT_BODY, generateBody, type BodySettings, type BodyViews } from './body';
import { addPolyline, createSketch, type SketchPlane } from './sketch';

function drawing(plane: SketchPlane, points: [number, number][], closed: boolean, smooth = false) {
  return addPolyline(createSketch(plane), points, closed, smooth).sketch;
}

function bounds(graph: ConstructionGraph) {
  const ps = Object.values(graph.vertices).map((v) => v.position);
  const range = (i: number) => [Math.min(...ps.map((p) => p[i])), Math.max(...ps.map((p) => p[i]))];
  return { x: range(0), y: range(1), z: range(2) };
}

const settings = (patch: Partial<BodySettings> = {}): BodySettings => ({ ...DEFAULT_BODY, ...patch });

// A box-like body: 4 m long (front at +Z), 1 m tall, 2 m wide.
const boxViews = (): BodyViews => ({
  side: drawing('side', [[-2, 0], [2, 0], [2, 1], [-2, 1]], true),
  top: drawing('top', [[0, -2], [1, -2], [1, 2], [0, 2]], false),
  front: createSketch('front'),
});

describe('bodies lofted from three views', () => {
  it('builds one closed solid that fills the side and top outlines', () => {
    const body = generateBody(boxViews(), settings({ roundness: 12 }));
    expect(body.message).toBeNull();
    const report = analyzeGraph(body.graph);
    expect(report.closed).toBe(true);
    expect(report.issues.filter((issue) => issue.code === 'non-manifold-edge' || issue.code === 'inconsistent-normals')).toEqual([]);
    const b = bounds(body.graph);
    expect(b.z[0]).toBeCloseTo(-2, 1);
    expect(b.z[1]).toBeCloseTo(2, 1);
    expect(b.y[0]).toBeCloseTo(0, 6);
    expect(b.y[1]).toBeCloseTo(1, 6);
    expect(b.x[0]).toBeCloseTo(-1, 6);
    expect(b.x[1]).toBeCloseTo(1, 6);
    expect(body.stations).toBe(DEFAULT_BODY.stations);
  });

  it('uses the front view as the cross-section shape', () => {
    // A roof that narrows: the top of every slice is the narrow part.
    const views = { ...boxViews(), front: drawing('front', [[0, 0], [1, 0], [0.4, 1], [0, 1]], false) };
    const body = generateBody(views, settings());
    expect(body.closed.front).toBe(true);
    const top = Object.values(body.graph.vertices).filter((v) => v.position[1] > 0.999);
    expect(Math.max(...top.map((v) => Math.abs(v.position[0])))).toBeLessThan(0.45);
  });

  it('cuts wheel arches from notches in the bottom of the side outline', () => {
    const side = drawing('side', [[-2, 0], [-1.2, 0], [-1.2, 0.5], [-0.6, 0.5], [-0.6, 0], [2, 0], [2, 1], [-2, 1]], true);
    const body = generateBody({ ...boxViews(), side }, settings());
    expect(analyzeGraph(body.graph).closed).toBe(true);
    // Above the arch (z = 0.9, board x = -0.9) the body starts at y = 0.5.
    const arch = Object.values(body.graph.vertices).filter((v) => Math.abs(v.position[2] - 0.9) < 0.15);
    expect(arch.length).toBeGreaterThan(0);
    expect(Math.min(...arch.map((v) => v.position[1]))).toBeCloseTo(0.5, 6);
  });

  it('says what is missing instead of failing', () => {
    expect(generateBody(createBodyViews(), settings()).message).toContain('side view');
    expect(generateBody({ ...createBodyViews(), side: boxViews().side }, settings()).message).toContain('top view');
    const far = drawing('top', [[0, 10], [1, 10], [1, 12], [0, 12]], false);
    expect(generateBody({ ...boxViews(), top: far }, settings()).message).toContain('do not overlap');
  });

  it('reports each view in object space for lining them up', () => {
    const extents = bodyExtents(boxViews(), settings());
    expect(extents.side).toEqual({ z: [-2, 2], y: [0, 1] });
    expect(extents.top).toEqual({ x: [-1, 1], z: [-2, 2] });
    expect(extents.front).toBeNull();
  });
});

describe('car templates', () => {
  const sceneOf = (objects: ReturnType<typeof createTemplate>): Scene => ({
    objects: Object.fromEntries(objects.map((o) => [o.id, o])),
    rootIds: [objects[0].id],
  });

  for (const id of ['supercar', 'saloon'] as const) {
    it(`builds the ${id} as closed, editable parts and saves it`, () => {
      const objects = createTemplate(id);
      expect(objects[0].kind).toBe('group');
      const meshes = objects.filter((o) => o.kind === 'mesh');
      expect(meshes.length).toBeGreaterThan(18);
      for (const mesh of meshes) {
        const report = analyzeGraph(meshGraphOf(mesh)!);
        expect(report.faces).toBeGreaterThan(0);
        expect(report.closed).toBe(true);
      }
      const document = { ...createDefaultDocument(), scene: sceneOf(objects) };
      const reopened = parseProject(serializeProject(document));
      if (!reopened.ok) throw new Error(reopened.errors.join('\n'));
      expect(reopened.document.scene).toEqual(document.scene);
    });
  }
});
