import { describe, expect, it } from 'vitest';
import { finishGame } from '../engine/game';
import { makeCtx, mkPlayer, mkSession, newTestSession } from '../engine/testing';
import { finishMessage } from './finishMessage';

const idle = { id: 'c1', number: 1, status: 'empty' as const, closing: false };

describe('finishMessage', () => {
  it('names the new lineup on the court that just finished', () => {
    const ctx = makeCtx();
    let s = newTestSession(['Ann', 'Ben', 'Cy', 'Dee', 'Eve'], { courts: 1 }, ctx);
    s = finishGame(s, s.courts[0].id, ctx);
    const text = finishMessage(s, 1);
    expect(text).toMatch(/^Court 1: \w+ and \w+ vs \w+ and \w+$/);
    const named = text.match(/\b(Ann|Ben|Cy|Dee|Eve)\b/g)!;
    expect(new Set(named).size).toBe(4);
    for (const n of named) expect(s.players.find((p) => p.name === n)).toBeTruthy();
  });

  it('says how many more players a game needs when none can start', () => {
    const two = mkSession([mkPlayer('a'), mkPlayer('b')], { courts: [idle] });
    expect(finishMessage(two, 1)).toBe('Court 1 finished. Waiting for 2 more players.');
    const three = mkSession([mkPlayer('a'), mkPlayer('b'), mkPlayer('c')], { courts: [idle] });
    expect(finishMessage(three, 1)).toBe('Court 1 finished. Waiting for 1 more player.');
  });

  it('is brief when nothing is missing, and says when the court closed', () => {
    const four = mkSession([mkPlayer('a'), mkPlayer('b'), mkPlayer('c'), mkPlayer('d')], { courts: [idle] });
    expect(finishMessage(four, 1)).toBe('Court 1 finished.');
    expect(finishMessage(four, 7)).toBe('Court 7 closed.');
  });
});
