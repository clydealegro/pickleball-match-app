import { describe, expect, it } from 'vitest';
import css from '../styles/app.css?raw';
import { nameHue } from '../store/boardInfo';

// The board section runs to the end of the file and bans the app variables, so this one sits just before it.
const START = css.indexOf('/* Member page */');
const END = css.indexOf('/* Board */');
const section = START >= 0 ? css.slice(START, END) : '';

/** The declarations of the first rule in the member section whose selector is exactly this one. */
function rule(selector: string): string {
  const esc = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const m = new RegExp(`(?:^|\\})\\s*${esc}\\s*\\{([^}]*)\\}`, 'm').exec(section);
  if (!m) throw new Error(`no rule for ${selector}`);
  return m[1];
}

describe('Member page styles', () => {
  it('is its own section, after the attendance card and before the board', () => {
    expect(START).toBeGreaterThan(0);
    expect(css.indexOf('/* Member page */', START + 1)).toBe(-1);
    expect(css.indexOf('/* Attendance card */')).toBeGreaterThan(0);
    expect(css.indexOf('/* Attendance card */')).toBeLessThan(START);
    expect(END).toBeGreaterThan(START);
    expect(section.length).toBeGreaterThan(500);
  });

  it('keeps every button at 44 px or more', () => {
    for (const sel of ['.member-pick', '.member-link', '.member-answer', '.member-chip', '.member-calendar', '.member-submit', '.member-retry']) {
      expect(rule(sel), sel).toMatch(/min-height:\s*(44|[5-9]\d)px/);
    }
  });

  it('keeps every field at 44 px or more and 16 px type or more, so a phone does not zoom', () => {
    for (const sel of ['.member-search', '.member-input']) {
      expect(rule(sel), sel).toMatch(/min-height:\s*44px/);
      const size = /font-size:\s*(\d+)px/.exec(rule(sel));
      expect(size, sel).not.toBeNull();
      expect(Number(size![1]), sel).toBeGreaterThanOrEqual(16);
    }
  });

  it('draws the circles at 38 and 56 px', () => {
    expect(rule('.member-tile-sm')).toMatch(/width:\s*38px/);
    expect(rule('.member-tile-sm')).toMatch(/height:\s*38px/);
    expect(rule('.member-tile-md')).toMatch(/width:\s*56px/);
    expect(rule('.member-tile-md')).toMatch(/height:\s*56px/);
    expect(rule('.member-tile')).toMatch(/border-radius:\s*50%/);
  });

  it('colours a circle from its hue, with white text, and nothing else is coloured by hand', () => {
    expect(rule('.member-tile')).toContain('background: hsl(var(--h) 42% 32%)');
    expect(rule('.member-tile')).toMatch(/color:\s*#fff\s*;/);
    const rest = section.replace(/\.member-tile\s*\{[^}]*\}/, '');
    expect(rest).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
    expect(rest).not.toMatch(/\brgba?\(|\bhsla?\(/);
    expect(rest).not.toContain('--h');
  });

  it('uses only the existing variables and adds none', () => {
    expect(section).toContain('var(--');
    expect(section).not.toMatch(/(^|[\s{;])--[a-z-]+\s*:/);
    const allowed = ['--bg', '--surface', '--line', '--ink', '--muted', '--accent', '--accent-ink', '--danger', '--chip-ring', '--radius', '--h'];
    for (const [, name] of section.matchAll(/var\((--[a-z-]+)/g)) expect(allowed).toContain(name);
  });

  it('wraps long text and never scrolls sideways', () => {
    expect(rule('.member-title')).toMatch(/overflow-wrap:\s*anywhere/);
    expect(rule('.member-grid')).toMatch(/minmax\(0,\s*1fr\)/);
    expect(rule('.member')).toMatch(/max-width:\s*480px/);
    expect(rule('.member-chips')).toMatch(/flex-wrap:\s*wrap/);
  });

  it('keeps the In button lime when it is the answer', () => {
    expect(rule(".member-answer-in[aria-pressed='true']")).toMatch(/background:\s*var\(--accent\)/);
    expect(rule(".member-answer-in[aria-pressed='true']")).toMatch(/color:\s*var\(--accent-ink\)/);
  });

  it('shows an error message in the danger colour', () => {
    expect(rule(".member-message[role='alert']")).toMatch(/color:\s*var\(--danger\)/);
  });

  it('has no em dashes', () => {
    expect(section).not.toContain(String.fromCharCode(0x2014));
  });
});

// The same maths the Board test uses.
const lin = (c: number) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
const lum = (r: number, g: number, b: number) => 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);

function hslLum(h: number, s: number, l: number): number {
  const sat = s / 100;
  const lig = l / 100;
  const c = (1 - Math.abs(2 * lig - 1)) * sat;
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
  const m = lig - c / 2;
  const [r, g, b] = h < 60 ? [c, x, 0] : h < 120 ? [x, c, 0] : h < 180 ? [0, c, x] : h < 240 ? [0, x, c] : h < 300 ? [x, 0, c] : [c, 0, x];
  return lum(r + m, g + m, b + m);
}

describe('the name circles', () => {
  it('keeps white initials at 4.5 to 1 or more on every one of the 360 hues', () => {
    const m = /hsl\(var\(--h\)\s+(\d+)%\s+(\d+)%\)/.exec(rule('.member-tile'));
    expect(m).not.toBeNull();
    const [s, l] = [Number(m![1]), Number(m![2])];
    for (let h = 0; h < 360; h += 1) {
      expect(1.05 / (hslLum(h, s, l) + 0.05), `hue ${h}`).toBeGreaterThanOrEqual(4.5);
    }
  });

  it('gives every name a hue from 0 to 359', () => {
    for (const name of ['Ana', 'Ben C.', 'Zasz', 'Enzo']) {
      expect(nameHue(name)).toBeGreaterThanOrEqual(0);
      expect(nameHue(name)).toBeLessThan(360);
    }
  });
});
