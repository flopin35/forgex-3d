import { describe, expect, it } from 'vitest';
import {
  alignPoints,
  copyFragment,
  distributePoints,
  duplicatePoints,
  flipPoints,
  isSketchFragment,
  lineAngle,
  lineAngleFromAnchor,
  lineLength,
  pasteFragment,
  pointsBounds,
  pointsCentre,
  polarPoint,
  rotatePoints,
  scalePoints,
  setLineAngle,
  setLineLength,
} from './edit';
import { findRegions, resolveSketch } from './regions';
import { addLine, addPolyline, createSketch, rectanglePoints, setPointsSmooth, type Sketch } from './sketch';

function square(): { sketch: Sketch; ids: string[] } {
  const { sketch, pointIds } = addPolyline(createSketch('front'), rectanglePoints(0, 0, 1, 1), true);
  return { sketch, ids: pointIds };
}

const xy = (sketch: Sketch, id: string) => [sketch.points[id].x, sketch.points[id].y];

describe('group edits on picked dots', () => {
  it('finds the box and middle of a pick', () => {
    const { sketch, ids } = square();
    expect(pointsBounds(sketch, ids)).toEqual([0, 0, 1, 1]);
    expect(pointsCentre(sketch, ids)).toEqual([0.5, 0.5]);
    expect(pointsBounds(sketch, ['nope'])).toBeNull();
  });

  it('rotates a quarter turn exactly around the middle', () => {
    const { sketch, ids } = square();
    const turned = rotatePoints(sketch, [ids[0]], 90, [0.5, 0.5]);
    expect(xy(turned, ids[0])).toEqual([1, 0]);
    const all = rotatePoints(sketch, ids, 90);
    expect(Object.values(all.points).map((p) => [p.x, p.y]).sort()).toEqual([[0, 0], [0, 1], [1, 0], [1, 1]]);
    // Lines and ids are untouched.
    expect(all.lines).toBe(sketch.lines);
  });

  it('rotates by any angle and keeps distances', () => {
    const { sketch, ids } = square();
    const turned = rotatePoints(sketch, ids, 30);
    const d = (s: Sketch) => Math.hypot(s.points[ids[0]].x - s.points[ids[2]].x, s.points[ids[0]].y - s.points[ids[2]].y);
    expect(d(turned)).toBeCloseTo(Math.SQRT2, 5);
    expect(pointsCentre(turned, ids)![0]).toBeCloseTo(0.5, 6);
  });

  it('scales and flips around the middle', () => {
    const { sketch, ids } = square();
    expect(pointsBounds(scalePoints(sketch, ids, 2), ids)).toEqual([-0.5, -0.5, 1.5, 1.5]);
    expect(pointsBounds(scalePoints(sketch, ids, 2, 1), ids)).toEqual([-0.5, 0, 1.5, 1]);
    const flipped = flipPoints(sketch, [ids[0], ids[1]], 'horizontal');
    expect(xy(flipped, ids[0])).toEqual([1, 0]);
    expect(xy(flipped, ids[1])).toEqual([0, 0]);
    expect(xy(flipPoints(sketch, ids, 'vertical'), ids[0])).toEqual([0, 1]);
    expect(() => scalePoints(sketch, ids, 0)).toThrow();
  });

  it('keeps the filled area after a flip (the outline still closes)', () => {
    const { sketch, ids } = square();
    const flipped = flipPoints(sketch, ids, 'horizontal');
    expect(findRegions(resolveSketch(flipped, false, 10))).toHaveLength(1);
  });

  it('aligns dots on an edge or centre line', () => {
    let sketch = createSketch('side');
    sketch = addPolyline(sketch, [[0, 0], [1, 0.4], [2.5, -0.2]], false).sketch;
    const ids = Object.keys(sketch.points);
    expect(Object.values(alignPoints(sketch, ids, 'bottom').points).map((p) => p.y)).toEqual([-0.2, -0.2, -0.2]);
    expect(Object.values(alignPoints(sketch, ids, 'top').points).map((p) => p.y)).toEqual([0.4, 0.4, 0.4]);
    expect(Object.values(alignPoints(sketch, ids, 'centre').points).map((p) => p.x)).toEqual([1.25, 1.25, 1.25]);
    expect(Object.values(alignPoints(sketch, ids, 'middle').points).map((p) => p.y)).toEqual([0.1, 0.1, 0.1]);
  });

  it('spaces dots evenly', () => {
    let sketch = createSketch('front');
    sketch = addPolyline(sketch, [[0, 0], [0.2, 0], [3, 0], [0.9, 1]], false).sketch;
    const ids = Object.keys(sketch.points);
    const spread = distributePoints(sketch, ids, 'horizontal');
    expect(Object.values(spread.points).map((p) => p.x).sort((a, b) => a - b)).toEqual([0, 1, 2, 3]);
    // Fewer than three dots: nothing to spread.
    expect(distributePoints(sketch, ids.slice(0, 2), 'horizontal')).toBe(sketch);
  });
});

describe('copy, paste and duplicate', () => {
  it('copies dots with the lines among them and pastes them as new ids', () => {
    const { sketch, ids } = square();
    const withSmooth = setPointsSmooth(sketch, [ids[1]], true);
    const fragment = copyFragment(withSmooth, ids.slice(0, 3))!;
    expect(fragment.points).toHaveLength(3);
    expect(fragment.lines).toHaveLength(2);
    expect(fragment.points.filter((p) => p.smooth)).toHaveLength(1);
    expect(isSketchFragment(JSON.parse(JSON.stringify(fragment)))).toBe(true);

    const pasted = pasteFragment(withSmooth, fragment, [5, 5]);
    expect(pasted.pointIds).toEqual(['p5', 'p6', 'p7']);
    expect(pasted.lineIds).toHaveLength(2);
    expect(Object.keys(pasted.sketch.points)).toHaveLength(7);
    expect(pointsCentre(pasted.sketch, pasted.pointIds)).toEqual([5, 5]);
  });

  it('duplicates a closed outline into a second filled area', () => {
    const { sketch, ids } = square();
    const copy = duplicatePoints(sketch, ids, 2, 0);
    expect(copy.pointIds).toHaveLength(4);
    expect(copy.lineIds).toHaveLength(4);
    expect(pointsBounds(copy.sketch, copy.pointIds)).toEqual([2, 0, 3, 1]);
    expect(findRegions(resolveSketch(copy.sketch, false, 10))).toHaveLength(2);
  });

  it('rejects clipboard data that is not a fragment', () => {
    expect(isSketchFragment(null)).toBe(false);
    expect(isSketchFragment({ plane: 'front', points: [], lines: [] })).toBe(false);
    expect(isSketchFragment({ plane: 'front', points: [{ x: 0, y: 0 }], lines: [[0, 3]] })).toBe(false);
    expect(isSketchFragment({ plane: 'up', points: [{ x: 0, y: 0 }], lines: [] })).toBe(false);
  });
});

describe('exact line sizes', () => {
  it('places a dot at a typed length and angle', () => {
    expect(polarPoint([1, 1], 2, 0)).toEqual([3, 1]);
    expect(polarPoint([1, 1], 2, 90)).toEqual([1, 3]);
    expect(polarPoint([0, 0], 1, 180)).toEqual([-1, 0]);
    const [x, y] = polarPoint([0, 0], 2, 30);
    expect(x).toBeCloseTo(Math.sqrt(3), 6);
    expect(y).toBeCloseTo(1, 6);
  });

  it('measures and resizes a line, keeping the end tied into the drawing', () => {
    let sketch = createSketch('front');
    sketch = addPolyline(sketch, [[0, 0], [1, 0], [1, 1]], false).sketch;
    const [first, second] = Object.keys(sketch.lines);
    expect(lineLength(sketch, first)).toBe(1);
    expect(lineAngle(sketch, first)).toBe(0);
    // p2 has two lines, p1 one: p2 stays, p1 moves.
    const longer = setLineLength(sketch, first, 2.5);
    expect(xy(longer, 'p2')).toEqual([1, 0]);
    expect(xy(longer, 'p1')).toEqual([-1.5, 0]);
    expect(lineLength(longer, first)).toBe(2.5);
    // Asked to keep the first end, the second moves instead.
    expect(xy(setLineLength(sketch, second, 3, 'a'), 'p3')).toEqual([1, 3]);
    expect(() => setLineLength(sketch, first, 0)).toThrow();
  });

  it('turns a line to an exact angle and keeps its length', () => {
    let sketch = createSketch('front');
    sketch = addPolyline(sketch, [[0, 0], [2, 0]], false).sketch;
    const id = Object.keys(sketch.lines)[0];
    const up = setLineAngle(sketch, id, 90, 'a');
    expect(xy(up, 'p2')).toEqual([0, 2]);
    expect(lineAngleFromAnchor(up, id, 'a')).toBe(90);
    const diagonal = setLineAngle(sketch, id, 45, 'a');
    expect(lineLength(diagonal, id)).toBeCloseTo(2, 5);
  });

  it('reports a missing line', () => {
    const sketch = addLine(addPolyline(createSketch('front'), [[0, 0], [1, 0]], false).sketch, 'p1', 'p2').sketch;
    expect(() => lineLength(sketch, 'l99')).toThrow(/does not exist/);
  });
});
