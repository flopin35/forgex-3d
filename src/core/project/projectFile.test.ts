import { describe, expect, it } from 'vitest';
import { createBlueprintObject, createBodyObject, createPartObject } from '../scene/parts';
import { createBodyViews } from '../sketch/body';
import { addPolyline, createSketch } from '../sketch/sketch';
import type { Scene } from '../scene/types';
import { createDefaultDocument } from './defaultDocument';
import { ensureProjectExtension, fileNameFromPath, projectNameFromPath } from './paths';
import { createReference } from './references';
import { createSnapshot } from './snapshots';
import {
  DEFAULT_SETTINGS,
  migrateProjectData,
  parseProject,
  PROJECT_FORMAT_VERSION,
  serializeProject,
  type ProjectDocument,
} from './projectFile';

function sampleDocument(): ProjectDocument {
  const car = createPartObject('group', { name: 'Car', id: 'obj_car' });
  const body = createPartObject('cube', { name: 'Body', id: 'obj_body' });
  const wheel = createPartObject('cylinder', { name: 'Wheel', id: 'obj_wheel' });
  const floor = createPartObject('plane', { name: 'Floor', id: 'obj_floor' });
  const scene: Scene = {
    rootIds: ['obj_car', 'obj_floor'],
    objects: {
      obj_car: { ...car, childIds: ['obj_body', 'obj_wheel'] },
      obj_body: { ...body, parentId: 'obj_car', transform: { position: [0, 1, 0], rotation: [0, 45, 0], scale: [2, 1, 4] } },
      obj_wheel: { ...wheel, parentId: 'obj_car', visible: false },
      obj_floor: floor,
    },
  };
  return { scene, settings: { gridSize: 0.28, snapEnabled: false, rotationSnapDegrees: 5 }, camera: { position: [6, 5, 8], target: [0, 0.5, 0] } };
}

function mutate(text: string, change: (data: Record<string, any>) => void): string {
  const data = JSON.parse(text);
  change(data);
  return JSON.stringify(data);
}

describe('.forgex project files', () => {
  it('round-trips hierarchy, transforms, materials, settings and camera exactly', () => {
    const document = sampleDocument();
    const text = serializeProject(document, new Date('2026-10-10T12:00:00Z'));
    const result = parseProject(text);
    if (!result.ok) throw new Error(result.errors.join('\n'));
    expect(result.document).toEqual(document);
    expect(result.warnings).toEqual([]);
    expect(result.migratedFrom).toBeNull();
  });

  it('records format, version and world conventions', () => {
    const data = JSON.parse(serializeProject(createDefaultDocument()));
    expect(data.format).toBe('forgex-project');
    expect(data.version).toBe(PROJECT_FORMAT_VERSION);
    expect(data.units).toEqual({
      lengthUnit: 'meters',
      upAxis: '+Y',
      forwardAxis: '+Z',
      handedness: 'right',
      rotation: 'degrees-xyz',
    });
  });

  it('rejects text that is not JSON or not a FORGEX project', () => {
    expect(parseProject('{ nope').ok).toBe(false);
    const other = parseProject(JSON.stringify({ format: 'something-else', version: 1 }));
    expect(other.ok).toBe(false);
    if (!other.ok) expect(other.errors[0]).toContain('not a FORGEX 3D project');
  });

  it('refuses files from a newer format version', () => {
    const text = mutate(serializeProject(sampleDocument()), (d) => (d.version = PROJECT_FORMAT_VERSION + 1));
    const result = parseProject(text);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors[0]).toContain('newer FORGEX 3D');
  });

  it('rejects broken hierarchy links', () => {
    const text = mutate(serializeProject(sampleDocument()), (d) => {
      d.scene.objects.find((o: any) => o.id === 'obj_wheel').parentId = 'obj_floor';
    });
    const result = parseProject(text);
    expect(result.ok).toBe(false);
  });

  it('rejects a cycle in the hierarchy', () => {
    const text = mutate(serializeProject(sampleDocument()), (d) => {
      const body = d.scene.objects.find((o: any) => o.id === 'obj_body');
      body.childIds = ['obj_car'];
    });
    expect(parseProject(text).ok).toBe(false);
  });

  it('rejects invalid numbers, colours and duplicate ids with paths in the message', () => {
    const text = mutate(serializeProject(sampleDocument()), (d) => {
      d.scene.objects[1].transform.position = [0, 'high', 0];
      d.scene.objects[2].material.color = 'blue';
      d.scene.objects[3].id = 'obj_car';
    });
    const result = parseProject(text);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors.some((e) => e.includes('scene.objects[1].transform.position'))).toBe(true);
      expect(result.errors.some((e) => e.includes('material.color'))).toBe(true);
    }
  });

  it('rejects broken construction topology', () => {
    const text = mutate(serializeProject(sampleDocument()), (d) => {
      const body = d.scene.objects.find((o: any) => o.id === 'obj_body');
      body.source.edges.push({ id: 'e99', a: 'v1', b: 'v2' });
    });
    const result = parseProject(text);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors.join(' ')).toContain('connected twice');
  });

  it('rejects other unit conventions instead of guessing', () => {
    const text = mutate(serializeProject(sampleDocument()), (d) => (d.units.upAxis = '+Z'));
    expect(parseProject(text).ok).toBe(false);
  });

  it('falls back to default settings with a warning', () => {
    const text = mutate(serializeProject(sampleDocument()), (d) => delete d.settings);
    const result = parseProject(text);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.document.settings).toEqual(DEFAULT_SETTINGS);
      expect(result.warnings).toHaveLength(1);
    }
  });

  it('reports bent faces as warnings on load', () => {
    const text = mutate(serializeProject(sampleDocument()), (d) => {
      const floor = d.scene.objects.find((o: any) => o.id === 'obj_floor');
      floor.source.vertices[2].position = [0.5, 0.3, 0.5];
    });
    const result = parseProject(text);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.warnings.join(' ')).toContain('no longer flat');
  });

  it('upgrades older versions step by step', () => {
    const migrations = {
      1: (d: Record<string, unknown>) => ({ ...d, addedIn2: true }),
      2: (d: Record<string, unknown>) => ({ ...d, addedIn3: true }),
    };
    const { data, fromVersion } = migrateProjectData({ version: 1 }, 3, migrations);
    expect(fromVersion).toBe(1);
    expect(data).toEqual({ version: 3, addedIn2: true, addedIn3: true });
    expect(() => migrateProjectData({ version: 1 }, 3, { 1: migrations[1] })).toThrow('No upgrade path');
  });
});

describe('version 3 content', () => {
  it('round-trips smooth dots, bodies, modifiers, shading and reference pictures', () => {
    const doc = sampleDocument();
    const curved = createBlueprintObject({
      name: 'Blade',
      id: 'obj_blade',
      sketch: addPolyline(createSketch('front'), [[0, 1], [0.2, 0.5], [0, 0]], false, (i) => i === 1).sketch,
      shape: { mode: 'extrude', mirror: true, curveSteps: 6 },
      modifiers: { mirror: 'none', subdivide: 1 },
    });
    const hull = createBodyObject({
      name: 'Hull',
      id: 'obj_hull',
      views: {
        ...createBodyViews(),
        side: addPolyline(createSketch('side'), [[-1, 0], [1, 0], [1, 0.5], [-1, 0.5]], true, true).sketch,
      },
      body: { stations: 20 },
    });
    const scene: Scene = {
      rootIds: [...doc.scene.rootIds, 'obj_blade', 'obj_hull'],
      objects: { ...doc.scene.objects, obj_blade: curved, obj_hull: hull },
    };
    const references = [{ ...createReference({ id: 'ref_1', plane: 'side' as const, name: 'Car side', src: 'data:image/png;base64,iVBORw0KGgo=', aspect: 0.4 }), flip: true }];
    const document: ProjectDocument = { ...doc, scene, references };
    const text = serializeProject(document);
    expect(JSON.parse(text).version).toBe(PROJECT_FORMAT_VERSION);
    const reopened = parseProject(text);
    if (!reopened.ok) throw new Error(reopened.errors.join('\n'));
    expect(reopened.document).toEqual(document);
  });

  it('opens version 2 files and skips broken reference pictures with a warning', () => {
    const v2 = mutate(serializeProject(sampleDocument()), (data) => {
      data.version = 2;
    });
    const old = parseProject(v2);
    expect(old.ok && old.migratedFrom).toBe(2);
    const bad = parseProject(mutate(serializeProject(sampleDocument()), (data) => {
      data.references = [{ id: 'r', plane: 'side', src: 'javascript:alert(1)', aspect: 1, x: 0, y: 0, width: 1, opacity: 1 }];
    }));
    expect(bad.ok).toBe(true);
    if (bad.ok) {
      expect(bad.document.references).toBeUndefined();
      expect(bad.warnings.join(' ')).toContain('Reference picture 1');
    }
  });

  it('rejects bad modifiers and broken body drawings', () => {
    const doc = sampleDocument();
    const hull = createBodyObject({ name: 'Hull', id: 'obj_hull' });
    const text = serializeProject({ ...doc, scene: { rootIds: [...doc.scene.rootIds, 'obj_hull'], objects: { ...doc.scene.objects, obj_hull: hull } } });
    const badModifiers = parseProject(mutate(text, (data) => (data.scene.objects[1].modifiers = { mirror: 'w', subdivide: 1 })));
    expect(!badModifiers.ok && badModifiers.errors.join(' ')).toContain('modifiers');
    const badBody = parseProject(mutate(text, (data) => (data.scene.objects.at(-1).source.views.top = { points: 'none' })));
    expect(!badBody.ok && badBody.errors.join(' ')).toContain('views.top');
  });
});

describe('version 4 content', () => {
  it('round-trips locked objects and snapshots', () => {
    const doc = sampleDocument();
    const [firstId] = doc.scene.rootIds;
    const lockedScene: Scene = { ...doc.scene, objects: { ...doc.scene.objects, [firstId]: { ...doc.scene.objects[firstId], locked: true } } };
    const snapshots = [createSnapshot(doc.scene, 'Before the wheels', 'snap_1', new Date('2026-10-01T10:00:00Z'))];
    const document: ProjectDocument = { ...doc, scene: lockedScene, snapshots };
    const text = serializeProject(document);
    const data = JSON.parse(text);
    expect(data.version).toBe(4);
    expect(data.scene.objects[0].locked).toBe(true);
    expect(data.snapshots[0].scene.objects[0].locked).toBeUndefined();
    const reopened = parseProject(text);
    if (!reopened.ok) throw new Error(reopened.errors.join('\n'));
    expect(reopened.document).toEqual(document);
  });

  it('opens version 3 files and skips a broken snapshot with a warning', () => {
    const v3 = parseProject(mutate(serializeProject(sampleDocument()), (data) => (data.version = 3)));
    expect(v3.ok && v3.migratedFrom).toBe(3);
    const text = serializeProject({ ...sampleDocument(), snapshots: [createSnapshot(sampleDocument().scene, 'Good', 'snap_a')] });
    const broken = parseProject(mutate(text, (data) => data.snapshots.push({ id: 'snap_b', name: 'Bad', createdAt: 'x', scene: { rootIds: ['missing'], objects: [] } })));
    expect(broken.ok).toBe(true);
    if (broken.ok) {
      expect(broken.document.snapshots?.map((s) => s.name)).toEqual(['Good']);
      expect(broken.warnings.join(' ')).toContain('Bad');
    }
    expect(parseProject(mutate(text, (data) => (data.scene.objects[0].locked = 'yes'))).ok).toBe(false);
  });
});

describe('project paths', () => {
  it('handles Windows and forward-slash paths', () => {
    expect(fileNameFromPath('C:\\Users\\HP\\Desktop\\Car.forgex')).toBe('Car.forgex');
    expect(projectNameFromPath('/home/me/Sword.FORGEX')).toBe('Sword');
    expect(ensureProjectExtension('C:\\Games\\Car')).toBe('C:\\Games\\Car.forgex');
    expect(ensureProjectExtension('Car.forgex')).toBe('Car.forgex');
  });
});
