import { describe, expect, it } from 'vitest';
import { createSession, endSession, extendSession } from './session';
import { expectEngineError, makeCtx, newTestSession } from './testing';

describe('extendSession', () => {
  it('moves the planned end later by the minutes given', () => {
    const s = { ...newTestSession(['A', 'B', 'C', 'D']), plannedEndAt: 5_000_000 };
    const next = extendSession(s, 30, makeCtx(1, 9_000_000));
    expect(next.plannedEndAt).toBe(5_000_000 + 30 * 60_000);
  });

  it('starts from now when the session has no planned end', () => {
    const s = newTestSession(['A', 'B', 'C', 'D']);
    const next = extendSession(s, 15, makeCtx(1, 2_000_000));
    expect(next.plannedEndAt).toBe(2_000_000 + 15 * 60_000);
  });

  it('accepts the limits 1 and 240', () => {
    const s = newTestSession(['A', 'B', 'C', 'D']);
    expect(extendSession(s, 1, makeCtx(1, 0)).plannedEndAt).toBe(60_000);
    expect(extendSession(s, 240, makeCtx(1, 0)).plannedEndAt).toBe(240 * 60_000);
  });

  it('rejects 0, 241, fractions, negatives and non-numbers', () => {
    const s = newTestSession(['A', 'B', 'C', 'D']);
    for (const m of [0, 241, 1.5, -5, NaN, Infinity]) {
      expectEngineError(() => extendSession(s, m, makeCtx()), 'INVALID_EXTENSION');
    }
  });

  it('rejects an ended session', () => {
    const ended = endSession(newTestSession(['A', 'B', 'C', 'D']), makeCtx());
    expectEngineError(() => extendSession(ended, 30, makeCtx()), 'SESSION_ENDED');
  });

  it('checks the ended session before the minutes', () => {
    const ended = endSession(newTestSession(['A', 'B', 'C', 'D']), makeCtx());
    expectEngineError(() => extendSession(ended, 0, makeCtx()), 'SESSION_ENDED');
  });

  it('returns a clone and leaves the original alone', () => {
    const s = { ...newTestSession(['A', 'B', 'C', 'D']), plannedEndAt: 1_000_000 };
    const next = extendSession(s, 15, makeCtx());
    expect(next).not.toBe(s);
    expect(s.plannedEndAt).toBe(1_000_000);
    expect(next.players).toEqual(s.players);
  });
});

describe('createSession venue and planned end', () => {
  const base = { name: 'x', mode: 'fairness' as const, courtCount: 1, players: [] };

  it('copies a trimmed venue and the planned end', () => {
    const s = createSession({ ...base, venue: '  Tacloban Sports Hall ', plannedEndAt: 123 }, makeCtx());
    expect(s.venue).toBe('Tacloban Sports Hall');
    expect(s.plannedEndAt).toBe(123);
  });

  it('omits the fields when not given or empty', () => {
    const s = createSession({ ...base, venue: '   ' }, makeCtx());
    expect('venue' in s).toBe(false);
    expect('plannedEndAt' in s).toBe(false);
  });
});
