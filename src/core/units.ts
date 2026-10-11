import type { Vec3 } from './math/vec3';

/**
 * FORGEX 3D world conventions. Everything inside the editor uses these.
 * Exporters convert at the boundary, never inside the editor.
 */
export const WORLD_CONVENTIONS = {
  lengthUnit: 'meters',
  upAxis: '+Y',
  forwardAxis: '+Z',
  handedness: 'right',
  rotation: 'degrees-xyz',
} as const;

/** Roblox: 1 stud = 0.28 m (https://create.roblox.com/docs/physics/units). */
export const METERS_PER_ROBLOX_STUD = 0.28;

/** Blender's default scene uses 1 unit = 1 m. */
export const METERS_PER_BLENDER_UNIT = 1;

export function metersToStuds(meters: number): number {
  return meters / METERS_PER_ROBLOX_STUD;
}

export function studsToMeters(studs: number): number {
  return studs * METERS_PER_ROBLOX_STUD;
}

/**
 * Converts a +Y-up position to Blender's +Z-up axes. This matches what Blender's
 * glTF importer does: glTF (x, y, z) becomes Blender (x, -z, y).
 */
export function yUpToZUp([x, y, z]: Vec3): Vec3 {
  return [x, 0 - z, y];
}

export function zUpToYUp([x, y, z]: Vec3): Vec3 {
  return [x, z, 0 - y];
}

export interface GridPreset {
  size: number;
  label: string;
}

export const GRID_PRESETS: readonly GridPreset[] = [
  { size: 0.05, label: '0.05 m' },
  { size: 0.1, label: '0.1 m' },
  { size: 0.25, label: '0.25 m' },
  { size: METERS_PER_ROBLOX_STUD, label: '0.28 m (1 stud)' },
  { size: 0.5, label: '0.5 m' },
  { size: 1, label: '1 m' },
  { size: 2, label: '2 m' },
];
