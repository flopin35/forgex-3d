import { describe, expect, it } from 'vitest';
import { createObjectId } from '../ids';
import { createCarDocument } from '../project/defaultDocument';
import { MemoryStorage, StorageLibrary } from './memoryLibrary';
import {
  findLibraryEntry,
  instantiateLibraryPart,
  isLibraryFileName,
  libraryFileName,
  libraryPartFromScene,
  parseLibraryPart,
  serializeLibraryPart,
} from './libraryPart';

function car() {
  const scene = createCarDocument().scene;
  const rootId = scene.rootIds[0];
  return { scene, rootId };
}

describe('My Parts library files', () => {
  it('saves an object with its children at the origin and reads it back exactly', () => {
    const { scene, rootId } = car();
    const part = libraryPartFromScene(scene, rootId, { name: 'Supercar', description: 'Two-door coupe', now: new Date('2026-10-13T12:00:00Z') });
    const root = part.scene.objects[part.scene.rootIds[0]];
    expect(root.parentId).toBeNull();
    expect(root.transform.position[0]).toBe(0);
    expect(root.transform.position[2]).toBe(0);
    expect(Object.keys(part.scene.objects).length).toBeGreaterThan(5);

    const parsed = parseLibraryPart(serializeLibraryPart(part));
    if (!parsed.ok) throw new Error(parsed.errors.join('\n'));
    expect(parsed.part).toEqual(part);
  });

  it('copies a part with new ids every time it is added', () => {
    const { scene, rootId } = car();
    const part = libraryPartFromScene(scene, rootId);
    const first = instantiateLibraryPart(part, createObjectId);
    const second = instantiateLibraryPart(part, createObjectId);
    expect(first[0].id).not.toBe(second[0].id);
    expect(first[0].parentId).toBeNull();
    expect(first.length).toBe(Object.keys(part.scene.objects).length);
    const ids = new Set(first.map((o) => o.id));
    for (const object of first.slice(1)) expect(ids.has(object.parentId!)).toBe(true);
  });

  it('rejects files that are not parts', () => {
    expect(parseLibraryPart('nope').ok).toBe(false);
    expect(parseLibraryPart('{"format":"forgex-project"}').ok).toBe(false);
    expect(parseLibraryPart('{"format":"forgex-part","version":9,"name":"x"}').ok).toBe(false);
    const twoRoots = JSON.stringify({ format: 'forgex-part', version: 1, name: 'x', scene: { rootIds: [], objects: [] } });
    expect(parseLibraryPart(twoRoots).ok).toBe(false);
  });

  it('makes safe file names', () => {
    expect(libraryFileName('Sport wheel')).toBe('Sport wheel.forgexpart');
    expect(libraryFileName('../../evil:name*?')).toBe('evilname.forgexpart');
    expect(libraryFileName('CON')).toBe('Part.forgexpart');
    expect(libraryFileName('   ')).toBe('Part.forgexpart');
    expect(isLibraryFileName('Sport wheel.forgexpart')).toBe(true);
    expect(isLibraryFileName('..\\x.forgexpart')).toBe(false);
    expect(isLibraryFileName('wheel.forgex')).toBe(false);
  });
});

describe('library in key-value storage', () => {
  it('writes, lists, finds, refuses duplicates and removes', async () => {
    const library = new StorageLibrary(new MemoryStorage());
    const { scene, rootId } = car();
    const part = libraryPartFromScene(scene, rootId, { name: 'Coupe' });
    expect(await library.write(part, false)).toBe('Coupe.forgexpart');
    await expect(library.write(part, false)).rejects.toThrow('already has');
    expect(await library.write(part, true)).toBe('Coupe.forgexpart');
    const entries = await library.list();
    expect(entries).toHaveLength(1);
    expect(findLibraryEntry(entries, 'coupe')?.file).toBe('Coupe.forgexpart');
    expect((await library.read('Coupe.forgexpart')).name).toBe('Coupe');
    await library.remove('Coupe.forgexpart');
    expect(await library.list()).toHaveLength(0);
    await expect(library.read('Coupe.forgexpart')).rejects.toThrow('no part');
  });
});
