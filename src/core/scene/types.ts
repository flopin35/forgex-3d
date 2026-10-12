import type { ConstructionGraph } from '../geometry/constructionGraph';
import type { Transform } from '../math/transform';
import { generateShape } from '../sketch/generate';
import type { ShapeSettings, Sketch } from '../sketch/sketch';

/** Smooth parametric shapes. Point-built shapes (cube, plane) use a construction graph instead. */
export type PrimitiveKind = 'sphere' | 'cylinder';
export const PRIMITIVE_KINDS: readonly PrimitiveKind[] = ['sphere', 'cylinder'];

export type MeshSource =
  | { readonly type: 'primitive'; readonly primitive: PrimitiveKind }
  | { readonly type: 'construction'; readonly graph: ConstructionGraph }
  /** A blueprint drawing plus how it becomes 3D (flat, extruded or revolved). The mesh is generated. */
  | { readonly type: 'sketch'; readonly sketch: Sketch; readonly shape: ShapeSettings };

export interface MaterialSettings {
  /** Hex colour, `#rrggbb`. */
  readonly color: string;
}

interface SceneObjectBase {
  readonly id: string;
  readonly name: string;
  readonly parentId: string | null;
  readonly childIds: readonly string[];
  readonly transform: Transform;
  readonly visible: boolean;
}

export interface MeshObject extends SceneObjectBase {
  readonly kind: 'mesh';
  readonly source: MeshSource;
  readonly material: MaterialSettings;
}

export interface GroupObject extends SceneObjectBase {
  readonly kind: 'group';
}

export type SceneObject = MeshObject | GroupObject;

/** The scene graph: object hierarchy, transforms, visibility and grouping. */
export interface Scene {
  readonly objects: Readonly<Record<string, SceneObject>>;
  readonly rootIds: readonly string[];
}

export function isConstructionMesh(
  object: SceneObject | undefined | null,
): object is MeshObject & { source: { type: 'construction'; graph: ConstructionGraph } } {
  return !!object && object.kind === 'mesh' && object.source.type === 'construction';
}

export function isSketchMesh(
  object: SceneObject | undefined | null,
): object is MeshObject & { source: { type: 'sketch'; sketch: Sketch; shape: ShapeSettings } } {
  return !!object && object.kind === 'mesh' && object.source.type === 'sketch';
}

/** The vertices, edges and faces an object shows: edited directly, or generated from its blueprint. */
export function meshGraphOf(object: SceneObject | undefined | null): ConstructionGraph | null {
  if (!object || object.kind !== 'mesh') return null;
  if (object.source.type === 'construction') return object.source.graph;
  if (object.source.type === 'sketch') return generateShape(object.source.sketch, object.source.shape).graph;
  return null;
}

export const HEX_COLOR = /^#[0-9a-fA-F]{6}$/;
