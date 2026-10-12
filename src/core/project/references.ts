import { isFiniteNumber } from '../math/vec3';
import { SKETCH_PLANES, type SketchPlane } from '../sketch/sketch';

/**
 * A picture placed behind the board to trace over, such as a car blueprint seen
 * from the side. It belongs to one drawing plane (Front, Side or Top).
 */
export interface ReferenceImage {
  readonly id: string;
  readonly plane: SketchPlane;
  readonly name: string;
  /** The picture itself, as a data: URL, so the project file carries it. */
  readonly src: string;
  /** Height divided by width of the picture. */
  readonly aspect: number;
  /** Centre of the picture on the board, in metres. */
  readonly x: number;
  readonly y: number;
  /** Width on the board in metres; the height follows the picture's proportions. */
  readonly width: number;
  /** 0 (invisible) to 1 (solid). */
  readonly opacity: number;
  /** Mirror left to right, for pictures of the car facing the other way. */
  readonly flip: boolean;
  readonly visible: boolean;
}

/** Pictures larger than this (as text) are refused, to keep project files sensible. */
export const MAX_REFERENCE_CHARS = 24 * 1024 * 1024;

export function createReference(options: {
  id: string;
  plane: SketchPlane;
  name: string;
  src: string;
  aspect: number;
  width?: number;
}): ReferenceImage {
  const width = options.width ?? 4.5;
  return {
    id: options.id,
    plane: options.plane,
    name: options.name.slice(0, 200),
    src: options.src,
    aspect: options.aspect > 0 && Number.isFinite(options.aspect) ? options.aspect : 1,
    x: 0,
    y: (width * (options.aspect > 0 ? options.aspect : 1)) / 2,
    width,
    opacity: 0.5,
    flip: false,
    visible: true,
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Reads the reference pictures of a project. Bad entries are skipped with a warning. */
export function readReferences(raw: unknown, warnings: string[]): ReferenceImage[] {
  if (raw === undefined) return [];
  if (!Array.isArray(raw)) {
    warnings.push('The reference pictures list was invalid and was skipped.');
    return [];
  }
  const out: ReferenceImage[] = [];
  const ids = new Set<string>();
  raw.forEach((item, i) => {
    const ok =
      isRecord(item) &&
      typeof item.id === 'string' &&
      item.id.length > 0 &&
      item.id.length <= 64 &&
      !ids.has(item.id) &&
      SKETCH_PLANES.includes(item.plane as SketchPlane) &&
      typeof item.src === 'string' &&
      /^data:image\/(png|jpeg|webp|gif|svg\+xml);/.test(item.src) &&
      item.src.length <= MAX_REFERENCE_CHARS &&
      [item.aspect, item.x, item.y, item.width, item.opacity].every(isFiniteNumber) &&
      (item.aspect as number) > 0 &&
      (item.width as number) > 0;
    if (!ok) {
      warnings.push(`Reference picture ${i + 1} was invalid and was skipped.`);
      return;
    }
    const record = item as Record<string, unknown>;
    ids.add(record.id as string);
    out.push({
      id: record.id as string,
      plane: record.plane as SketchPlane,
      name: typeof record.name === 'string' ? record.name.slice(0, 200) : 'Reference',
      src: record.src as string,
      aspect: record.aspect as number,
      x: record.x as number,
      y: record.y as number,
      width: record.width as number,
      opacity: Math.min(1, Math.max(0, record.opacity as number)),
      flip: record.flip === true,
      visible: record.visible !== false,
    });
  });
  return out;
}
