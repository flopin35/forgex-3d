# FORGEX 3D

A personal Windows 3D modelling studio for game assets. **Click dots on the board on the left; they join into lines. Close an outline and the 3D object builds itself on the right**, live, as you draw. Save editable `.forgex` projects and export `.glb` models for Blender and Roblox Studio. AI assistants such as Claude can build in it too, while you watch.

## Getting around

The window has one slim bar at the top, the board on the left and the 3D view on the right. Everything else stays out of the way until you want it:

- **Start screen:** begin from a blank board, a ready-made supercar or saloon, a file, or a recent project.
- **Quick search (Ctrl+K):** type a few letters to run any command, use any tool, jump to any part by name, add a saved part or restore a version.
- **Parts (Ctrl+B):** a drawer over the 3D view with four tabs: **Parts** (the parts list, with hide and lock on each row), **Properties**, **My Parts** and **Versions**.
- **Messages** pop up briefly in the corner. The **Activity** button (pulse icon) keeps them all, with the undo history (click a step to go back to it) and performance numbers.
- **Keyboard shortcuts (?)** lists every shortcut.

## Drawing on the board

- **Draw (D):** click to place a dot; every new dot is joined to the previous one. Click the first dot (or any dot already in the drawing) to close the shape, and it fills in. Esc, Enter, right-click or a double-click stops the line. Click a line to put a dot on it. Drag a dot to move it; drop it on another dot to join them.
- **Exact sizes:** while drawing, just **type a number**: a small box takes the next line's length in metres, and **Tab** moves to its angle (0° points right, 90° up). Enter places the dot. Straight lines show their length beside them, like dimensions on a technical drawing (the ruler button turns this off). Pick one line to type its exact length and angle, or one dot to type its exact position.
- **Curves (C):** the curve pen places smooth dots, and lines bend through them. **S** turns picked dots smooth or sharp. Smooth dots are circles, sharp corners are squares.
- **Pick (V):** click or drag a box around dots. A bar appears with group edits: turn 90° or by any angle, flip, align and space evenly, scale by a percentage, smooth, duplicate and delete. **Ctrl+A** picks every dot; **Ctrl+C / Ctrl+V** copy dots into any drawing (in this project or the next one); **Ctrl+D** duplicates them.
- **Rectangle (B) and circle (O)** stamps; a shape drawn inside another becomes a hole.
- **Mirror (M):** draw half of a symmetric object and get both halves.
- **Make it 3D** (card over the 3D view): **Flat**, **Extrude** with a thickness, or **Revolve** around the orange axis like a lathe (wheels, bottles, vases).
- **Snapping** to a fine board grid (1 cm to 1 m, or 1 Roblox stud), to existing dots, and smart guides that line a new dot up with others. Hold **Shift** while drawing for 45° steps.
- **Front, Side and Top** drawing planes. A top-view plan grows upwards from the ground like walls.
- **Pictures:** put a blueprint image behind the drawing to trace over, set its real width, fade, flip and line it up.

## Cars and other complex models

- **Bodies from three views** (car button on the board): draw the **Side** view (the silhouette, front on the left), the **Top** view and, if you like, the **Front** view. FORGEX lofts them into one smooth, closed solid, the way car designers work from blueprints. Notches cut up into the bottom of the side outline become wheel arches. With **Symmetric** on, draw only the right half of the top and front views.
- **Finish:** **Smooth shading** makes curved surfaces look round while sharp creases stay sharp. **Subdivide** (1 to 3) rounds any mesh with Catmull-Clark smoothing.
- **Wheels:** a blueprint set to **Revolve** around the **wheel axle** spins a tyre profile around the horizontal line.
- The **supercar** and **saloon** templates are built exactly this way, so every part of them can be reshaped.

## Keeping your work

- **Versions:** save a copy of the whole scene inside the project (Versions tab, File menu or quick search) and restore it later. Restoring can be undone.
- **Lock (Ctrl+L):** a locked part cannot be picked in the 3D view, moved, edited or deleted, by you or by an AI assistant, until you unlock it. Locking a group protects everything in it.
- **My Parts:** a library shared by every project, in `Documents\FORGEX 3D\Library`. Select a wheel, a door or a whole car and press **Save selected** (or Edit > Save to My Parts); click it in any later project to add a copy. AI assistants can save and reuse parts there too.
- `.forgex` files are validated on save and load, and a failed save never damages the existing file. Unsaved changes are protected on New, Open and closing the window.

## AI assistants (MCP)

FORGEX 3D has its own MCP server **built into FORGEX 3D.exe**, so connecting Claude needs nothing else installed. Open **Help > Connect an AI assistant**, click **Set up Claude Desktop**, then restart Claude. The panel also gives the exact setup for Claude Code, VS Code, Cursor and Codex. If FORGEX is closed when the assistant asks for something, it opens. Details and the tool list: [docs/mcp.md](docs/mcp.md).

## Exporting

**Export** writes a binary glTF (`.glb`) of everything visible, with object names and the hierarchy kept, in metres with +Y up.

- **Blender:** File > Import > glTF 2.0. Blender turns +Y up into its +Z up for you.
- **Roblox Studio:** Home or Avatar tab > Import 3D, then pick the `.glb`. Roblox measures in studs (1 stud = 0.28 m), so a 1.6 m sword is about 5.7 studs.

## Controls

Board:

| Input | Action |
| --- | --- |
| D / C / V / B / O | Draw corners, draw curves, pick, rectangle, circle |
| A number while drawing | Exact length (Tab for the angle, Enter to place) |
| Shift while drawing | 45° steps |
| Esc, Enter, right-click, double-click | Stop the current line |
| Backspace while drawing | Remove the dot you just placed |
| S | Make picked dots smooth or sharp |
| M | Mirror the drawing |
| Ctrl+A, Ctrl+C, Ctrl+V, Ctrl+D | Pick every dot, copy, paste, duplicate |
| Delete or Backspace | Delete picked dots and lines |
| Wheel, middle or right drag, Space + drag | Zoom and pan the board |

3D view and app:

| Input | Action |
| --- | --- |
| Left-click | Select (locked parts are skipped) |
| Left-drag, right-drag, wheel | Orbit, pan, zoom |
| Q / W / E / R | Select, move, rotate, scale |
| F | Frame the selection |
| T | Turntable spin |
| Tab | Edit points of a point-built object |
| Ctrl+L | Lock or unlock the selection |
| Ctrl+D, Ctrl+G | Duplicate, group |
| Ctrl+K | Quick search |
| Ctrl+B | Parts drawer |
| Ctrl+Z, Ctrl+Y | Undo, redo |
| Ctrl+N, Ctrl+O, Ctrl+S, Ctrl+Shift+S | New, open, save, save as |
| Ctrl+E | Export .glb |
| ? | Keyboard shortcuts |

## Set up on Windows (only to build it yourself)

The cloud build on GitHub makes `FORGEX 3D.exe` and the installer for you (see the Releases page). To build locally you need **Node.js 20+**, **Rust** (<https://rustup.rs>, default MSVC option), the **Microsoft C++ Build Tools** (Desktop development with C++), and WebView2 (already in Windows 10 and 11). Run `powershell -ExecutionPolicy Bypass -File scripts\check-setup.ps1` to see what is missing.

```powershell
npm install            # first time only
npm test               # unit tests, including the FORGEX Cube Test
npm run desktop        # opens the FORGEX 3D window (the first Rust build takes a few minutes)
```

| Command | What it does |
| --- | --- |
| `npm run dev` | Browser preview at http://localhost:1420 (no Rust needed; Save downloads the file) |
| `npm run build` | Type check and production web build |
| `npm run desktop:build` | Builds the installer into `src-tauri\target\release\bundle\nsis\` |
| `npm run mcp:bundle` | Rebuilds the one-file Node.js MCP server, `mcp/forgex-mcp.bundle.cjs` |
| `npm run mcp:tools` | Rewrites the tool list the built-in MCP server embeds (after changing a tool) |
| `cd src-tauri; cargo test` | Rust tests: safe saving, My Parts files, the built-in MCP server |

## World conventions

Metres, +Y up, right-handed, rotations in degrees (XYZ order); assets face +Z as in glTF. Exporters convert at the boundary: Roblox uses 1 stud = 0.28 m, and Blender is +Z up (its glTF importer converts). See `src/core/units.ts`.

## How the code is organised

```text
src/
  core/            no UI code; fully unit-tested
    geometry/      construction graph, invariants, loop detection, normals, triangulation, mesh output
    sketch/        blueprints: dots and lines, filled areas, flat/extrude/revolve, bodies, group edits and exact sizes
    scene/         scene graph (hierarchy, transforms, locks), parts, templates
    commands/      every undoable change
    project/       .forgex read, write, validation and migration; snapshots
    library/       My Parts (.forgexpart files)
    automation/    the AI tools, shared by the app and the MCP servers
    ai/            Claude and MCP client setup
    editor/, history/, math/, units.ts
  app/             actions shared by menus, quick search, panels and shortcuts; UI state; the AI link
  board/           the drawing board (SVG): drawing, picking, snapping, sizes, selection bar
  viewport/        Three.js rendering, picking, gizmos, captures, .glb export
  ui/              top bar, drawer, panels, quick search, start screen, pop-ups
  platform/        desktop (Tauri) and browser file access
src-tauri/         Rust shell: dialogs, safe file writes, My Parts files, Claude setup, built-in MCP server
mcp/               the Node.js MCP server
docs/              the file formats and the MCP guide
```

Rules the code follows: geometry logic never depends on the UI; the editable source is separate from generated meshes; every object, vertex, edge, face, dot and line has a stable ID; every change is a command; projects are validated when loaded and before saving.

## The FORGEX Cube Test by hand

1. Choose **Create > Cube**. It is built from 8 points and 12 edges, and its 6 faces were generated from the closed loops.
2. Click the cube, press **Tab**, click a corner point and drag the arrows. The three faces that meet there follow.
3. Press **Ctrl+Z**. The point and faces return exactly.
4. Move the point again, then **Ctrl+S** and save as `CubeTest.forgex`.
5. **Ctrl+N**, then **Ctrl+O** and open `CubeTest.forgex`. The moved corner is still there and still editable, with the same vertex IDs.

The automated version is `src/core/geometry/cubeTest.test.ts`. `examples/` has the two cars, a sword and a kart as projects, and `.glb` exports of the supercar and the sword.

## Troubleshooting

- **This folder is synced by OneDrive.** `npm install` and the Rust build create thousands of files. If you see `EBUSY`, `EPERM` or "access denied", pause OneDrive syncing while you work, or move the project to a folder such as `C:\dev\forgex-3d`.
- **Windows SmartScreen** warns about the unsigned app: choose More info, then Run anyway.
- **The 3D view stays empty.** Update your graphics driver; the app needs WebGL 2. The Activity pop-over shows the error.
- **Claude does not see FORGEX:** see Troubleshooting in [docs/mcp.md](docs/mcp.md).
