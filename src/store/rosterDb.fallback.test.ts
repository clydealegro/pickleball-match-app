import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('idb', async (importOriginal) => ({
  ...(await importOriginal<typeof import('idb')>()),
  openDB: vi.fn().mockRejectedValue(new Error('blocked')),
}));

import {
  ackOutbox,
  addRosterPlayer,
  clearRosterData,
  getRosterEntry,
  getSyncMeta,
  listOutbox,
  queueAllForSync,
  setSyncMeta,
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

  it('keeps the outbox, the photo sequence and the sync values in memory too', async () => {
    const ann = await addRosterPlayer('Ann');
    expect(await listOutbox()).toEqual([{ playerId: ann.id, rev: 1 }]);
    await setRosterPhoto(ann.id, { type: 'image/jpeg', data: new Uint8Array([7]).buffer });
    await removeRosterPhoto(ann.id);
    expect(await getRosterEntry(ann.id)).toMatchObject({ photoVersion: 0, photoSeq: 1 });
    const [entry] = await listOutbox();
    expect(entry.rev).toBe(3);
    await ackOutbox(ann.id, 1); // stale: keeps the newer mark
    expect(await listOutbox()).toHaveLength(1);
    await ackOutbox(ann.id, entry.rev);
    expect(await listOutbox()).toEqual([]);
    expect(await queueAllForSync()).toBe(1);
    await setSyncMeta('cursor', 'c1');
    expect(await getSyncMeta('cursor')).toBe('c1');
  });

  it('puts the outbox back too when a change fails', async () => {
    const ann = await addRosterPlayer('Ann');
    await ackOutbox(ann.id, 1);
    const data = new Uint8Array([1]).buffer;
    structuredClone(data, { transfer: [data] });
    await expect(setRosterPhoto(ann.id, { type: 'image/jpeg', data })).rejects.toThrow();
    expect(await listOutbox()).toEqual([]);
    await addRosterPlayer('Ben');
    expect((await listOutbox())[0].rev).toBe(2); // the failed change did not use up a revision
  });

  it('clears everything in memory too', async () => {
    await addRosterPlayer('Ann');
    await setSyncMeta('syncUser', 'u1');
    await clearRosterData();
    expect(await listRoster()).toEqual([]);
    expect(await listOutbox()).toEqual([]);
    expect(await getSyncMeta('syncUser')).toBeUndefined();
  });

  it('starts fresh after a reset', async () => {
    await addRosterPlayer('Ann');
    await resetRosterDbForTests();
    expect(isRosterPersistent()).toBe(true);
    expect(await listRoster()).toEqual([]);
  });
});
