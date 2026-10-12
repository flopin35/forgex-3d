import { createBlueprintObject, createPartObject } from '../scene/parts';
import type { Scene, SceneObject } from '../scene/types';
import { addPolyline, createSketch } from '../sketch/sketch';
import { DEFAULT_SETTINGS, type ProjectDocument } from './projectFile';

function documentWith(objects: SceneObject[]): ProjectDocument {
  const scene: Scene = {
    objects: Object.fromEntries(objects.map((object) => [object.id, object])),
    rootIds: objects.map((object) => object.id),
  };
  return { scene, settings: { ...DEFAULT_SETTINGS }, camera: null };
}

/** An empty project (used when an AI tool or the user starts from scratch). */
export function createEmptyDocument(): ProjectDocument {
  return documentWith([]);
}

/** A project with one point-built cube resting on the grid (the Cube Test scene). */
export function createDefaultDocument(): ProjectDocument {
  return documentWith([createPartObject('cube')]);
}

/** Right half of a sword outline, from the tip down to the pommel; the mirror draws the left half. */
export const STARTER_SWORD_OUTLINE: readonly [number, number][] = [
  [0, 1.6],
  [0.08, 1.44],
  [0.08, 0.5],
  [0.32, 0.5],
  [0.32, 0.4],
  [0.045, 0.4],
  [0.045, 0.1],
  [0.09, 0.1],
  [0.09, 0],
  [0, 0],
];

/** What the app opens with: a mirrored sword blueprint, extruded, so the board and the 3D view both show something. */
export function createStarterDocument(): ProjectDocument {
  const sketch = addPolyline(createSketch('front'), STARTER_SWORD_OUTLINE, false).sketch;
  const sword = createBlueprintObject({
    name: 'Sword',
    sketch,
    shape: { mode: 'extrude', depth: 0.06, mirror: true },
    color: '#9fc3e8',
  });
  return documentWith([sword]);
}
