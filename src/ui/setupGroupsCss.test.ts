import { describe, expect, it } from 'vitest';
import css from '../styles/app.css?raw';

// The Setup rules sit together before the Home section.
const START = css.indexOf('/* ---------- New session ---------- */');
const END = css.indexOf('/* Home */');
const section = css.slice(START, END);

function rule(selector: string): string {
  const esc = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const m = new RegExp(`(?:^|\\})\\s*${esc}\\s*\\{([^}]*)\\}`, 'm').exec(section);
  if (!m) throw new Error(`no rule for ${selector}`);
  return m[1];
}

describe('Setup group styles', () => {
  it('sit with the other Setup rules, before Home', () => {
    expect(START).toBeGreaterThan(0);
    expect(END).toBeGreaterThan(START);
    for (const sel of ['.pick-group', '.pick-group-title', '.pick-wide', '.pick-tag']) expect(section).toContain(`${sel} {`);
  });

  it('stack a group as a heading over its list', () => {
    expect(rule('.pick-group')).toMatch(/flex-direction:\s*column/);
  });

  it('draw the heading in the muted colour', () => {
    expect(rule('.pick-group-title')).toMatch(/color:\s*var\(--muted\)/);
  });

  it('give a tagged row the whole width of the grid', () => {
    expect(rule('.pick-wide')).toMatch(/grid-column:\s*1\s*\/\s*-1/);
  });

  it('keep the tag readable on the ticked ink row: outlined in the text colour, not filled', () => {
    expect(rule('.pick-tag')).toMatch(/border:\s*1px solid currentColor/);
    expect(rule('.pick-tag')).toMatch(/background:\s*transparent/);
    expect(rule('.pick-tag')).toMatch(/margin-left:\s*auto/);
  });

  it('let a long name shrink instead of pushing the row sideways', () => {
    expect(rule('.pick-wide .row-name')).toMatch(/min-width:\s*0/);
    expect(rule('.pick-tag')).toMatch(/min-width:\s*0/);
  });

  it('keep the rows at 44 px or more, with no hard-coded colours', () => {
    expect(rule('.pick')).toMatch(/min-height:\s*(4[4-9]|[5-9]\d)px/);
    expect(section).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
  });

  it('have no em dashes', () => {
    expect(section).not.toContain(String.fromCharCode(0x2014));
  });
});
