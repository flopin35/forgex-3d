import { isFiniteNumber } from '../math/vec3';

/**
 * A blueprint sketch: dots (points) joined by lines on one drawing plane.
 * Closed loops of lines become filled shapes; the shape settings turn the
 * drawing into a 3D object (flat panel, extruded solid or revolved solid).
 */

export type SketchPlane = 'front' | 'side' | 'top';
export const SKETCH_PLANES: readonly SketchPlane[] = ['front', 'side', 'top'];

export type ShapeMode = 'flat' | 'extrude' | 'revolve';
export const SHAPE_MODES: readonly ShapeMode[] = ['flat', 'extrude', 'revolve'];

export interface SketchPoint {
  readonly id: string;
  /** Horizontal position on the drawing plane, in metres. */
  readonly x: number;
  /** Vertical position on the drawing plane, in metres. */
  readonly y: number;
  /** A smooth dot: the lines through it bend into a curve instead of meeting at a corner. */
  readonly smooth?: boolean;
}

export interface SketchLine {
  readonly id: string;
  readonly a: string;
  readonly b: string;
}

export interface Sketch {
  readonly plane: SketchPlane;
  readonly points: Readonly<Record<string, SketchPoint>>;
  readonly lines: Readonly<Record<string, SketchLine>>;
  readonly counters: { readonly point: number; readonly line: number };
}

/** The axis a revolve spins around: the board's vertical line (x = 0) or its horizontal line (y = 0). */
export type RevolveAxis = 'vertical' | 'horizontal';
export const REVOLVE_AXES: readonly RevolveAxis[] = ['vertical', 'horizontal'];

export interface ShapeSettings {
  readonly mode: ShapeMode;
  /** Extrusion thickness in metres. */
  readonly depth: number;
  /** Steps around the axis when revolving. */
  readonly segments: number;
  /** Mirror the drawing across the vertical axis (x = 0). */
  readonly mirror: boolean;
  /** Revolve around the vertical axis (vases, bottles) or the horizontal one (wheels, barrels). */
  readonly axis: RevolveAxis;
  /** Straight pieces used for each curved line (smooth dots). */
  readonly curveSteps: number;
}

export const DEFAULT_CURVE_STEPS = 10;
export const MIN_CURVE_STEPS = 2;
export const MAX_CURVE_STEPS = 48;
export const DEFAULT_SHAPE: ShapeSettings = { mode: 'extrude', depth: 0.2, segments: 32, mirror: false, axis: 'vertical', curveSteps: DEFAULT_CURVE_STEPS };
export const MIN_SEGMENTS = 3;
export const MAX_SEGMENTS = 256;
export const MAX_DEPTH = 1000;

/** Points closer than this to the axis count as on it (shared by mirror and revolve). */
export const AXIS_EPSILON = 1e-6;

export class SketchError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SketchError';
  }
}

export function createSketch(plane: SketchPlane = 'front'): Sketch {
  return { plane, points: {}, lines: {}, counters: { point: 1, line: 1 } };
}

function linePairKey(a: string, b: string): string {
  return a < b ? `${a}\u0000${b}` : `${b}\u0000${a}`;
}

export function findLine(sketch: Sketch, a: string, b: string): SketchLine | undefined {
  const key = linePairKey(a, b);
  return Object.values(sketch.lines).find((line) => linePairKey(line.a, line.b) === key);
}

export function addPoint(sketch: Sketch, x: number, y: number, smooth = false): { sketch: Sketch; pointId: string } {
  if (!isFiniteNumber(x) || !isFiniteNumber(y)) throw new SketchError('A dot needs finite x and y positions.');
  const id = `p${sketch.counters.point}`;
  return {
    pointId: id,
    sketch: {
      ...sketch,
      points: { ...sketch.points, [id]: smooth ? { id, x, y, smooth: true } : { id, x, y } },
      counters: { ...sketch.counters, point: sketch.counters.point + 1 },
    },
  };
}

/** Joins two dots. Joining already-joined dots returns the existing line. */
export function addLine(sketch: Sketch, a: string, b: string): { sketch: Sketch; lineId: string; created: boolean } {
  if (!sketch.points[a] || !sketch.points[b]) throw new SketchError('A line must join two existing dots.');
  if (a === b) throw new SketchError('A line needs two different dots.');
  const existing = findLine(sketch, a, b);
  if (existing) return { sketch, lineId: existing.id, created: false };
  const id = `l${sketch.counters.line}`;
  return {
    lineId: id,
    created: true,
    sketch: {
      ...sketch,
      lines: { ...sketch.lines, [id]: { id, a, b } },
      counters: { ...sketch.counters, line: sketch.counters.line + 1 },
    },
  };
}

export function movePoint(sketch: Sketch, id: string, x: number, y: number): Sketch {
  const p = sketch.points[id];
  if (!p) throw new SketchError(`Dot ${id} does not exist.`);
  if (!isFiniteNumber(x) || !isFiniteNumber(y)) throw new SketchError('A dot needs finite x and y positions.');
  return { ...sketch, points: { ...sketch.points, [id]: { ...p, x, y } } };
}

/** Makes dots smooth (curved) or sharp (corners). Unknown ids are ignored. */
export function setPointsSmooth(sketch: Sketch, ids: readonly string[], smooth: boolean): Sketch {
  const points = { ...sketch.points };
  let changed = false;
  for (const id of ids) {
    const p = sketch.points[id];
    if (!p || !!p.smooth === smooth) continue;
    points[id] = smooth ? { ...p, smooth: true } : { id: p.id, x: p.x, y: p.y };
    changed = true;
  }
  return changed ? { ...sketch, points } : sketch;
}

/** Removes a dot and every line attached to it. */
export function removePoint(sketch: Sketch, id: string): Sketch {
  if (!sketch.points[id]) throw new SketchError(`Dot ${id} does not exist.`);
  const points = { ...sketch.points };
  delete points[id];
  const lines: Record<string, SketchLine> = {};
  for (const line of Object.values(sketch.lines)) if (line.a !== id && line.b !== id) lines[line.id] = line;
  return { ...sketch, points, lines };
}

export function removeLine(sketch: Sketch, id: string): Sketch {
  if (!sketch.lines[id]) throw new SketchError(`Line ${id} does not exist.`);
  const lines = { ...sketch.lines };
  delete lines[id];
  return { ...sketch, lines };
}

export function setPlane(sketch: Sketch, plane: SketchPlane): Sketch {
  return plane === sketch.plane ? sketch : { ...sketch, plane };
}

/** Adds a chain of dots joined in order (closed joins the last back to the first). */
export function addPolyline(
  sketch: Sketch,
  points: readonly (readonly [number, number])[],
  closed: boolean,
  smooth: boolean | ((index: number) => boolean) = false,
): { sketch: Sketch; pointIds: string[] } {
  let next = sketch;
  const ids: string[] = [];
  for (const [i, [x, y]] of points.entries()) {
    const added = addPoint(next, x, y, typeof smooth === 'function' ? smooth(i) : smooth);
    next = added.sketch;
    ids.push(added.pointId);
  }
  for (let i = 0; i + 1 < ids.length; i++) next = addLine(next, ids[i], ids[i + 1]).sketch;
  if (closed && ids.length >= 3) next = addLine(next, ids[ids.length - 1], ids[0]).sketch;
  return { sketch: next, pointIds: ids };
}

export function rectanglePoints(x0: number, y0: number, x1: number, y1: number): [number, number][] {
  return [
    [x0, y0],
    [x1, y0],
    [x1, y1],
    [x0, y1],
  ];
}

/** Regular polygon (a circle with many sides), starting at the top. */
export function polygonPoints(cx: number, cy: number, radius: number, sides: number): [number, number][] {
  const n = Math.max(3, Math.min(256, Math.round(sides)));
  return Array.from({ length: n }, (_, i) => {
    const angle = Math.PI / 2 + (i * 2 * Math.PI) / n;
    return [cx + radius * Math.cos(angle), cy + radius * Math.sin(angle)] as [number, number];
  });
}

/** Puts a new dot on a line at (x, y), splitting the line in two. */
export function splitLine(sketch: Sketch, lineId: string, x: number, y: number): { sketch: Sketch; pointId: string } {
  const line = sketch.lines[lineId];
  if (!line) throw new SketchError(`Line ${lineId} does not exist.`);
  // A dot added on a curve stays on the curve.
  const smooth = !!(sketch.points[line.a]?.smooth || sketch.points[line.b]?.smooth);
  const added = addPoint(removeLine(sketch, lineId), x, y, smooth);
  let next = addLine(added.sketch, line.a, added.pointId).sketch;
  next = addLine(next, added.pointId, line.b).sketch;
  return { sketch: next, pointId: added.pointId };
}

/** The point on a line closest to (x, y), kept slightly away from its ends. */
export function closestOnLine(sketch: Sketch, lineId: string, x: number, y: number): [number, number] {
  const line = sketch.lines[lineId];
  const a = line ? sketch.points[line.a] : undefined;
  const b = line ? sketch.points[line.b] : undefined;
  if (!a || !b) throw new SketchError(`Line ${lineId} does not exist.`);
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const lengthSq = dx * dx + dy * dy;
  const t = lengthSq === 0 ? 0.5 : Math.max(0.02, Math.min(0.98, ((x - a.x) * dx + (y - a.y) * dy) / lengthSq));
  return [a.x + t * dx, a.y + t * dy];
}

/** Removes lines and dots (and the lines of removed dots). Unknown ids are ignored. */
export function removeItems(sketch: Sketch, pointIds: readonly string[], lineIds: readonly string[]): Sketch {
  const dropPoints = new Set(pointIds.filter((id) => sketch.points[id]));
  const dropLines = new Set(lineIds);
  if (dropPoints.size === 0 && ![...dropLines].some((id) => sketch.lines[id])) return sketch;
  const points: Record<string, SketchPoint> = {};
  for (const p of Object.values(sketch.points)) if (!dropPoints.has(p.id)) points[p.id] = p;
  const lines: Record<string, SketchLine> = {};
  for (const line of Object.values(sketch.lines)) {
    if (!dropLines.has(line.id) && !dropPoints.has(line.a) && !dropPoints.has(line.b)) lines[line.id] = line;
  }
  return { ...sketch, points, lines };
}

/** Moves several dots by the same offset. */
export function translatePoints(sketch: Sketch, ids: readonly string[], dx: number, dy: number): Sketch {
  if (!isFiniteNumber(dx) || !isFiniteNumber(dy)) throw new SketchError('A move needs finite offsets.');
  const points = { ...sketch.points };
  let moved = false;
  for (const id of ids) {
    const p = sketch.points[id];
    if (!p) continue;
    points[id] = { ...p, x: p.x + dx, y: p.y + dy };
    moved = true;
  }
  return moved ? { ...sketch, points } : sketch;
}

/** Joins dot `from` into dot `into`: its lines move over, duplicates and zero-length lines disappear. */
export function mergePoints(sketch: Sketch, from: string, into: string): Sketch {
  if (!sketch.points[from] || !sketch.points[into]) throw new SketchError('Both dots must exist to join them.');
  if (from === into) return sketch;
  const points = { ...sketch.points };
  delete points[from];
  const lines: Record<string, SketchLine> = {};
  const seen = new Set<string>();
  for (const line of Object.values(sketch.lines)) {
    const a = line.a === from ? into : line.a;
    const b = line.b === from ? into : line.b;
    if (a === b) continue;
    const key = linePairKey(a, b);
    if (seen.has(key)) continue;
    seen.add(key);
    lines[line.id] = a === line.a && b === line.b ? line : { id: line.id, a, b };
  }
  return { ...sketch, points, lines };
}

/** Number of lines attached to a dot. */
export function pointDegree(sketch: Sketch, id: string): number {
  let count = 0;
  for (const line of Object.values(sketch.lines)) if (line.a === id || line.b === id) count++;
  return count;
}

/** Lines whose both dots are in the set. */
export function linesBetween(sketch: Sketch, pointIds: ReadonlySet<string>): string[] {
  return Object.values(sketch.lines)
    .filter((line) => pointIds.has(line.a) && pointIds.has(line.b))
    .map((line) => line.id);
}

export function sketchCounts(sketch: Sketch): { points: number; lines: number } {
  return { points: Object.keys(sketch.points).length, lines: Object.keys(sketch.lines).length };
}

function clampInt(value: unknown, min: number, max: number, fallback: number): number {
  return Math.min(max, Math.max(min, Math.round(isFiniteNumber(value) ? value : fallback)));
}

/** Fills in missing settings (older files) and keeps every value in range. */
export function clampShape(shape: Partial<ShapeSettings>): ShapeSettings {
  return {
    mode: SHAPE_MODES.includes(shape.mode as ShapeMode) ? (shape.mode as ShapeMode) : DEFAULT_SHAPE.mode,
    depth: Math.min(MAX_DEPTH, Math.max(0, isFiniteNumber(shape.depth) ? shape.depth : DEFAULT_SHAPE.depth)),
    segments: clampInt(shape.segments, MIN_SEGMENTS, MAX_SEGMENTS, DEFAULT_SHAPE.segments),
    mirror: shape.mirror === true,
    axis: REVOLVE_AXES.includes(shape.axis as RevolveAxis) ? (shape.axis as RevolveAxis) : 'vertical',
    curveSteps: clampInt(shape.curveSteps, MIN_CURVE_STEPS, MAX_CURVE_STEPS, DEFAULT_CURVE_STEPS),
  };
}
