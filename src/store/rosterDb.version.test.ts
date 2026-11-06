import { openDB } from 'idb';
import { beforeEach, describe, expect, it } from 'vitest';
import {
  addRosterPlayer,
  isRosterPersistent,
  listRoster,
  resetRosterDbForTests,
} from './rosterDb';

const DB_NAME = 'pickleball-roster';

/** Creates the database as a newer build of the app would have left it. */
async function seedNewerDatabase(version: number) {
  const seed = await openDB(DB_NAME, version, {
    upgrade(d) {
      d.createObjectStore('players', { keyPath: 'id' });
      d.createObjectStore('extra-from-the-future', { keyPath: 'id' });
    },
  });
  await seed.put('players', { id: 'p1', name: 'Ann', photoVersion: 0, updatedAt: 1 });
  seed.close();
}

beforeEach(async () => {
  await resetRosterDbForTests();
});

describe('roster db opened at an older version than the stored one', () => {
  it('uses the stored database instead of falling back to memory', async () => {
    await seedNewerDatabase(5);
    expect((await listRoster()).map((p) => p.name)).toEqual(['Ann']);
    expect(isRosterPersistent()).toBe(true);
  });

  it('keeps saving to the stored database', async () => {
    await seedNewerDatabase(5);
    await addRosterPlayer('Ben');
    expect((await listRoster()).map((p) => p.name)).toEqual(['Ann', 'Ben']);
    expect(isRosterPersistent()).toBe(true);
  });
});
