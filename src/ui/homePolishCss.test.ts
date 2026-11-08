import { describe, expect, it } from 'vitest';
import css from '../styles/app.css?raw';

/** The declarations of the first rule whose selector is exactly this one. */
function rule(selector: string): string {
  const esc = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const m = new RegExp(`(?:^|\\})\\s*${esc}\\s*\\{([^}]*)\\}`, 'm').exec(css);
  if (!m) throw new Error(`no rule for ${selector}`);
  return m[1];
}

/** The value of a custom property in a rule, which must be a hex colour. */
function hex(block: string, name: string): string {
  const m = new RegExp(`${name}:\\s*(#[0-9a-fA-F]{6})\\b`).exec(block);
  if (!m) throw new Error(`no hex for ${name}`);
  return m[1];
}

function luminance(color: string): number {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(color.slice(i, i + 2), 16) / 255).map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** WCAG contrast ratio of two hex colours. */
function ratio(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

describe('the contrast ratio helper', () => {
  it('gives 21 for black on white and 1 for the same colour', () => {
    expect(ratio('#000000', '#ffffff')).toBeCloseTo(21, 5);
    expect(ratio('#c8f03c', '#c8f03c')).toBeCloseTo(1, 5);
  });
});

describe('the selected chip ring', () => {
  it('is at least 3 to 1 against the page on the light theme', () => {
    const light = rule(':root');
    expect(ratio(hex(light, '--chip-ring'), hex(light, '--bg'))).toBeGreaterThanOrEqual(3);
  });

  it('is the accent lime on the dark theme, and still at least 3 to 1 against the page', () => {
    const dark = rule(":root[data-theme='dark']");
    expect(dark).toMatch(/--chip-ring:\s*var\(--accent\)/);
    expect(ratio(hex(rule(':root'), '--accent'), hex(dark, '--bg'))).toBeGreaterThanOrEqual(3);
  });

  it('is what the selected chip draws, over the lime wash', () => {
    const selected = rule(".home-chip[aria-checked='true']");
    expect(selected).toMatch(/border:\s*1\.5px solid var\(--chip-ring\)/);
    expect(selected).toMatch(/color-mix\(in srgb, var\(--accent\) 22%/);
  });
});

describe('the hero layout', () => {
  it('spreads the top block and the bottom block apart with 12 px between them', () => {
    const split = rule('.home-hero-split');
    expect(split).toMatch(/justify-content:\s*space-between/);
    expect(split).toMatch(/gap:\s*12px/);
  });

  it('keeps each block as one column, so the dashed chips stay with their lines', () => {
    const both = rule('.home-hero-head,\n.home-hero-body');
    expect(both).toMatch(/display:\s*flex/);
    expect(both).toMatch(/flex-direction:\s*column/);
  });

  it('draws the this-time-only note small and muted', () => {
    expect(rule('.home-once')).toMatch(/font-size:\s*13px/);
  });
});

describe('the Start bar buttons on Home', () => {
  it('are outlined in every state, never filled', () => {
    expect(rule('.home-start')).not.toMatch(/background:\s*var\(--accent\)/);
    expect(rule(".home-start[data-grade='primary']")).toMatch(/background:\s*transparent/);
    expect(rule(".home-start[data-grade='quiet']")).toMatch(/background:\s*transparent/);
  });

  it('draw the near-session outline in the ring colour at 2 px, and the far-session outline in the muted colour', () => {
    const primary = rule(".home-start[data-grade='primary']");
    expect(primary).toMatch(/border-color:\s*var\(--chip-ring\)/);
    expect(primary).toMatch(/border-width:\s*2px/);
    expect(rule(".home-start[data-grade='quiet']")).toMatch(/border-color:\s*var\(--muted\)/);
  });

  it('keep the ring and the muted outline at least 3 to 1 against the page in both themes', () => {
    const light = rule(':root');
    const dark = rule(":root[data-theme='dark']");
    expect(ratio(hex(light, '--chip-ring'), hex(light, '--bg'))).toBeGreaterThanOrEqual(3);
    expect(ratio(hex(light, '--muted'), hex(light, '--bg'))).toBeGreaterThanOrEqual(3);
    expect(ratio(hex(light, '--accent'), hex(dark, '--bg'))).toBeGreaterThanOrEqual(3);
    expect(ratio(hex(dark, '--muted'), hex(dark, '--bg'))).toBeGreaterThanOrEqual(3);
  });
});
