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
});
