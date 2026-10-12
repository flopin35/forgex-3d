import { isFiniteNumber } from '../math/vec3';
import {
  clampShape,
  SHAPE_MODES,
  SKETCH_PLANES,
  type ShapeMode,
  type ShapeSettings,
  type Sketch,
  type SketchLine,
  type SketchPlane,
  type SketchPoint,
} from './sketch';

/** The dots and lines of one drawing as written into a .forgex file. */
export interface SketchViewJson {
  points: { id: string; x: number; y: number; smooth?: true }[];
  lines: { id: string; a: string; b: string }[];
}

/** A blueprint as written into a .forgex file. */
export interface SketchJson extends SketchViewJson {
  plane: SketchPlane;
  shape: ShapeSettings;
}

export function viewToJson(sketch: Sketch): SketchViewJson {
  return {
    points: Object.values(sketch.points).map((p) => (p.smooth ? { id: p.id, x: p.x, y: p.y, smooth: true } : { id: p.id, x: p.x, y: p.y })),
    lines: Object.values(sketch.lines).map((l) => ({ id: l.id, a: l.a, b: l.b })),
  };
}

export function sketchToJson(sketch: Sketch, shape: ShapeSettings): SketchJson {
  return {
    plane: sketch.plane,
    ...viewToJson(sketch),
    shape: { ...shape },
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isId(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0 && value.length <= 64;
}

function nextCounter(ids: Iterable<string>, prefix: string): number {
  let max = 0;
  const pattern = new RegExp(`^${prefix}(\\d+)$`);
  for (const id of ids) {
    const match = pattern.exec(id);
    if (match) max = Math.max(max, Number(match[1]));
  }
  return max + 1;
}

/** Reads the dots and lines of one drawing. Problems go into `errors`; returns null if there were any. */
export function viewFromJson(raw: unknown, plane: SketchPlane, path: string, errors: string[]): Sketch | null {
  const start = errors.length;
  if (!isRecord(raw) || !Array.isArray(raw.points) || !Array.isArray(raw.lines)) {
    errors.push(`${path} needs points and lines lists.`);
    return null;
  }
  const points: Record<string, SketchPoint> = {};
  raw.points.forEach((item, i) => {
    const at = `${path}.points[${i}]`;
    if (!isRecord(item) || !isId(item.id)) return void errors.push(`${at} needs a text id.`);
    if (points[item.id]) return void errors.push(`${at}: dot id ${item.id} is used twice.`);
    if (!isFiniteNumber(item.x) || !isFiniteNumber(item.y)) return void errors.push(`${at}: x and y must be finite numbers.`);
    if (item.smooth !== undefined && typeof item.smooth !== 'boolean') return void errors.push(`${at}: smooth must be true or false.`);
    points[item.id] = item.smooth ? { id: item.id, x: item.x, y: item.y, smooth: true } : { id: item.id, x: item.x, y: item.y };
  });
  const lines: Record<string, SketchLine> = {};
  const pairs = new Set<string>();
  raw.lines.forEach((item, i) => {
    const at = `${path}.lines[${i}]`;
    if (!isRecord(item) || !isId(item.id)) return void errors.push(`${at} needs a text id.`);
    if (lines[item.id]) return void errors.push(`${at}: line id ${item.id} is used twice.`);
    const { a, b } = item;
    if (!isId(a) || !isId(b) || !points[a] || !points[b]) return void errors.push(`${at}: line ${item.id} must join two existing dots.`);
    if (a === b) return void errors.push(`${at}: line ${item.id} joins dot ${a} to itself.`);
    const key = a < b ? `${a}|${b}` : `${b}|${a}`;
    if (pairs.has(key)) return void errors.push(`${at}: dots ${a} and ${b} are joined twice.`);
    pairs.add(key);
    lines[item.id] = { id: item.id, a, b };
  });
  if (errors.length > start) return null;
  return { plane, points, lines, counters: { point: nextCounter(Object.keys(points), 'p'), line: nextCounter(Object.keys(lines), 'l') } };
}

/** Reads a blueprint from file data. Problems go into `errors`; returns null if there were any. */
export function sketchFromJson(raw: unknown, path: string, errors: string[]): { sketch: Sketch; shape: ShapeSettings } | null {
  const start = errors.length;
  if (!isRecord(raw)) {
    errors.push(`${path} must describe a blueprint.`);
    return null;
  }
  if (!SKETCH_PLANES.includes(raw.plane as SketchPlane)) errors.push(`${path}.plane must be one of: ${SKETCH_PLANES.join(', ')}.`);
  const sketch = viewFromJson(raw, (raw.plane as SketchPlane) ?? 'front', path, errors);
  const shapeRaw = isRecord(raw.shape) ? raw.shape : {};
  if (!SHAPE_MODES.includes(shapeRaw.mode as ShapeMode)) errors.push(`${path}.shape.mode must be one of: ${SHAPE_MODES.join(', ')}.`);
  if (errors.length > start || !sketch) return null;
  return { sketch, shape: clampShape(shapeRaw as Partial<ShapeSettings>) };
}
