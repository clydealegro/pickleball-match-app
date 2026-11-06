import { beforeEach, describe, expect, it } from 'vitest';
import {
  ackOutbox,
  addRosterPlayer,
  deleteRosterPlayer,
  getRosterEntry,
  getSyncMeta,
  listOutbox,
  markRosterPlayed,
  queueAllForSync,
  removeRosterPhoto,
  renameRosterPlayer,
  resetRosterDbForTests,
  setRosterPhoto,
  setSyncMeta,
  type PhotoData,
} from './rosterDb';

const photo = (...bytes: number[]): PhotoData => ({ type: 'image/jpeg', data: new Uint8Array(bytes).buffer });

beforeEach(async () => {
  await resetRosterDbForTests();
});

/** What a push does when it succeeds: read every mark, then remove each one at the revision it read. */
async function pushAll() {
  for (const entry of await listOutbox()) await ackOutbox(entry.playerId, entry.rev);
}

const ids = async () => (await listOutbox()).map((e) => e.playerId);

describe('roster outbox', () => {
  it('marks a new player as having changes to push', async () => {
    const ann = await addRosterPlayer('Ann');
    expect(await listOutbox()).toEqual([{ playerId: ann.id, rev: 1 }]);
  });

  it('keeps one mark per player and gives it a newer revision with every change', async () => {
    const ann = await addRosterPlayer('Ann');
    await renameRosterPlayer(ann.id, 'Annie');
    await setRosterPhoto(ann.id, photo(1));
    await markRosterPlayed([ann.id], 5_000);
    expect(await listOutbox()).toEqual([{ playerId: ann.id, rev: 4 }]);
  });

  it('marks every kind of change', async () => {
    const ann = await addRosterPlayer('Ann');
    await pushAll();
    expect(await listOutbox()).toEqual([]);

    await renameRosterPlayer(ann.id, 'Annie');
    expect(await ids()).toEqual([ann.id]);
    await pushAll();
    await setRosterPhoto(ann.id, photo(1));
    expect(await ids()).toEqual([ann.id]);
    await pushAll();
    await removeRosterPhoto(ann.id);
    expect(await ids()).toEqual([ann.id]);
    await pushAll();
    await markRosterPlayed([ann.id], 9_000);
    expect(await ids()).toEqual([ann.id]);
    await pushAll();
    await deleteRosterPlayer(ann.id);
    expect(await ids()).toEqual([ann.id]);
    expect(await getRosterEntry(ann.id)).toMatchObject({ deletedAt: expect.any(Number) });
  });

  it('marks nothing when nothing changed', async () => {
    const ann = await addRosterPlayer('Ann');
    await pushAll();
    await addRosterPlayer(' ANN '); // the same player
    await renameRosterPlayer(ann.id, 'Ann'); // the same name
    await removeRosterPhoto(ann.id); // no photo to remove
    await markRosterPlayed(['nobody'], 1_000);
    expect(await listOutbox()).toEqual([]);

    await deleteRosterPlayer(ann.id);
    await pushAll();
    await deleteRosterPlayer(ann.id); // already deleted
    await markRosterPlayed([ann.id], 2_000); // deleted players are not played
    expect(await listOutbox()).toEqual([]);
  });

  it('removes a mark only when the player has not changed since it was read', async () => {
    const ann = await addRosterPlayer('Ann');
    const [entry] = await listOutbox();
    await renameRosterPlayer(ann.id, 'Annie'); // changes again while a push is running
    await ackOutbox(ann.id, entry.rev);
    expect(await listOutbox()).toEqual([{ playerId: ann.id, rev: 2 }]);
    await ackOutbox(ann.id, 2);
    expect(await listOutbox()).toEqual([]);
    await ackOutbox(ann.id, 2); // nothing there: no error
    await ackOutbox('nobody', 1);
  });

  it('never gives the same revision twice, so a late acknowledgement cannot remove a newer mark', async () => {
    const ann = await addRosterPlayer('Ann');
    const [first] = await listOutbox();
    await ackOutbox(ann.id, first.rev);
    await renameRosterPlayer(ann.id, 'Annie');
    const [second] = await listOutbox();
    expect(second.rev).not.toBe(first.rev);
    await ackOutbox(ann.id, first.rev); // the first push's acknowledgement, arriving late
    expect(await listOutbox()).toEqual([second]);
  });

  it('saves the change and its mark together, or neither', async () => {
    const ann = await addRosterPlayer('Ann');
    await pushAll();
    const data = new Uint8Array([1, 2, 3]).buffer;
    structuredClone(data, { transfer: [data] }); // detaches the buffer, so it cannot be stored
    await expect(setRosterPhoto(ann.id, { type: 'image/jpeg', data })).rejects.toThrow();
    expect(await listOutbox()).toEqual([]);
    expect(await getRosterEntry(ann.id)).toMatchObject({ photoVersion: 0, photoSeq: 0 });
    await addRosterPlayer('Ben'); // and the counter was not spent by the failed change
    expect((await listOutbox())[0].rev).toBe(2);
  });

  it('marks every saved player, deleted ones included, for the first sign-in', async () => {
    const ann = await addRosterPlayer('Ann');
    const ben = await addRosterPlayer('Ben');
    await deleteRosterPlayer(ben.id);
    await pushAll();
    expect(await queueAllForSync()).toBe(2);
    expect((await ids()).sort()).toEqual([ann.id, ben.id].sort());
  });

  it('lists the marks in a steady order', async () => {
    const a = await addRosterPlayer('Ann');
    const b = await addRosterPlayer('Ben');
    const c = await addRosterPlayer('Cy');
    expect(await ids()).toEqual([a.id, b.id, c.id].sort());
  });
});

describe('photo sequence', () => {
  it('starts at 0 and goes up with every saved photo', async () => {
    const ann = await addRosterPlayer('Ann');
    expect(ann.photoSeq).toBe(0);
    await setRosterPhoto(ann.id, photo(1));
    await setRosterPhoto(ann.id, photo(2));
    expect(await getRosterEntry(ann.id)).toMatchObject({ photoVersion: 2, photoSeq: 2 });
  });

  it('is not reset when the photo is removed, so a re-added photo never reuses a number', async () => {
    const ann = await addRosterPlayer('Ann');
    await setRosterPhoto(ann.id, photo(1));
    await removeRosterPhoto(ann.id);
    expect(await getRosterEntry(ann.id)).toMatchObject({ photoVersion: 0, photoSeq: 1 });
    await setRosterPhoto(ann.id, photo(2));
    expect(await getRosterEntry(ann.id)).toMatchObject({ photoVersion: 1, photoSeq: 2 });
  });

  it('is kept when a player is deleted', async () => {
    const ann = await addRosterPlayer('Ann');
    await setRosterPhoto(ann.id, photo(1));
    await deleteRosterPlayer(ann.id);
    expect(await getRosterEntry(ann.id)).toMatchObject({ photoVersion: 1, photoSeq: 1 });
  });
});

describe('sync meta', () => {
  it('keeps small values between calls, and reads a missing one as undefined', async () => {
    expect(await getSyncMeta('cursor')).toBeUndefined();
    await setSyncMeta('cursor', '2026-11-06T10:00:00.000Z');
    await setSyncMeta('user', { id: 'u1' });
    expect(await getSyncMeta('cursor')).toBe('2026-11-06T10:00:00.000Z');
    expect(await getSyncMeta('user')).toEqual({ id: 'u1' });
  });
});
