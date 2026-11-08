import { describe, expect, it } from 'vitest';
import css from '../styles/app.css?raw';

/** The declarations of the first rule whose selector is exactly this one. */
function rule(selector: string): string {
  const esc = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const m = new RegExp(`(?:^|\\})\\s*${esc}\\s*\\{([^}]*)\\}`, 'm').exec(css);
  if (!m) throw new Error(`no rule for ${selector}`);
  return m[1];
}

describe('the logo button', () => {
  it('is at least 44 px square, so it is a fair tap target', () => {
    const block = rule('.app-logo-btn');
    expect(block).toMatch(/min-width:\s*44px/);
    expect(block).toMatch(/min-height:\s*44px/);
  });

  it('has no button chrome', () => {
    const block = rule('.app-logo-btn');
    expect(block).toMatch(/border:\s*0/);
    expect(block).toMatch(/background:\s*none/);
  });
});
