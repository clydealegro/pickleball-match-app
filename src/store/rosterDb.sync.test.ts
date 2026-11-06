import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  addRosterPlayer,
  applyPulledPlayer,
  deleteRosterPlayer,
  getRosterEntry,
  getRosterPhoto,
  listOutbox,
  markRosterPlayed,
  mergeLocalInto,
  removeRosterPhoto,
  renameRosterPlayer,
  resetRosterDbForTests,
  setRosterPhoto,
  setSyncMeta,
  subscribeRosterChanges,
  ackOutbox,
  type PhotoData,
  type PulledPlayer,
} from './rosterDb';

beforeEach(async () => {
  await resetRosterDbForTests();
});

const jpeg = (...bytes: number[]): PhotoData => ({ type: 'image/jpeg', data: new Uint8Array(bytes).buffer });
const bytesOf = (photo: PhotoData | undefined) => (photo ? [...new Uint8Array(photo.data)] : undefined);
const row = (over: Partial<PulledPlayer> = {}): PulledPlayer => ({
  id: 'p1',
  name: 'Ann',
  photoVersion: 0,
  photoSeq: 0,
  updatedAt: 5_000,
  ...over,
});

describe('saving a pulled row', () => {
  it('adds a player this device did not have, without marking them for a push', async () => {
    expect(await applyPulledPlayer(row({ lastPlayedAt: 4_000 }), undefined)).toBe('applied');
    expect(await getRosterEntry('p1')).toEqual({
      id: 'p1',
      name: 'Ann',
      photoVersion: 0,
      photoSeq: 0,
      lastPlayedAt: 4_000,
      updatedAt: 5_000,
    });
    expect(await listOutbox()).toEqual([]);
  });

  it('leaves a player alone while they have a change waiting to be pushed', async () => {
    const ann = await addRosterPlayer('Ann');
    expect(await applyPulledPlayer(row({ id: ann.id, name: 'Annie' }), undefined)).toBe('pending');
    expect(await getRosterEntry(ann.id)).toMatchObject({ name: 'Ann' });
  });

  it('changes a player that has nothing waiting, and says unchanged when it would change nothing', async () => {
    await applyPulledPlayer(row(), undefined);
    expect(await applyPulledPlayer(row({ name: 'Annie', updatedAt: 6_000 }), undefined)).toBe('applied');
    expect(await getRosterEntry('p1')).toMatchObject({ name: 'Annie', updatedAt: 6_000 });
    expect(await applyPulledPlayer(row({ name: 'Annie', updatedAt: 7_000 }), undefined)).toBe('unchanged');
    expect(await getRosterEntry('p1')).toMatchObject({ updatedAt: 6_000 });
  });

  it('stores a downloaded photo with the row, and keeps the photo already here when told nothing', async () => {
    await applyPulledPlayer(row({ photoVersion: 1, photoSeq: 1 }), jpeg(1, 2));
    expect(bytesOf(await getRosterPhoto('p1'))).toEqual([1, 2]);
    expect(await applyPulledPlayer(row({ name: 'Annie', photoVersion: 1, photoSeq: 1 }), undefined)).toBe('applied');
    expect(bytesOf(await getRosterPhoto('p1'))).toEqual([1, 2]);
    expect(await getRosterEntry('p1')).toMatchObject({ photoVersion: 1, photoSeq: 1 });
  });

  it('removes the photo when the row has none, and when its picture could not be found', async () => {
    await applyPulledPlayer(row({ photoVersion: 1, photoSeq: 1 }), jpeg(1));
    await applyPulledPlayer(row({ photoVersion: 0, photoSeq: 1, updatedAt: 6_000 }), undefined);
    expect(await getRosterPhoto('p1')).toBeUndefined();
    expect(await getRosterEntry('p1')).toMatchObject({ photoVersion: 0, photoSeq: 1 });

    await applyPulledPlayer(row({ photoVersion: 2, photoSeq: 2, updatedAt: 7_000 }), jpeg(2));
    await applyPulledPlayer(row({ photoVersion: 3, photoSeq: 3, updatedAt: 8_000 }), null);
    expect(await getRosterPhoto('p1')).toBeUndefined();
    expect(await getRosterEntry('p1')).toMatchObject({ photoVersion: 0, photoSeq: 3 });
  });

  it('never lowers the photo sequence', async () => {
    await applyPulledPlayer(row({ photoVersion: 1, photoSeq: 5 }), jpeg(1));
    await applyPulledPlayer(row({ photoVersion: 0, photoSeq: 2, updatedAt: 6_000 }), undefined);
    expect(await getRosterEntry('p1')).toMatchObject({ photoSeq: 5 });
  });

  it('deletes a player the server deleted, with their photo, and ignores one it never had', async () => {
    await applyPulledPlayer(row({ photoVersion: 1, photoSeq: 1 }), jpeg(1));
    expect(await applyPulledPlayer(row({ deletedAt: 9_000, updatedAt: 9_000, photoVersion: 1, photoSeq: 1 }), undefined)).toBe('applied');
    expect(await getRosterEntry('p1')).toMatchObject({ deletedAt: 9_000 });
    expect(await getRosterPhoto('p1')).toBeUndefined();
    expect(await applyPulledPlayer(row({ deletedAt: 9_000, updatedAt: 9_000 }), undefined)).toBe('unchanged');
    expect(await applyPulledPlayer(row({ id: 'other', deletedAt: 9_000 }), undefined)).toBe('unchanged');
    expect(await getRosterEntry('other')).toBeUndefined();
    expect(await listOutbox()).toEqual([]);
  });

  it('does not tell the app about it, so syncing does not set off another sync', async () => {
    const listener = vi.fn();
    subscribeRosterChanges(listener);
    await applyPulledPlayer(row(), undefined);
    expect(listener).not.toHaveBeenCalled();
  });
});

describe('merging two entries for one player', () => {
  async function pair() {
    await applyPulledPlayer(row({ id: 'kept', name: 'Ann' }), undefined);
    return addRosterPlayer('Ann2'); // a different local entry, with a mark
  }

  it('retires the local entry for good and clears its mark', async () => {
    const local = await pair();
    await mergeLocalInto(local.id, 'kept', 10_000);
    expect(await getRosterEntry(local.id)).toMatchObject({ deletedAt: 10_000 });
    expect(await listOutbox()).toEqual([]);
  });

  it('gives the kept player the local photo when they have none', async () => {
    const local = await pair();
    await setRosterPhoto(local.id, jpeg(7));
    await mergeLocalInto(local.id, 'kept', 10_000);
    expect(await getRosterEntry('kept')).toMatchObject({ photoVersion: 1, photoSeq: 1, updatedAt: 10_000 });
    expect(bytesOf(await getRosterPhoto('kept'))).toEqual([7]);
    expect(await getRosterPhoto(local.id)).toBeUndefined();
    expect((await listOutbox()).map((e) => e.playerId)).toEqual(['kept']);
  });

  it('keeps the photo the kept player has, and takes the later played time', async () => {
    const local = await pair();
    await applyPulledPlayer(row({ id: 'kept', photoVersion: 1, photoSeq: 4, lastPlayedAt: 2_000, updatedAt: 6_000 }), jpeg(1));
    await setRosterPhoto(local.id, jpeg(7));
    await markRosterPlayed([local.id], 3_000);
    await mergeLocalInto(local.id, 'kept', 10_000);
    expect(bytesOf(await getRosterPhoto('kept'))).toEqual([1]);
    expect(await getRosterEntry('kept')).toMatchObject({ photoSeq: 4, lastPlayedAt: 3_000 });
    expect((await listOutbox()).map((e) => e.playerId)).toEqual(['kept']);
  });

  it('marks nothing when the kept player gains nothing', async () => {
    const local = await pair();
    await mergeLocalInto(local.id, 'kept', 10_000);
    expect(await listOutbox()).toEqual([]);
    expect(await getRosterEntry('kept')).toMatchObject({ updatedAt: 5_000 });
  });

  it('refuses when either player is missing', async () => {
    const local = await pair();
    await expect(mergeLocalInto('nobody', 'kept')).rejects.toThrow();
    await expect(mergeLocalInto(local.id, 'nobody')).rejects.toThrow();
    await expect(mergeLocalInto('kept', 'kept')).rejects.toThrow();
    expect(await getRosterEntry(local.id)).toMatchObject({ name: 'Ann2' });
  });
});

describe('hearing about changes made on this device', () => {
  it('is told after every kind of change, and stops when asked to', async () => {
    const listener = vi.fn();
    const stop = subscribeRosterChanges(listener);
    const ann = await addRosterPlayer('Ann');
    await renameRosterPlayer(ann.id, 'Annie');
    await setRosterPhoto(ann.id, jpeg(1));
    await removeRosterPhoto(ann.id);
    await markRosterPlayed([ann.id], 1_000);
    await deleteRosterPlayer(ann.id);
    expect(listener).toHaveBeenCalledTimes(6);
    stop();
    await addRosterPlayer('Ben');
    expect(listener).toHaveBeenCalledTimes(6);
  });

  it('is not told about a change that failed, or about the sync engine bookkeeping', async () => {
    const listener = vi.fn();
    subscribeRosterChanges(listener);
    await expect(renameRosterPlayer('nobody', 'X')).rejects.toThrow();
    await ackOutbox('nobody', 1);
    await setSyncMeta('k', 1);
    expect(listener).not.toHaveBeenCalled();
  });
});
