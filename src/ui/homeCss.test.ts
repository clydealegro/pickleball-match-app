import { describe, expect, it } from 'vitest';
import css from '../styles/app.css?raw';


/** The declarations of the first rule whose selector is exactly this one. */
function rule(selector: string): string {
  const esc = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const m = new RegExp(`(?:^|\\})\\s*${esc}\\s*\\{([^}]*)\\}`, 'm').exec(css);
  if (!m) throw new Error(`no rule for ${selector}`);
  return m[1];
}

describe('Home styles', () => {
  it('keeps chips and the pencil at 44 px or more', () => {
    expect(rule('.home-chip')).toMatch(/min-height:\s*44px/);
    expect(rule('.home-edit')).toMatch(/width:\s*44px/);
    expect(rule('.home-edit')).toMatch(/height:\s*44px/);
    expect(rule('.home-dashed')).toMatch(/min-height:\s*44px/);
  });

  it('keeps the slide-in from scrolling the page sideways', () => {
    expect(rule('.app:has(.home)')).toMatch(/overflow-x:\s*clip/);
  });

  it('pulses the live dot', () => {
    expect(rule('.home-live-dot')).toMatch(/animation:[^;]*home-live-pulse/);
  });

  it('slides the hero in over 180 ms', () => {
    expect(rule('.home-hero-in')).toMatch(/animation:[^;]*180ms/);
  });

  it('turns the slide and the press animation off for reduced motion', () => {
    const block = /@media \(prefers-reduced-motion: reduce\)\s*\{([\s\S]*?\n\})/.exec(css.slice(css.indexOf('/* Home */')));
    expect(block).not.toBeNull();
    expect(block![1]).toMatch(/\.home-hero-in[^}]*animation:\s*none/);
    expect(block![1]).toMatch(/\.home-live-dot[^}]*animation:\s*none/);
    expect(block![1]).toMatch(/transition:\s*none/);
  });

  it('presses the Start button and chips in to .98', () => {
    expect(css).toMatch(/\.home-start:active[^{]*\{[^}]*scale\(\.98\)/);
  });

  it('has no styles left from the old slot cards', () => {
    for (const old of ['.slot-card', '.slot-big', '.slot-label', '.slot-title', '.btn-start']) expect(css).not.toContain(old);
  });

  it('styles the courts list rows at 28 to 32 px with a translucent divider', () => {
    const row = rule('.home-court-row');
    const h = /(?:min-)?height:\s*(\d+)px/.exec(row);
    expect(h).not.toBeNull();
    expect(Number(h![1])).toBeGreaterThanOrEqual(28);
    expect(Number(h![1])).toBeLessThanOrEqual(32);
    expect(row).toMatch(/border-top:[^;]*color-mix\([^;]*var\(--accent-ink\)[^;]*transparent/);
    expect(rule('.home-court-state')).toMatch(/font-weight:\s*700/);
  });

  it('hides the courts list on short screens', () => {
    const block = /@media \(max-height: 560px\)\s*\{([\s\S]*?\n\})/.exec(css);
    expect(block).not.toBeNull();
    expect(block![1]).toMatch(/\.home-courts\s*\{[^}]*display:\s*none/);
  });
});
