import { describe, expect, it } from 'vitest';
import css from '../styles/app.css?raw';

// The member page section follows this one, then the board, which runs to the end of the file and bans the app variables.
const START = css.indexOf('/* Attendance card */');
const END = css.indexOf('/* Member page */');
const section = START >= 0 ? css.slice(START, END) : '';

/** The declarations of the first rule in the attendance section whose selector is exactly this one. */
function rule(selector: string): string {
  const esc = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const m = new RegExp(`(?:^|\\})\\s*${esc}\\s*\\{([^}]*)\\}`, 'm').exec(section);
  if (!m) throw new Error(`no rule for ${selector}`);
  return m[1];
}

describe('Attendance card styles', () => {
  it('is its own section, after Home and before the board', () => {
    expect(START).toBeGreaterThan(0);
    expect(css.indexOf('/* Attendance card */', START + 1)).toBe(-1);
    expect(css.slice(0, START)).toContain('/* Home */');
    expect(END).toBeGreaterThan(START);
  });

  it('keeps its buttons at 44 px or more', () => {
    expect(rule('.attendance-btn')).toMatch(/min-height:\s*44px/);
  });

  it('keeps the card out of the way of the hero: it does not grow or shrink', () => {
    expect(rule('.attendance')).toMatch(/flex:\s*none/);
  });

  it('keeps the small lines close together so the card stays short', () => {
    expect(rule('.attendance-meta')).toMatch(/display:\s*flex/);
    expect(rule('.attendance-meta')).toMatch(/gap:\s*[0-4]px/);
  });

  it('uses the normal surface, line and ink variables', () => {
    const card = rule('.attendance');
    expect(card).toMatch(/background:\s*var\(--surface\)/);
    expect(card).toMatch(/border:[^;]*var\(--line\)/);
    expect(card).toMatch(/color:\s*var\(--ink\)/);
  });

  it('draws the pills from the accent, ink and danger variables', () => {
    expect(rule(".attendance-pill[data-kind='in']")).toMatch(/background:\s*var\(--accent\)/);
    expect(rule(".attendance-pill[data-kind='in']")).toMatch(/color:\s*var\(--accent-ink\)/);
    expect(rule(".attendance-pill[data-kind='out']")).toMatch(/color:\s*var\(--danger\)/);
  });

  it('wraps long links and pills instead of scrolling sideways', () => {
    expect(rule('.attendance-link')).toMatch(/overflow-wrap:\s*anywhere/);
    expect(rule('.attendance-pills')).toMatch(/flex-wrap:\s*wrap/);
    expect(rule('.attendance-actions')).toMatch(/flex-wrap:\s*wrap/);
  });

  it('has no hard-coded colours and adds no variables', () => {
    expect(section).toContain('var(--');
    expect(section).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
    expect(section).not.toMatch(/\brgba?\(|\bhsla?\(/);
    expect(section).not.toMatch(/--[a-z-]+\s*:/);
    for (const [, name] of section.matchAll(/var\((--[a-z-]+)/g)) {
      expect(['--surface', '--line', '--ink', '--muted', '--accent', '--accent-ink', '--danger']).toContain(name);
    }
  });

  it('has no em dashes', () => {
    expect(section.length).toBeGreaterThan(100);
    expect(section).not.toContain(String.fromCharCode(0x2014));
  });
});
