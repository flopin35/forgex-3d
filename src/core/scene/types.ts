import type { ConstructionGraph } from '../geometry/constructionGraph';
import { applyModifiers, type MeshModifiers } from '../geometry/modifiers';
import type { Transform } from '../math/transform';
import { generateBody, type BodySettings, type BodyViews } from '../sketch/body';
import { generateShape } from '../sketch/generate';
import type { ShapeSettings, Sketch } from '../sketch/sketch';

/** Smooth parametric shapes. Point-built shapes (cube, plane) use a construction graph instead. */
export type PrimitiveKind = 'sphere' | 'cylinder';
export const PRIMITIVE_KINDS: readonly PrimitiveKind[] = ['sphere', 'cylinder'];

export type MeshSource =
  | { readonly type: 'primitive'; readonly primitive: PrimitiveKind }
  | { readonly type: 'construction'; readonly graph: ConstructionGraph }
  /** A blueprint drawing plus how it becomes 3D (flat, extruded or revolved). The mesh is generated. */
  | { readonly type: 'sketch'; readonly sketch: Sketch; readonly shape: ShapeSettings }
  /** A body lofted from side, top and front drawings (car bodies, hulls, fuselages). The mesh is generated. */
  | { readonly type: 'body'; readonly views: BodyViews; readonly body: BodySettings };

export interface MaterialSettings {
  /** Hex colour, `#rrggbb`. */
  readonly color: string;
  /** Smooth shading: curved surfaces look round; creases sharper than about 50° stay sharp. */
  readonly smooth?: boolean;
}

/** Angle under which neighbouring faces are shaded as one smooth surface. */
export const SMOOTH_SHADING_ANGLE = 50;

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
  /** Mirror and subdivision applied on top of the source; absent means none. */
  readonly modifiers?: MeshModifiers;
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

export function isBodyMesh(
  object: SceneObject | undefined | null,
): object is MeshObject & { source: { type: 'body'; views: BodyViews; body: BodySettings } } {
  return !!object && object.kind === 'mesh' && object.source.type === 'body';
}

/** The graph an object's source describes, before modifiers: edited directly, or generated from drawings. */
export function sourceGraphOf(object: SceneObject | undefined | null): ConstructionGraph | null {
  if (!object || object.kind !== 'mesh') return null;
  switch (object.source.type) {
    case 'construction':
      return object.source.graph;
    case 'sketch':
      return generateShape(object.source.sketch, object.source.shape).graph;
    case 'body':
      return generateBody(object.source.views, object.source.body).graph;
    default:
      return null;
  }
}

/** The vertices, edges and faces an object shows and exports: its source graph with modifiers applied. */
export function meshGraphOf(object: SceneObject | undefined | null): ConstructionGraph | null {
  const graph = sourceGraphOf(object);
  if (!graph || !object || object.kind !== 'mesh') return graph;
  return applyModifiers(graph, object.modifiers);
}

export const HEX_COLOR = /^#[0-9a-fA-F]{6}$/;
