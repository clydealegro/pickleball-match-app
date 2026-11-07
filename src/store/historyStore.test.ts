import { beforeEach, describe, expect, it } from 'vitest';
import { createSession, endSession, type Ctx } from '../engine';
import { resetHistoryDbForTests } from './historyDb';
import { useHistoryStore } from './historyStore';

let n = 0;
const ctx = (now: number): Ctx => ({ now, rng: () => 0.5, newId: () => `h${++n}` });
const ended = (at: number) => endSession(createSession({ name: 'N', mode: 'fairness', courtCount: 1, players: [] }, ctx(at - 1)), ctx(at));

beforeEach(async () => {
  await resetHistoryDbForTests();
  useHistoryStore.setState({ entries: [], loaded: false, persistent: true });
});

describe('history store', () => {
  it('loads, saves and clears', async () => {
    await useHistoryStore.getState().load();
    expect(useHistoryStore.getState()).toMatchObject({ loaded: true, entries: [] });
    await useHistoryStore.getState().save(ended(1000));
    expect(useHistoryStore.getState().entries).toHaveLength(1);
    await useHistoryStore.getState().clear();
    expect(useHistoryStore.getState().entries).toHaveLength(0);
  });

  it('does not throw for a session that has not ended', async () => {
    const live = createSession({ name: 'N', mode: 'fairness', courtCount: 1, players: [] }, ctx(1));
    await expect(useHistoryStore.getState().save(live)).resolves.toBeUndefined();
    expect(useHistoryStore.getState().entries).toHaveLength(0);
  });
});
