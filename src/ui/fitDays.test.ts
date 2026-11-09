import { describe, expect, it } from 'vitest';
import { fitDays, MAX_FIT } from './fitDays';

/** A track of cards. Each card's content bottom is a function of the fit step, as the stylesheet would make it. */
function build(cards: { bottomAt: (step: number) => number; cardBottom: number }[]) {
  const track = document.createElement('div');
  for (const spec of cards) {
    const card = document.createElement('section');
    card.className = 'home-hero';
    card.style.paddingBottom = '0px';
    card.getBoundingClientRect = () => ({ bottom: spec.cardBottom }) as DOMRect;
    const content = document.createElement('div');
    content.getBoundingClientRect = () => ({ bottom: spec.bottomAt(Number(track.dataset.fit)) }) as DOMRect;
    card.append(content);
    track.append(card);
  }
  return track;
}

describe('fitDays', () => {
  it('stays at the full-size card when nothing is clipped', () => {
    const track = build([{ bottomAt: () => 300, cardBottom: 400 }]);
    expect(fitDays(track)).toBe(0);
    expect(track.dataset.fit).toBe('0');
  });

  it('takes the smallest step at which the content fits', () => {
    const track = build([{ bottomAt: (step) => 500 - step * 50, cardBottom: 400 }]);
    expect(fitDays(track)).toBe(2);
    expect(track.dataset.fit).toBe('2');
  });

  it('gives every card the step the most crowded one needs', () => {
    const track = build([
      { bottomAt: () => 300, cardBottom: 400 },
      { bottomAt: (step) => 450 - step * 50, cardBottom: 400 },
    ]);
    expect(fitDays(track)).toBe(1);
  });

  it('stops at the last step when even that does not fit', () => {
    const track = build([{ bottomAt: () => 900, cardBottom: 400 }]);
    expect(fitDays(track)).toBe(MAX_FIT);
    expect(track.dataset.fit).toBe(String(MAX_FIT));
  });

  it('allows a pixel of rounding, and keeps the card padding clear', () => {
    const track = build([{ bottomAt: () => 401, cardBottom: 400 }]);
    expect(fitDays(track)).toBe(0);
    const padded = build([{ bottomAt: () => 390, cardBottom: 400 }]);
    padded.querySelector<HTMLElement>('.home-hero')!.style.paddingBottom = '16px';
    expect(fitDays(padded)).toBeGreaterThan(0);
  });

  it('ignores the decorative court lines, which stick out on purpose', () => {
    const track = build([{ bottomAt: () => 300, cardBottom: 400 }]);
    const card = track.querySelector<HTMLElement>('.home-hero')!;
    const lines = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    lines.getBoundingClientRect = () => ({ bottom: 900 }) as DOMRect;
    card.append(lines);
    expect(fitDays(track)).toBe(0);
  });
});
