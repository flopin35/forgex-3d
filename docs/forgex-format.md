# The .forgex project format

A `.forgex` file is a UTF-8 JSON document. It stores the **editable source** of a project (the scene graph and construction graphs), never only the generated triangles, so everything you build can be reopened and edited.

Current version: **1**. Reading and validation live in `src/core/project/projectFile.ts`.

## Top level

| Field | Type | Meaning |
| --- | --- | --- |
| `format` | `"forgex-project"` | Identifies the file. Anything else is rejected. |
| `version` | integer | Format version. Files newer than the app are refused with a clear message; older ones are upgraded step by step. |
| `generator` | string | App and version that wrote the file, e.g. `FORGEX 3D 0.1.0`. |
| `savedAt` | ISO 8601 string | When the file was written. |
| `units` | object | World conventions; see below. Files with other conventions are rejected rather than guessed at. |
| `settings` | object | `gridSize` (metres), `snapEnabled`, `rotationSnapDegrees`. Missing settings fall back to defaults with a warning. |
| `scene` | object | `rootIds` (top-level object ids, in order) and `objects` (all objects, parents before children). |
| `camera` | object, optional | `position` and `target`, each `[x, y, z]` in metres. |

## World conventions (`units`)

```json
{ "lengthUnit": "meters", "upAxis": "+Y", "forwardAxis": "+Z", "handedness": "right", "rotation": "degrees-xyz" }
```

- 1 unit = 1 metre, +Y up, right-handed, assets face +Z (as in glTF).
- Rotations are Euler angles in degrees, applied in X, Y, Z order.
- Exporters convert at the boundary: Roblox uses 1 stud = 0.28 m; Blender is +Z up (its glTF importer converts).

## Objects

Every object has:

| Field | Type | Notes |
| --- | --- | --- |
| `id` | string | Stable id such as `obj_3f9a1c0b2d4e5f60`. Never reused. |
| `name` | string | Up to 200 characters. |
| `kind` | `"mesh"` or `"group"` | |
| `parentId` | string or `null` | Must match the parent's `childIds`. |
| `childIds` | string[] | Children in display order. |
| `visible` | boolean | |
| `transform` | object | `position`, `rotation` (degrees), `scale`, each `[x, y, z]`, relative to the parent. |

Meshes also have `material.color` (`#rrggbb`) and a `source`:

### Parametric primitive

```json
{ "type": "primitive", "primitive": "sphere" }
```

`primitive` is `sphere` or `cylinder` (1 m across, centred on the object origin).

### Construction graph (point-built)

```json
{
  "type": "construction",
  "vertices": [{ "id": "v1", "position": [-0.5, -0.5, -0.5] }],
  "edges": [{ "id": "e1", "a": "v1", "b": "v2" }],
  "faces": [{ "id": "f1", "vertices": ["v1", "v4", "v3", "v2"] }]
}
```

- Vertex positions are in the object's local space, in metres.
- A face lists its boundary loop in order; counter-clockwise around the outward normal (right-hand rule).
- Ids are stable. New ids continue after the highest existing number, so ids are never reused.

## Rules checked on load

The file is rejected, with every problem listed, when:

- it is not JSON, not a FORGEX project, or from a newer format version;
- an object id is missing, too long or used twice; a field has the wrong type; a number is not finite; a colour is not `#rrggbb`;
- the hierarchy is inconsistent: a `parentId` does not match the parent's `childIds`, an object appears twice, an object is unreachable from `rootIds`, or an object is inside itself;
- a construction graph breaks a structural invariant: duplicate ids, an edge to a missing vertex, an edge from a vertex to itself, two edges between the same pair of vertices, or a face that repeats a vertex, has fewer than 3 vertices or has a side with no edge.

These load with a warning instead: faces that are no longer flat, zero-area faces, edges shared by more than two faces, and inconsistent face winding.

## Saving

The app only writes a file that it has just re-read and validated. On the desktop, the new contents are written to a temporary file next to the project and then renamed over it, so a failed save never leaves a half-written project behind.

## Changing the format

1. Bump `PROJECT_FORMAT_VERSION`.
2. Add a migration from the previous version in `PROJECT_MIGRATIONS`.
3. Update this document and add a test that loads a file in the old format.
