import { describe, expect, it } from 'vitest';
import { analyzeGraph } from './analysis';
import { buildCubeGraph, buildPlaneGraph } from './builders';
import { GraphBuilder } from './graphBuilder';
import { buildMeshData } from './meshData';
import { applyModifiers, cleanModifiers, mirrorGraph, subdivide, subdivideOnce } from './modifiers';

/** Largest |x| + |y| + |z| of any vertex: 1.5 at the corners of a 1 m cube. */
function cornerReach(graph: ReturnType<typeof buildCubeGraph>): number {
  return Math.max(...Object.values(graph.vertices).map((v) => v.position.reduce((sum, c) => sum + Math.abs(c), 0)));
}

describe('subdivision (Catmull-Clark)', () => {
  it('turns a cube into 24 quads that stay one closed, rounder shell', () => {
    const once = subdivideOnce(buildCubeGraph(1));
    const report = analyzeGraph(once);
    expect(report.faces).toBe(24);
    expect(report.vertices).toBe(26);
    expect(report.edges).toBe(48);
    expect(report.closed).toBe(true);
    expect(report.issues.filter((issue) => issue.code === 'inconsistent-normals' || issue.code === 'non-manifold-edge')).toEqual([]);
    expect(Object.values(once.faces).every((face) => face.vertexIds.length === 4)).toBe(true);
    // Corners are pulled in: the cube becomes rounder.
    expect(cornerReach(once)).toBeLessThan(1);
    const twice = subdivide(buildCubeGraph(1), 2);
    expect(analyzeGraph(twice).faces).toBe(96);
    expect(analyzeGraph(twice).closed).toBe(true);
  });

  it('keeps the corners of an open surface in place', () => {
    const plane = subdivideOnce(buildPlaneGraph(1));
    expect(analyzeGraph(plane).faces).toBe(4);
    const corners = Object.values(plane.vertices).filter((v) => Math.abs(v.position[0]) === 0.5 && Math.abs(v.position[2]) === 0.5);
    expect(corners).toHaveLength(4);
  });
});

describe('mirror modifier', () => {
  it('joins a half box into one closed box and drops the face on the mirror plane', () => {
    const b = new GraphBuilder();
    const p = (x: number, y: number, z: number) => b.vertex([x, y, z]);
    const v = [p(0, 0, 0), p(0.5, 0, 0), p(0.5, 0, 0.5), p(0, 0, 0.5), p(0, 1, 0), p(0.5, 1, 0), p(0.5, 1, 0.5), p(0, 1, 0.5)];
    const quads = [[0, 3, 2, 1], [4, 5, 6, 7], [0, 1, 5, 4], [1, 2, 6, 5], [2, 3, 7, 6], [3, 0, 4, 7]];
    quads.forEach((q) => b.face(q.map((i) => v[i])));
    const half = b.build();
    const whole = mirrorGraph(half, 'x');
    const report = analyzeGraph(whole);
    expect(report.vertices).toBe(12);
    expect(report.faces).toBe(10);
    expect(report.closed).toBe(true);
    expect(report.issues.filter((issue) => issue.severity !== 'info')).toEqual([]);
  });

  it('caches modified graphs and cleans settings', () => {
    const cube = buildCubeGraph(1);
    const modifiers = cleanModifiers({ mirror: 'none', subdivide: 7 });
    expect(modifiers.subdivide).toBe(3);
    expect(applyModifiers(cube, { mirror: 'none', subdivide: 1 })).toBe(applyModifiers(cube, { mirror: 'none', subdivide: 1 }));
    expect(applyModifiers(cube, { mirror: 'none', subdivide: 0 })).toBe(cube);
  });
});

describe('smooth shading', () => {
  it('rounds gentle curves and keeps sharp creases', () => {
    const cube = buildCubeGraph(1);
    const flat = buildMeshData(cube);
    const smoothCube = buildMeshData(cube, { smoothAngle: 50 });
    // Cube edges are 90°, sharper than the smoothing angle: shading stays flat.
    expect(Math.max(...Array.from(smoothCube.normals, (n, i) => Math.abs(n - flat.normals[i])))).toBeLessThan(1e-9);
    // Once subdivided, neighbouring faces meet gently and share normals.
    const round = subdivide(cube, 2);
    const a = buildMeshData(round);
    const b = buildMeshData(round, { smoothAngle: 50 });
    expect(Array.from(b.normals)).not.toEqual(Array.from(a.normals));
    const lengths = [];
    for (let i = 0; i < b.normals.length; i += 3) lengths.push(Math.hypot(b.normals[i], b.normals[i + 1], b.normals[i + 2]));
    expect(Math.min(...lengths)).toBeGreaterThan(0.999);
  });
});
