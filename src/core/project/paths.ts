import { PROJECT_EXTENSION } from './projectFile';

/** `C:\Games\Car.forgex` → `Car.forgex` (handles both slash styles). */
export function fileNameFromPath(path: string): string {
  const parts = path.split(/[\\/]/);
  return parts[parts.length - 1] || path;
}

/** `C:\Games\Car.forgex` → `Car`. */
export function projectNameFromPath(path: string): string {
  const name = fileNameFromPath(path);
  const suffix = `.${PROJECT_EXTENSION}`;
  return name.toLowerCase().endsWith(suffix) ? name.slice(0, -suffix.length) : name;
}

/** Adds `.forgex` when the chosen path has no extension of that name. */
export function ensureProjectExtension(path: string): string {
  return path.toLowerCase().endsWith(`.${PROJECT_EXTENSION}`) ? path : `${path}.${PROJECT_EXTENSION}`;
}
