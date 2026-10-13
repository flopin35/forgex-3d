import { isFiniteNumber, roundTo } from '../math/vec3';
import { addLine, addPoint, SketchError, type Sketch, type SketchPlane, type SketchPoint } from './sketch';

/**
 * Group edits and exact sizes on a drawing: rotate, flip, scale, align and copy picked
 * dots, and set a line's length or angle. Every function returns a new sketch and
 * leaves dots that are not named untouched.
 */

type P = readonly [number, number];

/** Positions are kept to the micrometre so repeated edits do not collect float noise. */
const clean = (value: number) => roundTo(value, 6);

function existing(sketch: Sketch, ids: readonly string[]): SketchPoint[] {
  const seen = new Set<string>();
  const out: SketchPoint[] = [];
  for (const id of ids) {
    const p = sketch.points[id];
    if (p && !seen.has(id)) {
      seen.add(id);
      out.push(p);
    }
  }
  return out;
}

/** Moves each named dot to where `map` says. Unknown ids are ignored. */
export function mapPoints(sketch: Sketch, ids: readonly string[], map: (x: number, y: number) => P): Sketch {
  const picked = existing(sketch, ids);
  if (picked.length === 0) return sketch;
  const points = { ...sketch.points };
  let changed = false;
  for (const p of picked) {
    const [x, y] = map(p.x, p.y);
    if (!isFiniteNumber(x) || !isFiniteNumber(y)) throw new SketchError('That edit would move a dot to an invalid position.');
    const nx = clean(x);
    const ny = clean(y);
    if (nx === p.x && ny === p.y) continue;
    points[p.id] = { ...p, x: nx, y: ny };
    changed = true;
  }
  return changed ? { ...sketch, points } : sketch;
}

/** The box around some dots as [minX, minY, maxX, maxY], or null when none exist. */
export function pointsBounds(sketch: Sketch, ids: readonly string[]): [number, number, number, number] | null {
  const picked = existing(sketch, ids);
  if (picked.length === 0) return null;
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const p of picked) {
    minX = Math.min(minX, p.x);
    minY = Math.min(minY, p.y);
    maxX = Math.max(maxX, p.x);
    maxY = Math.max(maxY, p.y);
  }
  return [minX, minY, maxX, maxY];
}

/** The middle of the box around some dots: the pivot for rotate, flip and scale. */
export function pointsCentre(sketch: Sketch, ids: readonly string[]): [number, number] | null {
  const box = pointsBounds(sketch, ids);
  return box ? [(box[0] + box[2]) / 2, (box[1] + box[3]) / 2] : null;
}

/** Rotates dots counter-clockwise by `degrees` around `centre` (default: their middle). */
export function rotatePoints(sketch: Sketch, ids: readonly string[], degrees: number, centre?: P): Sketch {
  if (!isFiniteNumber(degrees)) throw new SketchError('A rotation needs an angle in degrees.');
  const pivot = centre ?? pointsCentre(sketch, ids);
  if (!pivot) return sketch;
  // Quarter turns are exact, so a square turned 90° stays on the grid.
  const turns = degrees / 90;
  let cos: number;
  let sin: number;
  if (Number.isInteger(turns)) {
    const q = ((turns % 4) + 4) % 4;
    cos = [1, 0, -1, 0][q];
    sin = [0, 1, 0, -1][q];
  } else {
    const rad = (degrees * Math.PI) / 180;
    cos = Math.cos(rad);
    sin = Math.sin(rad);
  }
  const [cx, cy] = pivot;
  return mapPoints(sketch, ids, (x, y) => [cx + (x - cx) * cos - (y - cy) * sin, cy + (x - cx) * sin + (y - cy) * cos]);
}

/** Scales dots around `centre` (default: their middle). 1 keeps the size, 2 doubles it. */
export function scalePoints(sketch: Sketch, ids: readonly string[], sx: number, sy: number = sx, centre?: P): Sketch {
  if (!isFiniteNumber(sx) || !isFiniteNumber(sy) || sx === 0 || sy === 0) throw new SketchError('A scale needs factors other than zero.');
  const pivot = centre ?? pointsCentre(sketch, ids);
  if (!pivot) return sketch;
  const [cx, cy] = pivot;
  return mapPoints(sketch, ids, (x, y) => [cx + (x - cx) * sx, cy + (y - cy) * sy]);
}

export type FlipDirection = 'horizontal' | 'vertical';

/** Flips dots left-right (horizontal) or upside down (vertical) around `centre` (default: their middle). */
export function flipPoints(sketch: Sketch, ids: readonly string[], direction: FlipDirection, centre?: P): Sketch {
  return direction === 'horizontal' ? scalePoints(sketch, ids, -1, 1, centre) : scalePoints(sketch, ids, 1, -1, centre);
}

export type AlignEdge = 'left' | 'centre' | 'right' | 'top' | 'middle' | 'bottom';
export const ALIGN_EDGES: readonly AlignEdge[] = ['left', 'centre', 'right', 'top', 'middle', 'bottom'];

/** Lines dots up on one edge or centre line of the box around them. */
export function alignPoints(sketch: Sketch, ids: readonly string[], edge: AlignEdge): Sketch {
  const box = pointsBounds(sketch, ids);
  if (!box) return sketch;
  const [minX, minY, maxX, maxY] = box;
  switch (edge) {
    case 'left':
      return mapPoints(sketch, ids, (_, y) => [minX, y]);
    case 'centre':
      return mapPoints(sketch, ids, (_, y) => [(minX + maxX) / 2, y]);
    case 'right':
      return mapPoints(sketch, ids, (_, y) => [maxX, y]);
    case 'top':
      return mapPoints(sketch, ids, (x) => [x, maxY]);
    case 'middle':
      return mapPoints(sketch, ids, (x) => [x, (minY + maxY) / 2]);
    case 'bottom':
      return mapPoints(sketch, ids, (x) => [x, minY]);
  }
}

/** Spaces three or more dots evenly between the outermost two, keeping their order. */
export function distributePoints(sketch: Sketch, ids: readonly string[], direction: FlipDirection): Sketch {
  const picked = existing(sketch, ids);
  if (picked.length < 3) return sketch;
  const axis = direction === 'horizontal' ? 'x' : 'y';
  const sorted = [...picked].sort((a, b) => a[axis] - b[axis] || (a.id < b.id ? -1 : 1));
  const first = sorted[0][axis];
  const step = (sorted[sorted.length - 1][axis] - first) / (sorted.length - 1);
  const target = new Map(sorted.map((p, i) => [p.id, first + step * i]));
  const points = { ...sketch.points };
  let changed = false;
  for (const p of sorted) {
    const value = clean(target.get(p.id)!);
    if (value === p[axis]) continue;
    points[p.id] = { ...p, [axis]: value };
    changed = true;
  }
  return changed ? { ...sketch, points } : sketch;
}

// -- Copy and paste ------------------------------------------------------------------------

/**
 * A copied piece of a drawing: dots (relative to the middle of the copy) and the lines
 * among them, by index. Plain data, so it can be kept on a clipboard and pasted into any
 * drawing, in this project or another.
 */
export interface SketchFragment {
  readonly plane: SketchPlane;
  readonly points: readonly { readonly x: number; readonly y: number; readonly smooth?: boolean }[];
  readonly lines: readonly (readonly [number, number])[];
}

/** Copies dots and the lines that join two of them. Returns null when no dot exists. */
export function copyFragment(sketch: Sketch, ids: readonly string[]): SketchFragment | null {
  const picked = existing(sketch, ids);
  if (picked.length === 0) return null;
  const [cx, cy] = pointsCentre(sketch, ids)!;
  const index = new Map(picked.map((p, i) => [p.id, i]));
  const lines: [number, number][] = [];
  for (const line of Object.values(sketch.lines)) {
    const a = index.get(line.a);
    const b = index.get(line.b);
    if (a !== undefined && b !== undefined) lines.push([a, b]);
  }
  return {
    plane: sketch.plane,
    points: picked.map((p) => (p.smooth ? { x: clean(p.x - cx), y: clean(p.y - cy), smooth: true } : { x: clean(p.x - cx), y: clean(p.y - cy) })),
    lines,
  };
}

/** Adds a copied fragment with its middle at `at`. Returns the new dot and line ids. */
export function pasteFragment(sketch: Sketch, fragment: SketchFragment, at: P): { sketch: Sketch; pointIds: string[]; lineIds: string[] } {
  let next = sketch;
  const pointIds: string[] = [];
  for (const p of fragment.points) {
    const added = addPoint(next, clean(at[0] + p.x), clean(at[1] + p.y), !!p.smooth);
    next = added.sketch;
    pointIds.push(added.pointId);
  }
  const lineIds: string[] = [];
  for (const [a, b] of fragment.lines) {
    if (!pointIds[a] || !pointIds[b] || a === b) continue;
    const joined = addLine(next, pointIds[a], pointIds[b]);
    next = joined.sketch;
    if (joined.created) lineIds.push(joined.lineId);
  }
  return { sketch: next, pointIds, lineIds };
}

/** Copies dots (and their lines) and pastes them shifted by (dx, dy). */
export function duplicatePoints(sketch: Sketch, ids: readonly string[], dx: number, dy: number): { sketch: Sketch; pointIds: string[]; lineIds: string[] } {
  const fragment = copyFragment(sketch, ids);
  if (!fragment) return { sketch, pointIds: [], lineIds: [] };
  const [cx, cy] = pointsCentre(sketch, ids)!;
  return pasteFragment(sketch, fragment, [cx + dx, cy + dy]);
}

/** Checks data from a clipboard or a file before it is pasted. */
export function isSketchFragment(value: unknown): value is SketchFragment {
  if (typeof value !== 'object' || value === null) return false;
  const f = value as Record<string, unknown>;
  if (f.plane !== 'front' && f.plane !== 'side' && f.plane !== 'top') return false;
  if (!Array.isArray(f.points) || !Array.isArray(f.lines) || f.points.length === 0 || f.points.length > 20_000) return false;
  const pointsOk = f.points.every((p) => typeof p === 'object' && p !== null && isFiniteNumber((p as { x: unknown }).x) && isFiniteNumber((p as { y: unknown }).y));
  const count = f.points.length;
  const linesOk = f.lines.every((l) => Array.isArray(l) && l.length === 2 && l.every((i) => Number.isInteger(i) && i >= 0 && i < count));
  return pointsOk && linesOk;
}

// -- Exact sizes --------------------------------------------------------------------------

/** A point `length` away from `from`, at `degrees` counter-clockwise from the board's x axis. */
export function polarPoint(from: P, length: number, degrees: number): [number, number] {
  const rad = (degrees * Math.PI) / 180;
  // Exact on the axes, so a typed 90° line is truly vertical.
  const quarter = degrees / 90;
  const cos = Number.isInteger(quarter) ? [1, 0, -1, 0][((quarter % 4) + 4) % 4] : Math.cos(rad);
  const sin = Number.isInteger(quarter) ? [0, 1, 0, -1][((quarter % 4) + 4) % 4] : Math.sin(rad);
  return [clean(from[0] + length * cos), clean(from[1] + length * sin)];
}

function lineEnds(sketch: Sketch, lineId: string): [SketchPoint, SketchPoint] {
  const line = sketch.lines[lineId];
  const a = line ? sketch.points[line.a] : undefined;
  const b = line ? sketch.points[line.b] : undefined;
  if (!line || !a || !b) throw new SketchError(`Line ${lineId} does not exist.`);
  return [a, b];
}

/** Straight distance between a line's two dots, in metres. */
export function lineLength(sketch: Sketch, lineId: string): number {
  const [a, b] = lineEnds(sketch, lineId);
  return Math.hypot(b.x - a.x, b.y - a.y);
}

/** Direction from a line's first dot to its second, in degrees counter-clockwise from the x axis (−180 to 180). */
export function lineAngle(sketch: Sketch, lineId: string): number {
  const [a, b] = lineEnds(sketch, lineId);
  return roundTo((Math.atan2(b.y - a.y, b.x - a.x) * 180) / Math.PI, 6);
}

/** Which end of a line stays put when it is resized or turned. */
export type LineAnchor = 'a' | 'b' | 'auto';

/**
 * The dot that stays put: the named end, or with 'auto' the end with more lines on it
 * (it is more tied into the drawing), or the first dot on a tie.
 */
function fixedEnd(sketch: Sketch, lineId: string, anchor: LineAnchor): { fixed: SketchPoint; moving: SketchPoint } {
  const [a, b] = lineEnds(sketch, lineId);
  if (anchor === 'a') return { fixed: a, moving: b };
  if (anchor === 'b') return { fixed: b, moving: a };
  let degreeA = 0;
  let degreeB = 0;
  for (const line of Object.values(sketch.lines)) {
    if (line.a === a.id || line.b === a.id) degreeA++;
    if (line.a === b.id || line.b === b.id) degreeB++;
  }
  return degreeB > degreeA ? { fixed: b, moving: a } : { fixed: a, moving: b };
}

/** Makes a line exactly `length` metres long by moving one end along it. */
export function setLineLength(sketch: Sketch, lineId: string, length: number, anchor: LineAnchor = 'auto'): Sketch {
  if (!isFiniteNumber(length) || length <= 0) throw new SketchError('A line length must be more than zero.');
  const { fixed, moving } = fixedEnd(sketch, lineId, anchor);
  const current = Math.hypot(moving.x - fixed.x, moving.y - fixed.y);
  const degrees = current === 0 ? 0 : (Math.atan2(moving.y - fixed.y, moving.x - fixed.x) * 180) / Math.PI;
  const [x, y] = polarPoint([fixed.x, fixed.y], length, roundTo(degrees, 9));
  return mapPoints(sketch, [moving.id], () => [x, y]);
}

/** Turns a line to `degrees` (counter-clockwise from the x axis, measured from the end that stays) keeping its length. */
export function setLineAngle(sketch: Sketch, lineId: string, degrees: number, anchor: LineAnchor = 'auto'): Sketch {
  if (!isFiniteNumber(degrees)) throw new SketchError('A line angle must be a number of degrees.');
  const { fixed, moving } = fixedEnd(sketch, lineId, anchor);
  const length = Math.hypot(moving.x - fixed.x, moving.y - fixed.y);
  if (length === 0) return sketch;
  const [x, y] = polarPoint([fixed.x, fixed.y], length, degrees);
  return mapPoints(sketch, [moving.id], () => [x, y]);
}

/** The angle of a line measured from the end that stays put, so the angle field matches what setLineAngle does. */
export function lineAngleFromAnchor(sketch: Sketch, lineId: string, anchor: LineAnchor = 'auto'): number {
  const { fixed, moving } = fixedEnd(sketch, lineId, anchor);
  return roundTo((Math.atan2(moving.y - fixed.y, moving.x - fixed.x) * 180) / Math.PI, 6);
}

/** Every dot id, for select all. */
export function allPointIds(sketch: Sketch): string[] {
  return Object.keys(sketch.points);
}
