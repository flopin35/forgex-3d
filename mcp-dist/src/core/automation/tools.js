"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.TOOL_SPECS = void 0;
exports.resolveObject = resolveObject;
exports.hasTool = hasTool;
exports.runTool = runTool;
exports.isReadOnlyTool = isReadOnlyTool;
const command_1 = require("../commands/command");
const sceneCommands_1 = require("../commands/sceneCommands");
const analysis_1 = require("../geometry/analysis");
const constructionGraph_1 = require("../geometry/constructionGraph");
const loops_1 = require("../geometry/loops");
const modifiers_1 = require("../geometry/modifiers");
const orientation_1 = require("../geometry/orientation");
const ids_1 = require("../ids");
const libraryPart_1 = require("../library/libraryPart");
const snapshots_1 = require("../project/snapshots");
const transform_1 = require("../math/transform");
const vec3_1 = require("../math/vec3");
const parts_1 = require("../scene/parts");
const scene_1 = require("../scene/scene");
const templates_1 = require("../scene/templates");
const types_1 = require("../scene/types");
const body_1 = require("../sketch/body");
const generate_1 = require("../sketch/generate");
const sketch_1 = require("../sketch/sketch");
const units_1 = require("../units");
const args_1 = require("./args");
const toolTypes_1 = require("./toolTypes");
// ---------------------------------------------------------------------------
// Schema fragments
// ---------------------------------------------------------------------------
const vec3 = (description) => ({ type: 'array', items: { type: 'number' }, minItems: 3, maxItems: 3, description });
const objectRef = (description = 'Object id (such as obj_3f9a1c0b2d4e5f60) or exact name') => ({ type: 'string', description });
const color = { type: 'string', description: 'Hex colour, for example #3d9fe8' };
const vertexRef = {
    anyOf: [
        { type: 'string', description: 'An existing vertex id, such as v3' },
        { type: 'integer', minimum: 0, description: 'Index into add_vertices from this same call' },
    ],
};
const transformProps = {
    position: vec3('Position in metres [x, y, z], +Y is up. Relative to the parent when one is given.'),
    rotation: vec3('Rotation in degrees [x, y, z], applied in X, Y, Z order'),
    scale: vec3('Scale factors [x, y, z]'),
};
const noArgs = { type: 'object', properties: {}, additionalProperties: false };
const point2 = { type: 'array', items: { type: 'number' }, minItems: 2, maxItems: 2 };
const shapeSchema = {
    type: 'object',
    properties: {
        mode: { type: 'string', enum: [...sketch_1.SHAPE_MODES] },
        depth: { type: 'number', minimum: 0, description: 'Extrusion thickness in metres (default 0.2)' },
        segments: { type: 'integer', minimum: 3, maximum: 256, description: 'Steps around the axis when revolving (default 32)' },
        mirror: { type: 'boolean', description: 'Copy the drawing across x = 0' },
        axis: { type: 'string', enum: [...sketch_1.REVOLVE_AXES], description: 'Revolve around the vertical line x = 0 (default) or the horizontal line y = 0 (wheels)' },
        curve_steps: { type: 'integer', minimum: sketch_1.MIN_CURVE_STEPS, maximum: sketch_1.MAX_CURVE_STEPS, description: 'Straight pieces per curved line (default 10)' },
    },
    additionalProperties: false,
};
const bodySchema = {
    type: 'object',
    properties: {
        stations: { type: 'integer', minimum: body_1.BODY_LIMITS.stations[0], maximum: body_1.BODY_LIMITS.stations[1], description: 'Slices along the length (default 48)' },
        section_points: { type: 'integer', minimum: body_1.BODY_LIMITS.sectionPoints[0], maximum: body_1.BODY_LIMITS.sectionPoints[1], description: 'Points around each slice (default 40)' },
        roundness: { type: 'number', minimum: body_1.BODY_LIMITS.roundness[0], maximum: body_1.BODY_LIMITS.roundness[1], description: 'Cross-section when there is no front view: 2 oval, higher boxier (default 4)' },
        symmetric: { type: 'boolean', description: 'Top and front views are right halves, mirrored (default true)' },
        curve_steps: { type: 'integer', minimum: sketch_1.MIN_CURVE_STEPS, maximum: sketch_1.MAX_CURVE_STEPS },
    },
    additionalProperties: false,
};
const readOnly = { readOnlyHint: true, destructiveHint: false, openWorldHint: false };
const edit = { readOnlyHint: false, destructiveHint: false, openWorldHint: false };
const MAX_VERTICES = 50_000;
const MAX_LISTED_ELEMENTS = 3_000;
// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function sceneOf(ctx) {
    return ctx.store.getState().scene;
}
function libraryOf(ctx) {
    if (!ctx.host.library)
        throw new toolTypes_1.ToolError('My Parts is not available here.');
    return ctx.host.library;
}
/** Runs a command through the editor (so it is undoable) or reports why it failed. */
function apply(ctx, command) {
    if (ctx.store.execute(command))
        return;
    const last = ctx.store.getState().messages.at(-1);
    throw new toolTypes_1.ToolError(last ? `${last.text}${last.detail ? ` ${last.detail}` : ''}` : `${command.label} failed.`);
}
function result(summary, details) {
    return { text: details === undefined ? summary : `${summary}\n${JSON.stringify(details, null, 1)}` };
}
function resolveObject(scene, ref, label = 'object') {
    if (typeof ref !== 'string' || !ref.trim())
        throw new toolTypes_1.ToolError(`${label} must be an object id or name.`);
    const key = ref.trim();
    if (scene.objects[key])
        return scene.objects[key];
    const all = Object.values(scene.objects);
    let matches = all.filter((o) => o.name === key);
    if (matches.length === 0)
        matches = all.filter((o) => o.name.toLowerCase() === key.toLowerCase());
    if (matches.length === 1)
        return matches[0];
    if (matches.length > 1) {
        throw new toolTypes_1.ToolError(`"${key}" matches ${matches.length} objects. Use an id instead: ${matches.map((o) => o.id).join(', ')}.`);
    }
    throw new toolTypes_1.ToolError(`No object is called "${key}". Use list_objects to see ids and names.`);
}
/** Stops edits to a locked object (or one inside a locked group) with a clear way out. */
function unlocked(scene, object) {
    if ((0, scene_1.isLocked)(scene, object.id)) {
        const where = object.locked ? `${object.name} is locked` : `${object.name} is inside a locked group`;
        throw new toolTypes_1.ToolError(`${where}, so it cannot be changed. Ask the user first, then call set_lock with locked false on it.`);
    }
    return object;
}
function resolveConstruction(scene, ref) {
    const object = resolveObject(scene, ref);
    if ((0, types_1.isSketchMesh)(object) || (0, types_1.isBodyMesh)(object)) {
        throw new toolTypes_1.ToolError(`${object.name} is drawn (a ${(0, types_1.isBodyMesh)(object) ? 'body' : 'blueprint'}): change it with edit_blueprint, or call convert_to_points first to edit its 3D points directly.`);
    }
    if (!(0, types_1.isConstructionMesh)(object)) {
        throw new toolTypes_1.ToolError(`${object.name} is not point-built. Only objects made with create_point_mesh, Cube or Plane have editable points.`);
    }
    return object;
}
function resolveDrawn(scene, ref) {
    const object = resolveObject(scene, ref);
    if (!(0, types_1.isSketchMesh)(object) && !(0, types_1.isBodyMesh)(object)) {
        throw new toolTypes_1.ToolError(`${object.name} is not drawn. Blueprints come from create_blueprint, bodies from create_body, or both from drawing on the board.`);
    }
    return object;
}
function readShape(raw, base) {
    if (raw === undefined || raw === null)
        return base;
    if (typeof raw !== 'object' || Array.isArray(raw))
        throw new toolTypes_1.ToolError('shape must be an object such as { "mode": "extrude", "depth": 0.2 }.');
    const shapeArgs = raw;
    return (0, sketch_1.clampShape)({
        mode: (0, args_1.optEnum)(shapeArgs, 'mode', sketch_1.SHAPE_MODES) ?? base.mode,
        depth: shapeArgs.depth === undefined ? base.depth : Number(shapeArgs.depth),
        segments: shapeArgs.segments === undefined ? base.segments : Number(shapeArgs.segments),
        mirror: (0, args_1.optBool)(shapeArgs, 'mirror') ?? base.mirror,
        axis: (0, args_1.optEnum)(shapeArgs, 'axis', sketch_1.REVOLVE_AXES) ?? base.axis,
        curveSteps: shapeArgs.curve_steps === undefined ? base.curveSteps : Number(shapeArgs.curve_steps),
    });
}
function readBodySettings(raw, base) {
    if (raw === undefined || raw === null)
        return base;
    if (typeof raw !== 'object' || Array.isArray(raw))
        throw new toolTypes_1.ToolError('body must be an object such as { "stations": 64 }.');
    const b = raw;
    const num = (key, fallback) => (b[key] === undefined ? fallback : Number(b[key]));
    return (0, body_1.clampBody)({
        stations: num('stations', base.stations),
        sectionPoints: num('section_points', base.sectionPoints),
        roundness: num('roundness', base.roundness),
        symmetric: (0, args_1.optBool)(b, 'symmetric') ?? base.symmetric,
        curveSteps: num('curve_steps', base.curveSteps),
    });
}
function blueprintSummary(object) {
    const { sketch, shape } = object.source;
    const generated = (0, generate_1.generateShape)(sketch, shape);
    return {
        plane: sketch.plane,
        shape,
        filledAreas: generated.regions,
        geometry: reportSummary((0, analysis_1.analyzeGraph)((0, types_1.meshGraphOf)(object) ?? generated.graph)),
    };
}
function bodySummary(object) {
    const generated = (0, body_1.generateBody)(object.source.views, object.source.body);
    return {
        body: object.source.body,
        closedViews: generated.closed,
        slices: generated.stations,
        ...(generated.message ? { missing: generated.message } : {}),
        geometry: reportSummary((0, analysis_1.analyzeGraph)((0, types_1.meshGraphOf)(object) ?? generated.graph)),
    };
}
function typeOf(object) {
    if (object.kind === 'group')
        return 'group';
    if (object.source.type === 'sketch')
        return 'blueprint';
    if (object.source.type === 'body')
        return 'body';
    return object.source.type === 'construction' ? 'point-built' : object.source.primitive;
}
/** Reads one drawing's dots from tool arguments: [x, y] pairs, with an optional smooth flag for all or some of them. */
function drawingFromArgs(plane, rawPoints, label, closed, smooth) {
    let sketch = (0, sketch_1.createSketch)(plane);
    const ids = [];
    const smoothSet = smoothIndices(smooth, rawPoints.length, `${label} smooth`);
    rawPoints.forEach((item, i) => {
        if (!Array.isArray(item) || item.length !== 2 || !item.every((n) => typeof n === 'number' && Number.isFinite(n))) {
            throw new toolTypes_1.ToolError(`${label}[${i}] must be [x, y] with two finite numbers.`);
        }
        const added = (0, sketch_1.addPoint)(sketch, item[0], item[1], smoothSet.has(i));
        sketch = added.sketch;
        ids.push(added.pointId);
    });
    for (let i = 0; i + 1 < ids.length; i++)
        sketch = (0, sketch_1.addLine)(sketch, ids[i], ids[i + 1]).sketch;
    if (closed && ids.length >= 3)
        sketch = (0, sketch_1.addLine)(sketch, ids[ids.length - 1], ids[0]).sketch;
    return { sketch, ids };
}
/** smooth: true (every dot), false/absent (none) or a list of point indices. */
function smoothIndices(raw, count, label) {
    if (raw === undefined || raw === null || raw === false)
        return new Set();
    if (raw === true)
        return new Set(Array.from({ length: count }, (_, i) => i));
    if (!Array.isArray(raw))
        throw new toolTypes_1.ToolError(`${label} must be true, false or a list of point indices.`);
    return new Set(raw.map((value) => (0, args_1.toIndex)(value, count, label)));
}
function describe(object) {
    const out = {
        id: object.id,
        name: object.name,
        type: typeOf(object),
        position: (0, args_1.roundVec)(object.transform.position),
        rotation: (0, args_1.roundVec)(object.transform.rotation, 2),
        scale: (0, args_1.roundVec)(object.transform.scale),
    };
    if (object.kind === 'mesh') {
        out.color = object.material.color;
        if (object.material.smooth)
            out.smoothShading = true;
        if ((0, modifiers_1.hasModifiers)(object.modifiers))
            out.modifiers = object.modifiers;
    }
    if (!object.visible)
        out.hidden = true;
    if (object.locked)
        out.locked = true;
    return out;
}
function tree(scene, ids) {
    return ids.map((id) => {
        const object = scene.objects[id];
        const node = describe(object);
        if (object.childIds.length)
            node.children = tree(scene, object.childIds);
        return node;
    });
}
function reportSummary(report) {
    return {
        vertices: report.vertices,
        edges: report.edges,
        faces: report.faces,
        triangles: report.triangles,
        closed: report.closed,
        problems: report.issues.filter((i) => i.severity !== 'info').map((i) => i.message),
        notes: report.issues.filter((i) => i.severity === 'info').map((i) => i.message),
    };
}
function applyTransformArgs(base, args) {
    return (0, transform_1.cleanTransform)({
        position: (0, args_1.optVec3)(args, 'position') ?? base.position,
        rotation: (0, args_1.optVec3)(args, 'rotation') ?? base.rotation,
        scale: (0, args_1.optVec3)(args, 'scale') ?? base.scale,
    });
}
function parentFromArgs(scene, args) {
    const parent = args.parent;
    if (parent === undefined || parent === null)
        return null;
    return resolveObject(scene, parent, 'parent').id;
}
/** Adds a face, creating any missing boundary edges first. */
function addFaceWithEdges(graph, loop, allowNonPlanar, label) {
    if (new Set(loop).size !== loop.length)
        throw new toolTypes_1.ToolError(`${label} repeats a vertex.`);
    let next = graph;
    for (let i = 0; i < loop.length; i++)
        next = (0, constructionGraph_1.addEdge)(next, loop[i], loop[(i + 1) % loop.length]).graph;
    try {
        return (0, constructionGraph_1.addFace)(next, loop, { requirePlanar: !allowNonPlanar }).graph;
    }
    catch (error) {
        if (!(error instanceof constructionGraph_1.GeometryError))
            throw error;
        const hint = error.code === 'non-planar' ? ' Pass allow_non_planar: true to keep a bent face, or split it into triangles.' : '';
        throw new toolTypes_1.ToolError(`${label} was rejected: ${error.message}${hint}`);
    }
}
function geometryCall(label, fn) {
    try {
        return fn();
    }
    catch (error) {
        if (error instanceof constructionGraph_1.GeometryError)
            throw new toolTypes_1.ToolError(`${label}: ${error.message}`);
        throw error;
    }
}
function readVertexList(value, label) {
    return (value ?? []).map((item, i) => (0, vec3_1.cleanVec3)((0, args_1.toVec3)(item, `${label}[${i}]`)));
}
// ---------------------------------------------------------------------------
// Tools
// ---------------------------------------------------------------------------
const TOOLS = [
    {
        name: 'get_status',
        title: 'Get FORGEX status',
        description: 'Shows where the tools are working (the open FORGEX 3D app, or a .forgex file), the project name and path, unsaved changes, object count, grid settings and the world conventions. Call this first.',
        inputSchema: noArgs,
        annotations: readOnly,
        run(_args, ctx) {
            const state = ctx.store.getState();
            const host = ctx.host.status();
            const count = Object.keys(state.scene.objects).length;
            const where = state.project.path ? `saved at ${state.project.path}` : 'not saved to disk yet';
            return result(`${host.detail} Project "${state.project.name}" is ${where}, with ${count} object${count === 1 ? '' : 's'}${state.dirty ? ' and unsaved changes' : ''}.`, {
                mode: host.mode,
                project: { name: state.project.name, path: state.project.path, unsavedChanges: state.dirty },
                projectsFolder: host.projectsFolder,
                objects: count,
                selected: state.selectedId,
                grid: state.settings,
                conventions: {
                    units: 'metres',
                    up: '+Y',
                    front: '+Z',
                    rotation: 'degrees, applied in X, Y, Z order',
                    robloxStud: `${units_1.METERS_PER_ROBLOX_STUD} m`,
                },
            });
        },
    },
    {
        name: 'list_objects',
        title: 'List scene objects',
        description: 'Lists every object as a tree (groups contain children) with id, name, type, position, rotation, scale and colour.',
        inputSchema: noArgs,
        annotations: readOnly,
        run(_args, ctx) {
            const scene = sceneOf(ctx);
            const count = Object.keys(scene.objects).length;
            if (count === 0)
                return result('The scene is empty.');
            return result(`${count} object${count === 1 ? '' : 's'}:`, tree(scene, scene.rootIds));
        },
    },
    {
        name: 'get_object',
        title: 'Get object details',
        description: 'Returns one object in full: transform, world position, parent and children. For point-built objects it also returns the geometry report and the vertex, edge and face ids you need for edit_point_mesh.',
        inputSchema: {
            type: 'object',
            properties: {
                object: objectRef(),
                include_geometry: { type: 'boolean', description: 'Include vertex, edge and face lists (default true)' },
            },
            required: ['object'],
            additionalProperties: false,
        },
        annotations: readOnly,
        run(args, ctx) {
            const scene = sceneOf(ctx);
            const object = resolveObject(scene, args.object);
            const details = {
                ...describe(object),
                parent: object.parentId,
                children: object.childIds,
                worldPosition: (0, args_1.roundVec)((0, transform_1.decomposeMatrix)((0, scene_1.worldMatrix)(scene, object.id)).position),
            };
            const dots = (sketch) => ({
                points: Object.values(sketch.points)
                    .slice(0, MAX_LISTED_ELEMENTS)
                    .map((p) => ({ id: p.id, x: (0, args_1.round)(p.x, 6), y: (0, args_1.round)(p.y, 6), ...(p.smooth ? { smooth: true } : {}) })),
                lines: Object.values(sketch.lines).slice(0, MAX_LISTED_ELEMENTS).map((l) => ({ id: l.id, a: l.a, b: l.b })),
            });
            if ((0, types_1.isSketchMesh)(object)) {
                Object.assign(details, blueprintSummary(object), dots(object.source.sketch));
            }
            if ((0, types_1.isBodyMesh)(object)) {
                Object.assign(details, bodySummary(object), {
                    views: Object.fromEntries(body_1.BODY_VIEWS.map((view) => [view, dots(object.source.views[view])])),
                });
            }
            if ((0, types_1.isConstructionMesh)(object)) {
                const graph = object.source.graph;
                details.geometry = reportSummary((0, analysis_1.analyzeGraph)(graph));
                if ((0, args_1.optBool)(args, 'include_geometry') !== false) {
                    const vertices = Object.values(graph.vertices);
                    const edges = Object.values(graph.edges);
                    const faces = Object.values(graph.faces);
                    details.vertices = vertices.slice(0, MAX_LISTED_ELEMENTS).map((v) => ({ id: v.id, position: (0, args_1.roundVec)(v.position, 6) }));
                    details.edges = edges.slice(0, MAX_LISTED_ELEMENTS).map((e) => ({ id: e.id, a: e.a, b: e.b }));
                    details.faces = faces.slice(0, MAX_LISTED_ELEMENTS).map((f) => ({ id: f.id, vertices: f.vertexIds }));
                    if ([vertices, edges, faces].some((list) => list.length > MAX_LISTED_ELEMENTS)) {
                        details.truncated = `Lists are cut at ${MAX_LISTED_ELEMENTS} items.`;
                    }
                }
            }
            return result(`${object.name} (${typeOf(object)})`, details);
        },
    },
    {
        name: 'list_parts',
        title: 'List parts',
        description: 'Lists the parts that add_part can create.',
        inputSchema: noArgs,
        annotations: readOnly,
        run() {
            return result('Available parts:', parts_1.PARTS.map((p) => ({ part: p.id, name: p.name, kind: p.category, description: p.description })));
        },
    },
    {
        name: 'add_part',
        title: 'Add a part',
        description: 'Adds a part from the library. cube and plane are point-built (editable vertices); sphere and cylinder are smooth 1 m primitives; group is an empty parent. Without a position the part rests on the ground at the origin. Names are made unique.',
        inputSchema: {
            type: 'object',
            properties: {
                part: { type: 'string', enum: parts_1.PARTS.map((p) => p.id) },
                name: { type: 'string' },
                ...transformProps,
                color,
                parent: objectRef('Optional parent object id or name'),
            },
            required: ['part'],
            additionalProperties: false,
        },
        annotations: edit,
        run(args, ctx) {
            const scene = sceneOf(ctx);
            const partId = (0, args_1.reqEnum)(args, 'part', parts_1.PARTS.map((p) => p.id));
            const parentId = parentFromArgs(scene, args);
            const base = (0, parts_1.createPartObject)(partId, { name: (0, scene_1.uniqueName)(scene, (0, args_1.optString)(args, 'name') ?? (0, parts_1.getPart)(partId).name) });
            const transform = applyTransformArgs(base.transform, args);
            const colorValue = (0, args_1.optColor)(args, 'color');
            const object = base.kind === 'mesh' ? { ...base, transform, material: { color: colorValue ?? base.material.color } } : { ...base, transform };
            apply(ctx, new sceneCommands_1.AddObjectsCommand([object], parentId, undefined, `AI: add ${object.name}`));
            return result(`Added ${object.name} (${object.id}).`, describe(object));
        },
    },
    {
        name: 'create_point_mesh',
        title: 'Build a mesh from points',
        description: 'The FORGEX way to model: give vertices, connect them with edges, and faces are generated from the closed loops (or give faces explicitly). ' +
            'Positions are in metres in the object\'s local space, +Y up. Faces must be flat unless allow_non_planar is true. ' +
            'Normals are oriented automatically (closed shells face outward). Example cube: 8 vertices and 12 edges with fill_loops.',
        inputSchema: {
            type: 'object',
            properties: {
                name: { type: 'string' },
                vertices: { type: 'array', items: vec3('Vertex position'), minItems: 1, description: 'Vertex positions; edges and faces refer to them by index' },
                edges: {
                    type: 'array',
                    items: { type: 'array', items: { type: 'integer', minimum: 0 }, minItems: 2, maxItems: 2 },
                    description: 'Pairs of vertex indices to connect',
                },
                faces: {
                    type: 'array',
                    items: { type: 'array', items: { type: 'integer', minimum: 0 }, minItems: 3 },
                    description: 'Optional explicit faces as loops of vertex indices. Missing boundary edges are added.',
                },
                fill_loops: { type: 'boolean', description: 'Generate faces from closed edge loops (default: true when no faces are given)' },
                allow_non_planar: { type: 'boolean', description: 'Allow bent explicit faces (default false)' },
                ...transformProps,
                color,
                parent: objectRef('Optional parent object id or name'),
            },
            required: ['name', 'vertices'],
            additionalProperties: false,
        },
        annotations: edit,
        run(args, ctx) {
            const scene = sceneOf(ctx);
            const name = (0, scene_1.uniqueName)(scene, (0, args_1.reqString)(args, 'name'));
            const positions = readVertexList((0, args_1.optArray)(args, 'vertices', MAX_VERTICES), 'vertices');
            if (positions.length === 0)
                throw new toolTypes_1.ToolError('vertices needs at least one position.');
            const edges = (0, args_1.optArray)(args, 'edges', MAX_VERTICES * 4);
            const faces = (0, args_1.optArray)(args, 'faces', MAX_VERTICES * 2);
            const fill = (0, args_1.optBool)(args, 'fill_loops') ?? !faces;
            const allowNonPlanar = (0, args_1.optBool)(args, 'allow_non_planar') ?? false;
            const parentId = parentFromArgs(scene, args);
            let graph = (0, constructionGraph_1.createEmptyGraph)();
            const ids = [];
            for (const p of positions) {
                const added = (0, constructionGraph_1.addVertex)(graph, p);
                graph = added.graph;
                ids.push(added.vertexId);
            }
            edges?.forEach((edge, i) => {
                if (!Array.isArray(edge) || edge.length !== 2)
                    throw new toolTypes_1.ToolError(`edges[${i}] must be a pair of vertex indices [a, b].`);
                const a = (0, args_1.toIndex)(edge[0], ids.length, `edges[${i}][0]`);
                const b = (0, args_1.toIndex)(edge[1], ids.length, `edges[${i}][1]`);
                if (a === b)
                    throw new toolTypes_1.ToolError(`edges[${i}] connects vertex ${a} to itself.`);
                graph = (0, constructionGraph_1.addEdge)(graph, ids[a], ids[b]).graph;
            });
            faces?.forEach((face, i) => {
                if (!Array.isArray(face) || face.length < 3)
                    throw new toolTypes_1.ToolError(`faces[${i}] must list at least 3 vertex indices.`);
                const loop = face.map((v, k) => ids[(0, args_1.toIndex)(v, ids.length, `faces[${i}][${k}]`)]);
                graph = addFaceWithEdges(graph, loop, allowNonPlanar, `faces[${i}]`);
            });
            let filled = 0;
            if (fill) {
                const fillResult = (0, loops_1.fillClosedLoops)(graph);
                graph = fillResult.graph;
                filled = fillResult.faceIds.length;
            }
            if (Object.keys(graph.faces).length > 0)
                graph = (0, orientation_1.orientFaces)(graph).graph;
            const object = {
                id: (0, ids_1.createObjectId)(),
                name,
                kind: 'mesh',
                parentId: null,
                childIds: [],
                visible: true,
                transform: applyTransformArgs((0, transform_1.identityTransform)(), args),
                material: { color: (0, args_1.optColor)(args, 'color') ?? '#3d9fe8' },
                source: { type: 'construction', graph },
            };
            apply(ctx, new sceneCommands_1.AddObjectsCommand([object], parentId, undefined, `AI: build ${name}`));
            const report = reportSummary((0, analysis_1.analyzeGraph)(graph));
            return result(`Built ${name} (${object.id}) from ${ids.length} points${filled ? `; ${filled} faces generated from closed loops` : ''}.`, {
                id: object.id,
                name,
                vertexIds: ids,
                geometry: report,
            });
        },
    },
    {
        name: 'edit_point_mesh',
        title: 'Edit a point-built mesh',
        description: 'Edits the vertices, edges and faces of a point-built object in one undoable step. Steps run in this order: remove faces, remove edges, remove vertices ' +
            '(dependent edges and faces go too), add vertices, move vertices, add edges, add faces, fill loops, recalculate normals. ' +
            'Refer to existing vertices by id (v3) and to vertices added in this call by their index in add_vertices. Positions are local, in metres.',
        inputSchema: {
            type: 'object',
            properties: {
                object: objectRef(),
                remove_faces: { type: 'array', items: { type: 'string' }, description: 'Face ids such as f2' },
                remove_edges: { type: 'array', items: { type: 'string' }, description: 'Edge ids such as e5' },
                remove_vertices: { type: 'array', items: { type: 'string' }, description: 'Vertex ids such as v3' },
                add_vertices: { type: 'array', items: vec3('Vertex position') },
                move_vertices: {
                    type: 'array',
                    items: {
                        type: 'object',
                        properties: {
                            vertex: vertexRef,
                            position: vec3('New position'),
                            offset: vec3('Move by this amount instead'),
                        },
                        required: ['vertex'],
                    },
                },
                add_edges: { type: 'array', items: { type: 'array', items: vertexRef, minItems: 2, maxItems: 2 } },
                add_faces: { type: 'array', items: { type: 'array', items: vertexRef, minItems: 3 } },
                fill_loops: { type: 'boolean', description: 'Generate faces from closed edge loops after the other steps' },
                recalculate_normals: { type: 'boolean', description: 'Re-orient all faces (default true when faces were added)' },
                allow_non_planar: { type: 'boolean', description: 'Allow bent faces in add_faces (default false)' },
            },
            required: ['object'],
            additionalProperties: false,
        },
        annotations: edit,
        run(args, ctx) {
            const object = unlocked(sceneOf(ctx), resolveConstruction(sceneOf(ctx), args.object));
            const before = object.source.graph;
            let graph = before;
            const allowNonPlanar = (0, args_1.optBool)(args, 'allow_non_planar') ?? false;
            for (const id of ((0, args_1.optArray)(args, 'remove_faces', MAX_VERTICES) ?? [])) {
                graph = geometryCall('remove_faces', () => (0, constructionGraph_1.removeFace)(graph, String(id)));
            }
            for (const id of ((0, args_1.optArray)(args, 'remove_edges', MAX_VERTICES) ?? [])) {
                graph = geometryCall('remove_edges', () => (0, constructionGraph_1.removeEdge)(graph, String(id)));
            }
            for (const id of ((0, args_1.optArray)(args, 'remove_vertices', MAX_VERTICES) ?? [])) {
                graph = geometryCall('remove_vertices', () => (0, constructionGraph_1.removeVertex)(graph, String(id)));
            }
            const newIds = [];
            for (const p of readVertexList((0, args_1.optArray)(args, 'add_vertices', MAX_VERTICES), 'add_vertices')) {
                const added = (0, constructionGraph_1.addVertex)(graph, p);
                graph = added.graph;
                newIds.push(added.vertexId);
            }
            const ref = (value, label) => {
                if (typeof value === 'string') {
                    if (!graph.vertices[value])
                        throw new toolTypes_1.ToolError(`${label}: vertex ${value} does not exist. Use get_object to see vertex ids.`);
                    return value;
                }
                if (newIds.length === 0)
                    throw new toolTypes_1.ToolError(`${label}: use a vertex id such as v3 (no add_vertices in this call).`);
                return newIds[(0, args_1.toIndex)(value, newIds.length, label)];
            };
            ((0, args_1.optArray)(args, 'move_vertices', MAX_VERTICES) ?? []).forEach((item, i) => {
                if (typeof item !== 'object' || item === null)
                    throw new toolTypes_1.ToolError(`move_vertices[${i}] must be { vertex, position } or { vertex, offset }.`);
                const move = item;
                const id = ref(move.vertex, `move_vertices[${i}].vertex`);
                const position = (0, args_1.optVec3)(move, 'position');
                const offset = (0, args_1.optVec3)(move, 'offset');
                if (!position && !offset)
                    throw new toolTypes_1.ToolError(`move_vertices[${i}] needs position or offset.`);
                const target = position ?? (0, vec3_1.add)(graph.vertices[id].position, offset);
                graph = (0, constructionGraph_1.moveVertex)(graph, id, (0, vec3_1.cleanVec3)(target));
            });
            ((0, args_1.optArray)(args, 'add_edges', MAX_VERTICES * 4) ?? []).forEach((edge, i) => {
                if (!Array.isArray(edge) || edge.length !== 2)
                    throw new toolTypes_1.ToolError(`add_edges[${i}] must be a pair of vertices.`);
                const a = ref(edge[0], `add_edges[${i}][0]`);
                const b = ref(edge[1], `add_edges[${i}][1]`);
                graph = geometryCall(`add_edges[${i}]`, () => (0, constructionGraph_1.addEdge)(graph, a, b).graph);
            });
            let facesAdded = 0;
            ((0, args_1.optArray)(args, 'add_faces', MAX_VERTICES * 2) ?? []).forEach((face, i) => {
                if (!Array.isArray(face) || face.length < 3)
                    throw new toolTypes_1.ToolError(`add_faces[${i}] must list at least 3 vertices.`);
                const loop = face.map((v, k) => ref(v, `add_faces[${i}][${k}]`));
                graph = addFaceWithEdges(graph, loop, allowNonPlanar, `add_faces[${i}]`);
                facesAdded++;
            });
            if ((0, args_1.optBool)(args, 'fill_loops')) {
                const filled = (0, loops_1.fillClosedLoops)(graph);
                graph = filled.graph;
                facesAdded += filled.faceIds.length;
            }
            if ((0, args_1.optBool)(args, 'recalculate_normals') ?? facesAdded > 0)
                graph = (0, orientation_1.orientFaces)(graph).graph;
            if (graph === before)
                return result(`Nothing changed on ${object.name}.`);
            apply(ctx, new sceneCommands_1.SetGraphCommand(object.id, before, graph, `AI: edit points of ${object.name}`));
            return result(`Edited ${object.name}.`, {
                addedVertexIds: newIds,
                facesAdded,
                geometry: reportSummary((0, analysis_1.analyzeGraph)(graph)),
            });
        },
    },
    {
        name: 'check_geometry',
        title: 'Check geometry',
        description: 'Checks point-built and blueprint objects against the geometry invariants: loose vertices, open boundaries, non-manifold edges, bent or zero-area faces, and inconsistent normals. Checks every such object when none is named.',
        inputSchema: { type: 'object', properties: { object: objectRef('Optional object id or name') }, additionalProperties: false },
        annotations: readOnly,
        run(args, ctx) {
            const scene = sceneOf(ctx);
            const targets = args.object !== undefined && args.object !== null
                ? [resolveObject(scene, args.object)]
                : Object.values(scene.objects).filter((o) => (0, types_1.meshGraphOf)(o) !== null);
            const checkable = targets.filter((o) => (0, types_1.meshGraphOf)(o) !== null);
            if (checkable.length === 0)
                return result('There are no point-built or blueprint objects to check.');
            const reports = checkable.map((o) => ({ id: o.id, name: o.name, ...reportSummary((0, analysis_1.analyzeGraph)((0, types_1.meshGraphOf)(o))) }));
            const problems = reports.reduce((n, r) => n + r.problems.length, 0);
            return result(problems === 0 ? 'No geometry problems found.' : `${problems} geometry problem${problems === 1 ? '' : 's'} found.`, reports);
        },
    },
    {
        name: 'create_blueprint',
        title: 'Draw a blueprint',
        description: 'Draws a 2D outline of dots and lines on a plane (front, side or top) and turns it into a 3D object, the same way the user draws on the FORGEX board. ' +
            'Closed loops are filled; a loop inside another becomes a hole. shape.mode: "extrude" (default, gives the outline a thickness of shape.depth metres), ' +
            '"flat" (a panel), or "revolve" (spins the lines around an axis like a lathe: shape.axis "vertical" spins around x = 0 for bottles and vases, draw the right half with x >= 0; ' +
            '"horizontal" spins around y = 0 for wheels and barrels, draw the profile above the line with y >= 0; on the front plane that axle runs along X). ' +
            'shape.mirror copies the drawing across x = 0, so you can draw half of a symmetric object. smooth turns corners into curves. Without lines or loops, the points are joined in order into one closed outline. ' +
            'For a car body, plane or boat hull use create_body instead.',
        inputSchema: {
            type: 'object',
            properties: {
                name: { type: 'string' },
                plane: {
                    type: 'string',
                    enum: [...sketch_1.SKETCH_PLANES],
                    description: 'front: x right (+X), y up (+Y), thickness along Z. side: seen from the right, x towards the back (-Z), y up, thickness along X. ' +
                        'top: seen from above, x right (+X), y towards the back (-Z); extrusions grow upwards from the ground like walls. Default front.',
                },
                points: {
                    type: 'array',
                    items: { type: 'array', items: { type: 'number' }, minItems: 2, maxItems: 2 },
                    minItems: 1,
                    description: 'Dot positions [x, y] in metres on the plane',
                },
                lines: { type: 'array', items: { type: 'array', items: { type: 'integer', minimum: 0 }, minItems: 2, maxItems: 2 }, description: 'Pairs of point indices to join' },
                loops: { type: 'array', items: { type: 'array', items: { type: 'integer', minimum: 0 }, minItems: 3 }, description: 'Closed outlines as lists of point indices' },
                closed: { type: 'boolean', description: 'When no lines or loops are given: close the outline (default true)' },
                smooth: {
                    anyOf: [{ type: 'boolean' }, { type: 'array', items: { type: 'integer', minimum: 0 } }],
                    description: 'Smooth dots bend their lines into curves through the dot (true for all, or a list of point indices). Use for car bodies, blades, organic shapes.',
                },
                shape: shapeSchema,
                ...transformProps,
                color,
                parent: objectRef('Optional parent object id or name'),
            },
            required: ['name', 'points'],
            additionalProperties: false,
        },
        annotations: edit,
        run(args, ctx) {
            const scene = sceneOf(ctx);
            const plane = (0, args_1.optEnum)(args, 'plane', sketch_1.SKETCH_PLANES) ?? 'front';
            const rawPoints = (0, args_1.optArray)(args, 'points', MAX_VERTICES) ?? [];
            if (rawPoints.length === 0)
                throw new toolTypes_1.ToolError('points needs at least one [x, y] position.');
            let sketch = (0, sketch_1.createSketch)(plane);
            const ids = [];
            const smoothSet = smoothIndices(args.smooth, rawPoints.length, 'smooth');
            rawPoints.forEach((item, i) => {
                if (!Array.isArray(item) || item.length !== 2 || !item.every((n) => typeof n === 'number' && Number.isFinite(n))) {
                    throw new toolTypes_1.ToolError(`points[${i}] must be [x, y] with two finite numbers.`);
                }
                const added = (0, sketch_1.addPoint)(sketch, item[0], item[1], smoothSet.has(i));
                sketch = added.sketch;
                ids.push(added.pointId);
            });
            const join = (a, b, label) => {
                const ia = (0, args_1.toIndex)(a, ids.length, label);
                const ib = (0, args_1.toIndex)(b, ids.length, label);
                if (ia === ib)
                    throw new toolTypes_1.ToolError(`${label} joins point ${ia} to itself.`);
                sketch = (0, sketch_1.addLine)(sketch, ids[ia], ids[ib]).sketch;
            };
            const lines = (0, args_1.optArray)(args, 'lines', MAX_VERTICES * 4);
            const loops = (0, args_1.optArray)(args, 'loops', MAX_VERTICES);
            lines?.forEach((line, i) => {
                if (!Array.isArray(line) || line.length !== 2)
                    throw new toolTypes_1.ToolError(`lines[${i}] must be a pair of point indices.`);
                join(line[0], line[1], `lines[${i}]`);
            });
            loops?.forEach((loop, i) => {
                if (!Array.isArray(loop) || loop.length < 3)
                    throw new toolTypes_1.ToolError(`loops[${i}] must list at least 3 point indices.`);
                loop.forEach((index, k) => join(index, loop[(k + 1) % loop.length], `loops[${i}]`));
            });
            if (!lines && !loops && ids.length >= 2) {
                for (let i = 0; i + 1 < ids.length; i++)
                    sketch = (0, sketch_1.addLine)(sketch, ids[i], ids[i + 1]).sketch;
                if (((0, args_1.optBool)(args, 'closed') ?? true) && ids.length >= 3)
                    sketch = (0, sketch_1.addLine)(sketch, ids[ids.length - 1], ids[0]).sketch;
            }
            const shape = readShape(args.shape, sketch_1.DEFAULT_SHAPE);
            const base = (0, parts_1.createBlueprintObject)({
                name: (0, scene_1.uniqueName)(scene, (0, args_1.reqString)(args, 'name')),
                sketch,
                shape,
                color: (0, args_1.optColor)(args, 'color') ?? parts_1.BLUEPRINT_COLORS[Object.keys(scene.objects).length % parts_1.BLUEPRINT_COLORS.length],
            });
            const object = { ...base, transform: applyTransformArgs(base.transform, args) };
            apply(ctx, new sceneCommands_1.AddObjectsCommand([object], parentFromArgs(scene, args), undefined, `AI: draw ${object.name}`));
            return result(`Drew ${object.name} (${object.id}) with ${ids.length} dots.`, {
                id: object.id,
                pointIds: ids,
                ...blueprintSummary(object),
            });
        },
    },
    {
        name: 'edit_blueprint',
        title: 'Edit a blueprint',
        description: 'Changes a blueprint drawing and how it becomes 3D, in one undoable step. Steps run in order: remove lines, remove points (their lines go too), add points, move points, add lines, then plane and shape. ' +
            'Refer to existing dots by id (p3) and to dots added in this call by their index in add_points. Coordinates are [x, y] metres on the drawing plane.',
        inputSchema: {
            type: 'object',
            properties: {
                object: objectRef(),
                remove_lines: { type: 'array', items: { type: 'string' } },
                remove_points: { type: 'array', items: { type: 'string' } },
                add_points: { type: 'array', items: { type: 'array', items: { type: 'number' }, minItems: 2, maxItems: 2 } },
                move_points: {
                    type: 'array',
                    items: {
                        type: 'object',
                        properties: {
                            point: { anyOf: [{ type: 'string' }, { type: 'integer', minimum: 0 }] },
                            position: { type: 'array', items: { type: 'number' }, minItems: 2, maxItems: 2 },
                            offset: { type: 'array', items: { type: 'number' }, minItems: 2, maxItems: 2 },
                        },
                        required: ['point'],
                    },
                },
                add_lines: {
                    type: 'array',
                    items: { type: 'array', items: { anyOf: [{ type: 'string' }, { type: 'integer', minimum: 0 }] }, minItems: 2, maxItems: 2 },
                },
                smooth_points: { type: 'array', items: { anyOf: [{ type: 'string' }, { type: 'integer', minimum: 0 }] }, description: 'Dots to make smooth (curved)' },
                sharp_points: { type: 'array', items: { anyOf: [{ type: 'string' }, { type: 'integer', minimum: 0 }] }, description: 'Dots to make sharp corners' },
                view: { type: 'string', enum: [...body_1.BODY_VIEWS], description: 'For a body: which drawing to edit (side, top or front). Required for bodies.' },
                plane: { type: 'string', enum: [...sketch_1.SKETCH_PLANES], description: 'Blueprints only: move the drawing to another plane' },
                shape: shapeSchema,
                body: bodySchema,
            },
            required: ['object'],
            additionalProperties: false,
        },
        annotations: edit,
        run(args, ctx) {
            const object = unlocked(sceneOf(ctx), resolveDrawn(sceneOf(ctx), args.object));
            const before = object.source;
            const view = (0, args_1.optEnum)(args, 'view', body_1.BODY_VIEWS);
            if (before.type === 'body' && !view)
                throw new toolTypes_1.ToolError(`${object.name} is a body: say which drawing to edit with view (side, top or front).`);
            const original = before.type === 'body' ? before.views[view] : before.sketch;
            let sketch = original;
            const guard = (label, fn) => {
                try {
                    return fn();
                }
                catch (error) {
                    if (error instanceof sketch_1.SketchError)
                        throw new toolTypes_1.ToolError(`${label}: ${error.message}`);
                    throw error;
                }
            };
            for (const id of ((0, args_1.optArray)(args, 'remove_lines', MAX_VERTICES) ?? []))
                sketch = guard('remove_lines', () => (0, sketch_1.removeLine)(sketch, String(id)));
            for (const id of ((0, args_1.optArray)(args, 'remove_points', MAX_VERTICES) ?? []))
                sketch = guard('remove_points', () => (0, sketch_1.removePoint)(sketch, String(id)));
            const newIds = [];
            ((0, args_1.optArray)(args, 'add_points', MAX_VERTICES) ?? []).forEach((item, i) => {
                if (!Array.isArray(item) || item.length !== 2)
                    throw new toolTypes_1.ToolError(`add_points[${i}] must be [x, y].`);
                const added = guard(`add_points[${i}]`, () => (0, sketch_1.addPoint)(sketch, Number(item[0]), Number(item[1])));
                sketch = added.sketch;
                newIds.push(added.pointId);
            });
            const ref = (value, label) => {
                if (typeof value === 'string') {
                    if (!sketch.points[value])
                        throw new toolTypes_1.ToolError(`${label}: dot ${value} does not exist. Use get_object to see dot ids.`);
                    return value;
                }
                return newIds[(0, args_1.toIndex)(value, newIds.length, label)];
            };
            ((0, args_1.optArray)(args, 'move_points', MAX_VERTICES) ?? []).forEach((item, i) => {
                if (typeof item !== 'object' || item === null)
                    throw new toolTypes_1.ToolError(`move_points[${i}] must be { point, position } or { point, offset }.`);
                const move = item;
                const id = ref(move.point, `move_points[${i}].point`);
                const position = Array.isArray(move.position) ? move.position.map(Number) : null;
                const offset = Array.isArray(move.offset) ? move.offset.map(Number) : null;
                const current = sketch.points[id];
                const target = position ?? (offset ? [current.x + offset[0], current.y + offset[1]] : null);
                if (!target)
                    throw new toolTypes_1.ToolError(`move_points[${i}] needs position or offset.`);
                sketch = guard(`move_points[${i}]`, () => (0, sketch_1.movePoint)(sketch, id, target[0], target[1]));
            });
            ((0, args_1.optArray)(args, 'add_lines', MAX_VERTICES * 4) ?? []).forEach((line, i) => {
                if (!Array.isArray(line) || line.length !== 2)
                    throw new toolTypes_1.ToolError(`add_lines[${i}] must be a pair of dots.`);
                const a = ref(line[0], `add_lines[${i}][0]`);
                const b = ref(line[1], `add_lines[${i}][1]`);
                sketch = guard(`add_lines[${i}]`, () => (0, sketch_1.addLine)(sketch, a, b).sketch);
            });
            const smoothRefs = (key) => ((0, args_1.optArray)(args, key, MAX_VERTICES) ?? []).map((value, i) => ref(value, `${key}[${i}]`));
            sketch = (0, sketch_1.setPointsSmooth)(sketch, smoothRefs('smooth_points'), true);
            sketch = (0, sketch_1.setPointsSmooth)(sketch, smoothRefs('sharp_points'), false);
            let after;
            if (before.type === 'body') {
                if (args.plane !== undefined || args.shape !== undefined)
                    throw new toolTypes_1.ToolError('plane and shape are for blueprints; bodies use view and body settings.');
                const body = readBodySettings(args.body, before.body);
                if (sketch === original && JSON.stringify(body) === JSON.stringify(before.body))
                    return result(`Nothing changed on ${object.name}.`);
                after = { type: 'body', views: { ...before.views, [view]: sketch }, body };
            }
            else {
                if (args.body !== undefined)
                    throw new toolTypes_1.ToolError('body settings are for bodies; blueprints use shape.');
                const plane = (0, args_1.optEnum)(args, 'plane', sketch_1.SKETCH_PLANES);
                if (plane)
                    sketch = (0, sketch_1.setPlane)(sketch, plane);
                const shape = readShape(args.shape, before.shape);
                if (sketch === original && JSON.stringify(shape) === JSON.stringify(before.shape))
                    return result(`Nothing changed on ${object.name}.`);
                after = { type: 'sketch', sketch, shape };
            }
            apply(ctx, new sceneCommands_1.SetSourceCommand(object.id, before, after, `AI: edit ${object.name}${view ? ` (${view} view)` : ''}`));
            const edited = { ...object, source: after };
            return result(`Edited ${object.name}.`, {
                addedPointIds: newIds,
                ...(edited.source.type === 'body' ? bodySummary(edited) : blueprintSummary(edited)),
            });
        },
    },
    {
        name: 'create_body',
        title: 'Loft a body from three views',
        description: 'Builds a smooth closed body from three outlines, the way car designers work from blueprints: the side view (length and height), the top view (length and width) and an optional front view (the cross-section shape). ' +
            'Use it for car bodies, cabins, aircraft fuselages, boat hulls and helmets. Coordinates: side view [x, y] has x = -Z (the front of the object, +Z, is on the left) and y = up; ' +
            'top view [x, y] has x = X and y = -Z (front at the bottom); front view [x, y] has x = X and y = up. The side view is a closed outline. With symmetric (default true) the top and front views ' +
            'are the right half only (x >= 0), drawn from the centre line round to the centre line. Notches cut up into the bottom of the side outline make wheel arches. smooth (default true) curves the outlines through the dots. ' +
            'Build a car from several bodies (body, cabin) plus revolved wheels; add_template shows complete examples.',
        inputSchema: {
            type: 'object',
            properties: {
                name: { type: 'string' },
                side: { type: 'array', items: point2, minItems: 3, description: 'Side view outline [x = -Z, y = up], closed' },
                top: { type: 'array', items: point2, minItems: 2, description: 'Top view outline [x = X, y = -Z]: right half when symmetric' },
                front: { type: 'array', items: point2, description: 'Optional front view cross-section [x = X, y = up]: right half when symmetric' },
                smooth: { type: 'boolean', description: 'Curve the outlines through every dot (default true)' },
                body: bodySchema,
                ...transformProps,
                color,
                parent: objectRef('Optional parent object id or name'),
            },
            required: ['name', 'side', 'top'],
            additionalProperties: false,
        },
        annotations: edit,
        run(args, ctx) {
            const scene = sceneOf(ctx);
            const body = readBodySettings(args.body, body_1.DEFAULT_BODY);
            const smooth = (0, args_1.optBool)(args, 'smooth') ?? true;
            const empty = (0, body_1.createBodyViews)();
            const read = (key, closed) => {
                const list = (0, args_1.optArray)(args, key, MAX_VERTICES);
                return list && list.length ? drawingFromArgs(key, list, key, closed, smooth).sketch : empty[key];
            };
            const views = { side: read('side', true), top: read('top', !body.symmetric), front: read('front', !body.symmetric) };
            const base = (0, parts_1.createBodyObject)({
                name: (0, scene_1.uniqueName)(scene, (0, args_1.reqString)(args, 'name')),
                views,
                body,
                color: (0, args_1.optColor)(args, 'color') ?? parts_1.BLUEPRINT_COLORS[Object.keys(scene.objects).length % parts_1.BLUEPRINT_COLORS.length],
            });
            const object = { ...base, transform: applyTransformArgs(base.transform, args) };
            apply(ctx, new sceneCommands_1.AddObjectsCommand([object], parentFromArgs(scene, args), undefined, `AI: loft ${object.name}`));
            const summary = bodySummary(object);
            return result(summary.missing ? `Created ${object.name} (${object.id}), but ${String(summary.missing)}` : `Lofted ${object.name} (${object.id}).`, { id: object.id, ...summary });
        },
    },
    {
        name: 'add_template',
        title: 'Add a ready-made model',
        description: 'Adds a complete, fully editable model built from bodies and blueprints: supercar (low mid-engine sports car) or saloon (long luxury limousine). ' +
            'Every part (body, cabin, lights, wheels with tyres, rims and spokes) can be reshaped afterwards with edit_blueprint. A good starting point for cars.',
        inputSchema: {
            type: 'object',
            properties: {
                template: { type: 'string', enum: templates_1.TEMPLATES.map((t) => t.id) },
                name: { type: 'string' },
                position: vec3('Where to put it, in metres; it rests on the ground'),
                color: { type: 'string', description: 'Paint colour for the body, for example #c0392b' },
            },
            required: ['template'],
            additionalProperties: false,
        },
        annotations: edit,
        run(args, ctx) {
            const scene = sceneOf(ctx);
            const id = (0, args_1.reqEnum)(args, 'template', templates_1.TEMPLATES.map((t) => t.id));
            const position = (0, args_1.optVec3)(args, 'position');
            let objects = (0, templates_1.createTemplate)(id, { groundPosition: position ? [position[0], position[2]] : [0, 0] });
            const paint = (0, args_1.optColor)(args, 'color');
            objects = objects.map((o, i) => {
                if (i === 0)
                    return { ...o, name: (0, scene_1.uniqueName)(scene, (0, args_1.optString)(args, 'name') ?? (0, templates_1.getTemplate)(id).name) };
                if (paint && o.kind === 'mesh' && o.name === 'Body' && o.parentId === objects[0].id)
                    return { ...o, material: { ...o.material, color: paint } };
                return o;
            });
            apply(ctx, new sceneCommands_1.AddObjectsCommand(objects, null, undefined, `AI: add ${objects[0].name}`));
            return result(`Added ${objects[0].name} (${objects[0].id}) with ${objects.length - 1} parts.`, tree(sceneOf(ctx), [objects[0].id]));
        },
    },
    {
        name: 'set_modifiers',
        title: 'Smooth and mirror a mesh',
        description: 'Non-destructive finishing for any mesh: subdivide (0 to 3 levels of Catmull-Clark smoothing, which rounds blocky point-built shapes into organic ones), ' +
            'mirror (copy the mesh across its local x, y or z = 0 plane and join the halves, so you can model one half), and smooth_shading (curved surfaces look round). ' +
            'The editable source is unchanged; values you leave out stay as they are.',
        inputSchema: {
            type: 'object',
            properties: {
                object: objectRef(),
                subdivide: { type: 'integer', minimum: 0, maximum: modifiers_1.MAX_SUBDIVISION },
                mirror: { type: 'string', enum: [...modifiers_1.MIRROR_AXES] },
                smooth_shading: { type: 'boolean' },
            },
            required: ['object'],
            additionalProperties: false,
        },
        annotations: edit,
        run(args, ctx) {
            const object = unlocked(sceneOf(ctx), resolveObject(sceneOf(ctx), args.object));
            if (object.kind !== 'mesh')
                throw new toolTypes_1.ToolError(`${object.name} is a group; modifiers work on meshes.`);
            const current = object.modifiers ?? modifiers_1.NO_MODIFIERS;
            const modifiers = (0, modifiers_1.cleanModifiers)({
                mirror: (0, args_1.optEnum)(args, 'mirror', modifiers_1.MIRROR_AXES) ?? current.mirror,
                subdivide: args.subdivide === undefined ? current.subdivide : Number(args.subdivide),
            });
            const smooth = (0, args_1.optBool)(args, 'smooth_shading') ?? !!object.material.smooth;
            apply(ctx, new sceneCommands_1.SetMeshLookCommand(object.id, { modifiers: object.modifiers, smooth: !!object.material.smooth }, { modifiers: (0, modifiers_1.hasModifiers)(modifiers) ? modifiers : undefined, smooth }, `AI: modifiers on ${object.name}`));
            const updated = sceneOf(ctx).objects[object.id];
            return result(`Updated ${object.name}.`, { ...describe(updated), geometry: reportSummary((0, analysis_1.analyzeGraph)((0, types_1.meshGraphOf)(updated))) });
        },
    },
    {
        name: 'convert_to_points',
        title: 'Convert blueprint to points',
        description: 'Turns a blueprint or body into a point-built object with its current 3D shape, so individual vertices can be edited with edit_point_mesh. The drawings are no longer used afterwards (undo restores them). Modifiers stay on.',
        inputSchema: { type: 'object', properties: { object: objectRef() }, required: ['object'], additionalProperties: false },
        annotations: edit,
        run(args, ctx) {
            const object = unlocked(sceneOf(ctx), resolveDrawn(sceneOf(ctx), args.object));
            const graph = (0, types_1.sourceGraphOf)(object);
            apply(ctx, new sceneCommands_1.SetSourceCommand(object.id, object.source, { type: 'construction', graph }, `AI: convert ${object.name} to points`));
            const counts = (0, analysis_1.analyzeGraph)(graph);
            return result(`${object.name} is now point-built with ${counts.vertices} vertices and ${counts.faces} faces.`);
        },
    },
    {
        name: 'set_transform',
        title: 'Set transform',
        description: 'Sets position (metres), rotation (degrees) and/or scale of an object, relative to its parent. Values you leave out stay as they are.',
        inputSchema: {
            type: 'object',
            properties: { object: objectRef(), ...transformProps },
            required: ['object'],
            additionalProperties: false,
        },
        annotations: { ...edit, idempotentHint: true },
        run(args, ctx) {
            const object = unlocked(sceneOf(ctx), resolveObject(sceneOf(ctx), args.object));
            if (args.position === undefined && args.rotation === undefined && args.scale === undefined) {
                throw new toolTypes_1.ToolError('Give at least one of position, rotation or scale.');
            }
            const after = applyTransformArgs(object.transform, args);
            apply(ctx, new sceneCommands_1.SetTransformCommand(object.id, object.transform, after, `AI: transform ${object.name}`));
            return result(`Updated ${object.name}.`, describe({ ...object, transform: after }));
        },
    },
    {
        name: 'set_color',
        title: 'Set colour',
        description: 'Sets the colour of a mesh object.',
        inputSchema: { type: 'object', properties: { object: objectRef(), color }, required: ['object', 'color'], additionalProperties: false },
        annotations: { ...edit, idempotentHint: true },
        run(args, ctx) {
            const object = unlocked(sceneOf(ctx), resolveObject(sceneOf(ctx), args.object));
            if (object.kind !== 'mesh')
                throw new toolTypes_1.ToolError(`${object.name} is a group and has no colour.`);
            const value = (0, args_1.optColor)(args, 'color');
            if (!value)
                throw new toolTypes_1.ToolError('color is required.');
            if (value !== object.material.color)
                apply(ctx, new sceneCommands_1.SetColorCommand(object.id, object.material.color, value));
            return result(`${object.name} is now ${value}.`);
        },
    },
    {
        name: 'rename_object',
        title: 'Rename object',
        description: 'Renames an object. Names show in the scene hierarchy and are saved in the project.',
        inputSchema: { type: 'object', properties: { object: objectRef(), name: { type: 'string' } }, required: ['object', 'name'], additionalProperties: false },
        annotations: { ...edit, idempotentHint: true },
        run(args, ctx) {
            const object = resolveObject(sceneOf(ctx), args.object);
            const name = (0, args_1.reqString)(args, 'name');
            if (name !== object.name)
                apply(ctx, new sceneCommands_1.RenameObjectCommand(object.id, object.name, name));
            return result(`Renamed ${object.id} to ${name}.`);
        },
    },
    {
        name: 'set_visibility',
        title: 'Show or hide',
        description: 'Shows or hides an object (and, in the viewport, its children).',
        inputSchema: {
            type: 'object',
            properties: { object: objectRef(), visible: { type: 'boolean' } },
            required: ['object', 'visible'],
            additionalProperties: false,
        },
        annotations: { ...edit, idempotentHint: true },
        run(args, ctx) {
            const object = resolveObject(sceneOf(ctx), args.object);
            const visible = (0, args_1.optBool)(args, 'visible');
            if (visible === undefined)
                throw new toolTypes_1.ToolError('visible is required.');
            if (visible !== object.visible)
                apply(ctx, new sceneCommands_1.SetVisibilityCommand(object.id, visible, object.name));
            return result(`${object.name} is now ${visible ? 'visible' : 'hidden'}.`);
        },
    },
    {
        name: 'delete_object',
        title: 'Delete object',
        description: 'Deletes an object together with all its children. It can be undone.',
        inputSchema: { type: 'object', properties: { object: objectRef() }, required: ['object'], additionalProperties: false },
        annotations: { readOnlyHint: false, destructiveHint: true, openWorldHint: false },
        run(args, ctx) {
            const scene = sceneOf(ctx);
            const object = unlocked(scene, resolveObject(scene, args.object));
            const count = Object.values(scene.objects).filter((o) => (0, scene_1.isSelfOrAncestor)(scene, object.id, o.id)).length;
            apply(ctx, new sceneCommands_1.DeleteObjectCommand(object.id, object.name));
            return result(`Deleted ${object.name}${count > 1 ? ` and ${count - 1} child object${count === 2 ? '' : 's'}` : ''}. undo brings it back.`);
        },
    },
    {
        name: 'duplicate_object',
        title: 'Duplicate object',
        description: 'Copies an object and all its children with new ids, placed next to the original in the hierarchy.',
        inputSchema: {
            type: 'object',
            properties: {
                object: objectRef(),
                offset: vec3('Move the copy by this amount in metres (default [0, 0, 0])'),
                name: { type: 'string' },
            },
            required: ['object'],
            additionalProperties: false,
        },
        annotations: edit,
        run(args, ctx) {
            const scene = sceneOf(ctx);
            const object = resolveObject(scene, args.object);
            const copies = (0, scene_1.cloneSubtree)(scene, object.id, ids_1.createObjectId);
            const offset = (0, args_1.optVec3)(args, 'offset') ?? [0, 0, 0];
            copies[0] = {
                ...copies[0],
                name: (0, scene_1.uniqueName)(scene, (0, args_1.optString)(args, 'name') ?? object.name),
                transform: (0, transform_1.cleanTransform)({ ...copies[0].transform, position: (0, vec3_1.add)(copies[0].transform.position, offset) }),
            };
            apply(ctx, new sceneCommands_1.AddObjectsCommand(copies, object.parentId, (0, scene_1.indexInParent)(scene, object.id) + 1, `AI: duplicate ${object.name}`));
            return result(`Created ${copies[0].name} (${copies[0].id})${copies.length > 1 ? ` with ${copies.length - 1} children` : ''}.`, describe(copies[0]));
        },
    },
    {
        name: 'set_parent',
        title: 'Set parent',
        description: 'Moves an object under another object (or to the top level with parent null). Its position in the world stays the same.',
        inputSchema: {
            type: 'object',
            properties: { object: objectRef(), parent: { type: ['string', 'null'], description: 'New parent id or name, or null for the top level' } },
            required: ['object', 'parent'],
            additionalProperties: false,
        },
        annotations: edit,
        run(args, ctx) {
            const scene = sceneOf(ctx);
            const object = unlocked(scene, resolveObject(scene, args.object));
            const parentId = parentFromArgs(scene, args);
            if (parentId !== null && (0, scene_1.isSelfOrAncestor)(scene, object.id, parentId)) {
                throw new toolTypes_1.ToolError(`${object.name} cannot go inside itself or one of its children.`);
            }
            if (parentId === object.parentId)
                return result(`${object.name} already has that parent.`);
            const siblings = parentId === null ? scene.rootIds : scene.objects[parentId].childIds;
            apply(ctx, new sceneCommands_1.MoveObjectCommand(object.id, parentId, siblings.length, `AI: move ${object.name}`));
            return result(`${object.name} is now ${parentId ? `inside ${scene.objects[parentId].name}` : 'at the top level'}.`);
        },
    },
    {
        name: 'group_objects',
        title: 'Group objects',
        description: 'Creates a group at the centre of the given objects and moves them into it, keeping their world positions.',
        inputSchema: {
            type: 'object',
            properties: { objects: { type: 'array', items: { type: 'string' }, minItems: 1 }, name: { type: 'string' } },
            required: ['objects'],
            additionalProperties: false,
        },
        annotations: edit,
        run(args, ctx) {
            const scene = sceneOf(ctx);
            const refs = (0, args_1.optArray)(args, 'objects', 1000);
            if (!refs || refs.length === 0)
                throw new toolTypes_1.ToolError('objects needs at least one object.');
            const chosen = [...new Map(refs.map((r) => resolveObject(scene, r)).map((o) => [o.id, o])).values()];
            // Children of other chosen objects move with their parent.
            const tops = chosen.filter((o) => !chosen.some((other) => other.id !== o.id && (0, scene_1.isSelfOrAncestor)(scene, other.id, o.id)));
            const centre = tops
                .map((o) => (0, transform_1.decomposeMatrix)((0, scene_1.worldMatrix)(scene, o.id)).position)
                .reduce((sum, p) => (0, vec3_1.add)(sum, p), [0, 0, 0])
                .map((v) => (0, args_1.round)(v / tops.length, 6));
            const group = (0, parts_1.createPartObject)('group', { name: (0, scene_1.uniqueName)(scene, (0, args_1.optString)(args, 'name') ?? 'Group') });
            const placed = { ...group, transform: { ...group.transform, position: centre } };
            const commands = [new sceneCommands_1.AddObjectsCommand([placed], null)];
            tops.forEach((o, i) => commands.push(new sceneCommands_1.MoveObjectCommand(o.id, placed.id, i)));
            apply(ctx, new command_1.CompositeCommand(`AI: group ${tops.length} objects`, commands, placed.id));
            return result(`Grouped ${tops.map((o) => o.name).join(', ')} into ${placed.name} (${placed.id}).`);
        },
    },
    {
        name: 'select_object',
        title: 'Select object',
        description: 'Selects an object in the editor (pass null to clear the selection). Useful before capture_viewport in the app.',
        inputSchema: { type: 'object', properties: { object: { type: ['string', 'null'] } }, required: ['object'], additionalProperties: false },
        annotations: { ...readOnly, idempotentHint: true },
        run(args, ctx) {
            if (args.object === null) {
                ctx.store.select(null);
                return result('Selection cleared.');
            }
            const object = resolveObject(sceneOf(ctx), args.object);
            ctx.store.select(object.id);
            return result(`Selected ${object.name}.`);
        },
    },
    {
        name: 'set_lock',
        title: 'Lock or unlock object',
        description: 'Locks an object so it cannot be picked in the 3D view, moved, edited or deleted (by the user or by these tools) until it is unlocked. Use it to protect finished parts. Locking a group protects everything inside it.',
        inputSchema: {
            type: 'object',
            properties: { object: objectRef(), locked: { type: 'boolean' } },
            required: ['object', 'locked'],
            additionalProperties: false,
        },
        annotations: { ...edit, idempotentHint: true },
        run(args, ctx) {
            const object = resolveObject(sceneOf(ctx), args.object);
            const locked = (0, args_1.optBool)(args, 'locked');
            if (locked === undefined)
                throw new toolTypes_1.ToolError('locked must be true or false.');
            if (!!object.locked === locked)
                return result(`${object.name} is already ${locked ? 'locked' : 'unlocked'}.`);
            apply(ctx, new sceneCommands_1.SetLockCommand(object.id, locked, object.name));
            return result(`${object.name} is now ${locked ? 'locked' : 'unlocked'}.`);
        },
    },
    {
        name: 'list_snapshots',
        title: 'List snapshots',
        description: 'Lists the saved versions (snapshots) stored in this project, oldest first, with their ids, names, dates and object counts.',
        inputSchema: noArgs,
        annotations: readOnly,
        run(_args, ctx) {
            const snapshots = ctx.store.getState().snapshots;
            if (snapshots.length === 0)
                return result('This project has no snapshots yet. save_snapshot takes one.');
            return result(`${snapshots.length} snapshot${snapshots.length === 1 ? '' : 's'}:`, snapshots.map((snapshot) => ({ id: snapshot.id, name: snapshot.name, createdAt: snapshot.createdAt, objects: Object.keys(snapshot.scene.objects).length })));
        },
    },
    {
        name: 'save_snapshot',
        title: 'Save snapshot',
        description: 'Saves the whole scene as a named version inside the project, to come back to with restore_snapshot. Take one before a big or risky change. Projects keep the latest 40.',
        inputSchema: { type: 'object', properties: { name: { type: 'string', description: 'Name such as "Before new wheels" (default "Version N")' } }, additionalProperties: false },
        annotations: edit,
        run(args, ctx) {
            const state = ctx.store.getState();
            const name = (0, args_1.optString)(args, 'name', 120) ?? (0, snapshots_1.nextSnapshotName)(state.snapshots);
            const snapshot = (0, snapshots_1.createSnapshot)(state.scene, name, (0, ids_1.randomId)('snap'));
            ctx.store.setSnapshots((0, snapshots_1.addSnapshot)(state.snapshots, snapshot));
            return result(`Saved snapshot “${snapshot.name}” (${snapshot.id}) with ${Object.keys(snapshot.scene.objects).length} objects.`);
        },
    },
    {
        name: 'restore_snapshot',
        title: 'Restore snapshot',
        description: 'Replaces the scene with a saved snapshot. This is one undoable change: undo brings back the scene as it was before.',
        inputSchema: { type: 'object', properties: { snapshot: { type: 'string', description: 'Snapshot id or exact name' } }, required: ['snapshot'], additionalProperties: false },
        annotations: { readOnlyHint: false, destructiveHint: true, openWorldHint: false },
        run(args, ctx) {
            const ref = (0, args_1.reqString)(args, 'snapshot', 200).trim();
            const state = ctx.store.getState();
            const snapshot = state.snapshots.find((s) => s.id === ref) ??
                state.snapshots.find((s) => s.name === ref) ??
                state.snapshots.find((s) => s.name.toLowerCase() === ref.toLowerCase());
            if (!snapshot)
                throw new toolTypes_1.ToolError(`No snapshot is called "${ref}". Use list_snapshots to see them.`);
            apply(ctx, new sceneCommands_1.ReplaceSceneCommand(state.scene, snapshot.scene, `Restore ${snapshot.name}`));
            return result(`Restored “${snapshot.name}” (${Object.keys(snapshot.scene.objects).length} objects). undo returns to the scene before.`);
        },
    },
    {
        name: 'list_library',
        title: 'List My Parts',
        description: 'Lists the reusable parts in My Parts, the shared library every FORGEX project can use (on Windows: Documents\\FORGEX 3D\\Library). Parts saved here in one project can be added to any other with add_from_library.',
        inputSchema: noArgs,
        annotations: readOnly,
        async run(_args, ctx) {
            const library = libraryOf(ctx);
            const entries = await library.list();
            if (entries.length === 0)
                return result(`My Parts is empty (${library.location()}). save_to_library adds an object.`);
            return result(`${entries.length} part${entries.length === 1 ? '' : 's'} in My Parts (${library.location()}):`, entries.map((entry) => ({ name: entry.name, file: entry.file, objects: entry.objectCount, ...(entry.description ? { description: entry.description } : {}) })));
        },
    },
    {
        name: 'save_to_library',
        title: 'Save to My Parts',
        description: 'Saves an object and everything inside it to My Parts, so it can be reused in any project. The saved copy stands at the origin; the object in this scene is not changed.',
        inputSchema: {
            type: 'object',
            properties: {
                object: objectRef(),
                name: { type: 'string', description: 'Part name (default: the object name)' },
                description: { type: 'string', description: 'A short note on what the part is for' },
                overwrite: { type: 'boolean', description: 'Replace a part with the same name (default false)' },
            },
            required: ['object'],
            additionalProperties: false,
        },
        annotations: edit,
        async run(args, ctx) {
            const library = libraryOf(ctx);
            const object = resolveObject(sceneOf(ctx), args.object);
            const part = (0, libraryPart_1.libraryPartFromScene)(sceneOf(ctx), object.id, { name: (0, args_1.optString)(args, 'name', 120), description: (0, args_1.optString)(args, 'description', 500) });
            try {
                const file = await library.write(part, (0, args_1.optBool)(args, 'overwrite') ?? false);
                return result(`Saved ${part.name} to My Parts as ${file} (${Object.keys(part.scene.objects).length} objects).`);
            }
            catch (error) {
                throw new toolTypes_1.ToolError(error instanceof Error ? error.message : String(error));
            }
        },
    },
    {
        name: 'add_from_library',
        title: 'Add from My Parts',
        description: 'Adds a copy of a part from My Parts to the scene, with new ids. Without a position it is placed clear of the existing objects.',
        inputSchema: {
            type: 'object',
            properties: {
                part: { type: 'string', description: 'Part name or file name from list_library' },
                position: vec3('Where to put it, in metres (default: beside the scene)'),
                parent: { type: ['string', 'null'], description: 'Optional parent object id or name' },
            },
            required: ['part'],
            additionalProperties: false,
        },
        annotations: edit,
        async run(args, ctx) {
            const library = libraryOf(ctx);
            const ref = (0, args_1.reqString)(args, 'part', 200);
            const entry = (0, libraryPart_1.findLibraryEntry)(await library.list(), ref);
            if (!entry)
                throw new toolTypes_1.ToolError(`My Parts has no part called "${ref}". Use list_library to see them.`);
            let part;
            try {
                part = await library.read(entry.file);
            }
            catch (error) {
                throw new toolTypes_1.ToolError(error instanceof Error ? error.message : String(error));
            }
            const scene = sceneOf(ctx);
            const objects = (0, libraryPart_1.instantiateLibraryPart)(part, ids_1.createObjectId);
            const position = (0, args_1.optVec3)(args, 'position');
            const parentId = parentFromArgs(scene, args);
            const root = objects[0];
            const [, y, z] = root.transform.position;
            objects[0] = {
                ...root,
                name: (0, scene_1.uniqueName)(scene, part.name),
                transform: (0, transform_1.cleanTransform)({ ...root.transform, position: position ?? [parentId ? 0 : (0, scene_1.clearSpotX)(scene, objects), y, z] }),
            };
            apply(ctx, new sceneCommands_1.AddObjectsCommand(objects, parentId, undefined, `AI: add ${part.name} from My Parts`));
            return result(`Added ${objects[0].name} (${objects[0].id}) from My Parts${objects.length > 1 ? ` with ${objects.length - 1} children` : ''}.`, describe(objects[0]));
        },
    },
    {
        name: 'undo',
        title: 'Undo',
        description: 'Undoes the most recent changes in FORGEX, whether the AI or the user made them.',
        inputSchema: { type: 'object', properties: { steps: { type: 'integer', minimum: 1, maximum: 50 } }, additionalProperties: false },
        annotations: edit,
        run(args, ctx) {
            const steps = (0, args_1.optInt)(args, 'steps', 1, 50) ?? 1;
            const undone = [];
            for (let i = 0; i < steps; i++) {
                const label = ctx.store.getState().history.undoLabel;
                if (!label || !ctx.store.undo())
                    break;
                undone.push(label);
            }
            return result(undone.length ? `Undid: ${undone.join('; ')}.` : 'There was nothing to undo.');
        },
    },
    {
        name: 'redo',
        title: 'Redo',
        description: 'Redoes changes that were undone.',
        inputSchema: { type: 'object', properties: { steps: { type: 'integer', minimum: 1, maximum: 50 } }, additionalProperties: false },
        annotations: edit,
        run(args, ctx) {
            const steps = (0, args_1.optInt)(args, 'steps', 1, 50) ?? 1;
            const redone = [];
            for (let i = 0; i < steps; i++) {
                const label = ctx.store.getState().history.redoLabel;
                if (!label || !ctx.store.redo())
                    break;
                redone.push(label);
            }
            return result(redone.length ? `Redid: ${redone.join('; ')}.` : 'There was nothing to redo.');
        },
    },
    {
        name: 'new_project',
        title: 'New project',
        description: 'Starts a new project. In the app, the user is asked first if there are unsaved changes. A relative path (like "kart") goes in the FORGEX projects folder; the file is written when saved.',
        inputSchema: {
            type: 'object',
            properties: {
                path: { type: 'string', description: 'Optional .forgex path for the new project' },
                empty: { type: 'boolean', description: 'Start with an empty scene (default true); false starts with the default cube' },
            },
            additionalProperties: false,
        },
        annotations: { readOnlyHint: false, destructiveHint: true, openWorldHint: false },
        async run(args, ctx) {
            return result(await ctx.host.newProject({ path: (0, args_1.optString)(args, 'path', 1000), empty: (0, args_1.optBool)(args, 'empty') ?? true }));
        },
    },
    {
        name: 'open_project',
        title: 'Open project',
        description: 'Opens a .forgex project. In the app, the user is asked first if there are unsaved changes. Relative paths use the FORGEX projects folder.',
        inputSchema: { type: 'object', properties: { path: { type: 'string' } }, required: ['path'], additionalProperties: false },
        annotations: { readOnlyHint: false, destructiveHint: true, openWorldHint: false },
        async run(args, ctx) {
            return result(await ctx.host.openProject((0, args_1.reqString)(args, 'path', 1000)));
        },
    },
    {
        name: 'save_project',
        title: 'Save project',
        description: 'Saves the project as a .forgex file, to the given path or to where it was last saved. Relative paths use the FORGEX projects folder.',
        inputSchema: { type: 'object', properties: { path: { type: 'string' } }, additionalProperties: false },
        annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false },
        async run(args, ctx) {
            return result(await ctx.host.saveProject((0, args_1.optString)(args, 'path', 1000)));
        },
    },
    {
        name: 'capture_viewport',
        title: 'Capture viewport image',
        description: 'Returns an image of the FORGEX 3D viewport so you can check your work. Needs the app to be open. view picks a camera angle (current keeps the user\'s view); frame fits all objects in view first.',
        inputSchema: {
            type: 'object',
            properties: {
                view: { type: 'string', enum: [...toolTypes_1.VIEW_PRESETS] },
                frame: { type: 'boolean', description: 'Fit all objects in view (default true unless view is current)' },
                width: { type: 'integer', minimum: 256, maximum: 1600, description: 'Image width in pixels (default 1024)' },
            },
            additionalProperties: false,
        },
        annotations: readOnly,
        async run(args, ctx) {
            if (!ctx.host.captureViewport) {
                throw new toolTypes_1.ToolError('Viewport images need the FORGEX 3D app. Start it (npm run desktop or npm run dev) and it links to this server automatically.');
            }
            const view = (0, args_1.optEnum)(args, 'view', toolTypes_1.VIEW_PRESETS) ?? 'current';
            const frame = (0, args_1.optBool)(args, 'frame') ?? view !== 'current';
            const width = (0, args_1.optInt)(args, 'width', 256, 1600) ?? 1024;
            const image = await ctx.host.captureViewport({ view, frame, width });
            return { text: `Viewport image (${view} view${frame ? ', framed' : ''}).`, image };
        },
    },
];
exports.TOOL_SPECS = TOOLS.map((tool) => ({
    name: tool.name,
    title: tool.title,
    description: tool.description,
    inputSchema: tool.inputSchema,
    annotations: tool.annotations,
}));
const TOOL_MAP = new Map(TOOLS.map((tool) => [tool.name, tool]));
function hasTool(name) {
    return TOOL_MAP.has(name);
}
/** Runs a tool. Throws ToolError for problems the caller can fix. */
async function runTool(name, rawArgs, ctx) {
    const tool = TOOL_MAP.get(name);
    if (!tool)
        throw new toolTypes_1.ToolError(`Unknown tool ${name}.`);
    return tool.run((0, args_1.asArgs)(rawArgs), ctx);
}
/** Tools that only read, so a host can skip saving afterwards. */
function isReadOnlyTool(name) {
    return TOOL_MAP.get(name)?.annotations?.readOnlyHint === true;
}
