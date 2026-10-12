import { snapScalar } from '../core/math/vec3';
import type { Sketch } from '../core/sketch/sketch';

/** Maps drawing-plane metres to board pixels. +y is up on the plane, down on screen. */
export interface BoardView {
  /** Pixels per metre. */
  scale: number;
  /** Screen position of the plane origin. */
  ox: number;
  oy: number;
}

export const MIN_SCALE = 8;
export const MAX_SCALE = 4000;

export function toScreen(view: BoardView, x: number, y: number): [number, number] {
  return [view.ox + x * view.scale, view.oy - y * view.scale];
}

export function toPlane(view: BoardView, sx: number, sy: number): [number, number] {
  return [(sx - view.ox) / view.scale, (view.oy - sy) / view.scale];
}

/** Zooms by `factor` keeping the plane point under (sx, sy) fixed on screen. */
export function zoomAt(view: BoardView, sx: number, sy: number, factor: number): BoardView {
  const scale = Math.min(MAX_SCALE, Math.max(MIN_SCALE, view.scale * factor));
  const [px, py] = toPlane(view, sx, sy);
  return { scale, ox: sx - px * scale, oy: sy + py * scale };
}

/** A box on the board in metres: [minX, minY, maxX, maxY]. */
export type BoardBox = [number, number, number, number];

/**
 * A view that fits the drawing and any reference pictures (or a default 4 m area)
 * into the board with a margin.
 */
export function fitView(sketch: Sketch | null, width: number, height: number, mirror: boolean, boxes: readonly BoardBox[] = []): BoardView {
  const points = sketch ? Object.values(sketch.points) : [];
  let minX = -2;
  let maxX = 2;
  let minY = -1;
  let maxY = 2;
  if (points.length > 0 || boxes.length > 0) {
    const xs = [...points.flatMap((p) => (mirror ? [p.x, -p.x] : [p.x])), ...boxes.flatMap((b) => [b[0], b[2]])];
    const ys = [...points.map((p) => p.y), ...boxes.flatMap((b) => [b[1], b[3]])];
    minX = Math.min(...xs, 0);
    maxX = Math.max(...xs, 0);
    minY = Math.min(...ys);
    maxY = Math.max(...ys);
    // Pictures already carry their own white space, so they need less margin than dots.
    const margin = points.length > 0 ? 0.25 : 0.08;
    const padX = Math.max(points.length > 0 ? 0.5 : 0.1, (maxX - minX) * margin);
    const padY = Math.max(points.length > 0 ? 0.5 : 0.1, (maxY - minY) * margin);
    minX -= padX;
    maxX += padX;
    minY -= padY;
    maxY += padY;
  }
  const scale = Math.min(MAX_SCALE, Math.max(MIN_SCALE, Math.min(width / (maxX - minX), height / (maxY - minY))));
  return {
    scale,
    ox: width / 2 - ((minX + maxX) / 2) * scale,
    oy: height / 2 + ((minY + maxY) / 2) * scale,
  };
}

/** Grid spacing on screen: the project grid, coarsened so lines stay at least 12 px apart. */
export function gridStep(view: BoardView, gridSize: number): number {
  let step = gridSize;
  while (step * view.scale < 12) step *= 2;
  return step;
}

export interface SnapOptions {
  gridSize: number;
  snapToGrid: boolean;
  /** Pull towards x = 0 (mirror and revolve axis). */
  snapToAxis: boolean;
  /** Restrict to 45° steps from this point (Shift held). */
  angleFrom?: [number, number] | null;
}

/** Snaps a plane position: angle steps, then grid, then the axis. */
export function snapPoint(view: BoardView, x: number, y: number, options: SnapOptions): [number, number] {
  let px = x;
  let py = y;
  if (options.angleFrom) {
    const [ax, ay] = options.angleFrom;
    const dx = px - ax;
    const dy = py - ay;
    const length = Math.hypot(dx, dy);
    const angle = Math.round(Math.atan2(dy, dx) / (Math.PI / 4)) * (Math.PI / 4);
    px = ax + Math.cos(angle) * length;
    py = ay + Math.sin(angle) * length;
  }
  if (options.snapToGrid && options.gridSize > 0) {
    px = snapScalar(px, options.gridSize);
    py = snapScalar(py, options.gridSize);
  }
  if (options.snapToAxis && Math.abs(px) * view.scale < 10) px = 0;
  return [px, py];
}

/** The dot nearest to a screen position within `radius` pixels, ignoring `skip`. */
export function dotAt(view: BoardView, sketch: Sketch, sx: number, sy: number, radius = 11, skip?: ReadonlySet<string>): string | null {
  let best: string | null = null;
  let bestDistance = radius;
  for (const p of Object.values(sketch.points)) {
    if (skip?.has(p.id)) continue;
    const [px, py] = toScreen(view, p.x, p.y);
    const distance = Math.hypot(px - sx, py - sy);
    if (distance <= bestDistance) {
      bestDistance = distance;
      best = p.id;
    }
  }
  return best;
}

/** The line nearest to a screen position within `radius` pixels. */
export function lineAt(view: BoardView, sketch: Sketch, sx: number, sy: number, radius = 7): string | null {
  let best: string | null = null;
  let bestDistance = radius;
  for (const line of Object.values(sketch.lines)) {
    const a = sketch.points[line.a];
    const b = sketch.points[line.b];
    if (!a || !b) continue;
    const [ax, ay] = toScreen(view, a.x, a.y);
    const [bx, by] = toScreen(view, b.x, b.y);
    const dx = bx - ax;
    const dy = by - ay;
    const lengthSq = dx * dx + dy * dy;
    const t = lengthSq === 0 ? 0 : Math.max(0, Math.min(1, ((sx - ax) * dx + (sy - ay) * dy) / lengthSq));
    const distance = Math.hypot(ax + t * dx - sx, ay + t * dy - sy);
    if (distance <= bestDistance) {
      bestDistance = distance;
      best = line.id;
    }
  }
  return best;
}

/** Formats metres for the board readout. */
export function metres(value: number): string {
  const rounded = Math.round(value * 1000) / 1000;
  return `${Object.is(rounded, -0) ? 0 : rounded}`;
}

/**
 * The line (drawn as a polyline, so curves count) nearest to a screen position within
 * `radius` pixels, with the closest point on it in plane coordinates.
 */
export function pathAt(
  view: BoardView,
  paths: ReadonlyMap<string, readonly (readonly [number, number])[]>,
  sx: number,
  sy: number,
  radius = 7,
): { lineId: string; point: [number, number] } | null {
  let best: { lineId: string; point: [number, number] } | null = null;
  let bestDistance = radius;
  for (const [lineId, points] of paths) {
    for (let i = 0; i + 1 < points.length; i++) {
      const [ax, ay] = toScreen(view, points[i][0], points[i][1]);
      const [bx, by] = toScreen(view, points[i + 1][0], points[i + 1][1]);
      const dx = bx - ax;
      const dy = by - ay;
      const lengthSq = dx * dx + dy * dy;
      const t = lengthSq === 0 ? 0 : Math.max(0, Math.min(1, ((sx - ax) * dx + (sy - ay) * dy) / lengthSq));
      const distance = Math.hypot(ax + t * dx - sx, ay + t * dy - sy);
      if (distance <= bestDistance) {
        bestDistance = distance;
        const p = points[i];
        const q = points[i + 1];
        best = { lineId, point: [p[0] + t * (q[0] - p[0]), p[1] + t * (q[1] - p[1])] };
      }
    }
  }
  return best;
}
