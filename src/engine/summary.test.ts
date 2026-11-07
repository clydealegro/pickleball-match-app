import { describe, expect, it } from 'vitest';
import { finishGame } from './game';
import { fairnessLine, formatDuration, formatSummaryText, gameLog, sessionStats, summarize } from './summary';
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
    expect(text).toContain('Ann: 1');
    expect(text).not.toContain('partner');
    expect(text.split('\n')).toHaveLength(3 + 4);
  });

  it('adds the playing time to the share text once a game is done', () => {
    const ctx = makeCtx(1, Date.UTC(2026, 10, 6));
    let s = newTestSession(['Ann', 'Ben', 'Cy', 'Dee'], { courts: 1 }, ctx);
    s = finishGame(s, s.courts[0].id, { ...ctx, now: ctx.now + 25 * 60_000 });
    expect(formatSummaryText(s).split('\n')[1]).toBe('1 game played · 25m');
  });

  it('uses the local date when a timezone offset is given', () => {
    const ctx = makeCtx(1, Date.UTC(2026, 10, 7, 3, 0));
    const s = newTestSession(['Ann', 'Ben', 'Cy', 'Dee'], { courts: 1 }, ctx);
    expect(formatSummaryText(s).startsWith('Test — 2026-11-07')).toBe(true);
    expect(formatSummaryText(s, -480).startsWith('Test — 2026-11-06')).toBe(true);
  });
});

describe('session facts', () => {
  function played() {
    const ctx = makeCtx(1, 1_000_000);
    let s = newTestSession(['Ann', 'Ben', 'Cy', 'Dee', 'Eve'], { courts: 1 }, ctx);
    s = finishGame(s, s.courts[0].id, { ...ctx, now: ctx.now + 10 * 60_000 });
    return s;
  }

  it('counts games, players, playing time and the spread of games', () => {
    const stats = sessionStats(played());
    expect(stats).toMatchObject({ games: 1, players: 5, playingMs: 10 * 60_000, averageGameMs: 10 * 60_000, minGames: 0, maxGames: 1 });
  });

  it('is all zeros before any game', () => {
    const s = newTestSession(['Ann', 'Ben', 'Cy', 'Dee'], { courts: 1 }, makeCtx());
    expect(sessionStats(s)).toMatchObject({ games: 0, playingMs: 0, averageGameMs: 0 });
    expect(fairnessLine(sessionStats(s))).toBe('');
  });

  it('describes how evenly games were shared', () => {
    const base = { games: 3, players: 4, playingMs: 0, averageGameMs: 0 };
    expect(fairnessLine({ ...base, minGames: 3, maxGames: 3 })).toBe('Everyone played 3 games');
    expect(fairnessLine({ ...base, minGames: 1, maxGames: 1 })).toBe('Everyone played 1 game');
    expect(fairnessLine({ ...base, minGames: 2, maxGames: 4 })).toBe('Games per player: 2 to 4');
  });

  it('lists opponents as well as partners', () => {
    const rows = summarize(played());
    const row = rows.find((r) => r.gamesPlayed === 1)!;
    expect(row.partners).toHaveLength(1);
    expect(row.opponents).toHaveLength(2);
  });

  it('writes the game log with names, court and length', () => {
    const log = gameLog(played());
    expect(log).toHaveLength(1);
    expect(log[0]).toMatchObject({ courtNumber: 1, durationMs: 10 * 60_000 });
    expect(log[0].team1).toHaveLength(2);
    expect(log[0].team2).toHaveLength(2);
    expect([...log[0].team1, ...log[0].team2].every((n) => n !== 'Unknown')).toBe(true);
  });

  it('formats durations', () => {
    expect(formatDuration(10_000)).toBe('under 1m');
    expect(formatDuration(45 * 60_000)).toBe('45m');
    expect(formatDuration(60 * 60_000)).toBe('1h');
    expect(formatDuration(85 * 60_000)).toBe('1h 25m');
  });
});
