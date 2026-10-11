import { homedir } from 'node:os';
import { isAbsolute, resolve } from 'node:path';
import { ensureProjectExtension } from '../src/core/project/paths';

/** Where relative project names go: FORGEX_PROJECTS_DIR, or Documents\FORGEX 3D. */
export function defaultProjectsFolder(): string {
  const configured = process.env.FORGEX_PROJECTS_DIR?.trim();
  return configured ? resolve(configured) : resolve(homedir(), 'Documents', 'FORGEX 3D');
}

/** "kart" → <projects folder>\kart.forgex; absolute paths are kept. Always ends in .forgex. */
export function resolveProjectPath(input: string, folder: string): string {
  const trimmed = input.trim();
  return ensureProjectExtension(isAbsolute(trimmed) ? resolve(trimmed) : resolve(folder, trimmed));
}
