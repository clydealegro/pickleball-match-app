import { beforeEach, describe, expect, it } from 'vitest';
import { makeCtx, newTestSession } from '../engine/testing';
import { clearPersisted, loadPersisted, savePersisted, STORAGE_KEY } from './persistence';

beforeEach(() => localStorage.clear());

describe('persistence', () => {
  it('round-trips a session and its undo stack', () => {
    const s = newTestSession(['A', 'B', 'C', 'D'], { courts: 1 }, makeCtx());
    expect(savePersisted({ session: s, undoStack: [s] })).toBe(true);
    const loaded = loadPersisted();
    expect(loaded?.session).toEqual(s);
    expect(loaded?.undoStack).toEqual([s]);
  });

  it('returns null when nothing is stored', () => {
    expect(loadPersisted()).toBeNull();
  });

  it('returns null (and does not throw) for corrupt JSON', () => {
    localStorage.setItem(STORAGE_KEY, '{not json');
    expect(loadPersisted()).toBeNull();
  });

  it('returns null for the wrong version or shape', () => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ version: 99, session: null, undoStack: [] }));
    expect(loadPersisted()).toBeNull();
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({ version: 1, session: { id: 1 }, undoStack: [] }),
    );
    expect(loadPersisted()).toBeNull();
  });

  it('returns null when stored courts or players have the wrong shape', () => {
    const s = newTestSession(['A', 'B', 'C', 'D'], { courts: 1 }, makeCtx());
    const store = (session: unknown) =>
      localStorage.setItem(STORAGE_KEY, JSON.stringify({ version: 1, session, undoStack: [] }));
    store({ ...s, courts: [null] });
    expect(loadPersisted()).toBeNull();
    const { name: _name, ...nameless } = s.players[0];
    store({ ...s, players: [nameless, ...s.players.slice(1)] });
    expect(loadPersisted()).toBeNull();
    store(s);
    expect(loadPersisted()?.session).toEqual(s);
  });

  it('returns null when a player lacks its counters or a playing court lacks its game', () => {
    const s = newTestSession(['A', 'B', 'C', 'D'], { courts: 1 }, makeCtx());
    expect(s.courts[0].status).toBe('playing');
    const store = (session: unknown) =>
      localStorage.setItem(STORAGE_KEY, JSON.stringify({ version: 1, session, undoStack: [] }));
    const { partnerCounts: _p, ...noCounts } = s.players[0];
    store({ ...s, players: [noCounts, ...s.players.slice(1)] });
    expect(loadPersisted()).toBeNull();
    const { game: _g, ...noGame } = s.courts[0];
    store({ ...s, courts: [noGame] });
    expect(loadPersisted()).toBeNull();
    store(s);
    expect(loadPersisted()?.session).toEqual(s);
  });

  it('clears the stored session', () => {
    savePersisted({ session: null, undoStack: [] });
    clearPersisted();
    expect(localStorage.getItem(STORAGE_KEY)).toBeNull();
  });

  it('reports failure instead of throwing when storage is unavailable', () => {
    const original = Storage.prototype.setItem;
    Storage.prototype.setItem = () => {
      throw new Error('quota');
    };
    try {
      expect(savePersisted({ session: null, undoStack: [] })).toBe(false);
    } finally {
      Storage.prototype.setItem = original;
    }
  });

  it('retries with a short undo stack when the first write hits the quota', () => {
    const s = newTestSession(['A', 'B', 'C', 'D'], { courts: 1 }, makeCtx());
    const original = Storage.prototype.setItem;
    let calls = 0;
    Storage.prototype.setItem = function (this: Storage, key: string, value: string) {
      if (calls++ === 0) throw new Error('quota');
      return original.call(this, key, value);
    };
    try {
      expect(savePersisted({ session: s, undoStack: Array.from({ length: 20 }, () => s) })).toBe(true);
    } finally {
      Storage.prototype.setItem = original;
    }
    expect(calls).toBe(2);
    expect(JSON.parse(localStorage.getItem(STORAGE_KEY)!).undoStack.length).toBeLessThanOrEqual(5);
  });
});

describe('a session with a Ready court', () => {
  function ready() {
    const s = newTestSession(['A', 'B', 'C', 'D', 'E'], { courts: 1, autoStart: false });
    expect(s.courts[0].status).toBe('ready');
    return s;
  }

  it('survives a reload with its lineup, and keeps the setting', () => {
    const s = ready();
    expect(savePersisted({ session: s, undoStack: [] })).toBe(true);
    const loaded = loadPersisted();
    expect(loaded?.session).toEqual(s);
    expect(loaded?.session?.autoStart).toBe(false);
  });

  it('is kept in the undo stack too', () => {
    const s = ready();
    savePersisted({ session: s, undoStack: [s] });
    expect(loadPersisted()?.undoStack).toHaveLength(1);
  });

  it('is rejected when the Ready court has no valid lineup', () => {
    const s = ready();
    const broken = JSON.parse(JSON.stringify(s));
    delete broken.courts[0].lineup;
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ version: 1, session: broken, undoStack: [] }));
    expect(loadPersisted()).toBeNull();
    broken.courts[0].lineup = { team1: ['a'], team2: ['b', 'c'] };
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ version: 1, session: broken, undoStack: [] }));
    expect(loadPersisted()).toBeNull();
  });

  it('still rejects a court with an unknown status', () => {
    const s = ready();
    const broken = JSON.parse(JSON.stringify(s));
    broken.courts[0].status = 'paused';
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ version: 1, session: broken, undoStack: [] }));
    expect(loadPersisted()).toBeNull();
  });
});

describe('a session with recorded results', () => {
  function played() {
    const s = newTestSession(['A', 'B', 'C', 'D'], { courts: 1 }, makeCtx());
    s.history.push({ team1: ['a', 'b'], team2: ['c', 'd'], courtNumber: 1, startedAt: 1, finishedAt: 2, winner: 1, score: [11, 7] });
    s.history.push({ team1: ['a', 'b'], team2: ['c', 'd'], courtNumber: 1, startedAt: 3, finishedAt: 4 });
    return s;
  }

  it('survives a reload with its winners and scores, and games without a result', () => {
    const s = played();
    savePersisted({ session: s, undoStack: [] });
    expect(loadPersisted()?.session).toEqual(s);
  });

  it('is rejected when a winner or a score is malformed', () => {
    for (const change of [
      (g: Record<string, unknown>) => (g.winner = 3),
      (g: Record<string, unknown>) => (g.winner = 'one'),
      (g: Record<string, unknown>) => (g.score = [11]),
      (g: Record<string, unknown>) => (g.score = [11, 'x']),
      (g: Record<string, unknown>) => (g.score = 'eleven to seven'),
    ]) {
      const broken = JSON.parse(JSON.stringify(played()));
      change(broken.history[0]);
      localStorage.setItem(STORAGE_KEY, JSON.stringify({ version: 1, session: broken, undoStack: [] }));
      expect(loadPersisted()).toBeNull();
    }
  });
});
