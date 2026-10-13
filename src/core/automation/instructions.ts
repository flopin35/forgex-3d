/** What every MCP client is told about FORGEX when it connects (the Node server and the app's built-in relay). */
export const SERVER_INSTRUCTIONS = [
  'FORGEX 3D is a 3D modelling studio for game assets (Roblox, Blender).',
  'Units are metres, +Y is up, the front of an asset faces +Z, and rotations are degrees applied in X, Y, Z order. For Roblox, 1 stud = 0.28 m.',
  'Call get_status first. When the FORGEX 3D app is open, every change appears live in its 3D view and undo history, and capture_viewport returns an image to check your work.',
  'Model the way the user does: create_blueprint draws dots joined by lines on a front, side or top plane and makes them flat, extruded or revolved; create_body lofts a smooth body (car, hull) from side, top and front outlines; create_point_mesh builds a mesh from vertices and edges, with faces from closed loops.',
  'add_template adds a ready-made supercar or saloon to start from; add_part adds primitives; group_objects and set_parent organise parts.',
  'Save a version with save_snapshot before a big change (restore_snapshot goes back). Respect locked objects: ask the user before unlocking them with set_lock.',
  'My Parts is a library shared by every project: save_to_library keeps a finished part, list_library and add_from_library reuse parts in later projects.',
  'Every change can be undone. When the app is closed, the Node server edits .forgex files directly: use save_project with a name (saved in the FORGEX projects folder) to keep work.',
].join(' ');
