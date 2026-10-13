import type { ConstructionGraph } from '../geometry/constructionGraph';
import type { MeshModifiers } from '../geometry/modifiers';
import { cloneTransform, type Transform } from '../math/transform';
import {
  indexInParent,
  insertSubtree,
  moveObject,
  removeSubtree,
  requireObject,
  SceneError,
  setObjectTransform,
  updateObject,
} from '../scene/scene';
import type { MeshObject, MeshSource, Scene, SceneObject } from '../scene/types';
import type { Command } from './command';

/** Adds an object (and any descendants it carries) to the scene. */
export class AddObjectsCommand implements Command {
  readonly label: string;
  readonly selectAfterApply: string;

  constructor(
    private readonly subtree: readonly SceneObject[],
    private readonly parentId: string | null = null,
    private readonly index?: number,
    label?: string,
  ) {
    if (subtree.length === 0) throw new SceneError('Nothing to add.');
    this.label = label ?? `Add ${subtree[0].name}`;
    this.selectAfterApply = subtree[0].id;
  }

  apply(scene: Scene): Scene {
    return insertSubtree(scene, this.subtree, this.parentId, this.index);
  }

  revert(scene: Scene): Scene {
    return removeSubtree(scene, this.subtree[0].id).scene;
  }
}

/** Deletes an object with all its children; undo puts the whole branch back in place. */
export class DeleteObjectCommand implements Command {
  readonly label: string;
  readonly selectAfterApply = null;
  private removed: SceneObject[] | null = null;
  private parentId: string | null = null;
  private index = 0;

  constructor(
    private readonly id: string,
    name: string,
  ) {
    this.label = `Delete ${name}`;
  }

  apply(scene: Scene): Scene {
    const result = removeSubtree(scene, this.id);
    this.removed = result.removed;
    this.parentId = result.parentId;
    this.index = result.index;
    return result.scene;
  }

  revert(scene: Scene): Scene {
    if (!this.removed) throw new SceneError('Delete was never applied.');
    return insertSubtree(scene, this.removed, this.parentId, this.index);
  }
}

export class SetTransformCommand implements Command {
  private readonly before: Transform;
  private readonly after: Transform;

  constructor(
    private readonly id: string,
    before: Transform,
    after: Transform,
    readonly label = 'Edit transform',
  ) {
    this.before = cloneTransform(before);
    this.after = cloneTransform(after);
  }

  apply(scene: Scene): Scene {
    return setObjectTransform(scene, this.id, cloneTransform(this.after));
  }

  revert(scene: Scene): Scene {
    return setObjectTransform(scene, this.id, cloneTransform(this.before));
  }
}

export class RenameObjectCommand implements Command {
  readonly label: string;

  constructor(
    private readonly id: string,
    private readonly before: string,
    private readonly after: string,
  ) {
    this.label = `Rename to “${after}”`;
  }

  apply(scene: Scene): Scene {
    return updateObject(scene, this.id, (o) => ({ ...o, name: this.after }));
  }

  revert(scene: Scene): Scene {
    return updateObject(scene, this.id, (o) => ({ ...o, name: this.before }));
  }
}

export class SetVisibilityCommand implements Command {
  readonly label: string;
  private before = true;

  constructor(
    private readonly id: string,
    private readonly visible: boolean,
    name: string,
  ) {
    this.label = `${visible ? 'Show' : 'Hide'} ${name}`;
  }

  apply(scene: Scene): Scene {
    this.before = requireObject(scene, this.id).visible;
    return updateObject(scene, this.id, (o) => ({ ...o, visible: this.visible }));
  }

  revert(scene: Scene): Scene {
    return updateObject(scene, this.id, (o) => ({ ...o, visible: this.before }));
  }
}

export class SetLockCommand implements Command {
  readonly label: string;
  private before = false;

  constructor(
    private readonly id: string,
    private readonly locked: boolean,
    name: string,
  ) {
    this.label = `${locked ? 'Lock' : 'Unlock'} ${name}`;
  }

  private write(scene: Scene, locked: boolean): Scene {
    return updateObject(scene, this.id, (o) => {
      const { locked: _old, ...rest } = o;
      void _old;
      return (locked ? { ...rest, locked: true } : rest) as SceneObject;
    });
  }

  apply(scene: Scene): Scene {
    this.before = !!requireObject(scene, this.id).locked;
    return this.write(scene, this.locked);
  }

  revert(scene: Scene): Scene {
    return this.write(scene, this.before);
  }
}

/** Swaps the whole scene for another one (restoring a snapshot). Undo brings the previous scene back. */
export class ReplaceSceneCommand implements Command {
  readonly selectAfterApply = null;

  constructor(
    private readonly before: Scene,
    private readonly after: Scene,
    readonly label: string,
  ) {}

  apply(): Scene {
    return this.after;
  }

  revert(): Scene {
    return this.before;
  }
}

function requireMesh(scene: Scene, id: string): MeshObject {
  const object = requireObject(scene, id);
  if (object.kind !== 'mesh') throw new SceneError(`${object.name} is not a mesh.`);
  return object;
}

export class SetColorCommand implements Command {
  readonly label = 'Change colour';

  constructor(
    private readonly id: string,
    private readonly before: string,
    private readonly after: string,
  ) {}

  private write(scene: Scene, color: string): Scene {
    const mesh = requireMesh(scene, this.id);
    return updateObject(scene, this.id, () => ({ ...mesh, material: { ...mesh.material, color } }));
  }

  apply(scene: Scene): Scene {
    return this.write(scene, this.after);
  }

  revert(scene: Scene): Scene {
    return this.write(scene, this.before);
  }
}

/** Re-parents or reorders an object in the hierarchy, keeping its place in the world. */
export class MoveObjectCommand implements Command {
  private previous: { parentId: string | null; index: number; transform: Transform } | null = null;

  constructor(
    private readonly id: string,
    private readonly parentId: string | null,
    private readonly index: number,
    readonly label = 'Move in hierarchy',
  ) {}

  apply(scene: Scene): Scene {
    const object = requireObject(scene, this.id);
    this.previous = {
      parentId: object.parentId,
      index: indexInParent(scene, this.id),
      transform: cloneTransform(object.transform),
    };
    return moveObject(scene, this.id, this.parentId, this.index, true);
  }

  revert(scene: Scene): Scene {
    if (!this.previous) throw new SceneError('Move was never applied.');
    const moved = moveObject(scene, this.id, this.previous.parentId, this.previous.index, false);
    return setObjectTransform(moved, this.id, cloneTransform(this.previous.transform));
  }
}

/** Replaces a mesh's whole source: blueprint edits, shape settings, or converting a blueprint to points. */
export class SetSourceCommand implements Command {
  constructor(
    private readonly id: string,
    private readonly before: MeshSource,
    private readonly after: MeshSource,
    readonly label: string,
  ) {}

  private write(scene: Scene, source: MeshSource): Scene {
    const mesh = requireMesh(scene, this.id);
    return updateObject(scene, this.id, () => ({ ...mesh, source }));
  }

  apply(scene: Scene): Scene {
    return this.write(scene, this.after);
  }

  revert(scene: Scene): Scene {
    return this.write(scene, this.before);
  }
}

/** How a mesh is finished: modifiers (mirror, subdivision) and smooth shading. */
export interface MeshLook {
  readonly modifiers: MeshModifiers | undefined;
  readonly smooth: boolean;
}

export class SetMeshLookCommand implements Command {
  constructor(
    private readonly id: string,
    private readonly before: MeshLook,
    private readonly after: MeshLook,
    readonly label: string,
  ) {}

  private write(scene: Scene, look: MeshLook): Scene {
    const mesh = requireMesh(scene, this.id);
    return updateObject(scene, this.id, () => {
      const { modifiers: _old, ...rest } = mesh;
      void _old;
      const material = look.smooth ? { ...mesh.material, smooth: true } : { color: mesh.material.color };
      return look.modifiers ? { ...rest, material, modifiers: look.modifiers } : { ...rest, material };
    });
  }

  apply(scene: Scene): Scene {
    return this.write(scene, this.after);
  }

  revert(scene: Scene): Scene {
    return this.write(scene, this.before);
  }
}

/**
 * Replaces an object's construction graph. Graphs are immutable and share unchanged
 * parts, so storing the before/after snapshots is cheap and makes undo exact.
 */
export class SetGraphCommand implements Command {
  constructor(
    private readonly id: string,
    private readonly before: ConstructionGraph,
    private readonly after: ConstructionGraph,
    readonly label: string,
  ) {}

  private write(scene: Scene, graph: ConstructionGraph): Scene {
    const mesh = requireMesh(scene, this.id);
    if (mesh.source.type !== 'construction') throw new SceneError(`${mesh.name} is not point-built.`);
    return updateObject(scene, this.id, () => ({ ...mesh, source: { type: 'construction', graph } }));
  }

  apply(scene: Scene): Scene {
    return this.write(scene, this.after);
  }

  revert(scene: Scene): Scene {
    return this.write(scene, this.before);
  }
}
