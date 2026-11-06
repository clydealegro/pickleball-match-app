import { beforeEach, describe, expect, it } from 'vitest';
import { resetRosterDbForTests } from './rosterDb';
import { useRosterStore } from './rosterStore';
import { useSessionStore } from './sessionStore';

beforeEach(async () => {
  localStorage.clear();
  useSessionStore.setState({ session: null, undoStack: [], saveFailed: false });
  await resetRosterDbForTests();
  useRosterStore.setState({ players: [], loaded: false, persistent: true });
});

describe('rosterStore', () => {
  it('adds a player and does not duplicate the same name', async () => {
    const ann = await useRosterStore.getState().add('Ann');
    expect(useRosterStore.getState().players).toEqual([ann]);
    const again = await useRosterStore.getState().add(' ann ');
    expect(again.id).toBe(ann.id);
    expect(useRosterStore.getState().players).toHaveLength(1);
  });

  it('renames and removes players', async () => {
    const { add, rename, remove } = useRosterStore.getState();
    const ann = await add('Ann');
    const ben = await add('Ben');
    await rename(ann.id, 'Annie');
    expect(useRosterStore.getState().players.map((p) => p.name)).toEqual(['Annie', 'Ben']);
    await remove(ben.id);
    expect(useRosterStore.getState().players.map((p) => p.name)).toEqual(['Annie']);
  });

  it('loads the saved players and reports that they persist', async () => {
    await useRosterStore.getState().add('Ann');
    useRosterStore.setState({ players: [], loaded: false });
    await useRosterStore.getState().load();
    expect(useRosterStore.getState().loaded).toBe(true);
    expect(useRosterStore.getState().persistent).toBe(true);
    expect(useRosterStore.getState().players.map((p) => p.name)).toEqual(['Ann']);
  });

  it('does not change a running session when the roster is edited', async () => {
    const { add, rename, remove } = useRosterStore.getState();
    const names = ['Ann', 'Ben', 'Cy', 'Dee'];
    const saved = [];
    for (const name of names) saved.push(await add(name));
    const res = useSessionStore.getState().start({
      name: 'Open play',
      mode: 'fairness',
      courtCount: 1,
      players: saved.map((p) => ({ name: p.name, rosterId: p.id })),
    });
    expect(res.ok).toBe(true);
    const snapshot = structuredClone(useSessionStore.getState().session);
    expect(snapshot?.players.map((p) => p.rosterId)).toEqual(saved.map((p) => p.id));

    await rename(saved[0].id, 'Annie');
    await remove(saved[1].id);

    expect(useRosterStore.getState().players.map((p) => p.name)).toEqual(['Annie', 'Cy', 'Dee']);
    expect(useSessionStore.getState().session).toEqual(snapshot);
    expect(JSON.parse(JSON.stringify(useSessionStore.getState().session))).toEqual(
      JSON.parse(JSON.stringify(snapshot)),
    );
  });
});
