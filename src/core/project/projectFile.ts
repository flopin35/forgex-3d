import { analyzeGraph } from '../geometry/analysis';
import { graphFromJson, graphToJson, type ConstructionGraphJson } from '../geometry/graphJson';
import { cleanModifiers, hasModifiers, MIRROR_AXES, type MeshModifiers, type MirrorAxis } from '../geometry/modifiers';
import { isFiniteNumber, isVec3, type Vec3 } from '../math/vec3';
import type { Transform } from '../math/transform';
import { HEX_COLOR, PRIMITIVE_KINDS, type MaterialSettings, type MeshSource, type PrimitiveKind, type Scene, type SceneObject } from '../scene/types';
import { BODY_VIEWS, clampBody, type BodySettings, type BodyViews } from '../sketch/body';
import { sketchFromJson, sketchToJson, viewFromJson, viewToJson, type SketchJson, type SketchViewJson } from '../sketch/sketchJson';
import { readReferences, type ReferenceImage } from './references';
import { MAX_SNAPSHOTS, type Snapshot } from './snapshots';
import { WORLD_CONVENTIONS } from '../units';
import { APP_NAME, APP_VERSION } from '../version';

export const PROJECT_FORMAT = 'forgex-project';
export const PROJECT_FORMAT_VERSION = 4;
export const PROJECT_EXTENSION = 'forgex';

export interface ProjectSettings {
  /** Grid cell size in metres; also the move snap step. */
  gridSize: number;
  snapEnabled: boolean;
  rotationSnapDegrees: number;
}

export interface CameraState {
  position: Vec3;
  target: Vec3;
}

/** Everything a .forgex file holds, in editor form. */
export interface ProjectDocument {
  scene: Scene;
  settings: ProjectSettings;
  camera: CameraState | null;
  /** Pictures to trace over on the board. Absent when there are none. */
  references?: readonly ReferenceImage[];
  /** Saved versions of the scene to go back to. Absent when there are none. */
  snapshots?: readonly Snapshot[];
}

export const DEFAULT_SETTINGS: ProjectSettings = { gridSize: 0.25, snapEnabled: true, rotationSnapDegrees: 15 };

type SerializedSource =
  | { type: 'primitive'; primitive: PrimitiveKind }
  | ({ type: 'construction' } & ConstructionGraphJson)
  | ({ type: 'sketch' } & SketchJson)
  | { type: 'body'; views: Record<'side' | 'top' | 'front', SketchViewJson>; body: BodySettings };

interface SerializedObject {
  id: string;
  name: string;
  kind: 'mesh' | 'group';
  parentId: string | null;
  childIds: string[];
  visible: boolean;
  locked?: true;
  transform: Transform;
  material?: { color: string; smooth?: true };
  modifiers?: MeshModifiers;
  source?: SerializedSource;
}

interface SerializedScene {
  rootIds: string[];
  objects: SerializedObject[];
}

/**
 * The current file format. Version 2 added blueprints; version 3 added smooth dots,
 * bodies lofted from three views, modifiers, smooth shading and reference pictures;
 * version 4 added locked objects and snapshots. See docs/forgex-format.md.
 */
export interface ProjectFileV4 {
  format: typeof PROJECT_FORMAT;
  version: 4;
  generator: string;
  savedAt: string;
  units: typeof WORLD_CONVENTIONS;
  settings: ProjectSettings;
  scene: SerializedScene;
  camera?: CameraState;
  references?: ReferenceImage[];
  snapshots?: { id: string; name: string; createdAt: string; scene: SerializedScene }[];
}

function serializeSource(source: MeshSource): SerializedSource {
  switch (source.type) {
    case 'primitive':
      return { type: 'primitive', primitive: source.primitive };
    case 'construction':
      return { type: 'construction', ...graphToJson(source.graph) };
    case 'sketch':
      return { type: 'sketch', ...sketchToJson(source.sketch, source.shape) };
    case 'body':
      return {
        type: 'body',
        views: { side: viewToJson(source.views.side), top: viewToJson(source.views.top), front: viewToJson(source.views.front) },
        body: { ...source.body },
      };
  }
}

function serializeObject(object: SceneObject): SerializedObject {
  const base: SerializedObject = {
    id: object.id,
    name: object.name,
    kind: object.kind,
    parentId: object.parentId,
    childIds: [...object.childIds],
    visible: object.visible,
    ...(object.locked ? { locked: true as const } : {}),
    transform: {
      position: [...object.transform.position],
      rotation: [...object.transform.rotation],
      scale: [...object.transform.scale],
    },
  };
  if (object.kind === 'mesh') {
    base.material = object.material.smooth ? { color: object.material.color, smooth: true } : { color: object.material.color };
    if (hasModifiers(object.modifiers)) base.modifiers = { ...object.modifiers! };
    base.source = serializeSource(object.source);
  }
  return base;
}

/** Writes objects parents-first in hierarchy order, so files read top to bottom. */
export function orderedObjects(scene: Scene): SceneObject[] {
  const out: SceneObject[] = [];
  const visit = (id: string) => {
    const object = scene.objects[id];
    if (!object) return;
    out.push(object);
    object.childIds.forEach(visit);
  };
  scene.rootIds.forEach(visit);
  return out;
}

/** A scene in file form: roots plus objects listed parents first. */
export function serializeScene(scene: Scene): SerializedScene {
  return { rootIds: [...scene.rootIds], objects: orderedObjects(scene).map(serializeObject) };
}

/** Objects in file form, in the order given (used for library parts). */
export function serializeObjects(objects: readonly SceneObject[]): unknown[] {
  return objects.map(serializeObject);
}

export function serializeProject(document: ProjectDocument, now: Date = new Date()): string {
  const file: ProjectFileV4 = {
    format: PROJECT_FORMAT,
    version: PROJECT_FORMAT_VERSION,
    generator: `${APP_NAME} ${APP_VERSION}`,
    savedAt: now.toISOString(),
    units: { ...WORLD_CONVENTIONS },
    settings: { ...document.settings },
    scene: serializeScene(document.scene),
  };
  if (document.camera) file.camera = { position: [...document.camera.position], target: [...document.camera.target] };
  if (document.references?.length) file.references = document.references.map((reference) => ({ ...reference }));
  if (document.snapshots?.length) {
    file.snapshots = document.snapshots.map((snapshot) => ({ id: snapshot.id, name: snapshot.name, createdAt: snapshot.createdAt, scene: serializeScene(snapshot.scene) }));
  }
  return `${JSON.stringify(file, null, 2)}\n`;
}

// ---------------------------------------------------------------------------
// Migration
// ---------------------------------------------------------------------------

export type RawProject = Record<string, unknown>;
export type Migration = (data: RawProject) => RawProject;

/**
 * Upgrades from version N to N + 1, keyed by N. Version 1 is the first format;
 * when the format changes, add a function here and bump PROJECT_FORMAT_VERSION.
 */
export const PROJECT_MIGRATIONS: Readonly<Record<number, Migration>> = {
  // Version 2 added blueprint objects ("sketch" sources). Version 1 files need no changes.
  1: (data) => data,
  // Version 3 added optional fields only (smooth dots, bodies, modifiers, shading, references).
  2: (data) => data,
  // Version 4 added optional fields only (locked objects, snapshots).
  3: (data) => data,
};

export function migrateProjectData(
  data: RawProject,
  targetVersion: number = PROJECT_FORMAT_VERSION,
  migrations: Readonly<Record<number, Migration>> = PROJECT_MIGRATIONS,
): { data: RawProject; fromVersion: number } {
  const fromVersion = data.version as number;
  let current = data;
  for (let version = fromVersion; version < targetVersion; version++) {
    const step = migrations[version];
    if (!step) throw new Error(`No upgrade path from format version ${version} to ${version + 1}.`);
    current = { ...step(current), version: version + 1 };
  }
  return { data: current, fromVersion };
}

// ---------------------------------------------------------------------------
// Parsing and validation
// ---------------------------------------------------------------------------

export type ParseResult =
  | { ok: true; document: ProjectDocument; warnings: string[]; migratedFrom: number | null }
  | { ok: false; errors: string[] };

const MAX_REPORTED_ERRORS = 25;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function readTransform(raw: unknown, at: string, errors: string[]): Transform | null {
  if (!isRecord(raw)) {
    errors.push(`${at} must be an object with position, rotation and scale.`);
    return null;
  }
  const out: Partial<Transform> = {};
  for (const key of ['position', 'rotation', 'scale'] as const) {
    const value = raw[key];
    if (!isVec3(value)) errors.push(`${at}.${key} must be three finite numbers.`);
    else out[key] = [value[0], value[1], value[2]];
  }
  return out.position && out.rotation && out.scale ? (out as Transform) : null;
}

function readSettings(raw: unknown, warnings: string[]): ProjectSettings {
  if (!isRecord(raw)) {
    warnings.push('The file has no settings; defaults were used.');
    return { ...DEFAULT_SETTINGS };
  }
  const settings = { ...DEFAULT_SETTINGS };
  if (isFiniteNumber(raw.gridSize) && raw.gridSize > 0) settings.gridSize = raw.gridSize;
  else warnings.push('Grid size was missing or invalid; the default was used.');
  if (typeof raw.snapEnabled === 'boolean') settings.snapEnabled = raw.snapEnabled;
  if (isFiniteNumber(raw.rotationSnapDegrees) && raw.rotationSnapDegrees > 0) {
    settings.rotationSnapDegrees = raw.rotationSnapDegrees;
  }
  return settings;
}

function readSource(raw: unknown, at: string, errors: string[]): MeshSource | null {
  if (!isRecord(raw)) {
    errors.push(`${at} must describe the mesh source.`);
    return null;
  }
  if (raw.type === 'primitive') {
    if (!PRIMITIVE_KINDS.includes(raw.primitive as PrimitiveKind)) {
      errors.push(`${at}.primitive must be one of: ${PRIMITIVE_KINDS.join(', ')}.`);
      return null;
    }
    return { type: 'primitive', primitive: raw.primitive as PrimitiveKind };
  }
  if (raw.type === 'construction') {
    const graph = graphFromJson(raw, at, errors);
    return graph ? { type: 'construction', graph } : null;
  }
  if (raw.type === 'sketch') {
    const blueprint = sketchFromJson(raw, at, errors);
    return blueprint ? { type: 'sketch', ...blueprint } : null;
  }
  if (raw.type === 'body') {
    if (!isRecord(raw.views)) {
      errors.push(`${at}.views must hold the side, top and front drawings.`);
      return null;
    }
    const start = errors.length;
    const views: Partial<Record<'side' | 'top' | 'front', ReturnType<typeof viewFromJson>>> = {};
    for (const view of BODY_VIEWS) views[view] = viewFromJson(raw.views[view], view, `${at}.views.${view}`, errors);
    if (errors.length > start || !views.side || !views.top || !views.front) return null;
    return { type: 'body', views: views as BodyViews, body: clampBody(isRecord(raw.body) ? (raw.body as Partial<BodySettings>) : {}) };
  }
  errors.push(`${at}.type must be "primitive", "construction", "sketch" or "body".`);
  return null;
}

function readObject(raw: unknown, at: string, errors: string[]): SceneObject | null {
  if (!isRecord(raw)) {
    errors.push(`${at} must be an object.`);
    return null;
  }
  const start = errors.length;
  const { id, name, kind, parentId, childIds, visible, locked } = raw;
  if (typeof id !== 'string' || id.length === 0 || id.length > 64) errors.push(`${at}.id must be text of 1–64 characters.`);
  if (typeof name !== 'string' || name.length > 200) errors.push(`${at}.name must be text of at most 200 characters.`);
  if (kind !== 'mesh' && kind !== 'group') errors.push(`${at}.kind must be "mesh" or "group".`);
  if (parentId !== null && typeof parentId !== 'string') errors.push(`${at}.parentId must be an object id or null.`);
  if (!Array.isArray(childIds) || !childIds.every((c) => typeof c === 'string')) {
    errors.push(`${at}.childIds must be a list of object ids.`);
  }
  if (typeof visible !== 'boolean') errors.push(`${at}.visible must be true or false.`);
  if (locked !== undefined && typeof locked !== 'boolean') errors.push(`${at}.locked must be true or false.`);
  const transform = readTransform(raw.transform, `${at}.transform`, errors);

  let mesh: { source: MeshSource; material: MaterialSettings; modifiers?: MeshModifiers } | null = null;
  if (kind === 'mesh') {
    const material = raw.material;
    if (!isRecord(material) || typeof material.color !== 'string' || !HEX_COLOR.test(material.color)) {
      errors.push(`${at}.material.color must be a colour like #3d9fe8.`);
    }
    let modifiers: MeshModifiers | undefined;
    if (raw.modifiers !== undefined) {
      const m = raw.modifiers;
      if (!isRecord(m) || (m.mirror !== undefined && !MIRROR_AXES.includes(m.mirror as MirrorAxis)) || (m.subdivide !== undefined && !isFiniteNumber(m.subdivide))) {
        errors.push(`${at}.modifiers must have mirror (none, x, y or z) and subdivide (0 to 3).`);
      } else {
        const cleaned = cleanModifiers(m as Partial<MeshModifiers>);
        if (hasModifiers(cleaned)) modifiers = cleaned;
      }
    }
    const source = readSource(raw.source, `${at}.source`, errors);
    if (source && isRecord(material) && typeof material.color === 'string') {
      const color = material.color.toLowerCase();
      mesh = { source, material: material.smooth === true ? { color, smooth: true } : { color }, ...(modifiers ? { modifiers } : {}) };
    }
  }
  if (errors.length > start || !transform) return null;

  const base = {
    id: id as string,
    name: name as string,
    parentId: parentId as string | null,
    childIds: [...(childIds as string[])],
    visible: visible as boolean,
    ...(locked === true ? { locked: true } : {}),
    transform,
  };
  return kind === 'group' ? { ...base, kind: 'group' } : { ...base, kind: 'mesh', ...mesh! };
}

/** Checks the parent/child links: every object reachable exactly once from the roots, no cycles. */
function checkHierarchy(objects: Record<string, SceneObject>, rootIds: string[], errors: string[]): void {
  const seen = new Set<string>();
  const visit = (id: string, expectedParent: string | null, trail: Set<string>) => {
    const object = objects[id];
    if (!object) return void errors.push(`The hierarchy refers to missing object ${id}.`);
    if (trail.has(id)) return void errors.push(`Object ${id} is inside itself.`);
    if (seen.has(id)) return void errors.push(`Object ${id} appears in the hierarchy twice.`);
    if (object.parentId !== expectedParent) {
      errors.push(`Object ${id} says its parent is ${object.parentId ?? 'the root'}, but it is listed under ${expectedParent ?? 'the root'}.`);
    }
    seen.add(id);
    trail.add(id);
    object.childIds.forEach((child) => visit(child, id, trail));
    trail.delete(id);
  };
  rootIds.forEach((id) => visit(id, null, new Set()));
  for (const id of Object.keys(objects)) {
    if (!seen.has(id)) errors.push(`Object ${id} is not reachable from the scene roots.`);
  }
}

/** Reads a list of objects in file form. Problems are added to `errors`. */
export function readObjects(raw: unknown[], at: string, errors: string[]): Record<string, SceneObject> {
  const objects: Record<string, SceneObject> = {};
  raw.forEach((item, i) => {
    const object = readObject(item, `${at}[${i}]`, errors);
    if (!object) return;
    if (objects[object.id]) errors.push(`Object id ${object.id} is used twice.`);
    else objects[object.id] = object;
  });
  return objects;
}

/** Reads a scene in file form (roots plus objects) and checks its hierarchy. */
export function readScene(raw: unknown, at: string, errors: string[]): Scene | null {
  if (!isRecord(raw) || !Array.isArray(raw.objects) || !Array.isArray(raw.rootIds)) {
    errors.push(`${at} needs rootIds and objects lists.`);
    return null;
  }
  const start = errors.length;
  const objects = readObjects(raw.objects, `${at}.objects`, errors);
  const rootIds = raw.rootIds.filter((id): id is string => typeof id === 'string');
  if (rootIds.length !== raw.rootIds.length) errors.push(`${at}.rootIds must contain only object ids.`);
  if (errors.length === start) checkHierarchy(objects, rootIds, errors);
  return errors.length === start ? { objects, rootIds } : null;
}

function readSnapshots(raw: unknown, warnings: string[]): Snapshot[] {
  if (raw === undefined) return [];
  if (!Array.isArray(raw)) {
    warnings.push('The saved snapshots were not a list and were skipped.');
    return [];
  }
  const out: Snapshot[] = [];
  raw.slice(-MAX_SNAPSHOTS).forEach((item, i) => {
    if (!isRecord(item) || typeof item.id !== 'string' || typeof item.name !== 'string' || typeof item.createdAt !== 'string') {
      warnings.push(`Snapshot ${i + 1} is missing its id, name or date and was skipped.`);
      return;
    }
    const problems: string[] = [];
    const scene = readScene(item.scene, `snapshots[${i}].scene`, problems);
    if (!scene) {
      warnings.push(`Snapshot “${item.name.slice(0, 80)}” could not be read and was skipped: ${problems[0] ?? 'invalid scene'}`);
      return;
    }
    out.push({ id: item.id.slice(0, 64), name: item.name.slice(0, 120), createdAt: item.createdAt.slice(0, 40), scene });
  });
  return out;
}

/** Reads a .forgex file. Never throws: problems come back as readable errors. */
export function parseProject(text: string): ParseResult {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch (error) {
    return { ok: false, errors: [`The file is not valid JSON: ${(error as Error).message}`] };
  }
  if (!isRecord(raw) || raw.format !== PROJECT_FORMAT) {
    return { ok: false, errors: ['This is not a FORGEX 3D project file.'] };
  }
  const version = raw.version;
  if (!Number.isInteger(version) || (version as number) < 1) {
    return { ok: false, errors: ['The project format version is missing or invalid.'] };
  }
  if ((version as number) > PROJECT_FORMAT_VERSION) {
    return {
      ok: false,
      errors: [
        `This project uses format version ${version as number}, made by a newer FORGEX 3D. This build reads up to version ${PROJECT_FORMAT_VERSION}.`,
      ],
    };
  }

  let data: RawProject;
  let migratedFrom: number | null = null;
  try {
    const migrated = migrateProjectData(raw);
    data = migrated.data;
    if (migrated.fromVersion !== PROJECT_FORMAT_VERSION) migratedFrom = migrated.fromVersion;
  } catch (error) {
    return { ok: false, errors: [(error as Error).message] };
  }

  const errors: string[] = [];
  const warnings: string[] = [];

  if (isRecord(data.units)) {
    if (data.units.lengthUnit !== WORLD_CONVENTIONS.lengthUnit || data.units.upAxis !== WORLD_CONVENTIONS.upAxis) {
      errors.push(
        `The project uses ${String(data.units.lengthUnit)} with ${String(data.units.upAxis)} up; FORGEX 3D expects metres with +Y up.`,
      );
    }
  } else {
    warnings.push('The file does not state its units; metres with +Y up were assumed.');
  }

  const settings = readSettings(data.settings, warnings);

  const sceneRaw = data.scene;
  if (!isRecord(sceneRaw) || !Array.isArray(sceneRaw.objects) || !Array.isArray(sceneRaw.rootIds)) {
    return { ok: false, errors: [...errors, 'The file has no valid scene (it needs rootIds and objects lists).'] };
  }

  const objects = readObjects(sceneRaw.objects, 'scene.objects', errors);
  const rootIds = sceneRaw.rootIds.filter((id): id is string => typeof id === 'string');
  if (rootIds.length !== sceneRaw.rootIds.length) errors.push('scene.rootIds must contain only object ids.');
  if (errors.length === 0) checkHierarchy(objects, rootIds, errors);

  let camera: CameraState | null = null;
  if (data.camera !== undefined) {
    if (isRecord(data.camera) && isVec3(data.camera.position) && isVec3(data.camera.target)) {
      camera = { position: [...data.camera.position], target: [...data.camera.target] };
    } else {
      warnings.push('The saved camera view was invalid and was skipped.');
    }
  }

  if (errors.length > 0) {
    const shown = errors.slice(0, MAX_REPORTED_ERRORS);
    if (errors.length > shown.length) shown.push(`…and ${errors.length - shown.length} more problems.`);
    return { ok: false, errors: shown };
  }

  // Hand-built geometry is checked; generated geometry (blueprints, bodies, modifiers) is rebuilt on load.
  for (const object of Object.values(objects)) {
    if (object.kind !== 'mesh' || object.source.type !== 'construction') continue;
    for (const issue of analyzeGraph(object.source.graph).issues) {
      if (issue.severity !== 'info') warnings.push(`${object.name}: ${issue.message}`);
    }
  }

  const references = readReferences(data.references, warnings);
  const snapshots = readSnapshots(data.snapshots, warnings);
  const document: ProjectDocument = { scene: { objects, rootIds }, settings, camera };
  if (references.length) document.references = references;
  if (snapshots.length) document.snapshots = snapshots;
  return { ok: true, document, warnings, migratedFrom };
}
