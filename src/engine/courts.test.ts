import { describe, expect, it } from 'vitest';
import { addCourt, removeCourt } from './courts';
import { expectEngineError, makeCtx, newTestSession } from './testing';

describe('addCourt', () => {
  it('numbers the new court after the highest and fills it when players are waiting', () => {
    const s = newTestSession(['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H'], { courts: 1 });
    expect(s.queueOrder).toHaveLength(4);
    const next = addCourt(s, makeCtx(2));
    expect(next.courts.map((c) => c.number)).toEqual([1, 2]);
    expect(next.courts[1].status).toBe('playing');
    expect(next.queueOrder).toHaveLength(0);
  });

  it('leaves the new court empty when nobody is waiting', () => {
    const s = newTestSession(['A', 'B', 'C', 'D'], { courts: 1 });
    const next = addCourt(s, makeCtx(2));
    expect(next.courts[1].status).toBe('empty');
  });
});

describe('removeCourt', () => {
  it('removes an empty court immediately', () => {
    const s = newTestSession(['A', 'B', 'C', 'D'], { courts: 2 });
    const empty = s.courts.find((c) => c.status === 'empty')!;
    const next = removeCourt(s, empty.id);
    expect(next.courts).toHaveLength(1);
  });

  it('marks a court in play as closing, and a second call cancels it', () => {
    const s = newTestSession(['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H'], { courts: 2 });
    const closing = removeCourt(s, s.courts[1].id);
    expect(closing.courts).toHaveLength(2);
    expect(closing.courts[1].closing).toBe(true);
    const reopened = removeCourt(closing, s.courts[1].id);
    expect(reopened.courts[1].closing).toBe(false);
  });

  it('refuses to remove the last open court', () => {
    const s = newTestSession(['A', 'B', 'C', 'D'], { courts: 1 });
    expectEngineError(() => removeCourt(s, s.courts[0].id), 'LAST_COURT');
  });

  it('counts closing courts as not open when protecting the last court', () => {
    const s = newTestSession(['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H'], { courts: 2 });
    const closing = removeCourt(s, s.courts[1].id);
    expectEngineError(() => removeCourt(closing, closing.courts[0].id), 'LAST_COURT');
  });

  it('throws for an unknown court', () => {
    const s = newTestSession(['A'], { courts: 1 });
    expectEngineError(() => removeCourt(s, 'nope'), 'NOT_FOUND');
  });
});
