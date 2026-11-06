import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('idb', async (importOriginal) => ({
  ...(await importOriginal<typeof import('idb')>()),
  openDB: vi.fn().mockRejectedValue(new Error('blocked')),
}));

import {
  addRosterPlayer,
  deleteRosterPlayer,
  getRosterPhoto,
  isRosterPersistent,
  lastSessionIds,
  listRoster,
  markRosterPlayed,
  removeRosterPhoto,
  renameRosterPlayer,
  resetRosterDbForTests,
  setRosterPhoto,
} from './rosterDb';

beforeEach(async () => {
  await resetRosterDbForTests();
});

describe('roster db without IndexedDB', () => {
  it('keeps players in memory and reports that nothing is persisted', async () => {
    // Optimistic by design: it only turns false once opening IndexedDB has actually failed.
    expect(isRosterPersistent()).toBe(true);
    const ann = await addRosterPlayer('Ann');
    await addRosterPlayer('Ben');
    expect(isRosterPersistent()).toBe(false);
    expect((await listRoster()).map((p) => p.name)).toEqual(['Ann', 'Ben']);
    expect((await addRosterPlayer(' ann ')).id).toBe(ann.id);
  });

  it('renames and soft deletes', async () => {
    const ann = await addRosterPlayer('Ann');
    const ben = await addRosterPlayer('Ben');
    await renameRosterPlayer(ann.id, 'Annie');
    await expect(renameRosterPlayer(ann.id, 'ben')).rejects.toThrow(/already/i);
    await deleteRosterPlayer(ben.id);
    expect((await listRoster()).map((p) => p.name)).toEqual(['Annie']);
    expect((await addRosterPlayer('Ben')).id).not.toBe(ben.id);
  });

  it('marks players as played', async () => {
    const a = await addRosterPlayer('Ann');
    const b = await addRosterPlayer('Ben');
    await markRosterPlayed([a.id], 1_000);
    await markRosterPlayed([b.id], 2_000);
    expect(lastSessionIds(await listRoster())).toEqual([b.id]);
  });

  it('keeps photos in memory too', async () => {
    const ann = await addRosterPlayer('Ann');
    await setRosterPhoto(ann.id, { type: 'image/jpeg', data: new Uint8Array([7]).buffer });
    expect(Array.from(new Uint8Array((await getRosterPhoto(ann.id))!.data))).toEqual([7]);
    expect((await listRoster())[0].photoVersion).toBe(1);
    await removeRosterPhoto(ann.id);
    expect(await getRosterPhoto(ann.id)).toBeUndefined();
  });

  it('saves nothing at all when a photo cannot be copied', async () => {
    const ann = await addRosterPlayer('Ann');
    const data = new Uint8Array([1]).buffer;
    structuredClone(data, { transfer: [data] }); // detaches the buffer, so it cannot be copied
    await expect(setRosterPhoto(ann.id, { type: 'image/jpeg', data })).rejects.toThrow();
    expect((await listRoster())[0].photoVersion).toBe(0);
    expect(await getRosterPhoto(ann.id)).toBeUndefined();
  });

  it('starts fresh after a reset', async () => {
    await addRosterPlayer('Ann');
    await resetRosterDbForTests();
    expect(isRosterPersistent()).toBe(true);
    expect(await listRoster()).toEqual([]);
  });
});
