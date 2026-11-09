import { describe, expect, it } from 'vitest';

// A merge once dropped one closing brace in app.css. The browser then read every rule after it as part of an
// unfinished @keyframes block and ignored them all, and no other test noticed because they only read the text.
const sheets = import.meta.glob('../styles/*.css', { query: '?raw', import: 'default', eager: true }) as Record<string, string>;

/** The css without comments and strings, so a brace inside either is not counted. */
function bare(css: string): string {
  return css
    .replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' '))
    .replace(/"(?:[^"\\\n]|\\.)*"|'(?:[^'\\\n]|\\.)*'/g, (m) => '"' + ' '.repeat(Math.max(0, m.length - 2)) + '"');
}

/** The nesting depth at the start of each line, and the depth at the very end. */
function depths(css: string): { atLine: number[]; end: number; lowest: number } {
  let depth = 0;
  let lowest = 0;
  const atLine: number[] = [];
  for (const line of bare(css).split('\n')) {
    atLine.push(depth);
    for (const ch of line) {
      if (ch === '{') depth += 1;
      if (ch === '}') depth -= 1;
      lowest = Math.min(lowest, depth);
    }
  }
  return { atLine, end: depth, lowest };
}

describe('the stylesheets', () => {
  it('finds the stylesheets', () => {
    expect(Object.keys(sheets).sort()).toEqual(['../styles/app.css', '../styles/editSlot.css', '../styles/playerSheet.css']);
  });

  for (const [path, css] of Object.entries(sheets)) {
    it(`${path} closes every block it opens, and never closes one it did not open`, () => {
      const { end, lowest } = depths(css);
      expect(lowest).toBe(0);
      expect(end).toBe(0);
    });
  }

  it('starts each named section of app.css at the top level, not inside another rule', () => {
    const css = sheets['../styles/app.css'];
    const { atLine } = depths(css);
    const lines = css.split('\n');
    const named = ['/* Home */', '/* Attendance card */', '/* Member page */', '/* Board */'];
    for (const marker of named) {
      const i = lines.findIndex((l) => l.startsWith(marker));
      expect(i, `${marker} is in app.css`).toBeGreaterThanOrEqual(0);
      expect(atLine[i], `${marker} starts at the top level`).toBe(0);
    }
  });
});
