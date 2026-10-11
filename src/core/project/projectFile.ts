import { analyzeGraph } from '../geometry/analysis';
import { graphFromJson, graphToJson, type ConstructionGraphJson } from '../geometry/graphJson';
import { isFiniteNumber, isVec3, type Vec3 } from '../math/vec3';
import type { Transform } from '../math/transform';
import { HEX_COLOR, PRIMITIVE_KINDS, type MeshSource, type PrimitiveKind, type Scene, type SceneObject } from '../scene/types';
import { WORLD_CONVENTIONS } from '../units';
import { APP_NAME, APP_VERSION } from '../version';

export const PROJECT_FORMAT = 'forgex-project';
export const PROJECT_FORMAT_VERSION = 1;
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
}

export const DEFAULT_SETTINGS: ProjectSettings = { gridSize: 0.25, snapEnabled: true, rotationSnapDegrees: 15 };

type SerializedSource =
  | { type: 'primitive'; primitive: PrimitiveKind }
  | ({ type: 'construction' } & ConstructionGraphJson);

interface SerializedObject {
  id: string;
  name: string;
  kind: 'mesh' | 'group';
  parentId: string | null;
  childIds: string[];
  visible: boolean;
  transform: Transform;
  material?: { color: string };
  source?: SerializedSource;
}

/** Version 1 of the file format. See docs/forgex-format.md. */
export interface ProjectFileV1 {
  format: typeof PROJECT_FORMAT;
  version: 1;
  generator: string;
  savedAt: string;
  units: typeof WORLD_CONVENTIONS;
  settings: ProjectSettings;
  scene: { rootIds: string[]; objects: SerializedObject[] };
  camera?: CameraState;
}

function serializeSource(source: MeshSource): SerializedSource {
  return source.type === 'primitive'
    ? { type: 'primitive', primitive: source.primitive }
    : { type: 'construction', ...graphToJson(source.graph) };
}

function serializeObject(object: SceneObject): SerializedObject {
  const base: SerializedObject = {
    id: object.id,
    name: object.name,
    kind: object.kind,
    parentId: object.parentId,
    childIds: [...object.childIds],
    visible: object.visible,
    transform: {
      position: [...object.transform.position],
      rotation: [...object.transform.rotation],
      scale: [...object.transform.scale],
    },
  };
  if (object.kind === 'mesh') {
    base.material = { color: object.material.color };
    base.source = serializeSource(object.source);
  }
  return base;
}

/** Writes objects parents-first in hierarchy order, so files read top to bottom. */
function orderedObjects(scene: Scene): SceneObject[] {
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

export function serializeProject(document: ProjectDocument, now: Date = new Date()): string {
  const file: ProjectFileV1 = {
    format: PROJECT_FORMAT,
    version: PROJECT_FORMAT_VERSION,
    generator: `${APP_NAME} ${APP_VERSION}`,
    savedAt: now.toISOString(),
    units: { ...WORLD_CONVENTIONS },
    settings: { ...document.settings },
    scene: {
      rootIds: [...document.scene.rootIds],
      objects: orderedObjects(document.scene).map(serializeObject),
    },
  };
  if (document.camera) file.camera = { position: [...document.camera.position], target: [...document.camera.target] };
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
export const PROJECT_MIGRATIONS: Readonly<Record<number, Migration>> = {};

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
  errors.push(`${at}.type must be "primitive" or "construction".`);
  return null;
}

function readObject(raw: unknown, at: string, errors: string[]): SceneObject | null {
  if (!isRecord(raw)) {
    errors.push(`${at} must be an object.`);
    return null;
  }
  const start = errors.length;
  const { id, name, kind, parentId, childIds, visible } = raw;
  if (typeof id !== 'string' || id.length === 0 || id.length > 64) errors.push(`${at}.id must be text of 1–64 characters.`);
  if (typeof name !== 'string' || name.length > 200) errors.push(`${at}.name must be text of at most 200 characters.`);
  if (kind !== 'mesh' && kind !== 'group') errors.push(`${at}.kind must be "mesh" or "group".`);
  if (parentId !== null && typeof parentId !== 'string') errors.push(`${at}.parentId must be an object id or null.`);
  if (!Array.isArray(childIds) || !childIds.every((c) => typeof c === 'string')) {
    errors.push(`${at}.childIds must be a list of object ids.`);
  }
  if (typeof visible !== 'boolean') errors.push(`${at}.visible must be true or false.`);
  const transform = readTransform(raw.transform, `${at}.transform`, errors);

  let mesh: { source: MeshSource; material: { color: string } } | null = null;
  if (kind === 'mesh') {
    const material = raw.material;
    if (!isRecord(material) || typeof material.color !== 'string' || !HEX_COLOR.test(material.color)) {
      errors.push(`${at}.material.color must be a colour like #3d9fe8.`);
    }
    const source = readSource(raw.source, `${at}.source`, errors);
    if (source && isRecord(material) && typeof material.color === 'string') {
      mesh = { source, material: { color: material.color.toLowerCase() } };
    }
  }
  if (errors.length > start || !transform) return null;

  const base = {
    id: id as string,
    name: name as string,
    parentId: parentId as string | null,
    childIds: [...(childIds as string[])],
    visible: visible as boolean,
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

  const objects: Record<string, SceneObject> = {};
  sceneRaw.objects.forEach((item, i) => {
    const object = readObject(item, `scene.objects[${i}]`, errors);
    if (!object) return;
    if (objects[object.id]) errors.push(`Object id ${object.id} is used twice.`);
    else objects[object.id] = object;
  });
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

  for (const object of Object.values(objects)) {
    if (object.kind === 'mesh' && object.source.type === 'construction') {
      for (const issue of analyzeGraph(object.source.graph).issues) {
        if (issue.severity !== 'info') warnings.push(`${object.name}: ${issue.message}`);
      }
    }
  }

  return { ok: true, document: { scene: { objects, rootIds }, settings, camera }, warnings, migratedFrom };
}
