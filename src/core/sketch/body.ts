import type { ConstructionGraph } from '../geometry/constructionGraph';
import { GraphBuilder } from '../geometry/graphBuilder';
import { orientFaces } from '../geometry/orientation';
import { isFiniteNumber } from '../math/vec3';
import { findRegions, resolveSketch } from './regions';
import { createSketch, DEFAULT_CURVE_STEPS, MAX_CURVE_STEPS, MIN_CURVE_STEPS, type Sketch } from './sketch';

/**
 * A body is lofted from three drawings, the way car designers work from blueprints:
 * the side view gives the height along the length, the top view gives the width
 * along the length, and the front view gives the shape of each cross-section.
 */
export type BodyView = 'side' | 'top' | 'front';
export const BODY_VIEWS: readonly BodyView[] = ['side', 'top', 'front'];

export interface BodyViews {
  readonly side: Sketch;
  readonly top: Sketch;
  readonly front: Sketch;
}

export interface BodySettings {
  /** Slices along the length. More slices follow the outlines more closely. */
  readonly stations: number;
  /** Points around each slice. */
  readonly sectionPoints: number;
  /** Cross-section used when the front view is empty: 2 is an oval, higher is boxier. */
  readonly roundness: number;
  /** The top and front views are drawn as their right half and mirrored across the centre line. */
  readonly symmetric: boolean;
  /** Straight pieces per curved line (smooth dots). */
  readonly curveSteps: number;
}

export const DEFAULT_BODY: BodySettings = { stations: 48, sectionPoints: 40, roundness: 4, symmetric: true, curveSteps: DEFAULT_CURVE_STEPS };
export const BODY_LIMITS = {
  stations: [4, 200],
  sectionPoints: [8, 160],
  roundness: [1.5, 12],
} as const;

function clampNumber(value: unknown, [min, max]: readonly [number, number], fallback: number, round: boolean): number {
  const n = isFiniteNumber(value) ? value : fallback;
  return Math.min(max, Math.max(min, round ? Math.round(n) : n));
}

export function clampBody(raw: Partial<BodySettings>): BodySettings {
  return {
    stations: clampNumber(raw.stations, BODY_LIMITS.stations, DEFAULT_BODY.stations, true),
    sectionPoints: clampNumber(raw.sectionPoints, BODY_LIMITS.sectionPoints, DEFAULT_BODY.sectionPoints, true),
    roundness: clampNumber(raw.roundness, BODY_LIMITS.roundness, DEFAULT_BODY.roundness, false),
    symmetric: raw.symmetric !== false,
    curveSteps: clampNumber(raw.curveSteps, [MIN_CURVE_STEPS, MAX_CURVE_STEPS], DEFAULT_CURVE_STEPS, true),
  };
}

export function createBodyViews(): BodyViews {
  return { side: createSketch('side'), top: createSketch('top'), front: createSketch('front') };
}

type P = [number, number];

/** The outline of a view's largest filled area, in board coordinates, or null when nothing is closed. */
export function viewOutline(sketch: Sketch, mirror: boolean, curveSteps: number): P[] | null {
  const resolved = resolveSketch(sketch, mirror, curveSteps);
  const regions = findRegions(resolved);
  if (regions.length === 0) return null;
  const largest = regions.reduce((best, region) => (region.area > best.area ? region : best));
  return largest.outer.map((id) => resolved.points.get(id)!);
}

/** Where a line at `value` crosses a polygon: the other coordinate of each crossing, sorted. */
function crossings(polygon: readonly P[], along: 0 | 1, value: number): number[] {
  const other = along === 0 ? 1 : 0;
  const out: number[] = [];
  for (let i = 0; i < polygon.length; i++) {
    const a = polygon[i];
    const b = polygon[(i + 1) % polygon.length];
    const lo = Math.min(a[along], b[along]);
    const hi = Math.max(a[along], b[along]);
    if (value < lo || value >= hi || hi === lo) continue;
    const t = (value - a[along]) / (b[along] - a[along]);
    out.push(a[other] + t * (b[other] - a[other]));
  }
  return out.sort((m, n) => m - n);
}

function extent(polygon: readonly P[], index: 0 | 1): [number, number] {
  let min = Infinity;
  let max = -Infinity;
  for (const p of polygon) {
    min = Math.min(min, p[index]);
    max = Math.max(max, p[index]);
  }
  return [min, max];
}

/** Resamples a closed polygon to exactly `count` points, keeping its corners when it has fewer. */
function resample(polygon: readonly P[], count: number): P[] {
  if (polygon.length >= count) {
    const lengths = polygon.map((p, i) => {
      const q = polygon[(i + 1) % polygon.length];
      return Math.hypot(q[0] - p[0], q[1] - p[1]);
    });
    const total = lengths.reduce((s, l) => s + l, 0);
    const out: P[] = [];
    let edge = 0;
    let walked = 0;
    for (let k = 0; k < count; k++) {
      const target = (total * k) / count;
      while (edge < polygon.length - 1 && walked + lengths[edge] < target) walked += lengths[edge++];
      const p = polygon[edge];
      const q = polygon[(edge + 1) % polygon.length];
      const t = lengths[edge] > 0 ? (target - walked) / lengths[edge] : 0;
      out.push([p[0] + t * (q[0] - p[0]), p[1] + t * (q[1] - p[1])]);
    }
    return out;
  }
  const out = [...polygon];
  while (out.length < count) {
    let longest = 0;
    let best = -1;
    for (let i = 0; i < out.length; i++) {
      const p = out[i];
      const q = out[(i + 1) % out.length];
      const l = Math.hypot(q[0] - p[0], q[1] - p[1]);
      if (l > best) {
        best = l;
        longest = i;
      }
    }
    const p = out[longest];
    const q = out[(longest + 1) % out.length];
    out.splice(longest + 1, 0, [(p[0] + q[0]) / 2, (p[1] + q[1]) / 2]);
  }
  return out;
}

/** The cross-section as [u, v] pairs: u from -1 (left) to 1 (right), v from 0 (bottom) to 1 (top). */
function sectionShape(front: P[] | null, settings: BodySettings): P[] {
  const m = settings.sectionPoints;
  if (front) {
    const [x0, x1] = extent(front, 0);
    const [y0, y1] = extent(front, 1);
    const cx = (x0 + x1) / 2;
    const hw = (x1 - x0) / 2;
    const h = y1 - y0;
    if (hw > 1e-9 && h > 1e-9) {
      // Start at the dot nearest the bottom centre so the seam sits underneath.
      let start = 0;
      let best = Infinity;
      front.forEach(([x, y], i) => {
        const d = Math.hypot((x - cx) / hw, (y - y0) / h);
        if (d < best) {
          best = d;
          start = i;
        }
      });
      const rotated = [...front.slice(start), ...front.slice(0, start)];
      return resample(rotated, m).map(([x, y]) => [(x - cx) / hw, (y - y0) / h] as P);
    }
  }
  const exponent = 2 / settings.roundness;
  return Array.from({ length: m }, (_, k) => {
    // Start at the bottom centre and go round counter-clockwise.
    const angle = -Math.PI / 2 + (2 * Math.PI * k) / m;
    const c = Math.cos(angle);
    const s = Math.sin(angle);
    const u = Math.sign(c) * Math.abs(c) ** exponent;
    const w = Math.sign(s) * Math.abs(s) ** exponent;
    return [u, (w + 1) / 2] as P;
  });
}

export interface GeneratedBody {
  graph: ConstructionGraph;
  /** Slices actually built. */
  stations: number;
  /** Which views have a closed outline. */
  closed: Record<BodyView, boolean>;
  /** What is missing, in words, or null when the body was built. */
  message: string | null;
}

export interface BodyExtents {
  /** Side view: length (z) and height (y) ranges in object space. */
  side: { z: [number, number]; y: [number, number] } | null;
  /** Top view: width (x) and length (z) ranges. */
  top: { x: [number, number]; z: [number, number] } | null;
  /** Front view: width (x) and height (y) ranges. */
  front: { x: [number, number]; y: [number, number] } | null;
}

/** The outlines of a body's views mapped into object space (+Y up, front faces +Z). */
function outlines(views: BodyViews, settings: BodySettings) {
  const side = viewOutline(views.side, false, settings.curveSteps);
  const top = viewOutline(views.top, settings.symmetric, settings.curveSteps);
  const front = viewOutline(views.front, settings.symmetric, settings.curveSteps);
  return { side, top, front };
}

/** Bounding ranges of each view, used to line the views up on the board. */
export function bodyExtents(views: BodyViews, settings: BodySettings): BodyExtents {
  const { side, top, front } = outlines(views, settings);
  const negate = ([a, b]: [number, number]): [number, number] => [-b, -a];
  return {
    // Side view: board x is -Z, board y is Y.
    side: side ? { z: negate(extent(side, 0)), y: extent(side, 1) } : null,
    // Top view: board x is X, board y is -Z.
    top: top ? { x: extent(top, 0), z: negate(extent(top, 1)) } : null,
    front: front ? { x: extent(front, 0), y: extent(front, 1) } : null,
  };
}

const cache = new WeakMap<BodyViews, Map<string, GeneratedBody>>();

export function generateBody(views: BodyViews, settings: BodySettings): GeneratedBody {
  const key = `${settings.stations}|${settings.sectionPoints}|${settings.roundness}|${settings.symmetric}|${settings.curveSteps}`;
  let byKey = cache.get(views);
  if (!byKey) {
    byKey = new Map();
    cache.set(views, byKey);
  }
  const cached = byKey.get(key);
  if (cached) return cached;
  const result = buildBody(views, settings);
  byKey.set(key, result);
  return result;
}

function buildBody(views: BodyViews, settings: BodySettings): GeneratedBody {
  const { side, top, front } = outlines(views, settings);
  const closed = { side: !!side, top: !!top, front: !!front };
  const empty = (message: string): GeneratedBody => ({ graph: new GraphBuilder().build(), stations: 0, closed, message });
  if (!side) return empty('Draw the side view as a closed outline (Side tab).');
  if (!top) {
    return empty(
      settings.symmetric
        ? 'Draw the top view (Top tab): the right half of the outline, from the centre line round to the centre line.'
        : 'Draw the top view as a closed outline (Top tab).',
    );
  }

  // Length ranges in object z: side board x is -z, top board y is -z.
  const [sx0, sx1] = extent(side, 0);
  const [ty0, ty1] = extent(top, 1);
  const z0 = Math.max(-sx1, -ty1);
  const z1 = Math.min(-sx0, -ty0);
  if (!(z1 - z0 > 1e-6)) return empty('The side and top views do not overlap along the length. Line them up front to back.');

  const section = sectionShape(front, settings);
  const builder = new GraphBuilder();
  const rings: string[][] = [];
  const n = settings.stations;
  for (let i = 0; i < n; i++) {
    // Slices bunch up towards the nose and tail, where the outline turns fastest.
    const t = (1 - Math.cos((Math.PI * (i + 0.5)) / n)) / 2;
    const z = z1 - t * (z1 - z0);
    const ys = crossings(side, 0, -z);
    const xs = crossings(top, 1, -z);
    if (ys.length < 2 || xs.length < 2) continue;
    const yLow = ys[0];
    const yHigh = ys[ys.length - 1];
    const xLow = xs[0];
    const xHigh = xs[xs.length - 1];
    if (yHigh - yLow < 1e-5 || xHigh - xLow < 1e-5) continue;
    const cx = (xLow + xHigh) / 2;
    const hw = (xHigh - xLow) / 2;
    rings.push(section.map(([u, v]) => builder.vertex([cx + u * hw, yLow + v * (yHigh - yLow), z])));
  }
  if (rings.length < 2) return empty('The outlines are too thin to build a body. Make the side and top views taller and wider.');

  const m = section.length;
  for (let i = 0; i + 1 < rings.length; i++) {
    for (let k = 0; k < m; k++) {
      const k1 = (k + 1) % m;
      builder.face([rings[i][k], rings[i][k1], rings[i + 1][k1], rings[i + 1][k]]);
    }
  }
  builder.face(rings[0]);
  builder.face([...rings[rings.length - 1]].reverse());
  const graph = orientFaces(builder.build()).graph;
  return { graph, stations: rings.length, closed, message: null };
}
