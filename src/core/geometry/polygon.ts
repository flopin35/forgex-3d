import { add, cross, dot, length, normalize, scale, sub, type Vec3 } from '../math/vec3';

export interface PolygonAnalysis {
  /** Unit normal by Newell's method; follows the right-hand rule for the given winding. */
  normal: Vec3;
  /** Area of the polygon projected onto its best-fit plane. */
  area: number;
  centroid: Vec3;
  /** Diagonal of the bounding box, used to scale tolerances. */
  size: number;
  /** Largest distance from any point to the best-fit plane. */
  maxPlaneDistance: number;
  planar: boolean;
  degenerate: boolean;
  selfIntersecting: boolean;
}

/** Relative tolerance used for planarity, scaled by the polygon's size. */
export const PLANARITY_TOLERANCE = 1e-5;

export function newellNormal(points: readonly Vec3[]): Vec3 {
  let nx = 0;
  let ny = 0;
  let nz = 0;
  for (let i = 0; i < points.length; i++) {
    const [xi, yi, zi] = points[i];
    const [xj, yj, zj] = points[(i + 1) % points.length];
    nx += (yi - yj) * (zi + zj);
    ny += (zi - zj) * (xi + xj);
    nz += (xi - xj) * (yi + yj);
  }
  return [nx, ny, nz];
}

function boundingDiagonal(points: readonly Vec3[]): number {
  const min: Vec3 = [Infinity, Infinity, Infinity];
  const max: Vec3 = [-Infinity, -Infinity, -Infinity];
  for (const p of points) {
    for (let k = 0; k < 3; k++) {
      min[k] = Math.min(min[k], p[k]);
      max[k] = Math.max(max[k], p[k]);
    }
  }
  return points.length ? length(sub(max, min)) : 0;
}

/** Builds a right-handed 2D basis (u, v) on the plane with normal n, so u × v = n. */
export function planeBasis(n: Vec3): { u: Vec3; v: Vec3 } {
  const helper: Vec3 = Math.abs(n[1]) < 0.9 ? [0, 1, 0] : [1, 0, 0];
  const u = normalize(cross(helper, n));
  const v = cross(n, u);
  return { u, v };
}

export function projectToPlane(points: readonly Vec3[], normal: Vec3): [number, number][] {
  const { u, v } = planeBasis(normal);
  return points.map((p) => [dot(p, u), dot(p, v)]);
}

function orient2d(a: [number, number], b: [number, number], c: [number, number]): number {
  return (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
}

function onSegment(a: [number, number], b: [number, number], p: [number, number], eps: number): boolean {
  return (
    Math.min(a[0], b[0]) - eps <= p[0] &&
    p[0] <= Math.max(a[0], b[0]) + eps &&
    Math.min(a[1], b[1]) - eps <= p[1] &&
    p[1] <= Math.max(a[1], b[1]) + eps
  );
}

function segmentsIntersect(
  p1: [number, number],
  p2: [number, number],
  p3: [number, number],
  p4: [number, number],
  eps: number,
): boolean {
  const d1 = orient2d(p3, p4, p1);
  const d2 = orient2d(p3, p4, p2);
  const d3 = orient2d(p1, p2, p3);
  const d4 = orient2d(p1, p2, p4);
  if (((d1 > eps && d2 < -eps) || (d1 < -eps && d2 > eps)) && ((d3 > eps && d4 < -eps) || (d3 < -eps && d4 > eps))) {
    return true;
  }
  if (Math.abs(d1) <= eps && onSegment(p3, p4, p1, eps)) return true;
  if (Math.abs(d2) <= eps && onSegment(p3, p4, p2, eps)) return true;
  if (Math.abs(d3) <= eps && onSegment(p1, p2, p3, eps)) return true;
  if (Math.abs(d4) <= eps && onSegment(p1, p2, p4, eps)) return true;
  return false;
}

export function isSelfIntersecting2d(points: readonly [number, number][], size: number): boolean {
  const n = points.length;
  if (n < 4) return false;
  const eps = Math.max(1e-12, (size * 1e-9) ** 2);
  for (let i = 0; i < n; i++) {
    const a1 = points[i];
    const a2 = points[(i + 1) % n];
    for (let j = i + 1; j < n; j++) {
      // Skip the segment itself and its neighbours, which share an endpoint.
      if (j === i || (j + 1) % n === i || (i + 1) % n === j) continue;
      if (segmentsIntersect(a1, a2, points[j], points[(j + 1) % n], eps)) return true;
    }
  }
  return false;
}

export function analyzePolygon(points: readonly Vec3[]): PolygonAnalysis {
  const raw = newellNormal(points);
  const rawLength = length(raw);
  const area = rawLength / 2;
  const size = boundingDiagonal(points);
  let centroid: Vec3 = [0, 0, 0];
  for (const p of points) centroid = add(centroid, p);
  centroid = points.length ? scale(centroid, 1 / points.length) : centroid;

  const areaEpsilon = Math.max(1e-14, (size * 1e-7) ** 2);
  const degenerate = points.length < 3 || area <= areaEpsilon;
  const normal: Vec3 = degenerate ? [0, 0, 0] : scale(raw, 1 / rawLength);

  let maxPlaneDistance = 0;
  if (!degenerate) {
    for (const p of points) {
      maxPlaneDistance = Math.max(maxPlaneDistance, Math.abs(dot(sub(p, centroid), normal)));
    }
  }
  const planar = !degenerate && maxPlaneDistance <= Math.max(1e-9, PLANARITY_TOLERANCE * size);
  const selfIntersecting = !degenerate && isSelfIntersecting2d(projectToPlane(points, normal), size);

  return { normal, area, centroid, size, maxPlaneDistance, planar, degenerate, selfIntersecting };
}

export function pointInPolygon2d(point: [number, number], polygon: readonly [number, number][]): boolean {
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const [xi, yi] = polygon[i];
    const [xj, yj] = polygon[j];
    const crosses = yi > point[1] !== yj > point[1] && point[0] < ((xj - xi) * (point[1] - yi)) / (yj - yi) + xi;
    if (crosses) inside = !inside;
  }
  return inside;
}

function pointInTriangle(p: [number, number], a: [number, number], b: [number, number], c: [number, number]): boolean {
  const d1 = orient2d(a, b, p);
  const d2 = orient2d(b, c, p);
  const d3 = orient2d(c, a, p);
  return d1 >= 0 && d2 >= 0 && d3 >= 0;
}

/**
 * Triangulates a simple polygon by ear clipping on its best-fit plane.
 * Returns index triples in the polygon's own winding, so triangle normals
 * match the face normal. Falls back to a fan if the outline is degenerate.
 */
export function triangulatePolygon(points: readonly Vec3[]): number[] {
  const n = points.length;
  if (n < 3) return [];
  if (n === 3) return [0, 1, 2];

  const normal = normalize(newellNormal(points));
  if (length(normal) === 0) return fan(n);
  const p2 = projectToPlane(points, normal);
  const size = boundingDiagonal(points);
  const eps = Math.max(1e-14, (size * 1e-9) ** 2);

  const remaining = Array.from({ length: n }, (_, i) => i);
  const triangles: number[] = [];
  let guard = 0;
  while (remaining.length > 3 && guard++ < n * n) {
    let clipped = false;
    for (let i = 0; i < remaining.length; i++) {
      const ia = remaining[(i - 1 + remaining.length) % remaining.length];
      const ib = remaining[i];
      const ic = remaining[(i + 1) % remaining.length];
      if (orient2d(p2[ia], p2[ib], p2[ic]) <= eps) continue;
      let blocked = false;
      for (const k of remaining) {
        if (k === ia || k === ib || k === ic) continue;
        if (pointInTriangle(p2[k], p2[ia], p2[ib], p2[ic])) {
          blocked = true;
          break;
        }
      }
      if (blocked) continue;
      triangles.push(ia, ib, ic);
      remaining.splice(i, 1);
      clipped = true;
      break;
    }
    if (!clipped) break;
  }
  if (remaining.length === 3) {
    triangles.push(remaining[0], remaining[1], remaining[2]);
  } else if (remaining.length > 3) {
    for (let i = 1; i < remaining.length - 1; i++) triangles.push(remaining[0], remaining[i], remaining[i + 1]);
  }
  return triangles;
}

function fan(n: number): number[] {
  const out: number[] = [];
  for (let i = 1; i < n - 1; i++) out.push(0, i, i + 1);
  return out;
}
