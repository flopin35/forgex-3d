import { createPartObject } from '../scene/parts';
import type { Scene } from '../scene/types';
import { DEFAULT_SETTINGS, type ProjectDocument } from './projectFile';

/** An empty project (used when an AI tool starts from scratch). */
export function createEmptyDocument(): ProjectDocument {
  return { scene: { objects: {}, rootIds: [] }, settings: { ...DEFAULT_SETTINGS }, camera: null };
}

/** A new project starts with one point-built cube resting on the grid. */
export function createDefaultDocument(): ProjectDocument {
  const cube = createPartObject('cube');
  const scene: Scene = { objects: { [cube.id]: cube }, rootIds: [cube.id] };
  return { scene, settings: { ...DEFAULT_SETTINGS }, camera: null };
}
