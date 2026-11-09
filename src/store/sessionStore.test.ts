import { beforeEach, describe, expect, it, vi } from 'vitest';
import * as engine from '../engine';
import { MAX_UNDO, setSessionWritesBlocked, useSessionStore } from './sessionStore';
import { savePersisted, STORAGE_KEY } from './persistence';

const players = ['Ann', 'Ben', 'Cy', 'Dee', 'Eve'].map((name) => ({ name }));

beforeEach(() => {
  setSessionWritesBlocked(false);
  localStorage.clear();
  useSessionStore.setState({ session: null, undoStack: [], saveFailed: false });
});

function start() {
  const res = useSessionStore.getState().start({ name: 'Open play', mode: 'fairness', courtCount: 1, players });
  expect(res.ok).toBe(true);
}

describe('sessionStore', () => {
  it('starts a session and persists it', () => {
    start();
    const { session, undoStack } = useSessionStore.getState();
    expect(session?.name).toBe('Open play');
    expect(session?.courts[0].status).toBe('playing');
    expect(undoStack).toHaveLength(0);
    expect(JSON.parse(localStorage.getItem(STORAGE_KEY)!).session.name).toBe('Open play');
  });

  it('applies an action and can undo it', () => {
    start();
    const before = useSessionStore.getState().session!;
    const courtId = before.courts[0].id;
    const res = useSessionStore.getState().apply((s, ctx) => engine.finishGame(s, courtId, ctx));
    expect(res.ok).toBe(true);
    expect(useSessionStore.getState().session!.history).toHaveLength(1);
    expect(useSessionStore.getState().undoStack).toHaveLength(1);

    useSessionStore.getState().undo();
    expect(useSessionStore.getState().session).toEqual(before);
    expect(useSessionStore.getState().undoStack).toHaveLength(0);
  });

  it('returns an error and leaves state unchanged when the engine rejects an action', () => {
    start();
    const before = useSessionStore.getState().session!;
    const res = useSessionStore
      .getState()
      .apply((s, ctx) => engine.addPlayer(s, { name: 'ann' }, ctx));
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toMatch(/already/i);
    expect(useSessionStore.getState().session).toEqual(before);
    expect(useSessionStore.getState().undoStack).toHaveLength(0);
  });

  it('bounds the undo stack', () => {
    start();
    for (let i = 0; i < MAX_UNDO + 10; i++) {
      useSessionStore.getState().apply((s) => ({ ...s, name: `${s.name}.` }));
    }
    expect(useSessionStore.getState().undoStack).toHaveLength(MAX_UNDO);
  });

  it('undo does nothing when there is nothing to undo', () => {
    start();
    useSessionStore.getState().undo();
    expect(useSessionStore.getState().session).not.toBeNull();
  });

  it('reset clears the session and storage', () => {
    start();
    useSessionStore.getState().reset();
    expect(useSessionStore.getState().session).toBeNull();
    expect(JSON.parse(localStorage.getItem(STORAGE_KEY)!).session).toBeNull();
  });

  it('flags a failed save but keeps working in memory', () => {
    const original = Storage.prototype.setItem;
    Storage.prototype.setItem = () => {
      throw new Error('quota');
    };
    try {
      start();
      expect(useSessionStore.getState().saveFailed).toBe(true);
      expect(useSessionStore.getState().session).not.toBeNull();
    } finally {
      Storage.prototype.setItem = original;
    }
  });

  it('turns an unexpected (non-engine) error into a generic failure, logs it, and leaves state unchanged', () => {
    start();
    const { session, undoStack } = useSessionStore.getState();
    const logged = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      const res = useSessionStore.getState().apply(() => {
        throw new TypeError('boom');
      });
      expect(res).toEqual({ ok: false, error: 'Something went wrong. Try again, or undo the last action.' });
      expect(useSessionStore.getState().session).toBe(session);
      expect(useSessionStore.getState().undoStack).toBe(undoStack);
      expect(logged).toHaveBeenCalledTimes(1);
      expect(logged.mock.calls[0][0]).toBeInstanceOf(TypeError);
    } finally {
      logged.mockRestore();
    }
  });

  it('restores the session and undo stack from storage when the app reloads', async () => {
    start();
    const prev = useSessionStore.getState().session!;
    const courtId = prev.courts[0].id;
    useSessionStore.getState().apply((s, ctx) => engine.finishGame(s, courtId, ctx));
    const { session, undoStack } = useSessionStore.getState();
    expect(undoStack).toEqual([prev]);
    localStorage.clear();
    expect(savePersisted({ session, undoStack })).toBe(true);

    vi.resetModules();
    const fresh = await import('./sessionStore');
    expect(fresh.useSessionStore).not.toBe(useSessionStore);
    expect(fresh.useSessionStore.getState().session).toEqual(session);
    expect(fresh.useSessionStore.getState().undoStack).toEqual([prev]);
  });
});

describe('what the last action was', () => {
  const noop = (s: ReturnType<typeof useSessionStore.getState>['session']) => s!;

  it('is remembered with the action, and is empty for an action with no label', () => {
    start();
    expect(useSessionStore.getState().lastAction).toBeNull();
    useSessionStore.getState().apply((s) => noop(s), 'Game finished on Court 1');
    const last = useSessionStore.getState().lastAction!;
    expect(last.label).toBe('Game finished on Court 1');
    expect(last.at).toBeGreaterThan(0);
    useSessionStore.getState().apply((s) => noop(s));
    expect(useSessionStore.getState().lastAction).toBeNull();
  });

  it('gets a new id for every labelled action, even in the same millisecond', () => {
    start();
    const { apply } = useSessionStore.getState();
    apply((s) => noop(s), 'one');
    const first = useSessionStore.getState().lastAction!.id;
    apply((s) => noop(s), 'two');
    expect(useSessionStore.getState().lastAction!.id).toBeGreaterThan(first);
  });

  it('is cleared by Undo, a new session and a reset, and not set when the action fails', () => {
    start();
    const { apply, undo, reset } = useSessionStore.getState();
    apply((s) => noop(s), 'something');
    undo();
    expect(useSessionStore.getState().lastAction).toBeNull();
    apply((s) => noop(s), 'something');
    reset();
    expect(useSessionStore.getState().lastAction).toBeNull();
    start();
    apply((s) => noop(s), 'something');
    const failed = apply(() => {
      throw new engine.EngineError('NOT_FOUND', 'nope');
    }, 'will not happen');
    expect(failed.ok).toBe(false);
    expect(useSessionStore.getState().lastAction!.label).toBe('something');
  });

  it('is not saved with the session, so it is gone after a reload', () => {
    start();
    useSessionStore.getState().apply((s) => noop(s), 'something');
    expect(localStorage.getItem(STORAGE_KEY)!).not.toContain('something');
  });
});

it('blocks every session mutation after another window writes', () => {
  start();
  useSessionStore.getState().apply(s => ({ ...s, name: 'Updated' }));
  const before = useSessionStore.getState();
  const saved = localStorage.getItem(STORAGE_KEY);
  setSessionWritesBlocked(true);
  expect(before.apply(s => ({ ...s, name: 'Stale' })).ok).toBe(false);
  expect(before.start({ name: 'Replacement', mode: 'fairness', courtCount: 1, players }).ok).toBe(false);
  before.undo();
  before.reset();
  expect(useSessionStore.getState().session).toBe(before.session);
  expect(localStorage.getItem(STORAGE_KEY)).toBe(saved);
  setSessionWritesBlocked(false);
});

it('purges the current session and undo even when ordinary writes are blocked', () => {
  start();
  useSessionStore.getState().apply(s => ({ ...s, name: 'Changed' }));
  setSessionWritesBlocked(true);
  expect(useSessionStore.getState().purge()).toBe(true);
  expect(useSessionStore.getState()).toMatchObject({ session: null, undoStack: [], lastAction: null });
  expect(JSON.parse(localStorage.getItem(STORAGE_KEY)!)).toMatchObject({ session: null, undoStack: [] });
  setSessionWritesBlocked(false);
});
