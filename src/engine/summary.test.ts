import { describe, expect, it } from 'vitest';
import { finishGame } from './game';
import { formatSummaryText, summarize } from './summary';
import { makeCtx, newTestSession } from './testing';

describe('summarize', () => {
  it('lists games played and partners, most games first', () => {
    const ctx = makeCtx();
    let s = newTestSession(['Ann', 'Ben', 'Cy', 'Dee', 'Eve'], { courts: 1 }, ctx);
    s = finishGame(s, s.courts[0].id, { ...ctx, now: 2_000 });
    const rows = summarize(s);
    expect(rows).toHaveLength(5);
    expect(rows[0].gamesPlayed).toBeGreaterThanOrEqual(rows[4].gamesPlayed);
    const played = rows.filter((r) => r.gamesPlayed === 1);
    expect(played.length).toBeGreaterThanOrEqual(4);
    for (const row of played.filter((r) => r.partners.length > 0)) {
      expect(row.partners[0].count).toBe(1);
    }
  });

  it('formats a plain-text report', () => {
    const ctx = makeCtx(1, Date.UTC(2026, 10, 6));
    let s = newTestSession(['Ann', 'Ben', 'Cy', 'Dee'], { courts: 1 }, ctx);
    s = finishGame(s, s.courts[0].id, ctx);
    const text = formatSummaryText(s);
    expect(text.startsWith('Test — 2026-11-06')).toBe(true);
    expect(text).toContain('1 game played');
    expect(text).toContain('Ann: 1 game');
    expect(text).toContain('partner');
  });

  it('uses the local date when a timezone offset is given', () => {
    const ctx = makeCtx(1, Date.UTC(2026, 10, 7, 3, 0));
    const s = newTestSession(['Ann', 'Ben', 'Cy', 'Dee'], { courts: 1 }, ctx);
    expect(formatSummaryText(s).startsWith('Test — 2026-11-07')).toBe(true);
    expect(formatSummaryText(s, -480).startsWith('Test — 2026-11-06')).toBe(true);
  });
});
