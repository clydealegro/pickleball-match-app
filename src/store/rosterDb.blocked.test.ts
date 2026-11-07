import { openDB } from 'idb';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  isRosterBlocked,
  listRoster,
  resetRosterDbForTests,
  subscribeRosterBlocked,
} from './rosterDb';
import { useRosterStore } from './rosterStore';

const DB_NAME = 'pickleball-roster';

beforeEach(async () => {
  await resetRosterDbForTests();
});

describe('an upgrade that waits for another tab', () => {
  it('says so while the old tab holds on, and stops saying so when it lets go', async () => {
    // An old tab (version 2) that does not close its connection when asked.
    const oldTab = await openDB(DB_NAME, 2, {
      upgrade(d) {
        d.createObjectStore('players', { keyPath: 'id' });
        d.createObjectStore('photos', { keyPath: 'id' });
      },
    });
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const heard = vi.fn();
    const stop = subscribeRosterBlocked(heard);

    expect(isRosterBlocked()).toBe(false);
    const loading = listRoster();
    await vi.waitFor(() => expect(isRosterBlocked()).toBe(true));
    expect(heard).toHaveBeenCalledTimes(1);

    oldTab.close();
    expect(await loading).toEqual([]);
    expect(isRosterBlocked()).toBe(false);
    expect(heard).toHaveBeenCalledTimes(2);

    stop();
    warn.mockRestore();
  });

  it('is not blocked in the ordinary case, and tells no one when nothing changed', async () => {
    const heard = vi.fn();
    const stop = subscribeRosterBlocked(heard);
    await listRoster();
    expect(isRosterBlocked()).toBe(false);
    expect(heard).not.toHaveBeenCalled();
    stop();
  });

  it('reaches the roster store, so the app can tell the organizer', async () => {
    const oldTab = await openDB(DB_NAME, 2, {
      upgrade(d) {
        d.createObjectStore('players', { keyPath: 'id' });
        d.createObjectStore('photos', { keyPath: 'id' });
      },
    });
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    expect(useRosterStore.getState().blocked).toBe(false);
    const loading = useRosterStore.getState().load();
    await vi.waitFor(() => expect(useRosterStore.getState().blocked).toBe(true));
    oldTab.close();
    await loading;
    expect(useRosterStore.getState().blocked).toBe(false);
    warn.mockRestore();
  });
});
