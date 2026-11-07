import { beforeEach, describe, expect, it } from 'vitest';
import {
  addRosterPlayer,
  clearRosterData,
  getRosterEntry,
  getRosterPhoto,
  getSyncMeta,
  listOutbox,
  listRoster,
  resetRosterDbForTests,
  setRosterPhoto,
  setSyncMeta,
} from './rosterDb';

beforeEach(async () => {
  await resetRosterDbForTests();
});

describe('clearing this device', () => {
  it('removes every player, photo, mark and sync value', async () => {
    const ann = await addRosterPlayer('Ann');
    await setRosterPhoto(ann.id, { type: 'image/jpeg', data: new Uint8Array([1]).buffer });
    await setSyncMeta('syncUser', 'u1');
    await setSyncMeta('syncCursor', 'c1');
    await clearRosterData();
    expect(await listRoster()).toEqual([]);
    expect(await getRosterEntry(ann.id)).toBeUndefined();
    expect(await getRosterPhoto(ann.id)).toBeUndefined();
    expect(await listOutbox()).toEqual([]);
    expect(await getSyncMeta('syncUser')).toBeUndefined();
    expect(await getSyncMeta('syncCursor')).toBeUndefined();
  });

  it('keeps the revision counter, so a revision is still never reused', async () => {
    await addRosterPlayer('Ann');
    await addRosterPlayer('Ben');
    await clearRosterData();
    const cy = await addRosterPlayer('Cy');
    expect(await listOutbox()).toEqual([{ playerId: cy.id, rev: 3 }]);
  });

  it('is fine on an empty database, and the app keeps working after it', async () => {
    await clearRosterData();
    await clearRosterData();
    await addRosterPlayer('Ann');
    expect((await listRoster()).map((p) => p.name)).toEqual(['Ann']);
  });
});
