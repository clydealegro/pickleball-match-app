import { describe, expect, it } from 'vitest';
import { newTestSession } from '../engine/testing';
import { swapLabel } from './swapLabel';

describe('swapLabel', () => {
  const make = () => {
    const s = newTestSession(['Ann', 'Ben', 'Cy', 'Dee', 'Eve', 'Fay', 'Gus', 'Hal', 'Ivy', 'Jon'], { courts: 2, autoStart: false });
    const onCourt1 = s.courts[0].lineup!.team1[0];
    const onCourt2 = s.courts[1].lineup!.team2[1];
    const waiting = s.queueOrder[0];
    const name = (id: string) => s.players.find((p) => p.id === id)!.name;
    return { s, onCourt1, onCourt2, waiting, name };
  };

  it('says who stepped in for whom, on which court, whichever way round they are named', () => {
    const { s, onCourt1, waiting, name } = make();
    const text = `${name(waiting)} swapped in for ${name(onCourt1)} on Court 1`;
    expect(swapLabel(s, waiting, onCourt1)).toBe(text);
    expect(swapLabel(s, onCourt1, waiting)).toBe(text);
  });

  it('says two court players swapped places', () => {
    const { s, onCourt1, onCourt2, name } = make();
    expect(swapLabel(s, onCourt1, onCourt2)).toBe(`${name(onCourt1)} and ${name(onCourt2)} swapped places`);
  });

  it('names the court the player taken off was on', () => {
    const { s, onCourt2, waiting, name } = make();
    expect(swapLabel(s, waiting, onCourt2)).toBe(`${name(waiting)} swapped in for ${name(onCourt2)} on Court 2`);
  });
});
