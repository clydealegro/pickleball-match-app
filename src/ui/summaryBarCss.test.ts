import { describe, expect, it } from 'vitest';
import css from '../styles/app.css?raw';

/** The declarations of the first rule whose selector is exactly this one. */
function rule(selector: string): string {
  const esc = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const m = new RegExp(`(?:^|\\})\\s*${esc}\\s*\\{([^}]*)\\}`, 'm').exec(css);
  if (!m) throw new Error(`no rule for ${selector}`);
  return m[1];
}

describe('the summary bar', () => {
  it('stays stuck to the bottom, in one row of two buttons 52 px tall', () => {
    const bar = rule('.sum-actions');
    expect(bar).toMatch(/position:\s*sticky/);
    expect(bar).toMatch(/bottom:\s*0/);
    expect(bar).toMatch(/flex-direction:\s*row/);
    const buttons = rule('.sum-actions .btn');
    expect(buttons).toMatch(/flex:\s*1/);
    expect(buttons).toMatch(/min-height:\s*52px/);
  });

  it('fades the list out above it, over about 24 px, into the page colour', () => {
    const fade = rule('.sum-actions::before');
    expect(fade).toMatch(/bottom:\s*100%/);
    expect(fade).toMatch(/height:\s*24px/);
    expect(fade).toMatch(/linear-gradient\([^)]*transparent[^)]*var\(--bg\)/);
    expect(fade).toMatch(/pointer-events:\s*none/);
  });

  it('draws no filled button: both are transparent, never the accent or the ink', () => {
    for (const selector of ['.sum-actions .btn', '.sum-share', '.sum-done']) {
      const block = rule(selector);
      expect(block, selector).not.toMatch(/background:\s*var\(--(accent|ink)\)/);
    }
    expect(rule('.sum-actions .btn')).toMatch(/background:\s*transparent/);
  });

  it('outlines Share thin and muted', () => {
    const share = rule('.sum-share');
    expect(share).toMatch(/border:\s*1px solid var\(--muted\)/);
  });

  it('outlines Done at 2 px in the ring colour, in bold', () => {
    const done = rule('.sum-done');
    expect(done).toMatch(/border:\s*2px solid var\(--chip-ring\)/);
    expect(done).toMatch(/font-weight:\s*700/);
  });
});

describe('the summary header', () => {
  it('sets the session name at 24 px', () => {
    expect(rule('.sum-title')).toMatch(/font-size:\s*24px/);
  });

  it('sets the label small, muted, uppercase and spaced', () => {
    const label = rule('.sum-eyebrow');
    expect(label).toMatch(/font-size:\s*11px/);
    expect(label).toMatch(/color:\s*var\(--muted\)/);
    expect(label).toMatch(/text-transform:\s*uppercase/);
    expect(label).toMatch(/letter-spacing:\s*[\d.]+em/);
  });
});
