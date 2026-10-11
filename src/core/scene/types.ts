import type { ConstructionGraph } from '../geometry/constructionGraph';
import type { Transform } from '../math/transform';

/** Smooth parametric shapes. Point-built shapes (cube, plane) use a construction graph instead. */
export type PrimitiveKind = 'sphere' | 'cylinder';
export const PRIMITIVE_KINDS: readonly PrimitiveKind[] = ['sphere', 'cylinder'];

export type MeshSource =
  | { readonly type: 'primitive'; readonly primitive: PrimitiveKind }
  | { readonly type: 'construction'; readonly graph: ConstructionGraph };

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

export const HEX_COLOR = /^#[0-9a-fA-F]{6}$/;
