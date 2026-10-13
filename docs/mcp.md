# Connecting AI assistants (MCP)

FORGEX 3D has its own MCP server, so Claude Desktop, Claude Code, VS Code, Cursor, Codex and other MCP apps can build in it. The assistant works in the open app while you watch: every change appears in the 3D view, shows in History as "AI: …" and can be undone with Ctrl+Z. It can draw blueprints, loft car bodies, add ready-made cars, check geometry, save versions, use My Parts, take pictures of the view and save projects.

## The quick way: Claude Desktop

1. In FORGEX 3D, open **Help > Connect an AI assistant** (or click **Connect AI** in the top bar).
2. Click **Set up Claude Desktop**.
3. Quit Claude completely (right-click its icon by the clock, then **Quit**) and open it again.
4. Ask Claude something like *"Use FORGEX to model a simple wooden table"*.

The MCP server is built into `FORGEX 3D.exe`, so **nothing else needs installing**: no Node.js and no extra files. Claude runs `FORGEX 3D.exe --mcp`, which opens no window; it passes each tool call to the FORGEX window. If FORGEX is closed when Claude asks for something, it opens it. The top bar shows **AI linked** while an assistant is connected, and **AI working** while a tool runs.

The button adds this entry to Claude Desktop's config (`%APPDATA%\Claude\claude_desktop_config.json`, and the Microsoft Store copy's config if there is one), keeping everything else in the file and a backup next to it:

```json
{
  "mcpServers": {
    "forgex-3d": {
      "command": "C:\\Users\\HP\\OneDrive\\Desktop\\3D software\\release\\FORGEX 3D.exe",
      "args": ["--mcp"]
    }
  }
}
```

If you move `FORGEX 3D.exe`, click **Set up again**. The installed app (from the setup file) lives in one place, so it never needs this.

## Other apps

The Connect panel shows the exact text for this copy of FORGEX, with a Copy button.

**Claude Code** (all your projects):

```powershell
claude mcp add --scope user --transport stdio forgex-3d -- "C:\path\to\FORGEX 3D.exe" --mcp
```

Inside this project folder, Claude Code also offers the Node.js server from `.mcp.json` (below).

**VS Code, Cursor, Codex and others:** add a stdio server with command `C:\path\to\FORGEX 3D.exe` and argument `--mcp`. For Codex, in `%USERPROFILE%\.codex\config.toml`:

```toml
[mcp_servers.forgex-3d]
command = 'C:\path\to\FORGEX 3D.exe'
args = ["--mcp"]
```

## The Node.js server (development, and working without the app)

`mcp/forgex-mcp.cjs` is the same server written for Node.js 20+. It needs no `npm install`: it runs the committed bundle `mcp/forgex-mcp.bundle.cjs`, or a fresh build from `npm run mcp:build`. Rebuild the bundle with `npm run mcp:bundle` after changing the server or the tools (CI checks it is up to date).

```json
{ "mcpServers": { "forgex-3d": { "command": "node", "args": ["C:\\path\\to\\forgex-3d\\mcp\\forgex-mcp.cjs"] } } }
```

Unlike the built-in server, it can also work with FORGEX closed:

| | When | What happens |
| --- | --- | --- |
| **Live** | FORGEX 3D is open | Same as the built-in server: tool calls run in the open app. |
| **File** | The app is closed | The server edits `.forgex` files itself. Relative names such as `"kart"` go to `Documents\FORGEX 3D\kart.forgex`. Once a project has a file, every change is saved to it. My Parts is read from `Documents\FORGEX 3D\Library`. |

| Environment variable | Default | Meaning |
| --- | --- | --- |
| `FORGEX_MCP_MODE` | `auto` | `live` (app only), `file` (never use the app) or `auto` |
| `FORGEX_BRIDGE_PORT` | `47833` | Port for the app link. Change it in the app too with `VITE_FORGEX_BRIDGE_PORT` at build time. |
| `FORGEX_PROJECTS_DIR` | `Documents\FORGEX 3D` | Where relative project names and My Parts live |

## How the link works

The server (built-in or Node.js) listens on `127.0.0.1:47833`, which only this computer can reach. The FORGEX window asks it for the next tool call (`GET /forgex/v1/poll`), runs it on the open project and posts the result (`POST /forgex/v1/result`). Requests from web pages are refused unless they come from the FORGEX app itself. Only one server can hold the link at a time.

## Tools

| Tool | What it does |
| --- | --- |
| `get_status` | Where the tools are working, the project, unsaved changes, grid and world conventions. Call first. |
| `list_objects`, `get_object` | The scene tree; one object in full, including dot, line, vertex, edge and face ids. |
| `create_blueprint`, `edit_blueprint` | Draw dots and lines on the front, side or top plane and make them 3D: flat, extruded or revolved, optionally mirrored, with smooth (curved) dots. The same blueprints you draw on the board. |
| `create_body` | Loft a smooth closed body from side, top and optional front outlines: car bodies, cabins, hulls. |
| `add_template` | Add a ready-made, fully editable `supercar` or `saloon`. |
| `list_parts`, `add_part` | Cube, plane, sphere, cylinder, empty group. |
| `create_point_mesh`, `edit_point_mesh`, `check_geometry`, `convert_to_points` | Build and edit meshes vertex by vertex; check them against the geometry rules. |
| `set_modifiers` | Subdivide, mirror and smooth shading for any mesh. |
| `set_transform`, `set_color`, `rename_object`, `set_visibility`, `set_lock` | Edit an object. Locked objects refuse edits until unlocked. |
| `duplicate_object`, `delete_object`, `set_parent`, `group_objects`, `select_object` | Organise the scene. |
| `save_snapshot`, `list_snapshots`, `restore_snapshot` | Saved versions inside the project. Restoring can be undone. |
| `list_library`, `save_to_library`, `add_from_library` | My Parts: reusable parts shared by every project. |
| `undo`, `redo` | Step through history (yours too). |
| `new_project`, `open_project`, `save_project` | Projects. You are asked before unsaved work is discarded. |
| `capture_viewport` | A picture of the 3D view from any side, so the assistant can check its work. |

Units are metres, +Y is up, assets face +Z, and rotations are degrees in X, Y, Z order. For Roblox, 1 stud = 0.28 m.

## Troubleshooting

- **Claude does not list FORGEX:** make sure Claude was fully quit and reopened after setting up. Claude Desktop keeps server logs in `%APPDATA%\Claude\logs\mcp-server-forgex-3d.log`.
- **"FORGEX could not open its local link":** another FORGEX server (for example an older Node.js entry, or a second AI app) holds port 47833. Remove the older entry or close the other app.
- **"FORGEX 3D was opened but did not link in time":** check that the FORGEX window is open and not stuck on a dialog, then ask again.
