/** A 3D vector stored as a plain tuple so it serialises directly to JSON. */
export type Vec3 = [number, number, number];

export function vec3(x = 0, y = 0, z = 0): Vec3 {
  return [x, y, z];
}

export function add(a: Vec3, b: Vec3): Vec3 {
  return [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
}

export function sub(a: Vec3, b: Vec3): Vec3 {
  return [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
}

export function scale(a: Vec3, s: number): Vec3 {
  return [a[0] * s, a[1] * s, a[2] * s];
}

export function dot(a: Vec3, b: Vec3): number {
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
}

export function cross(a: Vec3, b: Vec3): Vec3 {
  return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
}

export function length(a: Vec3): number {
  return Math.hypot(a[0], a[1], a[2]);
}

export function distance(a: Vec3, b: Vec3): number {
  return length(sub(a, b));
}

/** Returns a unit vector, or [0, 0, 0] when the input has no length. */
export function normalize(a: Vec3): Vec3 {
  const len = length(a);
  return len > 0 ? [a[0] / len, a[1] / len, a[2] / len] : [0, 0, 0];
}

export function equals(a: Vec3, b: Vec3, epsilon = 1e-9): boolean {
  return Math.abs(a[0] - b[0]) <= epsilon && Math.abs(a[1] - b[1]) <= epsilon && Math.abs(a[2] - b[2]) <= epsilon;
}

export function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

export function isVec3(value: unknown): value is Vec3 {
  return Array.isArray(value) && value.length === 3 && value.every(isFiniteNumber);
}

/** Rounds to a fixed number of decimals and removes negative zero. */
export function roundTo(value: number, decimals = 6): number {
  const factor = 10 ** decimals;
  const rounded = Math.round(value * factor) / factor;
  return Object.is(rounded, -0) ? 0 : rounded;
}

export function cleanVec3(v: Vec3, decimals = 6): Vec3 {
  return [roundTo(v[0], decimals), roundTo(v[1], decimals), roundTo(v[2], decimals)];
}

/** Snaps a value to the nearest multiple of `step`. A step of 0 or less leaves it unchanged. */
export function snapScalar(value: number, step: number): number {
  if (!(step > 0)) return value;
  return roundTo(Math.round(value / step) * step, 9);
}
