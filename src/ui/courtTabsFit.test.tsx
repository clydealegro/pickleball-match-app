import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Court } from '../engine';
import { CourtTabs } from './CourtTabs';

afterEach(() => {
  delete (Element.prototype as unknown as Record<string, unknown>).scrollIntoView;
});

const courts = (n: number): Court[] =>
  Array.from({ length: n }, (_, i) => ({
    id: `c${i + 1}`,
    number: i + 1,
    status: i === 0 ? 'playing' : 'empty',
    closing: false,
    ...(i === 0 ? { game: { team1: ['a', 'b'] as [string, string], team2: ['c', 'd'] as [string, string], startedAt: Date.now() } } : {}),
  }));

describe('the court tabs fit the width', () => {
  it.each([2, 3, 4, 7, 12])('show every one of %i courts as a tab, with exactly one selected', (n) => {
    render(<CourtTabs courts={courts(n)} selectedId="c2" onSelect={() => {}} />);
    const tabs = screen.getAllByRole('tab');
    expect(tabs).toHaveLength(n);
    expect(tabs.filter((t) => t.classList.contains('is-selected'))).toHaveLength(1);
    expect(tabs.filter((t) => t.getAttribute('aria-selected') === 'true')).toHaveLength(1);
    expect(screen.getByRole('tab', { selected: true })).toHaveClass('is-selected');
  });

  it('never scrolls the strip to bring a tab into view, because nothing scrolls', () => {
    const scrollIntoView = vi.fn();
    (Element.prototype as unknown as Record<string, unknown>).scrollIntoView = scrollIntoView;
    const { rerender } = render(<CourtTabs courts={courts(6)} selectedId="c1" onSelect={() => {}} />);
    rerender(<CourtTabs courts={courts(6)} selectedId="c5" onSelect={() => {}} />);
    expect(scrollIntoView).not.toHaveBeenCalled();
  });

  it('moves the selected mark, which carries the arrow, to the tab that is picked', async () => {
    const onSelect = vi.fn();
    const { rerender } = render(<CourtTabs courts={courts(3)} selectedId="c1" onSelect={onSelect} />);
    await userEvent.setup().click(screen.getByRole('tab', { name: /Court 3/ }));
    expect(onSelect).toHaveBeenCalledWith('c3');
    rerender(<CourtTabs courts={courts(3)} selectedId="c3" onSelect={onSelect} />);
    expect(screen.getByRole('tab', { name: /Court 3/ })).toHaveClass('is-selected');
    expect(screen.getByRole('tab', { name: /Court 1/ })).not.toHaveClass('is-selected');
  });

  it('keeps the court name and its state on separate lines of text, so a narrow tab can keep the name on one line', () => {
    render(<CourtTabs courts={courts(4)} selectedId="c1" onSelect={() => {}} />);
    const tab = screen.getByRole('tab', { name: /Court 2/ });
    expect(tab.querySelector('.court-tab-name')!.textContent).toBe('Court 2');
    expect(tab.querySelector('.court-tab-state')!.textContent).toBe('Open');
  });
});
