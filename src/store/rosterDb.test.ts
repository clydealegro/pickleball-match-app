import { beforeEach, describe, expect, it } from 'vitest';
import {
  addRosterPlayer,
  deleteRosterPlayer,
  lastSessionIds,
  listRoster,
  markRosterPlayed,
  renameRosterPlayer,
  resetRosterDbForTests,
} from './rosterDb';

beforeEach(async () => {
  await resetRosterDbForTests();
});

describe('roster db', () => {
  it('adds players and lists them alphabetically', async () => {
    await addRosterPlayer('Ben');
    await addRosterPlayer('ann');
    await addRosterPlayer('Cy');
    expect((await listRoster()).map((p) => p.name)).toEqual(['ann', 'Ben', 'Cy']);
  });

  it('stores the fields the sync plan will rely on', async () => {
    const p = await addRosterPlayer('  Ann  ', 1_234);
    expect(p).toMatchObject({ name: 'Ann', photoVersion: 0, updatedAt: 1_234 });
    expect(p.deletedAt).toBeUndefined();
    expect(typeof p.id).toBe('string');
  });

  it('returns the existing entry for a duplicate name (case-insensitive)', async () => {
    const a = await addRosterPlayer('Ann');
    const b = await addRosterPlayer('  ANN ');
    expect(b.id).toBe(a.id);
    expect(await listRoster()).toHaveLength(1);
  });

  it('does not create duplicates when adds with the same name overlap', async () => {
    const results = await Promise.all(['Ann', 'ann', ' ANN '].map((n) => addRosterPlayer(n)));
    expect(await listRoster()).toHaveLength(1);
    expect(new Set(results.map((p) => p.id)).size).toBe(1);
  });

  it('rejects empty names', async () => {
    await expect(addRosterPlayer('   ')).rejects.toThrow(/name/i);
  });

  it('renames a player and rejects a name that is already taken', async () => {
    const ann = await addRosterPlayer('Ann');
    await addRosterPlayer('Ben');
    await renameRosterPlayer(ann.id, 'Annie', 2_000);
    const renamed = (await listRoster()).find((p) => p.id === ann.id)!;
    expect(renamed.name).toBe('Annie');
    expect(renamed.updatedAt).toBe(2_000);
    await expect(renameRosterPlayer(ann.id, 'ben')).rejects.toThrow(/already/i);
  });

  it('soft deletes: hidden from the list, and the name can be added again', async () => {
    const ann = await addRosterPlayer('Ann');
    await deleteRosterPlayer(ann.id, 3_000);
    expect(await listRoster()).toHaveLength(0);
    const again = await addRosterPlayer('Ann');
    expect(again.id).not.toBe(ann.id);
  });

  it('marks players as having played and finds the last session group', async () => {
    const a = await addRosterPlayer('Ann');
    const b = await addRosterPlayer('Ben');
    const c = await addRosterPlayer('Cy');
    await markRosterPlayed([a.id, b.id], 1_000);
    await markRosterPlayed([b.id, c.id], 2_000);
    const roster = await listRoster();
    expect(lastSessionIds(roster).sort()).toEqual([b.id, c.id].sort());
  });

  it('lastSessionIds is empty when nobody has played', async () => {
    await addRosterPlayer('Ann');
    expect(lastSessionIds(await listRoster())).toEqual([]);
  });
});
