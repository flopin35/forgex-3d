import { AXIS_EPSILON, type Sketch } from './sketch';

/** A drawing resolved for geometry: mirror applied, every dot and line in plane coordinates. */
export interface ResolvedSketch {
  /** Dot positions by id. Mirrored copies have ids ending in "~m". */
  points: Map<string, [number, number]>;
  /** Unique lines as [a, b] dot ids. */
  segments: [string, string][];
}

/** A filled area: an outer boundary (counter-clockwise) with optional holes (clockwise). */
export interface Region {
  outer: string[];
  holes: string[][];
  area: number;
}

type P = [number, number];

export function mirrorId(id: string): string {
  return `${id}~m`;
}

/** Applies the mirror (across x = 0). Dots on the axis are shared by both halves. */
export function resolveSketch(sketch: Sketch, mirror: boolean): ResolvedSketch {
  const points = new Map<string, P>();
  const onAxis = (x: number) => Math.abs(x) <= AXIS_EPSILON;
  for (const p of Object.values(sketch.points)) {
    points.set(p.id, [mirror && onAxis(p.x) ? 0 : p.x, p.y]);
    if (mirror && !onAxis(p.x)) points.set(mirrorId(p.id), [-p.x, p.y]);
  }
  const mirrored = (id: string) => (mirror && points.has(mirrorId(id)) ? mirrorId(id) : id);
  const seen = new Set<string>();
  const segments: [string, string][] = [];
  const push = (a: string, b: string) => {
    if (a === b) return;
    const key = a < b ? `${a}|${b}` : `${b}|${a}`;
    if (seen.has(key)) return;
    seen.add(key);
    segments.push([a, b]);
  };
  for (const line of Object.values(sketch.lines)) {
    push(line.a, line.b);
    if (mirror) push(mirrored(line.a), mirrored(line.b));
  }
  return { points, segments };
}

export function signedArea(loop: readonly string[], points: Map<string, P>): number {
  let sum = 0;
  for (let i = 0; i < loop.length; i++) {
    const [x1, y1] = points.get(loop[i])!;
    const [x2, y2] = points.get(loop[(i + 1) % loop.length])!;
    sum += x1 * y2 - x2 * y1;
  }
  return sum / 2;
}

export function pointInPolygon(point: P, polygon: readonly P[]): boolean {
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const [xi, yi] = polygon[i];
    const [xj, yj] = polygon[j];
    if (yi > point[1] !== yj > point[1] && point[0] < ((xj - xi) * (point[1] - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

function cross(o: P, a: P, b: P): number {
  return (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
}

/** A point strictly inside a counter-clockwise polygon (centre of its first ear). */
function interiorPoint(polygon: readonly P[]): P {
  const n = polygon.length;
  for (let i = 0; i < n; i++) {
    const a = polygon[(i - 1 + n) % n];
    const b = polygon[i];
    const c = polygon[(i + 1) % n];
    if (cross(a, b, c) <= 1e-14) continue;
    const centre: P = [(a[0] + b[0] + c[0]) / 3, (a[1] + b[1] + c[1]) / 3];
    if (pointInPolygon(centre, polygon)) return centre;
  }
  return polygon[0];
}

/**
 * Finds the filled regions of a planar line drawing by tracing its faces
 * (each half-edge turns to the next edge clockwise around its end dot).
 * Nesting is even-odd: a shape inside a filled shape is a hole, a shape inside
 * a hole is filled again. Lines that do not close a loop are ignored here.
 */
export function findRegions(resolved: ResolvedSketch): Region[] {
  const { points } = resolved;
  const neighbours = new Map<string, Set<string>>();
  for (const [a, b] of resolved.segments) {
    if (!points.has(a) || !points.has(b)) continue;
    const pa = points.get(a)!;
    const pb = points.get(b)!;
    if (pa[0] === pb[0] && pa[1] === pb[1]) continue;
    if (!neighbours.has(a)) neighbours.set(a, new Set());
    if (!neighbours.has(b)) neighbours.set(b, new Set());
    neighbours.get(a)!.add(b);
    neighbours.get(b)!.add(a);
  }

  // Drop dangling lines: they cannot bound an area.
  const degree = new Map([...neighbours].map(([id, set]) => [id, set.size]));
  const stack = [...degree].filter(([, d]) => d <= 1).map(([id]) => id);
  const removed = new Set<string>();
  while (stack.length) {
    const id = stack.pop()!;
    if (removed.has(id)) continue;
    removed.add(id);
    for (const other of neighbours.get(id) ?? []) {
      if (removed.has(other)) continue;
      const d = (degree.get(other) ?? 0) - 1;
      degree.set(other, d);
      if (d <= 1) stack.push(other);
    }
  }

  // Neighbours of each remaining dot sorted counter-clockwise by angle.
  const sorted = new Map<string, string[]>();
  for (const [id, set] of neighbours) {
    if (removed.has(id)) continue;
    const [x, y] = points.get(id)!;
    const list = [...set].filter((n) => !removed.has(n));
    list.sort((m, n) => {
      const pm = points.get(m)!;
      const pn = points.get(n)!;
      return Math.atan2(pm[1] - y, pm[0] - x) - Math.atan2(pn[1] - y, pn[0] - x);
    });
    sorted.set(id, list);
  }

  const visited = new Set<string>();
  const faces: { loop: string[]; area: number; polygon: P[] }[] = [];
  for (const [start, list] of sorted) {
    for (const next of list) {
      const startKey = `${start}>${next}`;
      if (visited.has(startKey)) continue;
      const loop: string[] = [];
      let a = start;
      let b = next;
      let guard = 0;
      while (!visited.has(`${a}>${b}`) && guard++ < 100_000) {
        visited.add(`${a}>${b}`);
        loop.push(a);
        const around = sorted.get(b)!;
        const index = around.indexOf(a);
        const c = around[(index - 1 + around.length) % around.length];
        a = b;
        b = c;
      }
      if (loop.length < 3 || new Set(loop).size !== loop.length) continue;
      const area = signedArea(loop, points);
      if (area > 1e-12) faces.push({ loop, area, polygon: loop.map((id) => points.get(id)!) });
    }
  }

  // Even-odd nesting by containment of an interior sample point.
  const samples = faces.map((face) => interiorPoint(face.polygon));
  const depth = faces.map((face, i) =>
    faces.reduce((count, other, j) => count + (j !== i && other.area > face.area && pointInPolygon(samples[i], other.polygon) ? 1 : 0), 0),
  );
  const regions: Region[] = [];
  faces.forEach((face, i) => {
    if (depth[i] % 2 !== 0) return;
    const holes: string[][] = [];
    faces.forEach((other, j) => {
      if (depth[j] !== depth[i] + 1 || !pointInPolygon(samples[j], face.polygon)) return;
      holes.push([...other.loop].reverse());
    });
    regions.push({ outer: face.loop, holes, area: face.area - holes.reduce((s, h) => s + Math.abs(signedArea(h, points)), 0) });
  });
  return regions;
}

function segmentsCross(a: P, b: P, c: P, d: P): boolean {
  const d1 = cross(c, d, a);
  const d2 = cross(c, d, b);
  const d3 = cross(a, b, c);
  const d4 = cross(a, b, d);
  return ((d1 > 1e-12 && d2 < -1e-12) || (d1 < -1e-12 && d2 > 1e-12)) && ((d3 > 1e-12 && d4 < -1e-12) || (d3 < -1e-12 && d4 > 1e-12));
}

/**
 * Triangulates a region with holes: each hole is joined to the outline by a bridge
 * to a visible outline dot, then the single combined outline is ear-clipped.
 * Returns triangles as dot-id triples, counter-clockwise.
 */
export function triangulateRegion(region: Region, points: Map<string, P>): [string, string, string][] {
  let ring = [...region.outer];
  const holes = [...region.holes].sort(
    (h1, h2) => Math.max(...h2.map((id) => points.get(id)![0])) - Math.max(...h1.map((id) => points.get(id)![0])),
  );
  const allEdges = (): [P, P][] => {
    const edges: [P, P][] = [];
    const loops = [ring, ...holes];
    for (const loop of loops) {
      for (let i = 0; i < loop.length; i++) edges.push([points.get(loop[i])!, points.get(loop[(i + 1) % loop.length])!]);
    }
    return edges;
  };
  for (const hole of holes) {
    const holeStart = hole.reduce((best, id, i) => (points.get(id)![0] > points.get(hole[best])![0] ? i : best), 0);
    const m = points.get(hole[holeStart])!;
    const edges = allEdges();
    let bestIndex = -1;
    let bestDistance = Infinity;
    ring.forEach((id, i) => {
      const p = points.get(id)!;
      const distance = Math.hypot(p[0] - m[0], p[1] - m[1]);
      if (distance >= bestDistance) return;
      if (edges.some(([e1, e2]) => segmentsCross(m, p, e1, e2))) return;
      bestDistance = distance;
      bestIndex = i;
    });
    if (bestIndex < 0) bestIndex = 0;
    const rotatedHole = [...hole.slice(holeStart), ...hole.slice(0, holeStart)];
    ring = [...ring.slice(0, bestIndex + 1), ...rotatedHole, rotatedHole[0], ...ring.slice(bestIndex)];
  }

  // Ear clipping over positions; the bridge repeats two dots, which is allowed here.
  const remaining = ring.map((_, i) => i);
  const pos = (i: number) => points.get(ring[i])!;
  const triangles: [string, string, string][] = [];
  let guard = 0;
  while (remaining.length > 3 && guard++ < ring.length * ring.length * 2) {
    let clipped = false;
    for (let k = 0; k < remaining.length; k++) {
      const ia = remaining[(k - 1 + remaining.length) % remaining.length];
      const ib = remaining[k];
      const ic = remaining[(k + 1) % remaining.length];
      const a = pos(ia);
      const b = pos(ib);
      const c = pos(ic);
      if (cross(a, b, c) <= 1e-14) continue;
      let blocked = false;
      for (const other of remaining) {
        if (other === ia || other === ib || other === ic) continue;
        const p = pos(other);
        if ((p[0] === a[0] && p[1] === a[1]) || (p[0] === b[0] && p[1] === b[1]) || (p[0] === c[0] && p[1] === c[1])) continue;
        if (cross(a, b, p) > 0 && cross(b, c, p) > 0 && cross(c, a, p) > 0) {
          blocked = true;
          break;
        }
      }
      if (blocked) continue;
      triangles.push([ring[ia], ring[ib], ring[ic]]);
      remaining.splice(k, 1);
      clipped = true;
      break;
    }
    if (!clipped) {
      // Collinear leftovers: drop the flattest corner and carry on.
      remaining.splice(0, 1);
    }
  }
  if (remaining.length === 3) triangles.push([ring[remaining[0]], ring[remaining[1]], ring[remaining[2]]]);
  return triangles.filter(([a, b, c]) => a !== b && b !== c && a !== c && cross(points.get(a)!, points.get(b)!, points.get(c)!) > 1e-14);
}
