"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.SetGraphCommand = exports.SetMeshLookCommand = exports.SetSourceCommand = exports.MoveObjectCommand = exports.SetColorCommand = exports.ReplaceSceneCommand = exports.SetLockCommand = exports.SetVisibilityCommand = exports.RenameObjectCommand = exports.SetTransformCommand = exports.DeleteObjectCommand = exports.AddObjectsCommand = void 0;
const transform_1 = require("../math/transform");
const scene_1 = require("../scene/scene");
/** Adds an object (and any descendants it carries) to the scene. */
class AddObjectsCommand {
    subtree;
    parentId;
    index;
    label;
    selectAfterApply;
    constructor(subtree, parentId = null, index, label) {
        this.subtree = subtree;
        this.parentId = parentId;
        this.index = index;
        if (subtree.length === 0)
            throw new scene_1.SceneError('Nothing to add.');
        this.label = label ?? `Add ${subtree[0].name}`;
        this.selectAfterApply = subtree[0].id;
    }
    apply(scene) {
        return (0, scene_1.insertSubtree)(scene, this.subtree, this.parentId, this.index);
    }
    revert(scene) {
        return (0, scene_1.removeSubtree)(scene, this.subtree[0].id).scene;
    }
}
exports.AddObjectsCommand = AddObjectsCommand;
/** Deletes an object with all its children; undo puts the whole branch back in place. */
class DeleteObjectCommand {
    id;
    label;
    selectAfterApply = null;
    removed = null;
    parentId = null;
    index = 0;
    constructor(id, name) {
        this.id = id;
        this.label = `Delete ${name}`;
    }
    apply(scene) {
        const result = (0, scene_1.removeSubtree)(scene, this.id);
        this.removed = result.removed;
        this.parentId = result.parentId;
        this.index = result.index;
        return result.scene;
    }
    revert(scene) {
        if (!this.removed)
            throw new scene_1.SceneError('Delete was never applied.');
        return (0, scene_1.insertSubtree)(scene, this.removed, this.parentId, this.index);
    }
}
exports.DeleteObjectCommand = DeleteObjectCommand;
class SetTransformCommand {
    id;
    label;
    before;
    after;
    constructor(id, before, after, label = 'Edit transform') {
        this.id = id;
        this.label = label;
        this.before = (0, transform_1.cloneTransform)(before);
        this.after = (0, transform_1.cloneTransform)(after);
    }
    apply(scene) {
        return (0, scene_1.setObjectTransform)(scene, this.id, (0, transform_1.cloneTransform)(this.after));
    }
    revert(scene) {
        return (0, scene_1.setObjectTransform)(scene, this.id, (0, transform_1.cloneTransform)(this.before));
    }
}
exports.SetTransformCommand = SetTransformCommand;
class RenameObjectCommand {
    id;
    before;
    after;
    label;
    constructor(id, before, after) {
        this.id = id;
        this.before = before;
        this.after = after;
        this.label = `Rename to “${after}”`;
    }
    apply(scene) {
        return (0, scene_1.updateObject)(scene, this.id, (o) => ({ ...o, name: this.after }));
    }
    revert(scene) {
        return (0, scene_1.updateObject)(scene, this.id, (o) => ({ ...o, name: this.before }));
    }
}
exports.RenameObjectCommand = RenameObjectCommand;
class SetVisibilityCommand {
    id;
    visible;
    label;
    before = true;
    constructor(id, visible, name) {
        this.id = id;
        this.visible = visible;
        this.label = `${visible ? 'Show' : 'Hide'} ${name}`;
    }
    apply(scene) {
        this.before = (0, scene_1.requireObject)(scene, this.id).visible;
        return (0, scene_1.updateObject)(scene, this.id, (o) => ({ ...o, visible: this.visible }));
    }
    revert(scene) {
        return (0, scene_1.updateObject)(scene, this.id, (o) => ({ ...o, visible: this.before }));
    }
}
exports.SetVisibilityCommand = SetVisibilityCommand;
class SetLockCommand {
    id;
    locked;
    label;
    before = false;
    constructor(id, locked, name) {
        this.id = id;
        this.locked = locked;
        this.label = `${locked ? 'Lock' : 'Unlock'} ${name}`;
    }
    write(scene, locked) {
        return (0, scene_1.updateObject)(scene, this.id, (o) => {
            const { locked: _old, ...rest } = o;
            void _old;
            return (locked ? { ...rest, locked: true } : rest);
        });
    }
    apply(scene) {
        this.before = !!(0, scene_1.requireObject)(scene, this.id).locked;
        return this.write(scene, this.locked);
    }
    revert(scene) {
        return this.write(scene, this.before);
    }
}
exports.SetLockCommand = SetLockCommand;
/** Swaps the whole scene for another one (restoring a snapshot). Undo brings the previous scene back. */
class ReplaceSceneCommand {
    before;
    after;
    label;
    selectAfterApply = null;
    constructor(before, after, label) {
        this.before = before;
        this.after = after;
        this.label = label;
    }
    apply() {
        return this.after;
    }
    revert() {
        return this.before;
    }
}
exports.ReplaceSceneCommand = ReplaceSceneCommand;
function requireMesh(scene, id) {
    const object = (0, scene_1.requireObject)(scene, id);
    if (object.kind !== 'mesh')
        throw new scene_1.SceneError(`${object.name} is not a mesh.`);
    return object;
}
class SetColorCommand {
    id;
    before;
    after;
    label = 'Change colour';
    constructor(id, before, after) {
        this.id = id;
        this.before = before;
        this.after = after;
    }
    write(scene, color) {
        const mesh = requireMesh(scene, this.id);
        return (0, scene_1.updateObject)(scene, this.id, () => ({ ...mesh, material: { ...mesh.material, color } }));
    }
    apply(scene) {
        return this.write(scene, this.after);
    }
    revert(scene) {
        return this.write(scene, this.before);
    }
}
exports.SetColorCommand = SetColorCommand;
/** Re-parents or reorders an object in the hierarchy, keeping its place in the world. */
class MoveObjectCommand {
    id;
    parentId;
    index;
    label;
    previous = null;
    constructor(id, parentId, index, label = 'Move in hierarchy') {
        this.id = id;
        this.parentId = parentId;
        this.index = index;
        this.label = label;
    }
    apply(scene) {
        const object = (0, scene_1.requireObject)(scene, this.id);
        this.previous = {
            parentId: object.parentId,
            index: (0, scene_1.indexInParent)(scene, this.id),
            transform: (0, transform_1.cloneTransform)(object.transform),
        };
        return (0, scene_1.moveObject)(scene, this.id, this.parentId, this.index, true);
    }
    revert(scene) {
        if (!this.previous)
            throw new scene_1.SceneError('Move was never applied.');
        const moved = (0, scene_1.moveObject)(scene, this.id, this.previous.parentId, this.previous.index, false);
        return (0, scene_1.setObjectTransform)(moved, this.id, (0, transform_1.cloneTransform)(this.previous.transform));
    }
}
exports.MoveObjectCommand = MoveObjectCommand;
/** Replaces a mesh's whole source: blueprint edits, shape settings, or converting a blueprint to points. */
class SetSourceCommand {
    id;
    before;
    after;
    label;
    constructor(id, before, after, label) {
        this.id = id;
        this.before = before;
        this.after = after;
        this.label = label;
    }
    write(scene, source) {
        const mesh = requireMesh(scene, this.id);
        return (0, scene_1.updateObject)(scene, this.id, () => ({ ...mesh, source }));
    }
    apply(scene) {
        return this.write(scene, this.after);
    }
    revert(scene) {
        return this.write(scene, this.before);
    }
}
exports.SetSourceCommand = SetSourceCommand;
class SetMeshLookCommand {
    id;
    before;
    after;
    label;
    constructor(id, before, after, label) {
        this.id = id;
        this.before = before;
        this.after = after;
        this.label = label;
    }
    write(scene, look) {
        const mesh = requireMesh(scene, this.id);
        return (0, scene_1.updateObject)(scene, this.id, () => {
            const { modifiers: _old, ...rest } = mesh;
            void _old;
            const material = look.smooth ? { ...mesh.material, smooth: true } : { color: mesh.material.color };
            return look.modifiers ? { ...rest, material, modifiers: look.modifiers } : { ...rest, material };
        });
    }
    apply(scene) {
        return this.write(scene, this.after);
    }
    revert(scene) {
        return this.write(scene, this.before);
    }
}
exports.SetMeshLookCommand = SetMeshLookCommand;
/**
 * Replaces an object's construction graph. Graphs are immutable and share unchanged
 * parts, so storing the before/after snapshots is cheap and makes undo exact.
 */
class SetGraphCommand {
    id;
    before;
    after;
    label;
    constructor(id, before, after, label) {
        this.id = id;
        this.before = before;
        this.after = after;
        this.label = label;
    }
    write(scene, graph) {
        const mesh = requireMesh(scene, this.id);
        if (mesh.source.type !== 'construction')
            throw new scene_1.SceneError(`${mesh.name} is not point-built.`);
        return (0, scene_1.updateObject)(scene, this.id, () => ({ ...mesh, source: { type: 'construction', graph } }));
    }
    apply(scene) {
        return this.write(scene, this.after);
    }
    revert(scene) {
        return this.write(scene, this.before);
    }
}
exports.SetGraphCommand = SetGraphCommand;
