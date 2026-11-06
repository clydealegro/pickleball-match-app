import { openDB } from 'idb';
import { beforeEach, describe, expect, it } from 'vitest';
import {
  addRosterPlayer,
  deleteRosterPlayer,
  getRosterPhoto,
  listRoster,
  removeRosterPhoto,
  resetRosterDbForTests,
  setRosterPhoto,
  type PhotoData,
} from './rosterDb';

const photo = (...bytes: number[]): PhotoData => ({
  type: 'image/jpeg',
  data: new Uint8Array(bytes).buffer,
});
const bytesOf = (p: PhotoData | undefined) => (p ? Array.from(new Uint8Array(p.data)) : undefined);

beforeEach(async () => {
  await resetRosterDbForTests();
});

describe('roster photos', () => {
  it('has no photo until one is saved', async () => {
    const ann = await addRosterPlayer('Ann');
    expect(await getRosterPhoto(ann.id)).toBeUndefined();
    expect(ann.photoVersion).toBe(0);
  });

  it('saves a photo and raises the photo version', async () => {
    const ann = await addRosterPlayer('Ann');
    await setRosterPhoto(ann.id, photo(1, 2, 3), 5_000);
    const stored = await getRosterPhoto(ann.id);
    expect(stored?.type).toBe('image/jpeg');
    expect(bytesOf(stored)).toEqual([1, 2, 3]);
    expect((await listRoster())[0]).toMatchObject({ photoVersion: 1, updatedAt: 5_000 });
  });

  it('replacing a photo raises the version again and swaps the bytes', async () => {
    const ann = await addRosterPlayer('Ann');
    await setRosterPhoto(ann.id, photo(1));
    await setRosterPhoto(ann.id, photo(9, 9));
    expect(bytesOf(await getRosterPhoto(ann.id))).toEqual([9, 9]);
    expect((await listRoster())[0].photoVersion).toBe(2);
  });

  it('removing a photo sets the version back to 0', async () => {
    const ann = await addRosterPlayer('Ann');
    await setRosterPhoto(ann.id, photo(1));
    await removeRosterPhoto(ann.id, 7_000);
    expect(await getRosterPhoto(ann.id)).toBeUndefined();
    expect((await listRoster())[0]).toMatchObject({ photoVersion: 0, updatedAt: 7_000 });
  });

  it('removing a photo that is not there changes nothing', async () => {
    const ann = await addRosterPlayer('Ann', 1_000);
    await removeRosterPhoto(ann.id, 9_000);
    expect((await listRoster())[0]).toMatchObject({ photoVersion: 0, updatedAt: 1_000 });
  });

  it('deleting a player removes their photo but keeps the version for later sync', async () => {
    const ann = await addRosterPlayer('Ann');
    await setRosterPhoto(ann.id, photo(1));
    await deleteRosterPlayer(ann.id);
    expect(await getRosterPhoto(ann.id)).toBeUndefined();
    expect(await listRoster()).toEqual([]);
  });

  it('refuses to save a photo for a player that no longer exists', async () => {
    const ann = await addRosterPlayer('Ann');
    await deleteRosterPlayer(ann.id);
    await expect(setRosterPhoto(ann.id, photo(1))).rejects.toThrow(/no longer exists/i);
    await expect(setRosterPhoto('nobody', photo(1))).rejects.toThrow(/no longer exists/i);
  });

  it('upgrades a version 1 database and keeps its players', async () => {
    await resetRosterDbForTests();
    const old = await openDB('pickleball-roster', 1, {
      upgrade(d) {
        d.createObjectStore('players', { keyPath: 'id' });
      },
    });
    await old.put('players', { id: 'p1', name: 'Ann', photoVersion: 0, updatedAt: 1 });
    old.close();

    expect((await listRoster()).map((p) => p.name)).toEqual(['Ann']);
    await setRosterPhoto('p1', photo(4, 5));
    expect(bytesOf(await getRosterPhoto('p1'))).toEqual([4, 5]);
  });
});
