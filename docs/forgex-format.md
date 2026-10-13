# The .forgex project format

A `.forgex` file is a UTF-8 JSON document. It stores the **editable source** of a project (the scene graph and construction graphs), never only the generated triangles, so everything you build can be reopened and edited.

Current version: **4**. Version 2 added blueprints; version 3 added smooth dots, bodies, modifiers, smooth shading and reference pictures; version 4 added locked objects and snapshots (saved versions). All additions are optional fields, so older files open unchanged. Reading and validation live in `src/core/project/projectFile.ts`.

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
| `references` | array, optional | Pictures behind the board to trace over; see below. |
| `snapshots` | array, optional | Saved versions of the scene; see below. |

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
| `locked` | `true`, optional | A locked object cannot be picked in the 3D view, moved, edited or deleted until it is unlocked. Locking a group protects everything inside it. |
| `transform` | object | `position`, `rotation` (degrees), `scale`, each `[x, y, z]`, relative to the parent. |

Meshes also have `material` (`color` as `#rrggbb`, and `smooth: true` for smooth shading), optional `modifiers`, and a `source`.

`modifiers` change what is shown and exported, never the source: `{ "mirror": "x", "subdivide": 2 }`. `mirror` (`none`, `x`, `y` or `z`) copies the mesh across that local axis plane and joins the halves (faces lying in the plane are dropped); `subdivide` (0 to 3) applies Catmull-Clark smoothing. Mirror runs first.

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

### Blueprint (drawn on the board)

```json
{
  "type": "sketch",
  "plane": "front",
  "points": [{ "id": "p1", "x": 0, "y": 1.6 }, { "id": "p2", "x": 0.08, "y": 1.44, "smooth": true }],
  "lines": [{ "id": "l1", "a": "p1", "b": "p2" }],
  "shape": { "mode": "extrude", "depth": 0.06, "segments": 32, "mirror": true, "axis": "vertical", "curveSteps": 10 }
}
```

- A dot with `smooth: true` bends the lines through it into a curve (Catmull-Rom style: the curve's direction at the dot runs from one neighbour to the other). `curveSteps` is the number of straight pieces per curved line (2 to 48).

- `plane` is `front` (x = +X, y = +Y), `side` (seen from the right: x = −Z, y = +Y) or `top` (seen from above: x = +X, y = −Z). Positions are metres in the object's local space.
- Closed loops of lines are filled; a loop inside a filled loop is a hole, and a loop inside a hole is filled again. Lines that close nothing stay as lines (extruded, they become thin walls).
- `shape.mode`: `flat` (a panel), `extrude` (thickness `depth` metres; centred on the plane, except `top` drawings, which grow upwards from the ground), or `revolve` (spun in `segments` steps around the vertical line x = 0 when `axis` is `vertical`, or around the horizontal line y = 0 when `axis` is `horizontal`, as for a wheel).
- `shape.mirror` copies the drawing across x = 0; dots on the axis are shared by both halves.
- Only the drawing is stored. The 3D mesh is generated from it on load, so it always matches.

### Body (lofted from three views)

```json
{
  "type": "body",
  "views": {
    "side": { "points": [...], "lines": [...] },
    "top": { "points": [...], "lines": [...] },
    "front": { "points": [...], "lines": [] }
  },
  "body": { "stations": 72, "sectionPoints": 48, "roundness": 4, "symmetric": true, "curveSteps": 10 }
}
```

- Each view holds dots and lines like a blueprint, on its own plane (`side`: x = −Z, y = +Y; `top`: x = +X, y = −Z; `front`: x = +X, y = +Y).
- The largest filled area of the side view gives the height at each point along the length; the top view gives the width; the front view (optional) gives the shape of every slice, scaled to fit. Without a front view, slices are superellipses whose `roundness` runs from 2 (oval) to 12 (boxy).
- `stations` slices are taken along the length where the side and top views overlap, bunched towards the ends. Each slice has `sectionPoints` points. The ends are capped, so the body is one closed solid.
- With `symmetric`, the top and front views are mirrored across x = 0 (draw the right half).

## Reference pictures

```json
{ "id": "ref_1", "plane": "side", "name": "Car side", "src": "data:image/png;base64,...", "aspect": 0.4, "x": 0, "y": 0.9, "width": 4.6, "opacity": 0.5, "flip": false, "visible": true }
```

The picture is stored inside the project (`src` must be a `data:image/` URL of PNG, JPEG, WebP, GIF or SVG, under 24 MB as text). `x` and `y` are its centre on the board in metres, `width` its width in metres, `aspect` its height divided by width. Invalid pictures are skipped with a warning; they never stop a project from opening.

## Snapshots

```json
{ "id": "snap_3f9a1c0b2d4e5f60", "name": "Before new wheels", "createdAt": "2026-10-13T18:02:11.000Z", "scene": { "rootIds": [...], "objects": [...] } }
```

A snapshot is a full copy of the scene, in the same form as the top-level `scene`, kept so the user can go back to it. Restoring one replaces the scene as one undoable change. Projects keep the newest 40. A snapshot that cannot be read is skipped with a warning; it never stops a project from opening.

## My Parts: .forgexpart files

Reusable parts live outside any project, one per file, in the library folder (`Documents\FORGEX 3D\Library` on Windows), so every project and the MCP server can use them.

```json
{
  "format": "forgex-part",
  "version": 1,
  "generator": "FORGEX 3D 0.2.0",
  "name": "Sport wheel",
  "description": "18 inch, five spokes",
  "createdAt": "2026-10-13T18:02:11.000Z",
  "scene": { "rootIds": ["obj_..."], "objects": [...] },
  "thumbnail": "data:image/jpeg;base64,..."
}
```

`scene` holds exactly one root object (with any children), in the project form, standing at the origin. Adding a part to a project copies it with fresh ids. The file name comes from the part name (`Sport wheel.forgexpart`). Reading and writing live in `src/core/library/libraryPart.ts`.

## Rules checked on load

The file is rejected, with every problem listed, when:

- it is not JSON, not a FORGEX project, or from a newer format version;
- an object id is missing, too long or used twice; a field has the wrong type; a number is not finite; a colour is not `#rrggbb`;
- the hierarchy is inconsistent: a `parentId` does not match the parent's `childIds`, an object appears twice, an object is unreachable from `rootIds`, or an object is inside itself;
- a blueprint or body view has a line to a missing dot, a line from a dot to itself, a duplicate id, or an unknown plane or shape mode;
- `modifiers` has an unknown mirror axis or a subdivision level that is not a number;
- a construction graph breaks a structural invariant: duplicate ids, an edge to a missing vertex, an edge from a vertex to itself, two edges between the same pair of vertices, or a face that repeats a vertex, has fewer than 3 vertices or has a side with no edge.

These load with a warning instead, for point-built geometry: faces that are no longer flat, zero-area faces, edges shared by more than two faces, and inconsistent face winding. Generated geometry (blueprints, bodies, modifiers) is rebuilt on load and not checked this way.

## Saving

The app only writes a file that it has just re-read and validated. On the desktop, the new contents are written to a temporary file next to the project and then renamed over it, so a failed save never leaves a half-written project behind.

## Changing the format

1. Bump `PROJECT_FORMAT_VERSION`.
2. Add a migration from the previous version in `PROJECT_MIGRATIONS`.
3. Update this document and add a test that loads a file in the old format.
