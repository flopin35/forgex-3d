"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.PROJECT_MIGRATIONS = exports.DEFAULT_SETTINGS = exports.PROJECT_EXTENSION = exports.PROJECT_FORMAT_VERSION = exports.PROJECT_FORMAT = void 0;
exports.orderedObjects = orderedObjects;
exports.serializeScene = serializeScene;
exports.serializeObjects = serializeObjects;
exports.serializeProject = serializeProject;
exports.migrateProjectData = migrateProjectData;
exports.readObjects = readObjects;
exports.readScene = readScene;
exports.parseProject = parseProject;
const analysis_1 = require("../geometry/analysis");
const graphJson_1 = require("../geometry/graphJson");
const modifiers_1 = require("../geometry/modifiers");
const vec3_1 = require("../math/vec3");
const types_1 = require("../scene/types");
const body_1 = require("../sketch/body");
const sketchJson_1 = require("../sketch/sketchJson");
const references_1 = require("./references");
const snapshots_1 = require("./snapshots");
const units_1 = require("../units");
const version_1 = require("../version");
exports.PROJECT_FORMAT = 'forgex-project';
exports.PROJECT_FORMAT_VERSION = 4;
exports.PROJECT_EXTENSION = 'forgex';
exports.DEFAULT_SETTINGS = { gridSize: 0.25, snapEnabled: true, rotationSnapDegrees: 15 };
function serializeSource(source) {
    switch (source.type) {
        case 'primitive':
            return { type: 'primitive', primitive: source.primitive };
        case 'construction':
            return { type: 'construction', ...(0, graphJson_1.graphToJson)(source.graph) };
        case 'sketch':
            return { type: 'sketch', ...(0, sketchJson_1.sketchToJson)(source.sketch, source.shape) };
        case 'body':
            return {
                type: 'body',
                views: { side: (0, sketchJson_1.viewToJson)(source.views.side), top: (0, sketchJson_1.viewToJson)(source.views.top), front: (0, sketchJson_1.viewToJson)(source.views.front) },
                body: { ...source.body },
            };
    }
}
function serializeObject(object) {
    const base = {
        id: object.id,
        name: object.name,
        kind: object.kind,
        parentId: object.parentId,
        childIds: [...object.childIds],
        visible: object.visible,
        ...(object.locked ? { locked: true } : {}),
        transform: {
            position: [...object.transform.position],
            rotation: [...object.transform.rotation],
            scale: [...object.transform.scale],
        },
    };
    if (object.kind === 'mesh') {
        base.material = object.material.smooth ? { color: object.material.color, smooth: true } : { color: object.material.color };
        if ((0, modifiers_1.hasModifiers)(object.modifiers))
            base.modifiers = { ...object.modifiers };
        base.source = serializeSource(object.source);
    }
    return base;
}
/** Writes objects parents-first in hierarchy order, so files read top to bottom. */
function orderedObjects(scene) {
    const out = [];
    const visit = (id) => {
        const object = scene.objects[id];
        if (!object)
            return;
        out.push(object);
        object.childIds.forEach(visit);
    };
    scene.rootIds.forEach(visit);
    return out;
}
/** A scene in file form: roots plus objects listed parents first. */
function serializeScene(scene) {
    return { rootIds: [...scene.rootIds], objects: orderedObjects(scene).map(serializeObject) };
}
/** Objects in file form, in the order given (used for library parts). */
function serializeObjects(objects) {
    return objects.map(serializeObject);
}
function serializeProject(document, now = new Date()) {
    const file = {
        format: exports.PROJECT_FORMAT,
        version: exports.PROJECT_FORMAT_VERSION,
        generator: `${version_1.APP_NAME} ${version_1.APP_VERSION}`,
        savedAt: now.toISOString(),
        units: { ...units_1.WORLD_CONVENTIONS },
        settings: { ...document.settings },
        scene: serializeScene(document.scene),
    };
    if (document.camera)
        file.camera = { position: [...document.camera.position], target: [...document.camera.target] };
    if (document.references?.length)
        file.references = document.references.map((reference) => ({ ...reference }));
    if (document.snapshots?.length) {
        file.snapshots = document.snapshots.map((snapshot) => ({ id: snapshot.id, name: snapshot.name, createdAt: snapshot.createdAt, scene: serializeScene(snapshot.scene) }));
    }
    return `${JSON.stringify(file, null, 2)}\n`;
}
/**
 * Upgrades from version N to N + 1, keyed by N. Version 1 is the first format;
 * when the format changes, add a function here and bump PROJECT_FORMAT_VERSION.
 */
exports.PROJECT_MIGRATIONS = {
    // Version 2 added blueprint objects ("sketch" sources). Version 1 files need no changes.
    1: (data) => data,
    // Version 3 added optional fields only (smooth dots, bodies, modifiers, shading, references).
    2: (data) => data,
    // Version 4 added optional fields only (locked objects, snapshots).
    3: (data) => data,
};
function migrateProjectData(data, targetVersion = exports.PROJECT_FORMAT_VERSION, migrations = exports.PROJECT_MIGRATIONS) {
    const fromVersion = data.version;
    let current = data;
    for (let version = fromVersion; version < targetVersion; version++) {
        const step = migrations[version];
        if (!step)
            throw new Error(`No upgrade path from format version ${version} to ${version + 1}.`);
        current = { ...step(current), version: version + 1 };
    }
    return { data: current, fromVersion };
}
const MAX_REPORTED_ERRORS = 25;
function isRecord(value) {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}
function readTransform(raw, at, errors) {
    if (!isRecord(raw)) {
        errors.push(`${at} must be an object with position, rotation and scale.`);
        return null;
    }
    const out = {};
    for (const key of ['position', 'rotation', 'scale']) {
        const value = raw[key];
        if (!(0, vec3_1.isVec3)(value))
            errors.push(`${at}.${key} must be three finite numbers.`);
        else
            out[key] = [value[0], value[1], value[2]];
    }
    return out.position && out.rotation && out.scale ? out : null;
}
function readSettings(raw, warnings) {
    if (!isRecord(raw)) {
        warnings.push('The file has no settings; defaults were used.');
        return { ...exports.DEFAULT_SETTINGS };
    }
    const settings = { ...exports.DEFAULT_SETTINGS };
    if ((0, vec3_1.isFiniteNumber)(raw.gridSize) && raw.gridSize > 0)
        settings.gridSize = raw.gridSize;
    else
        warnings.push('Grid size was missing or invalid; the default was used.');
    if (typeof raw.snapEnabled === 'boolean')
        settings.snapEnabled = raw.snapEnabled;
    if ((0, vec3_1.isFiniteNumber)(raw.rotationSnapDegrees) && raw.rotationSnapDegrees > 0) {
        settings.rotationSnapDegrees = raw.rotationSnapDegrees;
    }
    return settings;
}
function readSource(raw, at, errors) {
    if (!isRecord(raw)) {
        errors.push(`${at} must describe the mesh source.`);
        return null;
    }
    if (raw.type === 'primitive') {
        if (!types_1.PRIMITIVE_KINDS.includes(raw.primitive)) {
            errors.push(`${at}.primitive must be one of: ${types_1.PRIMITIVE_KINDS.join(', ')}.`);
            return null;
        }
        return { type: 'primitive', primitive: raw.primitive };
    }
    if (raw.type === 'construction') {
        const graph = (0, graphJson_1.graphFromJson)(raw, at, errors);
        return graph ? { type: 'construction', graph } : null;
    }
    if (raw.type === 'sketch') {
        const blueprint = (0, sketchJson_1.sketchFromJson)(raw, at, errors);
        return blueprint ? { type: 'sketch', ...blueprint } : null;
    }
    if (raw.type === 'body') {
        if (!isRecord(raw.views)) {
            errors.push(`${at}.views must hold the side, top and front drawings.`);
            return null;
        }
        const start = errors.length;
        const views = {};
        for (const view of body_1.BODY_VIEWS)
            views[view] = (0, sketchJson_1.viewFromJson)(raw.views[view], view, `${at}.views.${view}`, errors);
        if (errors.length > start || !views.side || !views.top || !views.front)
            return null;
        return { type: 'body', views: views, body: (0, body_1.clampBody)(isRecord(raw.body) ? raw.body : {}) };
    }
    errors.push(`${at}.type must be "primitive", "construction", "sketch" or "body".`);
    return null;
}
function readObject(raw, at, errors) {
    if (!isRecord(raw)) {
        errors.push(`${at} must be an object.`);
        return null;
    }
    const start = errors.length;
    const { id, name, kind, parentId, childIds, visible, locked } = raw;
    if (typeof id !== 'string' || id.length === 0 || id.length > 64)
        errors.push(`${at}.id must be text of 1–64 characters.`);
    if (typeof name !== 'string' || name.length > 200)
        errors.push(`${at}.name must be text of at most 200 characters.`);
    if (kind !== 'mesh' && kind !== 'group')
        errors.push(`${at}.kind must be "mesh" or "group".`);
    if (parentId !== null && typeof parentId !== 'string')
        errors.push(`${at}.parentId must be an object id or null.`);
    if (!Array.isArray(childIds) || !childIds.every((c) => typeof c === 'string')) {
        errors.push(`${at}.childIds must be a list of object ids.`);
    }
    if (typeof visible !== 'boolean')
        errors.push(`${at}.visible must be true or false.`);
    if (locked !== undefined && typeof locked !== 'boolean')
        errors.push(`${at}.locked must be true or false.`);
    const transform = readTransform(raw.transform, `${at}.transform`, errors);
    let mesh = null;
    if (kind === 'mesh') {
        const material = raw.material;
        if (!isRecord(material) || typeof material.color !== 'string' || !types_1.HEX_COLOR.test(material.color)) {
            errors.push(`${at}.material.color must be a colour like #3d9fe8.`);
        }
        let modifiers;
        if (raw.modifiers !== undefined) {
            const m = raw.modifiers;
            if (!isRecord(m) || (m.mirror !== undefined && !modifiers_1.MIRROR_AXES.includes(m.mirror)) || (m.subdivide !== undefined && !(0, vec3_1.isFiniteNumber)(m.subdivide))) {
                errors.push(`${at}.modifiers must have mirror (none, x, y or z) and subdivide (0 to 3).`);
            }
            else {
                const cleaned = (0, modifiers_1.cleanModifiers)(m);
                if ((0, modifiers_1.hasModifiers)(cleaned))
                    modifiers = cleaned;
            }
        }
        const source = readSource(raw.source, `${at}.source`, errors);
        if (source && isRecord(material) && typeof material.color === 'string') {
            const color = material.color.toLowerCase();
            mesh = { source, material: material.smooth === true ? { color, smooth: true } : { color }, ...(modifiers ? { modifiers } : {}) };
        }
    }
    if (errors.length > start || !transform)
        return null;
    const base = {
        id: id,
        name: name,
        parentId: parentId,
        childIds: [...childIds],
        visible: visible,
        ...(locked === true ? { locked: true } : {}),
        transform,
    };
    return kind === 'group' ? { ...base, kind: 'group' } : { ...base, kind: 'mesh', ...mesh };
}
/** Checks the parent/child links: every object reachable exactly once from the roots, no cycles. */
function checkHierarchy(objects, rootIds, errors) {
    const seen = new Set();
    const visit = (id, expectedParent, trail) => {
        const object = objects[id];
        if (!object)
            return void errors.push(`The hierarchy refers to missing object ${id}.`);
        if (trail.has(id))
            return void errors.push(`Object ${id} is inside itself.`);
        if (seen.has(id))
            return void errors.push(`Object ${id} appears in the hierarchy twice.`);
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
        if (!seen.has(id))
            errors.push(`Object ${id} is not reachable from the scene roots.`);
    }
}
/** Reads a list of objects in file form. Problems are added to `errors`. */
function readObjects(raw, at, errors) {
    const objects = {};
    raw.forEach((item, i) => {
        const object = readObject(item, `${at}[${i}]`, errors);
        if (!object)
            return;
        if (objects[object.id])
            errors.push(`Object id ${object.id} is used twice.`);
        else
            objects[object.id] = object;
    });
    return objects;
}
/** Reads a scene in file form (roots plus objects) and checks its hierarchy. */
function readScene(raw, at, errors) {
    if (!isRecord(raw) || !Array.isArray(raw.objects) || !Array.isArray(raw.rootIds)) {
        errors.push(`${at} needs rootIds and objects lists.`);
        return null;
    }
    const start = errors.length;
    const objects = readObjects(raw.objects, `${at}.objects`, errors);
    const rootIds = raw.rootIds.filter((id) => typeof id === 'string');
    if (rootIds.length !== raw.rootIds.length)
        errors.push(`${at}.rootIds must contain only object ids.`);
    if (errors.length === start)
        checkHierarchy(objects, rootIds, errors);
    return errors.length === start ? { objects, rootIds } : null;
}
function readSnapshots(raw, warnings) {
    if (raw === undefined)
        return [];
    if (!Array.isArray(raw)) {
        warnings.push('The saved snapshots were not a list and were skipped.');
        return [];
    }
    const out = [];
    raw.slice(-snapshots_1.MAX_SNAPSHOTS).forEach((item, i) => {
        if (!isRecord(item) || typeof item.id !== 'string' || typeof item.name !== 'string' || typeof item.createdAt !== 'string') {
            warnings.push(`Snapshot ${i + 1} is missing its id, name or date and was skipped.`);
            return;
        }
        const problems = [];
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
function parseProject(text) {
    let raw;
    try {
        raw = JSON.parse(text);
    }
    catch (error) {
        return { ok: false, errors: [`The file is not valid JSON: ${error.message}`] };
    }
    if (!isRecord(raw) || raw.format !== exports.PROJECT_FORMAT) {
        return { ok: false, errors: ['This is not a FORGEX 3D project file.'] };
    }
    const version = raw.version;
    if (!Number.isInteger(version) || version < 1) {
        return { ok: false, errors: ['The project format version is missing or invalid.'] };
    }
    if (version > exports.PROJECT_FORMAT_VERSION) {
        return {
            ok: false,
            errors: [
                `This project uses format version ${version}, made by a newer FORGEX 3D. This build reads up to version ${exports.PROJECT_FORMAT_VERSION}.`,
            ],
        };
    }
    let data;
    let migratedFrom = null;
    try {
        const migrated = migrateProjectData(raw);
        data = migrated.data;
        if (migrated.fromVersion !== exports.PROJECT_FORMAT_VERSION)
            migratedFrom = migrated.fromVersion;
    }
    catch (error) {
        return { ok: false, errors: [error.message] };
    }
    const errors = [];
    const warnings = [];
    if (isRecord(data.units)) {
        if (data.units.lengthUnit !== units_1.WORLD_CONVENTIONS.lengthUnit || data.units.upAxis !== units_1.WORLD_CONVENTIONS.upAxis) {
            errors.push(`The project uses ${String(data.units.lengthUnit)} with ${String(data.units.upAxis)} up; FORGEX 3D expects metres with +Y up.`);
        }
    }
    else {
        warnings.push('The file does not state its units; metres with +Y up were assumed.');
    }
    const settings = readSettings(data.settings, warnings);
    const sceneRaw = data.scene;
    if (!isRecord(sceneRaw) || !Array.isArray(sceneRaw.objects) || !Array.isArray(sceneRaw.rootIds)) {
        return { ok: false, errors: [...errors, 'The file has no valid scene (it needs rootIds and objects lists).'] };
    }
    const objects = readObjects(sceneRaw.objects, 'scene.objects', errors);
    const rootIds = sceneRaw.rootIds.filter((id) => typeof id === 'string');
    if (rootIds.length !== sceneRaw.rootIds.length)
        errors.push('scene.rootIds must contain only object ids.');
    if (errors.length === 0)
        checkHierarchy(objects, rootIds, errors);
    let camera = null;
    if (data.camera !== undefined) {
        if (isRecord(data.camera) && (0, vec3_1.isVec3)(data.camera.position) && (0, vec3_1.isVec3)(data.camera.target)) {
            camera = { position: [...data.camera.position], target: [...data.camera.target] };
        }
        else {
            warnings.push('The saved camera view was invalid and was skipped.');
        }
    }
    if (errors.length > 0) {
        const shown = errors.slice(0, MAX_REPORTED_ERRORS);
        if (errors.length > shown.length)
            shown.push(`…and ${errors.length - shown.length} more problems.`);
        return { ok: false, errors: shown };
    }
    // Hand-built geometry is checked; generated geometry (blueprints, bodies, modifiers) is rebuilt on load.
    for (const object of Object.values(objects)) {
        if (object.kind !== 'mesh' || object.source.type !== 'construction')
            continue;
        for (const issue of (0, analysis_1.analyzeGraph)(object.source.graph).issues) {
            if (issue.severity !== 'info')
                warnings.push(`${object.name}: ${issue.message}`);
        }
    }
    const references = (0, references_1.readReferences)(data.references, warnings);
    const snapshots = readSnapshots(data.snapshots, warnings);
    const document = { scene: { objects, rootIds }, settings, camera };
    if (references.length)
        document.references = references;
    if (snapshots.length)
        document.snapshots = snapshots;
    return { ok: true, document, warnings, migratedFrom };
}
