import { openDB } from 'idb';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  addRosterPlayer,
  getRosterEntry,
  getRosterPhoto,
  getSyncMeta,
  listOutbox,
  listRoster,
  resetRosterDbForTests,
  setRosterPhoto,
  setSyncMeta,
} from './rosterDb';

const DB_NAME = 'pickleball-roster';

beforeEach(async () => {
  await resetRosterDbForTests();
});

/** Leaves the database as an earlier build would have: players saved, and (from version 2) photos. */
async function seedOldDatabase(version: 1 | 2) {
  const old = await openDB(DB_NAME, version, {
    upgrade(d) {
      d.createObjectStore('players', { keyPath: 'id' });
      if (version >= 2) d.createObjectStore('photos', { keyPath: 'id' });
    },
  });
  await old.put('players', { id: 'p1', name: 'Ann', photoVersion: 0, updatedAt: 1 });
  await old.put('players', { id: 'p2', name: 'Ben', photoVersion: 3, updatedAt: 2 });
  if (version >= 2) await old.put('photos', { id: 'p2', type: 'image/jpeg', data: new Uint8Array([7, 8]).buffer });
  old.close();
}

describe('upgrading to version 3', () => {
  it('keeps a version 2 database as it was and starts each photo sequence at the photo count', async () => {
    await seedOldDatabase(2);
    expect((await listRoster()).map((p) => [p.name, p.photoVersion, p.photoSeq])).toEqual([
      ['Ann', 0, 0],
      ['Ben', 3, 3],
    ]);
    expect(Array.from(new Uint8Array((await getRosterPhoto('p2'))!.data))).toEqual([7, 8]);
    expect(await listOutbox()).toEqual([]);
    await setSyncMeta('cursor', 'x');
    expect(await getSyncMeta('cursor')).toBe('x');
  });

  it('upgrades a version 1 database too', async () => {
    await seedOldDatabase(1);
    expect((await listRoster()).map((p) => p.name)).toEqual(['Ann', 'Ben']);
    await setRosterPhoto('p1', { type: 'image/jpeg', data: new Uint8Array([1]).buffer });
    expect(await getRosterEntry('p1')).toMatchObject({ photoVersion: 1, photoSeq: 1 });
  });

  it('creates the two new stores', async () => {
    await seedOldDatabase(2);
    await listRoster();
    const raw = await openDB(DB_NAME);
    expect(Array.from(raw.objectStoreNames).sort()).toEqual(['outbox', 'photos', 'players', 'syncMeta']);
    expect(raw.version).toBe(3);
    raw.close();
  });
});

describe('a database left by a newer build', () => {
  it('still saves players when it has no outbox, photos or syncMeta store', async () => {
    const seed = await openDB(DB_NAME, 9, {
      upgrade(d) {
        d.createObjectStore('players', { keyPath: 'id' });
      },
    });
    await seed.put('players', { id: 'p1', name: 'Ann', photoVersion: 2, updatedAt: 1 });
    seed.close();

    const ben = await addRosterPlayer('Ben');
    expect((await listRoster()).map((p) => p.name)).toEqual(['Ann', 'Ben']);
    expect((await listRoster())[0].photoSeq).toBe(2); // read as the photo count, since the row has none
    expect(await getRosterEntry(ben.id)).toBeDefined();
    expect(await listOutbox()).toEqual([]);
    expect(await getSyncMeta('cursor')).toBeUndefined();
    await expect(setSyncMeta('cursor', 'x')).resolves.toBeUndefined();
  });

  it('still refuses a photo when it has no photos store, and saves nothing of that change', async () => {
    const seed = await openDB(DB_NAME, 9, {
      upgrade(d) {
        d.createObjectStore('players', { keyPath: 'id' });
      },
    });
    await seed.put('players', { id: 'p1', name: 'Ann', photoVersion: 0, updatedAt: 1 });
    seed.close();

    await expect(setRosterPhoto('p1', { type: 'image/jpeg', data: new Uint8Array([1]).buffer })).rejects.toThrow();
    expect(await getRosterEntry('p1')).toMatchObject({ photoVersion: 0, photoSeq: 0 });
  });
});

describe('two tabs of the app', () => {
  /** A second copy of the module is a second tab: its own connection and its own queue. */
  async function secondTab() {
    vi.resetModules();
    return import('./rosterDb');
  }

  it('do not overwrite each other when both change the same player at once', async () => {
    const ann = await addRosterPlayer('Ann');
    const tabB = await secondTab();
    const photo = (n: number) => ({ type: 'image/jpeg', data: new Uint8Array([n]).buffer });

    await Promise.all([setRosterPhoto(ann.id, photo(1)), tabB.setRosterPhoto(ann.id, photo(2))]);
    await Promise.all([tabB.markRosterPlayed([ann.id], 9_000), setRosterPhoto(ann.id, photo(3))]);

    const entry = await getRosterEntry(ann.id);
    expect(entry).toMatchObject({ photoVersion: 3, photoSeq: 3, lastPlayedAt: 9_000 });
    expect(await listOutbox()).toEqual([{ playerId: ann.id, rev: 5 }]); // added, then four changes
  });

  it('do not create the same name twice when both add it at once', async () => {
    const tabB = await secondTab();
    await Promise.all([addRosterPlayer('Ann'), tabB.addRosterPlayer('ann')]);
    expect(await listRoster()).toHaveLength(1);
  });
});
