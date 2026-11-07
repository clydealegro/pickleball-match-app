import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createSession, endSession, type Ctx, type Session } from '../engine';
import {
  HISTORY_LIMIT,
  clearHistory,
  isHistoryPersistent,
  listHistory,
  resetHistoryDbForTests,
  saveSessionToHistory,
} from './historyDb';

let n = 0;
const ctx = (now: number): Ctx => ({ now, newId: () => `id${++n}`, rng: () => 0.5 });

function finished(endedAt: number, name = 'Night'): Session {
  const s = createSession({ name, mode: 'fairness', courtCount: 1, players: [] }, ctx(endedAt - 1000));
  return endSession(s, ctx(endedAt));
}

beforeEach(async () => {
  await resetHistoryDbForTests();
});

describe('history db', () => {
  it('keeps a finished session and lists it back whole', async () => {
    const s = finished(5000);
    expect(await saveSessionToHistory(s)).toBe(true);
    const [entry] = await listHistory();
    expect(entry).toMatchObject({ id: s.id, name: 'Night', endedAt: 5000, games: 0 });
    expect(entry.session).toEqual(s);
  });

  it('lists newest first', async () => {
    await saveSessionToHistory(finished(1000, 'old'));
    await saveSessionToHistory(finished(3000, 'new'));
    await saveSessionToHistory(finished(2000, 'mid'));
    expect((await listHistory()).map((e) => e.name)).toEqual(['new', 'mid', 'old']);
  });

  it('saving the same session twice keeps one copy', async () => {
    const s = finished(1000);
    await saveSessionToHistory(s);
    await saveSessionToHistory(s);
    expect(await listHistory()).toHaveLength(1);
  });

  it('refuses a session that has not ended', async () => {
    const live = createSession({ name: 'x', mode: 'fairness', courtCount: 1, players: [] }, ctx(1));
    await expect(saveSessionToHistory(live)).rejects.toThrow(/finished/i);
    expect(await listHistory()).toHaveLength(0);
  });

  it('drops the oldest sessions past the limit', async () => {
    for (let i = 1; i <= HISTORY_LIMIT + 3; i++) await saveSessionToHistory(finished(i * 1000, `s${i}`));
    const list = await listHistory();
    expect(list).toHaveLength(HISTORY_LIMIT);
    expect(list[0].name).toBe(`s${HISTORY_LIMIT + 3}`);
    expect(list.at(-1)!.name).toBe('s4');
  });

  it('keeps every session when saves overlap', async () => {
    await Promise.all([1, 2, 3, 4, 5].map((i) => saveSessionToHistory(finished(i * 1000, `s${i}`))));
    expect(await listHistory()).toHaveLength(5);
  });

  it('clears everything', async () => {
    await saveSessionToHistory(finished(1000));
    await clearHistory();
    expect(await listHistory()).toEqual([]);
  });

  it('is persistent while IndexedDB works', async () => {
    await saveSessionToHistory(finished(1000));
    expect(isHistoryPersistent()).toBe(true);
  });
});

describe('history db without storage', () => {
  it('falls back to memory, still lists, and says it was not kept', async () => {
    vi.resetModules();
    vi.doMock('idb', async (orig) => ({ ...(await orig<typeof import('idb')>()), openDB: vi.fn().mockRejectedValue(new Error('blocked')) }));
    const fresh = await import('./historyDb');
    const { createSession: cs, endSession: es } = await import('../engine');
    const s = es(cs({ name: 'Mem', mode: 'fairness', courtCount: 1, players: [] }, ctx(1)), ctx(2));
    expect(await fresh.saveSessionToHistory(s)).toBe(false);
    expect((await fresh.listHistory()).map((e) => e.name)).toEqual(['Mem']);
    expect(fresh.isHistoryPersistent()).toBe(false);
    vi.doUnmock('idb');
    vi.resetModules();
  });
});
