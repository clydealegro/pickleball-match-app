import { describe, expect, it } from 'vitest';
import { finishGame } from './game';
import { fairnessLine, formatSummaryText, gameLog, hasResults, sessionStats, summarize } from './summary';
import { idOf, makeCtx, newTestSession } from './testing';
import type { GameResult, Session } from './types';

/** Four players, one court, one game finished with the given result. Ann and Ben are team 1. */
function oneGame(result?: GameResult): Session {
  let s = newTestSession(['Ann', 'Ben', 'Cy', 'Dee'], { courts: 1 });
  const court = s.courts[0];
  // Put the teams in a known order so the expectations can name them.
  court.game = { team1: [idOf(s, 'Ann'), idOf(s, 'Ben')], team2: [idOf(s, 'Cy'), idOf(s, 'Dee')], startedAt: 1_000 };
  s = finishGame(s, court.id, makeCtx(1, 61_000), result);
  return s;
}
const row = (s: Session, name: string) => summarize(s).find((r) => r.name === name)!;

describe('records in the summary', () => {
  it('counts a win for the winners and a loss for the others', () => {
    const s = oneGame({ winner: 1, score: [11, 4] });
    expect(row(s, 'Ann')).toMatchObject({ wins: 1, losses: 0 });
    expect(row(s, 'Ben')).toMatchObject({ wins: 1, losses: 0 });
    expect(row(s, 'Cy')).toMatchObject({ wins: 0, losses: 1 });
    expect(row(s, 'Dee')).toMatchObject({ wins: 0, losses: 1 });
  });

  it('counts a winner recorded without a score, and ignores a skipped result', () => {
    expect(row(oneGame({ winner: 2 }), 'Cy')).toMatchObject({ wins: 1, losses: 0 });
    const skipped = oneGame();
    expect(row(skipped, 'Ann')).toMatchObject({ wins: 0, losses: 0 });
    expect(hasResults(skipped)).toBe(false);
    expect(hasResults(oneGame({ winner: 1 }))).toBe(true);
  });

  it('gives each partner pair its own record, both ways round', () => {
    const s = oneGame({ winner: 1, score: [11, 4] });
    expect(row(s, 'Ann').partners).toEqual([{ name: 'Ben', count: 1, wins: 1, losses: 0 }]);
    expect(row(s, 'Ben').partners).toEqual([{ name: 'Ann', count: 1, wins: 1, losses: 0 }]);
    expect(row(s, 'Cy').partners).toEqual([{ name: 'Dee', count: 1, wins: 0, losses: 1 }]);
  });

  it('gives a partner with no recorded result a record of nothing', () => {
    expect(row(oneGame(), 'Ann').partners).toEqual([{ name: 'Ben', count: 1, wins: 0, losses: 0 }]);
  });

  it('adds up over several games with different partners', () => {
    let s = newTestSession(['Ann', 'Ben', 'Cy', 'Dee'], { courts: 1 });
    const ids = ['Ann', 'Ben', 'Cy', 'Dee'].map((n) => idOf(s, n));
    const game = (t1: [number, number], t2: [number, number], winner: 1 | 2, at: number) => {
      s.courts[0].game = { team1: [ids[t1[0]], ids[t1[1]]], team2: [ids[t2[0]], ids[t2[1]]], startedAt: at };
      s = finishGame(s, s.courts[0].id, makeCtx(1, at + 600_000), { winner, score: winner === 1 ? [11, 5] : [5, 11] });
    };
    game([0, 1], [2, 3], 1, 1_000); // Ann and Ben beat Cy and Dee
    game([0, 2], [1, 3], 1, 700_000); // Ann and Cy beat Ben and Dee
    game([0, 3], [1, 2], 2, 1_400_000); // Ben and Cy beat Ann and Dee
    expect(row(s, 'Ann')).toMatchObject({ wins: 2, losses: 1 });
    expect(row(s, 'Dee')).toMatchObject({ wins: 0, losses: 3 });
    expect(row(s, 'Ann').partners.find((p) => p.name === 'Ben')).toMatchObject({ wins: 1, losses: 0 });
    expect(row(s, 'Ann').partners.find((p) => p.name === 'Dee')).toMatchObject({ wins: 0, losses: 1 });
  });

  it('leaves the games, partner and opponent counts as they were', () => {
    const a = row(oneGame(), 'Ann');
    const b = row(oneGame({ winner: 1, score: [11, 2] }), 'Ann');
    expect(b.gamesPlayed).toBe(a.gamesPlayed);
    expect(b.opponents).toEqual(a.opponents);
    expect(fairnessLine(sessionStats(oneGame({ winner: 1 })))).toBe(fairnessLine(sessionStats(oneGame())));
  });
});

describe('the game log', () => {
  it('carries the winner and the score when there are some, and nothing when there are not', () => {
    expect(gameLog(oneGame({ winner: 2, score: [6, 11] }))[0]).toMatchObject({ winner: 2, score: [6, 11] });
    const plain = gameLog(oneGame())[0];
    expect(plain).not.toHaveProperty('winner');
    expect(plain).not.toHaveProperty('score');
  });
});

describe('the shared text', () => {
  it('leaves results out unless asked', () => {
    const text = formatSummaryText(oneGame({ winner: 1, score: [11, 4] }));
    expect(text).toContain('Ann: 1');
    expect(text).not.toMatch(/\dW|\dL/);
  });

  it('adds each player’s record when asked, and only for players who have one', () => {
    const text = formatSummaryText(oneGame({ winner: 1, score: [11, 4] }), 0, { results: true });
    expect(text).toContain('Ann: 1 · 1W 0L');
    expect(text).toContain('Cy: 1 · 0W 1L');
    const skipped = formatSummaryText(oneGame(), 0, { results: true });
    expect(skipped).toContain('Ann: 1');
    expect(skipped).not.toMatch(/\dW|\dL/);
  });
});
