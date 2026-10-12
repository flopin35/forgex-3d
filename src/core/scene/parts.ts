import { buildCubeGraph, buildPlaneGraph } from '../geometry/builders';
import { createObjectId } from '../ids';
import { identityTransform } from '../math/transform';
import type { Vec3 } from '../math/vec3';
import type { MeshModifiers } from '../geometry/modifiers';
import { clampBody, createBodyViews, DEFAULT_BODY, type BodySettings, type BodyViews } from '../sketch/body';
import { clampShape, createSketch, DEFAULT_SHAPE, type ShapeSettings, type Sketch, type SketchPlane } from '../sketch/sketch';
import type { Transform } from '../math/transform';
import type { MeshObject, SceneObject } from './types';

export type PartId = 'cube' | 'plane' | 'sphere' | 'cylinder' | 'group';

export interface PartDefinition {
  id: PartId;
  name: string;
  category: 'Point-built' | 'Parametric' | 'Structure';
  description: string;
  /** Height above the grid that rests the part on the ground. */
  restingHeight: number;
}

export const PARTS: readonly PartDefinition[] = [
  {
    id: 'cube',
    name: 'Cube',
    category: 'Point-built',
    description: '8 connected points and 6 faces. Press Tab to edit its vertices.',
    restingHeight: 0.5,
  },
  {
    id: 'plane',
    name: 'Plane',
    category: 'Point-built',
    description: '4 connected points and one face, lying on the ground.',
    restingHeight: 0,
  },
  {
    id: 'sphere',
    name: 'Sphere',
    category: 'Parametric',
    description: 'Smooth sphere, 1 m across.',
    restingHeight: 0.5,
  },
  {
    id: 'cylinder',
    name: 'Cylinder',
    category: 'Parametric',
    description: 'Smooth cylinder, 1 m tall and 1 m across.',
    restingHeight: 0.5,
  },
  {
    id: 'group',
    name: 'Group',
    category: 'Structure',
    description: 'An empty parent for organising objects in the hierarchy.',
    restingHeight: 0,
  },
];

const PART_COLORS: Record<Exclude<PartId, 'group'>, string> = {
  cube: '#3d9fe8',
  plane: '#7d93ab',
  sphere: '#e4a23c',
  cylinder: '#55b888',
};

export function getPart(id: PartId): PartDefinition {
  const part = PARTS.find((p) => p.id === id);
  if (!part) throw new Error(`Unknown part ${id}`);
  return part;
}

export interface CreatePartOptions {
  name?: string;
  /** Ground position (x, z); the part's resting height is added on top. */
  groundPosition?: [number, number];
  id?: string;
}

export const BLUEPRINT_COLORS = ['#3d9fe8', '#e4a23c', '#55b888', '#e0565b', '#a77be0', '#62cbff'];

interface GeneratedObjectOptions {
  name: string;
  color?: string;
  id?: string;
  /** Smooth shading (default on: curves look round, sharp creases stay sharp). */
  smooth?: boolean;
  transform?: Partial<Transform>;
  modifiers?: MeshModifiers;
}

function generatedBase(options: GeneratedObjectOptions) {
  return {
    id: options.id ?? createObjectId(),
    name: options.name,
    kind: 'mesh' as const,
    parentId: null,
    childIds: [],
    visible: true,
    transform: { ...identityTransform(), ...options.transform },
    material: options.smooth === false ? { color: options.color ?? BLUEPRINT_COLORS[0] } : { color: options.color ?? BLUEPRINT_COLORS[0], smooth: true as const },
    ...(options.modifiers ? { modifiers: options.modifiers } : {}),
  };
}

/** A blueprint object: a drawing on a plane that becomes 3D through its shape settings. */
export function createBlueprintObject(
  options: GeneratedObjectOptions & {
    sketch?: Sketch;
    plane?: SketchPlane;
    shape?: Partial<ShapeSettings>;
  },
): MeshObject {
  return {
    ...generatedBase(options),
    source: {
      type: 'sketch',
      sketch: options.sketch ?? createSketch(options.plane ?? 'front'),
      shape: clampShape({ ...DEFAULT_SHAPE, ...options.shape }),
    },
  };
}

/** A body object: side, top and front drawings lofted into one smooth solid. */
export function createBodyObject(options: GeneratedObjectOptions & { views?: BodyViews; body?: Partial<BodySettings> }): MeshObject {
  return {
    ...generatedBase(options),
    source: { type: 'body', views: options.views ?? createBodyViews(), body: clampBody({ ...DEFAULT_BODY, ...options.body }) },
  };
}

export function createPartObject(partId: PartId, options: CreatePartOptions = {}): SceneObject {
  const part = getPart(partId);
  const [x, z] = options.groundPosition ?? [0, 0];
  const position: Vec3 = [x, part.restingHeight, z];
  const base = {
    id: options.id ?? createObjectId(),
    name: options.name ?? part.name,
    parentId: null,
    childIds: [],
    transform: { ...identityTransform(), position },
    visible: true,
  };
  switch (partId) {
    case 'group':
      return { ...base, kind: 'group' };
    case 'cube':
      return { ...base, kind: 'mesh', source: { type: 'construction', graph: buildCubeGraph(1) }, material: { color: PART_COLORS.cube } };
    case 'plane':
      return { ...base, kind: 'mesh', source: { type: 'construction', graph: buildPlaneGraph(1) }, material: { color: PART_COLORS.plane } };
    case 'sphere':
    case 'cylinder':
      return { ...base, kind: 'mesh', source: { type: 'primitive', primitive: partId }, material: { color: PART_COLORS[partId] } };
  }
}
