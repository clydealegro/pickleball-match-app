import { describe, expect, it } from 'vitest';
import css from '../styles/app.css?raw';

/** The declarations of the first rule whose selector is exactly this one. */
function rule(selector: string): string {
  const esc = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const m = new RegExp(`(?:^|\\})\\s*${esc}\\s*\\{([^}]*)\\}`, 'm').exec(css);
  if (!m) throw new Error(`no rule for ${selector}`);
  return m[1];
}

// On a short phone the slot card used to shrink to whatever room was left and cut off its chips ("Add a venue", "Add courts")
// as soon as the attendance card sat below it. It now keeps the height its content needs, and Home scrolls when that does not fit.
describe('Home on a short phone', () => {
  it('keeps the slot card as tall as its content, so its chips are never cut off', () => {
    const hero = rule('.home-hero');
    expect(hero).toMatch(/min-height:\s*min-content/);
    expect(hero).not.toMatch(/min-height:\s*0\b/);
  });

  it('scrolls inside itself when the screen is too short, so the Start button stays reachable', () => {
    const home = rule('.home');
    expect(home).toMatch(/overflow-y:\s*auto/);
    expect(rule('.sticky-bar')).toMatch(/position:\s*sticky/);
  });

  it('still lets the slot card grow into spare room on a tall phone', () => {
    expect(rule('.home-hero')).toMatch(/flex:\s*1\b/);
  });
});
