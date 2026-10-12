# FORGEX 3D MCP server

The MCP server lets AI assistants (Claude Desktop, Claude Code, VS Code, Codex and other MCP clients) build in FORGEX 3D: add parts, construct meshes from points and edges, edit vertices, check geometry, undo, save `.forgex` files and look at the viewport.

It needs only **Node.js 20+**. The server in `mcp/dist` is prebuilt and has no npm dependencies; rebuild it with `npm run mcp:build` after changing the code.

## Two ways it works

| | When | What happens |
| --- | --- | --- |
| **Live** | FORGEX 3D is open | Tool calls run in the open app. Changes appear in the viewport, show in History as "AI: …", and can be undone with Ctrl+Z. The status bar shows **AI linked**. `capture_viewport` returns an image. |
| **File** | The app is closed | The server edits `.forgex` files itself. Relative names such as `"kart"` go to `Documents\FORGEX 3D\kart.forgex`. Once a project has a file, every change is saved to it. |

The switch is automatic. The app and server talk over `127.0.0.1:47833`, which only this computer can reach. Web pages are refused.

## Connect a client

Replace the path if your project lives somewhere else.

### Claude Desktop

Settings → Developer → Edit Config opens `%APPDATA%\Claude\claude_desktop_config.json`. Add `forgex-3d` next to your other servers (such as Blender), then fully quit and restart Claude Desktop:

```json
{
  "mcpServers": {
    "forgex-3d": {
      "command": "node",
      "args": ["C:\\Users\\HP\\OneDrive\\Desktop\\3D software\\mcp\\forgex-mcp.cjs"]
    }
  }
}
```

### Claude Code

The project includes `.mcp.json`, so Claude Code offers the server when started in this folder. To add it for all projects instead:

```powershell
claude mcp add --scope user --transport stdio forgex-3d -- node "C:\Users\HP\OneDrive\Desktop\3D software\mcp\forgex-mcp.cjs"
```

### VS Code

The project includes `.vscode/mcp.json`. Open the folder in VS Code and start **forgex-3d** from the MCP servers list.

### Codex

Add to `%USERPROFILE%\.codex\config.toml`:

```toml
[mcp_servers.forgex-3d]
command = "node"
args = ["C:\\Users\\HP\\OneDrive\\Desktop\\3D software\\mcp\\forgex-mcp.cjs"]
```

## Tools

| Tool | What it does |
| --- | --- |
| `get_status` | Mode (live or file), project, unsaved changes, grid and world conventions. Call first. |
| `list_objects`, `get_object` | The scene tree; one object in full, including vertex, edge and face ids. |
| `list_parts`, `add_part` | Cube, plane (point-built), sphere, cylinder, empty group. |
| `create_blueprint` | Draw dots and lines on the front, side or top plane and make it 3D: flat, extruded (thickness) or revolved (lathe), optionally mirrored. The same blueprint the user draws on the board. |
| `edit_blueprint` | Add, move and remove dots and lines; change the plane or shape settings. One undo step. |
| `convert_to_points` | Turn a blueprint into a point-built mesh for vertex editing. |
| `create_point_mesh` | Build a mesh from vertices and edges; faces come from closed loops, or give them explicitly. |
| `edit_point_mesh` | Add, move and remove vertices, edges and faces; fill loops; recalculate normals. One undo step. |
| `check_geometry` | Report problems against the geometry invariants. |
| `set_transform`, `set_color`, `rename_object`, `set_visibility` | Edit an object. |
| `duplicate_object`, `delete_object`, `set_parent`, `group_objects`, `select_object` | Organise the scene. |
| `undo`, `redo` | Step through history (the user's changes too). |
| `new_project`, `open_project`, `save_project` | Projects. In the app, the user is asked before unsaved work is discarded. |
| `capture_viewport` | Image of the viewport from the current, front, back, left, right, top, bottom or perspective view (app only). |

Units are metres, +Y is up, assets face +Z, and rotations are degrees in X, Y, Z order. For Roblox, 1 stud = 0.28 m.

## Settings

| Environment variable | Default | Meaning |
| --- | --- | --- |
| `FORGEX_MCP_MODE` | `auto` | `live` (app only), `file` (never use the app) or `auto` |
| `FORGEX_BRIDGE_PORT` | `47833` | Port for the app link. Change it in the app too with `VITE_FORGEX_BRIDGE_PORT` at build time. |
| `FORGEX_PROJECTS_DIR` | `Documents\FORGEX 3D` | Where relative project names are saved |

Set them in the client's server entry, for example `"env": { "FORGEX_PROJECTS_DIR": "D:\\Game assets" }`.

## Troubleshooting

- **The client cannot start the server:** run `node "…\mcp\forgex-mcp.cjs"` in a terminal. It should print `[forgex-mcp] Ready` and wait; press Ctrl+C to stop it. Claude Desktop writes server logs to `%APPDATA%\Claude\logs\mcp-server-forgex-3d.log`.
- **"AI linked" never appears in the app:** only one FORGEX MCP server can hold the app link. If two clients start the server, the second works on files only (its `get_status` says so).
- **Writes are refused:** the server only reads and writes `.forgex` files.
