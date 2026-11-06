import { beforeEach, describe, expect, it } from 'vitest';
import * as engine from '../engine';
import { MAX_UNDO, useSessionStore } from './sessionStore';
import { STORAGE_KEY } from './persistence';

const players = ['Ann', 'Ben', 'Cy', 'Dee', 'Eve'].map((name) => ({ name }));

beforeEach(() => {
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
});
