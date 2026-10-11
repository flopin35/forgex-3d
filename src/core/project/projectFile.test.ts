import { describe, expect, it } from 'vitest';
import { createPartObject } from '../scene/parts';
import type { Scene } from '../scene/types';
import { createDefaultDocument } from './defaultDocument';
import { ensureProjectExtension, fileNameFromPath, projectNameFromPath } from './paths';
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

describe('project paths', () => {
  it('handles Windows and forward-slash paths', () => {
    expect(fileNameFromPath('C:\\Users\\HP\\Desktop\\Car.forgex')).toBe('Car.forgex');
    expect(projectNameFromPath('/home/me/Sword.FORGEX')).toBe('Sword');
    expect(ensureProjectExtension('C:\\Games\\Car')).toBe('C:\\Games\\Car.forgex');
    expect(ensureProjectExtension('Car.forgex')).toBe('Car.forgex');
  });
});
