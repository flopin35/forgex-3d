import { CompositeCommand, type Command } from '../commands/command';
import {
  AddObjectsCommand,
  DeleteObjectCommand,
  MoveObjectCommand,
  RenameObjectCommand,
  SetColorCommand,
  SetGraphCommand,
  SetTransformCommand,
  SetVisibilityCommand,
} from '../commands/sceneCommands';
import { analyzeGraph, type GraphReport } from '../geometry/analysis';
import {
  addEdge,
  addFace,
  addVertex,
  createEmptyGraph,
  GeometryError,
  moveVertex,
  removeEdge,
  removeFace,
  removeVertex,
  type ConstructionGraph,
} from '../geometry/constructionGraph';
import { fillClosedLoops } from '../geometry/loops';
import { orientFaces } from '../geometry/orientation';
import { createObjectId } from '../ids';
import { cleanTransform, decomposeMatrix, identityTransform, type Transform } from '../math/transform';
import { add, cleanVec3, type Vec3 } from '../math/vec3';
import { PARTS, createPartObject, getPart, type PartId } from '../scene/parts';
import { cloneSubtree, indexInParent, isSelfOrAncestor, uniqueName, worldMatrix } from '../scene/scene';
import { isConstructionMesh, type MeshObject, type Scene, type SceneObject } from '../scene/types';
import { METERS_PER_ROBLOX_STUD } from '../units';
import {
  asArgs,
  optArray,
  optBool,
  optColor,
  optEnum,
  optInt,
  optString,
  optVec3,
  reqEnum,
  reqString,
  round,
  roundVec,
  toIndex,
  toVec3,
  type Args,
} from './args';
import { ToolError, VIEW_PRESETS, type ToolContext, type ToolOutput, type ToolSpec } from './toolTypes';

interface ToolDefinition extends ToolSpec {
  run(args: Args, ctx: ToolContext): ToolOutput | Promise<ToolOutput>;
}

type ConstructionMesh = MeshObject & { source: { type: 'construction'; graph: ConstructionGraph } };

// ---------------------------------------------------------------------------
// Schema fragments
// ---------------------------------------------------------------------------

const vec3 = (description: string) => ({ type: 'array', items: { type: 'number' }, minItems: 3, maxItems: 3, description });
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
const readOnly = { readOnlyHint: true, destructiveHint: false, openWorldHint: false };
const edit = { readOnlyHint: false, destructiveHint: false, openWorldHint: false };

const MAX_VERTICES = 50_000;
const MAX_LISTED_ELEMENTS = 3_000;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function sceneOf(ctx: ToolContext): Scene {
  return ctx.store.getState().scene;
}

/** Runs a command through the editor (so it is undoable) or reports why it failed. */
function apply(ctx: ToolContext, command: Command): void {
  if (ctx.store.execute(command)) return;
  const last = ctx.store.getState().messages.at(-1);
  throw new ToolError(last ? `${last.text}${last.detail ? ` ${last.detail}` : ''}` : `${command.label} failed.`);
}

function result(summary: string, details?: unknown): ToolOutput {
  return { text: details === undefined ? summary : `${summary}\n${JSON.stringify(details, null, 1)}` };
}

export function resolveObject(scene: Scene, ref: unknown, label = 'object'): SceneObject {
  if (typeof ref !== 'string' || !ref.trim()) throw new ToolError(`${label} must be an object id or name.`);
  const key = ref.trim();
  if (scene.objects[key]) return scene.objects[key];
  const all = Object.values(scene.objects);
  let matches = all.filter((o) => o.name === key);
  if (matches.length === 0) matches = all.filter((o) => o.name.toLowerCase() === key.toLowerCase());
  if (matches.length === 1) return matches[0];
  if (matches.length > 1) {
    throw new ToolError(`"${key}" matches ${matches.length} objects. Use an id instead: ${matches.map((o) => o.id).join(', ')}.`);
  }
  throw new ToolError(`No object is called "${key}". Use list_objects to see ids and names.`);
}

function resolveConstruction(scene: Scene, ref: unknown): ConstructionMesh {
  const object = resolveObject(scene, ref);
  if (!isConstructionMesh(object)) {
    throw new ToolError(`${object.name} is not point-built. Only objects made with create_point_mesh, Cube or Plane have editable points.`);
  }
  return object;
}

function typeOf(object: SceneObject): string {
  if (object.kind === 'group') return 'group';
  return object.source.type === 'construction' ? 'point-built' : object.source.primitive;
}

function describe(object: SceneObject): Record<string, unknown> {
  const out: Record<string, unknown> = {
    id: object.id,
    name: object.name,
    type: typeOf(object),
    position: roundVec(object.transform.position),
    rotation: roundVec(object.transform.rotation, 2),
    scale: roundVec(object.transform.scale),
  };
  if (object.kind === 'mesh') out.color = object.material.color;
  if (!object.visible) out.hidden = true;
  return out;
}

function tree(scene: Scene, ids: readonly string[]): Record<string, unknown>[] {
  return ids.map((id) => {
    const object = scene.objects[id];
    const node = describe(object);
    if (object.childIds.length) node.children = tree(scene, object.childIds);
    return node;
  });
}

interface ReportSummary {
  vertices: number;
  edges: number;
  faces: number;
  triangles: number;
  closed: boolean;
  problems: string[];
  notes: string[];
}

function reportSummary(report: GraphReport): ReportSummary {
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

function applyTransformArgs(base: Transform, args: Args): Transform {
  return cleanTransform({
    position: optVec3(args, 'position') ?? base.position,
    rotation: optVec3(args, 'rotation') ?? base.rotation,
    scale: optVec3(args, 'scale') ?? base.scale,
  });
}

function parentFromArgs(scene: Scene, args: Args): string | null {
  const parent = args.parent;
  if (parent === undefined || parent === null) return null;
  return resolveObject(scene, parent, 'parent').id;
}

/** Adds a face, creating any missing boundary edges first. */
function addFaceWithEdges(graph: ConstructionGraph, loop: string[], allowNonPlanar: boolean, label: string): ConstructionGraph {
  if (new Set(loop).size !== loop.length) throw new ToolError(`${label} repeats a vertex.`);
  let next = graph;
  for (let i = 0; i < loop.length; i++) next = addEdge(next, loop[i], loop[(i + 1) % loop.length]).graph;
  try {
    return addFace(next, loop, { requirePlanar: !allowNonPlanar }).graph;
  } catch (error) {
    if (!(error instanceof GeometryError)) throw error;
    const hint = error.code === 'non-planar' ? ' Pass allow_non_planar: true to keep a bent face, or split it into triangles.' : '';
    throw new ToolError(`${label} was rejected: ${error.message}${hint}`);
  }
}

function geometryCall<T>(label: string, fn: () => T): T {
  try {
    return fn();
  } catch (error) {
    if (error instanceof GeometryError) throw new ToolError(`${label}: ${error.message}`);
    throw error;
  }
}

function readVertexList(value: unknown[] | undefined, label: string): Vec3[] {
  return (value ?? []).map((item, i) => cleanVec3(toVec3(item, `${label}[${i}]`)));
}

// ---------------------------------------------------------------------------
// Tools
// ---------------------------------------------------------------------------

const TOOLS: ToolDefinition[] = [
  {
    name: 'get_status',
    title: 'Get FORGEX status',
    description:
      'Shows where the tools are working (the open FORGEX 3D app, or a .forgex file), the project name and path, unsaved changes, object count, grid settings and the world conventions. Call this first.',
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
          robloxStud: `${METERS_PER_ROBLOX_STUD} m`,
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
      if (count === 0) return result('The scene is empty.');
      return result(`${count} object${count === 1 ? '' : 's'}:`, tree(scene, scene.rootIds));
    },
  },
  {
    name: 'get_object',
    title: 'Get object details',
    description:
      'Returns one object in full: transform, world position, parent and children. For point-built objects it also returns the geometry report and the vertex, edge and face ids you need for edit_point_mesh.',
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
      const details: Record<string, unknown> = {
        ...describe(object),
        parent: object.parentId,
        children: object.childIds,
        worldPosition: roundVec(decomposeMatrix(worldMatrix(scene, object.id)).position),
      };
      if (isConstructionMesh(object)) {
        const graph = object.source.graph;
        details.geometry = reportSummary(analyzeGraph(graph));
        if (optBool(args, 'include_geometry') !== false) {
          const vertices = Object.values(graph.vertices);
          const edges = Object.values(graph.edges);
          const faces = Object.values(graph.faces);
          details.vertices = vertices.slice(0, MAX_LISTED_ELEMENTS).map((v) => ({ id: v.id, position: roundVec(v.position, 6) }));
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
      return result(
        'Available parts:',
        PARTS.map((p) => ({ part: p.id, name: p.name, kind: p.category, description: p.description })),
      );
    },
  },
  {
    name: 'add_part',
    title: 'Add a part',
    description:
      'Adds a part from the library. cube and plane are point-built (editable vertices); sphere and cylinder are smooth 1 m primitives; group is an empty parent. Without a position the part rests on the ground at the origin. Names are made unique.',
    inputSchema: {
      type: 'object',
      properties: {
        part: { type: 'string', enum: PARTS.map((p) => p.id) },
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
      const partId = reqEnum<PartId>(args, 'part', PARTS.map((p) => p.id));
      const parentId = parentFromArgs(scene, args);
      const base = createPartObject(partId, { name: uniqueName(scene, optString(args, 'name') ?? getPart(partId).name) });
      const transform = applyTransformArgs(base.transform, args);
      const colorValue = optColor(args, 'color');
      const object: SceneObject =
        base.kind === 'mesh' ? { ...base, transform, material: { color: colorValue ?? base.material.color } } : { ...base, transform };
      apply(ctx, new AddObjectsCommand([object], parentId, undefined, `AI: add ${object.name}`));
      return result(`Added ${object.name} (${object.id}).`, describe(object));
    },
  },
  {
    name: 'create_point_mesh',
    title: 'Build a mesh from points',
    description:
      'The FORGEX way to model: give vertices, connect them with edges, and faces are generated from the closed loops (or give faces explicitly). ' +
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
      const name = uniqueName(scene, reqString(args, 'name'));
      const positions = readVertexList(optArray(args, 'vertices', MAX_VERTICES), 'vertices');
      if (positions.length === 0) throw new ToolError('vertices needs at least one position.');
      const edges = optArray(args, 'edges', MAX_VERTICES * 4);
      const faces = optArray(args, 'faces', MAX_VERTICES * 2);
      const fill = optBool(args, 'fill_loops') ?? !faces;
      const allowNonPlanar = optBool(args, 'allow_non_planar') ?? false;
      const parentId = parentFromArgs(scene, args);

      let graph = createEmptyGraph();
      const ids: string[] = [];
      for (const p of positions) {
        const added = addVertex(graph, p);
        graph = added.graph;
        ids.push(added.vertexId);
      }
      edges?.forEach((edge, i) => {
        if (!Array.isArray(edge) || edge.length !== 2) throw new ToolError(`edges[${i}] must be a pair of vertex indices [a, b].`);
        const a = toIndex(edge[0], ids.length, `edges[${i}][0]`);
        const b = toIndex(edge[1], ids.length, `edges[${i}][1]`);
        if (a === b) throw new ToolError(`edges[${i}] connects vertex ${a} to itself.`);
        graph = addEdge(graph, ids[a], ids[b]).graph;
      });
      faces?.forEach((face, i) => {
        if (!Array.isArray(face) || face.length < 3) throw new ToolError(`faces[${i}] must list at least 3 vertex indices.`);
        const loop = face.map((v, k) => ids[toIndex(v, ids.length, `faces[${i}][${k}]`)]);
        graph = addFaceWithEdges(graph, loop, allowNonPlanar, `faces[${i}]`);
      });
      let filled = 0;
      if (fill) {
        const fillResult = fillClosedLoops(graph);
        graph = fillResult.graph;
        filled = fillResult.faceIds.length;
      }
      if (Object.keys(graph.faces).length > 0) graph = orientFaces(graph).graph;

      const object: MeshObject = {
        id: createObjectId(),
        name,
        kind: 'mesh',
        parentId: null,
        childIds: [],
        visible: true,
        transform: applyTransformArgs(identityTransform(), args),
        material: { color: optColor(args, 'color') ?? '#3d9fe8' },
        source: { type: 'construction', graph },
      };
      apply(ctx, new AddObjectsCommand([object], parentId, undefined, `AI: build ${name}`));
      const report = reportSummary(analyzeGraph(graph));
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
    description:
      'Edits the vertices, edges and faces of a point-built object in one undoable step. Steps run in this order: remove faces, remove edges, remove vertices ' +
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
      const object = resolveConstruction(sceneOf(ctx), args.object);
      const before = object.source.graph;
      let graph = before;
      const allowNonPlanar = optBool(args, 'allow_non_planar') ?? false;

      for (const id of (optArray(args, 'remove_faces', MAX_VERTICES) ?? []) as unknown[]) {
        graph = geometryCall('remove_faces', () => removeFace(graph, String(id)));
      }
      for (const id of (optArray(args, 'remove_edges', MAX_VERTICES) ?? []) as unknown[]) {
        graph = geometryCall('remove_edges', () => removeEdge(graph, String(id)));
      }
      for (const id of (optArray(args, 'remove_vertices', MAX_VERTICES) ?? []) as unknown[]) {
        graph = geometryCall('remove_vertices', () => removeVertex(graph, String(id)));
      }

      const newIds: string[] = [];
      for (const p of readVertexList(optArray(args, 'add_vertices', MAX_VERTICES), 'add_vertices')) {
        const added = addVertex(graph, p);
        graph = added.graph;
        newIds.push(added.vertexId);
      }
      const ref = (value: unknown, label: string): string => {
        if (typeof value === 'string') {
          if (!graph.vertices[value]) throw new ToolError(`${label}: vertex ${value} does not exist. Use get_object to see vertex ids.`);
          return value;
        }
        if (newIds.length === 0) throw new ToolError(`${label}: use a vertex id such as v3 (no add_vertices in this call).`);
        return newIds[toIndex(value, newIds.length, label)];
      };

      (optArray(args, 'move_vertices', MAX_VERTICES) ?? []).forEach((item, i) => {
        if (typeof item !== 'object' || item === null) throw new ToolError(`move_vertices[${i}] must be { vertex, position } or { vertex, offset }.`);
        const move = item as Args;
        const id = ref(move.vertex, `move_vertices[${i}].vertex`);
        const position = optVec3(move, 'position');
        const offset = optVec3(move, 'offset');
        if (!position && !offset) throw new ToolError(`move_vertices[${i}] needs position or offset.`);
        const target = position ?? add(graph.vertices[id].position, offset!);
        graph = moveVertex(graph, id, cleanVec3(target));
      });

      (optArray(args, 'add_edges', MAX_VERTICES * 4) ?? []).forEach((edge, i) => {
        if (!Array.isArray(edge) || edge.length !== 2) throw new ToolError(`add_edges[${i}] must be a pair of vertices.`);
        const a = ref(edge[0], `add_edges[${i}][0]`);
        const b = ref(edge[1], `add_edges[${i}][1]`);
        graph = geometryCall(`add_edges[${i}]`, () => addEdge(graph, a, b).graph);
      });

      let facesAdded = 0;
      (optArray(args, 'add_faces', MAX_VERTICES * 2) ?? []).forEach((face, i) => {
        if (!Array.isArray(face) || face.length < 3) throw new ToolError(`add_faces[${i}] must list at least 3 vertices.`);
        const loop = face.map((v, k) => ref(v, `add_faces[${i}][${k}]`));
        graph = addFaceWithEdges(graph, loop, allowNonPlanar, `add_faces[${i}]`);
        facesAdded++;
      });

      if (optBool(args, 'fill_loops')) {
        const filled = fillClosedLoops(graph);
        graph = filled.graph;
        facesAdded += filled.faceIds.length;
      }
      if (optBool(args, 'recalculate_normals') ?? facesAdded > 0) graph = orientFaces(graph).graph;

      if (graph === before) return result(`Nothing changed on ${object.name}.`);
      apply(ctx, new SetGraphCommand(object.id, before, graph, `AI: edit points of ${object.name}`));
      return result(`Edited ${object.name}.`, {
        addedVertexIds: newIds,
        facesAdded,
        geometry: reportSummary(analyzeGraph(graph)),
      });
    },
  },
  {
    name: 'check_geometry',
    title: 'Check geometry',
    description:
      'Checks point-built objects against the geometry invariants: loose vertices, open boundaries, non-manifold edges, bent or zero-area faces, and inconsistent normals. Checks every point-built object when none is named.',
    inputSchema: { type: 'object', properties: { object: objectRef('Optional object id or name') }, additionalProperties: false },
    annotations: readOnly,
    run(args, ctx) {
      const scene = sceneOf(ctx);
      const targets: ConstructionMesh[] =
        args.object !== undefined && args.object !== null
          ? [resolveConstruction(scene, args.object)]
          : Object.values(scene.objects).filter(isConstructionMesh);
      if (targets.length === 0) return result('There are no point-built objects to check.');
      const reports = targets.map((o) => ({ id: o.id, name: o.name, ...reportSummary(analyzeGraph(o.source.graph)) }));
      const problems = reports.reduce((n, r) => n + r.problems.length, 0);
      return result(problems === 0 ? 'No geometry problems found.' : `${problems} geometry problem${problems === 1 ? '' : 's'} found.`, reports);
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
      const object = resolveObject(sceneOf(ctx), args.object);
      if (args.position === undefined && args.rotation === undefined && args.scale === undefined) {
        throw new ToolError('Give at least one of position, rotation or scale.');
      }
      const after = applyTransformArgs(object.transform, args);
      apply(ctx, new SetTransformCommand(object.id, object.transform, after, `AI: transform ${object.name}`));
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
      const object = resolveObject(sceneOf(ctx), args.object);
      if (object.kind !== 'mesh') throw new ToolError(`${object.name} is a group and has no colour.`);
      const value = optColor(args, 'color')!;
      if (!value) throw new ToolError('color is required.');
      if (value !== object.material.color) apply(ctx, new SetColorCommand(object.id, object.material.color, value));
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
      const name = reqString(args, 'name');
      if (name !== object.name) apply(ctx, new RenameObjectCommand(object.id, object.name, name));
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
      const visible = optBool(args, 'visible');
      if (visible === undefined) throw new ToolError('visible is required.');
      if (visible !== object.visible) apply(ctx, new SetVisibilityCommand(object.id, visible, object.name));
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
      const object = resolveObject(scene, args.object);
      const count = Object.values(scene.objects).filter((o) => isSelfOrAncestor(scene, object.id, o.id)).length;
      apply(ctx, new DeleteObjectCommand(object.id, object.name));
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
      const copies = cloneSubtree(scene, object.id, createObjectId);
      const offset = optVec3(args, 'offset') ?? [0, 0, 0];
      copies[0] = {
        ...copies[0],
        name: uniqueName(scene, optString(args, 'name') ?? object.name),
        transform: cleanTransform({ ...copies[0].transform, position: add(copies[0].transform.position, offset) }),
      };
      apply(ctx, new AddObjectsCommand(copies, object.parentId, indexInParent(scene, object.id) + 1, `AI: duplicate ${object.name}`));
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
      const object = resolveObject(scene, args.object);
      const parentId = parentFromArgs(scene, args);
      if (parentId !== null && isSelfOrAncestor(scene, object.id, parentId)) {
        throw new ToolError(`${object.name} cannot go inside itself or one of its children.`);
      }
      if (parentId === object.parentId) return result(`${object.name} already has that parent.`);
      const siblings = parentId === null ? scene.rootIds : scene.objects[parentId].childIds;
      apply(ctx, new MoveObjectCommand(object.id, parentId, siblings.length, `AI: move ${object.name}`));
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
      const refs = optArray(args, 'objects', 1000);
      if (!refs || refs.length === 0) throw new ToolError('objects needs at least one object.');
      const chosen = [...new Map(refs.map((r) => resolveObject(scene, r)).map((o) => [o.id, o])).values()];
      // Children of other chosen objects move with their parent.
      const tops = chosen.filter((o) => !chosen.some((other) => other.id !== o.id && isSelfOrAncestor(scene, other.id, o.id)));
      const centre = tops
        .map((o) => decomposeMatrix(worldMatrix(scene, o.id)).position)
        .reduce((sum, p) => add(sum, p), [0, 0, 0] as Vec3)
        .map((v) => round(v / tops.length, 6)) as Vec3;
      const group = createPartObject('group', { name: uniqueName(scene, optString(args, 'name') ?? 'Group') });
      const placed: SceneObject = { ...group, transform: { ...group.transform, position: centre } };
      const commands: Command[] = [new AddObjectsCommand([placed], null)];
      tops.forEach((o, i) => commands.push(new MoveObjectCommand(o.id, placed.id, i)));
      apply(ctx, new CompositeCommand(`AI: group ${tops.length} objects`, commands, placed.id));
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
    name: 'undo',
    title: 'Undo',
    description: 'Undoes the most recent changes in FORGEX, whether the AI or the user made them.',
    inputSchema: { type: 'object', properties: { steps: { type: 'integer', minimum: 1, maximum: 50 } }, additionalProperties: false },
    annotations: edit,
    run(args, ctx) {
      const steps = optInt(args, 'steps', 1, 50) ?? 1;
      const undone: string[] = [];
      for (let i = 0; i < steps; i++) {
        const label = ctx.store.getState().history.undoLabel;
        if (!label || !ctx.store.undo()) break;
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
      const steps = optInt(args, 'steps', 1, 50) ?? 1;
      const redone: string[] = [];
      for (let i = 0; i < steps; i++) {
        const label = ctx.store.getState().history.redoLabel;
        if (!label || !ctx.store.redo()) break;
        redone.push(label);
      }
      return result(redone.length ? `Redid: ${redone.join('; ')}.` : 'There was nothing to redo.');
    },
  },
  {
    name: 'new_project',
    title: 'New project',
    description:
      'Starts a new project. In the app, the user is asked first if there are unsaved changes. A relative path (like "kart") goes in the FORGEX projects folder; the file is written when saved.',
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
      return result(await ctx.host.newProject({ path: optString(args, 'path', 1000), empty: optBool(args, 'empty') ?? true }));
    },
  },
  {
    name: 'open_project',
    title: 'Open project',
    description: 'Opens a .forgex project. In the app, the user is asked first if there are unsaved changes. Relative paths use the FORGEX projects folder.',
    inputSchema: { type: 'object', properties: { path: { type: 'string' } }, required: ['path'], additionalProperties: false },
    annotations: { readOnlyHint: false, destructiveHint: true, openWorldHint: false },
    async run(args, ctx) {
      return result(await ctx.host.openProject(reqString(args, 'path', 1000)));
    },
  },
  {
    name: 'save_project',
    title: 'Save project',
    description: 'Saves the project as a .forgex file, to the given path or to where it was last saved. Relative paths use the FORGEX projects folder.',
    inputSchema: { type: 'object', properties: { path: { type: 'string' } }, additionalProperties: false },
    annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false },
    async run(args, ctx) {
      return result(await ctx.host.saveProject(optString(args, 'path', 1000)));
    },
  },
  {
    name: 'capture_viewport',
    title: 'Capture viewport image',
    description:
      'Returns an image of the FORGEX 3D viewport so you can check your work. Needs the app to be open. view picks a camera angle (current keeps the user\'s view); frame fits all objects in view first.',
    inputSchema: {
      type: 'object',
      properties: {
        view: { type: 'string', enum: [...VIEW_PRESETS] },
        frame: { type: 'boolean', description: 'Fit all objects in view (default true unless view is current)' },
        width: { type: 'integer', minimum: 256, maximum: 1600, description: 'Image width in pixels (default 1024)' },
      },
      additionalProperties: false,
    },
    annotations: readOnly,
    async run(args, ctx) {
      if (!ctx.host.captureViewport) {
        throw new ToolError('Viewport images need the FORGEX 3D app. Start it (npm run desktop or npm run dev) and it links to this server automatically.');
      }
      const view = optEnum(args, 'view', VIEW_PRESETS) ?? 'current';
      const frame = optBool(args, 'frame') ?? view !== 'current';
      const width = optInt(args, 'width', 256, 1600) ?? 1024;
      const image = await ctx.host.captureViewport({ view, frame, width });
      return { text: `Viewport image (${view} view${frame ? ', framed' : ''}).`, image };
    },
  },
];

export const TOOL_SPECS: readonly ToolSpec[] = TOOLS.map((tool) => ({
  name: tool.name,
  title: tool.title,
  description: tool.description,
  inputSchema: tool.inputSchema,
  annotations: tool.annotations,
}));

const TOOL_MAP = new Map(TOOLS.map((tool) => [tool.name, tool]));

export function hasTool(name: string): boolean {
  return TOOL_MAP.has(name);
}

/** Runs a tool. Throws ToolError for problems the caller can fix. */
export async function runTool(name: string, rawArgs: unknown, ctx: ToolContext): Promise<ToolOutput> {
  const tool = TOOL_MAP.get(name);
  if (!tool) throw new ToolError(`Unknown tool ${name}.`);
  return tool.run(asArgs(rawArgs), ctx);
}

/** Tools that only read, so a host can skip saving afterwards. */
export function isReadOnlyTool(name: string): boolean {
  return TOOL_MAP.get(name)?.annotations?.readOnlyHint === true;
}
