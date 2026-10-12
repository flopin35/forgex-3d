# FORGEX 3D

A personal Windows 3D modelling studio for game assets. **Draw on the blueprint board on the left: click to place dots, each one joined to the last by a line. Close the outline and the 3D object builds itself on the right**, live, as you draw. Save editable `.forgex` projects and export `.glb` models for Blender and Roblox Studio.

## Cars and other complex models

FORGEX 3D opens with a ready-made **supercar**, and **Create > Luxury saloon** adds a long limousine. Every part is a drawing you can reshape, so they are starting points, not fixed models.

- **Bodies from three views** (car button on the board, or Create > Body): draw the **Side** view (the silhouette, front on the left), the **Top** view (the outline from above) and, if you like, the **Front** view (the shape of a slice). FORGEX lofts them into one smooth, closed solid, the way car designers work from blueprints. Notches cut up into the bottom of the side outline become **wheel arches**. With **Symmetric** on, draw only the right half of the top and front views. Dashed purple guides show where the other views reach, so the three stay in proportion.
- **Curves:** the **curve pen (C)** places smooth dots, and lines bend through them. With the pick tool, **S** turns picked dots smooth or sharp. Smooth dots are circles on the board, sharp corners are squares.
- **Reference pictures:** **Pictures** on the board puts a blueprint image (a car seen from the side, the top or the front) behind the drawing to trace over. Set its width to the real length, fade it, flip it, and drag it into line.
- **Finish:** **Smooth shading** makes curved surfaces look round while sharp creases stay sharp. **Subdivide** (1 to 3) rounds any mesh with Catmull-Clark smoothing, which turns blocky point-built shapes into organic ones (box modelling: press Tab and move the orange cage points; the smooth surface follows). **Mirror** (point-built meshes) lets you model one half.
- **Wheels:** a blueprint set to **Revolve** around the **wheel axle** spins a tyre profile around the horizontal line.
- Build a car from several parts: a body, a cabin (a second body in dark glass), revolved tyres and rims, extruded spokes, lights and grilles. The templates show exactly this.

## The board and the 3D view

- **Draw (D):** click to place a dot; every new dot is joined to the previous one. Click the first dot (or any dot already in the drawing) to close the shape, and it fills in. Esc, Enter, right-click or a double-click stops the line. Click a line to put a dot on it. Drag a dot to move it; drop it on another dot to join them.
- **Make it 3D** (card over the 3D view): **Flat** panel, **Extrude** with a thickness slider, or **Revolve** around the orange axis like a lathe (wheels, bottles, vases). Switch any time; the drawing stays editable.
- **Mirror (M):** draw half of a symmetric object (a sword, a shield, a car body) and get both halves. The dashed line is the mirror.
- **Rectangle (B) and circle (O)** stamps; a shape drawn inside another becomes a hole.
- **Pick (V):** click or drag a box around dots, drag them, Delete removes them. Shift adds to the pick.
- **Snapping** to a fine board grid (1 cm to 1 m, or 1 Roblox stud), to existing dots, and **smart guides** that line a new dot up with the others. Hold **Shift** while drawing for 45° steps. The footer shows each line's length in metres and studs.
- **Front, Side and Top** drawing planes. A top-view plan grows upwards from the ground like walls.
- **Turntable (T)** spins the 3D view; **Export** writes a `.glb` (File menu or Ctrl+E).
- Pan the board with the middle or right mouse button, or hold Space and drag; zoom with the wheel. Drag the divider to give the board or the 3D view more room.

`examples/supercar.forgex` and `examples/luxury-saloon.forgex` are the two cars as projects, and `examples/supercar.glb` is the supercar exported for Blender or Roblox Studio. `examples/sword.forgex` is a simpler start: a mirrored, extruded sword.

## Also in the editor

- Windows desktop app (Tauri) with a live Three.js viewport: grid, coloured X/Z axes, a clickable axis cube for preset views, lighting.
- Parts (Create menu): **Cube** and **Plane** are point-built (a real construction graph of vertices, edges and faces); **Sphere** and **Cylinder** are smooth parametric shapes; **Empty group** for organising.
- Select by clicking, then move, rotate and scale with the gizmo or by typing exact values. Drag a field's X/Y/Z label to scrub a value.
- Grid snapping with presets from 0.05 m to 2 m, including **0.28 m (1 Roblox stud)**, plus rotation snapping.
- **Points mode (Tab):** select and move individual vertices of a point-built object; connected faces follow live.
- Geometry tools: Fill closed loops, Recalculate normals, Check geometry, with a live report of invariant problems.
- Scene hierarchy: drag to reorder or nest (world position is kept), double-click to rename, hide/show, group, duplicate, delete.
- Undo/redo for every change, with a History tab.
- `.forgex` save, save as and open, with validation, version migration and safe writes (a failed save never damages the existing file).
- Unsaved-change protection on New, Open and window close.
- Diagnostics panel and status bar with render and rebuild times (the performance budgets).

- **Convert to points** turns a blueprint into a point-built mesh for vertex-by-vertex editing (undo turns it back).

Not yet built, and not faked in the UI: connectors and snapping between components, the 180-part library, materials beyond colour, and a native Roblox (.rbxm) export.

## AI assistants (MCP)

FORGEX 3D has its own MCP server, so Claude, Codex or VS Code can build in it: draw blueprints (`create_blueprint`, `edit_blueprint`), loft car bodies from three views (`create_body`), add ready-made cars (`add_template`), smooth and mirror meshes (`set_modifiers`), add parts, construct meshes from points, edit vertices, check geometry and save projects. With the app open, the AI works live in your viewport (status bar: **AI linked**) and can take viewport images. With the app closed, it edits `.forgex` files directly. Setup for each client: [docs/mcp.md](docs/mcp.md).

## Set up on Windows

You need four things. Run `powershell -ExecutionPolicy Bypass -File scripts\check-setup.ps1` in this folder to see which are missing.

1. **Node.js 20 or newer** (LTS): <https://nodejs.org>
2. **Rust**: <https://rustup.rs>. Accept the default (MSVC) option.
3. **Microsoft C++ Build Tools**: <https://visualstudio.microsoft.com/visual-cpp-build-tools/>. Tick **Desktop development with C++**.
4. **WebView2**: already included in Windows 10 and 11.

Open a new terminal after installing, so the new tools are on your PATH.

## Run it

```powershell
npm install            # first time only
npm test               # unit tests, including the FORGEX Cube Test
npm run desktop        # opens the FORGEX 3D window (first Rust build takes a few minutes)
```

Other commands:

| Command | What it does |
| --- | --- |
| `npm run cube-test` | Runs only the FORGEX Cube Test |
| `npm run dev` | Browser preview at http://localhost:1420 (no Rust needed; Save downloads the file) |
| `npm run build` | Type check and production web build |
| `npm run desktop:build` | Builds the installer into `src-tauri\target\release\bundle\nsis\` |
| `cd src-tauri; cargo test` | Rust tests for safe saving |
| `powershell -ExecutionPolicy Bypass -File scripts\verify.ps1` | Runs every check and writes `logs\verify.log` |

## Controls

Board:

| Input | Action |
| --- | --- |
| D / C / V / B / O | Draw corners, Draw curves, Pick, Rectangle, Circle |
| S | Make picked dots smooth or sharp |
| Click | Place a dot (Draw) or pick a dot or line (Pick) |
| Esc, Enter, right-click, double-click | Stop the current line |
| Shift while drawing | 45° steps |
| M | Mirror the drawing |
| Delete or Backspace | Delete picked dots and lines |
| Backspace while drawing | Remove the dot you just placed |
| Wheel, middle or right drag, Space + drag | Zoom and pan the board |

3D view:

| Input | Action |
| --- | --- |
| Left-click | Select (in points mode: select a vertex) |
| Left-drag on empty space | Orbit |
| Right-drag, or Shift + left/middle drag | Pan |
| Middle-drag | Orbit |
| Mouse wheel | Zoom |
| Click the axis cube (bottom right) | Look along that axis |
| Q / W / E / R | Select / Move / Rotate / Scale tool |
| Tab | Edit points of a point-built object (with Subdivide on, its orange cage) |
| F | Frame the selection |
| Delete | Delete picked dots, otherwise the selected object and its children |
| T | Turntable spin |
| Esc | Cancel a drag, leave points mode, or clear the selection |
| Ctrl+Z, Ctrl+Y (or Ctrl+Shift+Z) | Undo, redo |
| Ctrl+D, Ctrl+G | Duplicate, group |
| Ctrl+N, Ctrl+O, Ctrl+S, Ctrl+Shift+S | New, open, save, save as |
| Ctrl+E | Export .glb |
| Ctrl+B | Show or hide the Scene and Properties panels |

## Exporting

**Export** writes a binary glTF (`.glb`) of everything visible, with object names and the hierarchy kept, in metres with +Y up.

- **Blender:** File > Import > glTF 2.0. Blender turns +Y up into its +Z up for you.
- **Roblox Studio:** Home or Avatar tab > Import 3D, then pick the `.glb`. Roblox measures in studs (1 stud = 0.28 m), so a 1.6 m sword is about 5.7 studs.

## The FORGEX Cube Test by hand

1. Start the app and choose **Create > Cube**. The cube is built from 8 points and 12 edges, and its 6 faces were generated from the closed loops.
2. Click the cube, press **Tab**, click a corner point and drag the arrows. The three faces that meet there follow.
3. Press **Ctrl+Z**. The point and faces return exactly.
4. Move the point again, then **Ctrl+S** and save as `CubeTest.forgex`.
5. **Ctrl+N** for a new project, then **Ctrl+O** and open `CubeTest.forgex`. The moved corner is still there and still editable, with the same vertex IDs.

The automated version is `src/core/geometry/cubeTest.test.ts`.

`examples/kart-blockout.forgex` is a small sample project: a grouped kart with a point-built wedge body. `examples/sword.forgex` is the blueprint sword the app opens with, and `examples/sword.glb` is its export.

## World conventions

Metres, +Y up, right-handed, rotations in degrees (XYZ order); assets face +Z as in glTF. Exporters convert at the boundary: Roblox uses 1 stud = 0.28 m, and Blender is +Z up (its glTF importer converts). See `src/core/units.ts`.

## How the code is organised

```text
src/
  core/            no UI code; fully unit-tested
    geometry/      construction graph, invariants, loop detection, normals, triangulation, mesh output
    sketch/        blueprints: dots and lines, filled areas and holes, flat/extrude/revolve, mirror
    scene/         scene graph (hierarchy, transforms), parts
    commands/      every undoable change
    history/       undo/redo stacks
    project/       .forgex read, write, validation and migration
    editor/        the editor store: scene, selection, modes, settings, dirty state
    math/, units.ts
  app/             actions shared by menus, toolbar, panels and shortcuts; board UI state
  board/           the blueprint board (SVG): drawing, picking, snapping, guides
  viewport/        Three.js rendering, picking, gizmos, turntable, .glb export
  ui/              React panels
  platform/        desktop (Tauri) and browser file access
src-tauri/         Rust shell: dialogs, safe file reads and writes
docs/forgex-format.md   the project file format
```

Rules the code follows: geometry logic never depends on the UI; the editable source (scene and construction graphs) is separate from generated meshes; every object, vertex, edge and face has a stable ID; every change is a command; projects are validated when loaded and before saving.

## Troubleshooting

- **This folder is synced by OneDrive.** `npm install` and the Rust build create thousands of files. If you see `EBUSY`, `EPERM` or "access denied", pause OneDrive syncing while you work, or move the project to a folder such as `C:\dev\forgex-3d`.
- **`link.exe` not found** or **MSVC errors** while building: install the C++ Build Tools (step 3 above), then open a new terminal.
- **The first `npm run desktop` is slow.** Rust compiles Tauri once (often 3 to 10 minutes); later starts take seconds.
- **The viewport stays black.** Update your graphics driver; the app needs WebGL 2. The Messages tab shows the error.
