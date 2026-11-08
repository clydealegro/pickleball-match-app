import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { mkPlayer, mkSession } from '../engine/testing';
import css from '../styles/app.css?raw';
import { BoardWaiting } from './BoardWaiting';

afterEach(cleanup);

/** The declarations of the first rule whose selector is exactly this one. */
function rule(selector: string, source = css): string {
  const esc = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const m = new RegExp(`(?:^|\\})\\s*${esc}\\s*\\{([^}]*)\\}`, 'm').exec(source);
  if (!m) throw new Error(`no rule for ${selector}`);
  return m[1];
}

/** The body of the first at-rule that starts with this text (a media or container block). */
function block(start: string): string {
  const at = css.indexOf(start);
  if (at < 0) throw new Error(`no ${start}`);
  const open = css.indexOf('{', at);
  let depth = 0;
  for (let i = open; i < css.length; i++) {
    if (css[i] === '{') depth++;
    if (css[i] === '}' && --depth === 0) return css.slice(open + 1, i);
  }
  throw new Error('unbalanced');
}

const declaration = (body: string, prop: string): string => {
  const m = new RegExp(`(?:^|[\\s;])${prop}:\\s*([^;]+);`).exec(body);
  if (!m) throw new Error(`no ${prop}`);
  return m[1].trim();
};

/** Evaluates a CSS size made of clamp, min, max, calc, var and cqw, cqh, px, rem, for a container of the given content size. */
function evalSize(expr: string, box: { w: number; h: number }, vars: Record<string, number> = {}): number {
  let i = 0;
  const src = expr.replace(/\s+/g, ' ').trim();
  function sum(): number {
    let v = product();
    while (src[i] === ' ' && (src[i + 1] === '+' || src[i + 1] === '-')) {
      const op = src[i + 1];
      i += 3;
      const r = product();
      v = op === '+' ? v + r : v - r;
    }
    return v;
  }
  function product(): number {
    let v = atom();
    while (src[i] === ' ' && src[i + 1] === '*') {
      i += 3;
      v *= atom();
    }
    return v;
  }
  function args(): number[] {
    const out = [sum()];
    while (src[i] === ',') {
      i += src[i + 1] === ' ' ? 2 : 1;
      out.push(sum());
    }
    i++; // the closing bracket
    return out;
  }
  function atom(): number {
    const rest = src.slice(i);
    const fn = /^(clamp|min|max|calc)\(/.exec(rest);
    if (fn) {
      i += fn[0].length;
      const a = fn[1] === 'calc' ? [sum()] : args();
      if (fn[1] === 'calc') i++;
      if (fn[1] === 'clamp') return Math.max(a[0], Math.min(a[1], a[2]));
      if (fn[1] === 'min') return Math.min(...a);
      if (fn[1] === 'max') return Math.max(...a);
      return a[0];
    }
    const v = /^var\((--[a-z-]+)\)/.exec(rest);
    if (v) {
      i += v[0].length;
      return vars[v[1]];
    }
    const n = /^(-?\d*\.?\d+)(cqw|cqh|px|rem)?/.exec(rest);
    if (!n) throw new Error(`cannot read "${rest}" in "${expr}"`);
    i += n[0].length;
    const x = Number(n[1]);
    return n[2] === 'cqw' ? (x * box.w) / 100 : n[2] === 'cqh' ? (x * box.h) / 100 : n[2] === 'rem' ? x * 16 : x;
  }
  return sum();
}

// A court card on a 1920 by 1080 screen with three courts, measured in the browser: 616 by 714, less padding and border.
const TV_CARD = { w: 577, h: 675 };
// A phone held upright with three courts: 346 by 179.
const PHONE_CARD = { w: 330, h: 160 };

describe('the evaluator used here', () => {
  it('reads clamp, min, max, calc and var', () => {
    expect(evalSize('clamp(20px, min(13cqw, 15cqh), 120px)', { w: 100, h: 100 })).toBe(20);
    expect(evalSize('clamp(20px, min(130cqw, 150cqh), 120px)', { w: 100, h: 100 })).toBe(120);
    expect(evalSize('max(11px, calc(var(--d) * 0.19))', { w: 1, h: 1 }, { '--d': 100 })).toBe(19);
    expect(evalSize('max(1.6rem, min(20cqh, 9cqw))', { w: 100, h: 100 })).toBe(25.6);
  });
});

describe('the board scales its type and circles to the screen', () => {
  it('has a court clock of 60 px or more on a TV with three courts, and a readable one on a phone', () => {
    const size = declaration(rule('.board-timer'), 'font-size');
    expect(evalSize(size, TV_CARD)).toBeGreaterThanOrEqual(60);
    expect(evalSize(size, PHONE_CARD)).toBeGreaterThanOrEqual(20);
  });

  it('lets the clock grow with the card, up to a ceiling above 100 px', () => {
    const size = declaration(rule('.board-timer'), 'font-size');
    expect(size).toMatch(/cqw/);
    expect(size).toMatch(/cqh/);
    expect(evalSize(size, { w: 5000, h: 5000 })).toBeGreaterThanOrEqual(100);
  });

  it('has circles of 140 px or more and names of 30 px or more on a TV with three courts', () => {
    const stacked = block('@container (max-aspect-ratio');
    const d = evalSize(declaration(stacked, '--d'), TV_CARD);
    expect(d).toBeGreaterThanOrEqual(140);
    const name = declaration(rule('.board-pf'), 'font-size');
    expect(evalSize(name, TV_CARD, { '--d': d })).toBeGreaterThanOrEqual(30);
  });

  it('keeps names at 11 px or more however small the circle', () => {
    const name = declaration(rule('.board-pf'), 'font-size');
    expect(evalSize(name, TV_CARD, { '--d': 20 })).toBe(11);
    const waiting = declaration(rule('.board-wpf'), 'font-size');
    expect(evalSize(waiting, TV_CARD, { '--wd': 20 })).toBe(11);
  });

  it('sizes the waiting names from their circle, 25 px or more at TV size', () => {
    const waiting = declaration(rule('.board-wpf'), 'font-size');
    expect(evalSize(waiting, TV_CARD, { '--wd': 164 })).toBeGreaterThanOrEqual(25);
  });

  it('has a header that grows with the screen up to 44 px', () => {
    for (const sel of ['.board-name', '.board-clock']) {
      const size = declaration(rule(sel), 'font-size');
      expect(size).toMatch(/^clamp\(18px, 3\.4vmin, 44px\)$/);
    }
  });
});

describe('the board picks the layout of a court from the shape of its card', () => {
  it('stacks the teams in a card that is square or taller and tall enough, wherever it sits', () => {
    const q = /@container \(max-aspect-ratio: ([\d.]+)\) and \(min-height: (\d+)px\)/.exec(css);
    expect(q).not.toBeNull();
    expect(Number(q![1])).toBeGreaterThanOrEqual(1);
    expect(Number(q![2])).toBeGreaterThanOrEqual(300);
    const stacked = block('@container (max-aspect-ratio');
    expect(rule('.board-teams', stacked)).toMatch(/flex-direction:\s*column/);
  });

  it('keeps side by side as the default and leaves the stacking to the card shape, not the screen', () => {
    expect(rule('.board-teams')).toMatch(/flex-direction:\s*row/);
    const landscape = block('@media (orientation: landscape)');
    expect(landscape).not.toContain('.board-teams');
  });

  it('keeps the VS circle readable and in proportion to the circles', () => {
    const vs = declaration(rule('.board-teams'), '--vs');
    expect(evalSize(vs, { w: 100, h: 100 }, { '--d': 10 })).toBeGreaterThanOrEqual(24);
    expect(evalSize(vs, { w: 5000, h: 5000 }, { '--d': 200 })).toBeLessThanOrEqual(80);
    expect(declaration(rule('.board-vs'), 'font-size')).toMatch(/^max\(10px/);
  });
});

describe('the header on a narrow screen', () => {
  it('never shrinks the clock and Close, so the name gives way first', () => {
    expect(css).toMatch(/\.board-head-r \{\s*flex:\s*none;/);
    expect(rule('.board-name')).toMatch(/text-overflow:\s*ellipsis/);
  });

  it('tightens the right side on a narrow screen so Close stays in view', () => {
    const narrow = block('@media (max-width: 520px)');
    expect(rule('.board-head-r', narrow)).toMatch(/gap:\s*8px/);
    expect(rule('.board-more', narrow)).toMatch(/font-size:\s*12px/);
  });
});

describe('the waiting strip', () => {
  it('centres the circles, so a short queue leaves no one-sided gap', () => {
    expect(rule('.board-wstrip')).toMatch(/justify-content:\s*center/);
  });

  it('gives the strip a quarter of a landscape screen and a larger label', () => {
    const landscape = block('@media (orientation: landscape)');
    expect(rule('.board-waiting', landscape)).toMatch(/height:\s*24%/);
    expect(rule('.board-wl-label', landscape)).toMatch(/font-size:\s*clamp\(12px, 9cqh/);
    expect(rule('.board-wl-count', landscape)).toMatch(/font-size:\s*clamp\(16px, 16cqh/);
  });

  it('shrinks to a slim band when no one is waiting, and the message is readable', () => {
    expect(rule('.board-waiting.is-empty')).toMatch(/height:\s*9%/);
    expect(declaration(rule('.board-none'), 'font-size')).toMatch(/cqh/);
    expect(rule('.board-none')).toMatch(/align-self:\s*center/);
  });

  it('marks the strip as empty only when no one waits', () => {
    const { rerender } = render(<BoardWaiting waiting={[]} everyone={[]} />);
    expect(screen.getByRole('region', { name: 'Waiting' })).toHaveClass('is-empty');
    const ids = ['p1', 'p2'];
    const s = mkSession(ids.map((id) => mkPlayer(id, { name: id })), {});
    rerender(<BoardWaiting waiting={s.players} everyone={s.players} />);
    expect(screen.getByRole('region', { name: 'Waiting' })).not.toHaveClass('is-empty');
  });
});
