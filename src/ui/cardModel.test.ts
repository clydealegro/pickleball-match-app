import { describe, expect, it } from 'vitest';
import { finishGame } from '../engine/game';
import { makeCtx, mkPlayer, mkSession, newTestSession } from '../engine/testing';
import { MAX_CARD_PLAYERS, buildCardModel, gridColumns, paletteFor } from './cardModel';

function played() {
  const ctx = makeCtx(1, new Date(2026, 10, 4, 18).getTime());
  let s = newTestSession(['Ann', 'Ben', 'Cy', 'Dee', 'Eve'], { courts: 1 }, ctx);
  for (let i = 1; i <= 3; i++) s = finishGame(s, s.courts[0].id, { ...ctx, now: ctx.now + i * 20 * 60_000 });
  return { ...s, name: 'Wednesday open play', endedAt: ctx.now + 99 };
}

describe('buildCardModel', () => {
  it('carries the name, the day, the facts and the highlights', () => {
    const m = buildCardModel(played(), { results: false, theme: 'light' });
    expect(m.title).toBe('Wednesday open play');
    expect(m.date).toBe('Wed 4 Nov');
    expect(m.facts).toBe('3 games · 1h');
    expect(m.lines.length).toBeGreaterThan(0);
  });

  it('lists every player, most games first, with their games', () => {
    const s = played();
    const m = buildCardModel(s, { results: false, theme: 'light' });
    expect(m.players).toHaveLength(5);
    expect(m.players[0].games).toBeGreaterThanOrEqual(m.players[4].games);
    expect(m.more).toBe(0);
    expect(m.players.every((p) => p.record === undefined)).toBe(true);
  });

  it('keeps win records off unless results are switched on', () => {
    const s = played();
    const withWins = { ...s, history: s.history.map((g) => ({ ...g, winner: 1 as const })) };
    const off = buildCardModel(withWins, { results: false, theme: 'light' });
    expect(off.players.every((p) => p.record === undefined)).toBe(true);
    expect(off.lines.some((l) => l.startsWith('Unbeaten'))).toBe(false);
    const on = buildCardModel(withWins, { results: true, theme: 'light' });
    expect(on.players.some((p) => /^\d+W \d+L$/.test(p.record ?? ''))).toBe(true);
  });

  it('shows a player who did not play with 0 games, and carries the photo link', () => {
    const s = mkSession([mkPlayer('Ann', { name: 'Ann', rosterId: 'r1', gamesPlayed: 0 })]);
    const m = buildCardModel(s, { results: false, theme: 'light' });
    expect(m.players).toEqual([{ name: 'Ann', games: 0, rosterId: 'r1' }]);
  });

  it('caps the grid and counts the rest', () => {
    const many = mkSession(Array.from({ length: MAX_CARD_PLAYERS + 4 }, (_, i) => mkPlayer(`p${i}`, { name: `P${String(i).padStart(2, '0')}` })));
    const m = buildCardModel(many, { results: false, theme: 'light' });
    expect(m.players).toHaveLength(MAX_CARD_PLAYERS);
    expect(m.more).toBe(4);
  });
});

describe('gridColumns', () => {
  it('uses more columns as the group grows', () => {
    expect([1, 6, 7, 12, 13, 20, 21, 30].map(gridColumns)).toEqual([3, 3, 4, 4, 5, 5, 6, 6]);
  });
});

describe('paletteFor', () => {
  it('follows the theme and treats anything unknown as light', () => {
    expect(paletteFor('dark').bg).toBe('#0f0f0e');
    expect(paletteFor('light').bg).toBe('#fafaf7');
    expect(paletteFor(undefined).bg).toBe('#fafaf7');
    expect(paletteFor('sunlight').bg).toBe('#fafaf7');
  });
});
