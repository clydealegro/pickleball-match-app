import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { SAMPLE } from './fixtures';
import { MemberPicker } from './MemberPicker';

const OK = { ok: true as const, message: 'Thanks. The organizer will see your name.' };

beforeEach(() => {
  localStorage.clear();
  history.replaceState(null, '', '/');
  delete document.documentElement.dataset.theme;
});

function setup(players = SAMPLE.players, onAskToJoin = vi.fn(async () => OK)) {
  const onPick = vi.fn();
  render(<MemberPicker players={players} onPick={onPick} onAskToJoin={onAskToJoin} />);
  return { onPick, onAskToJoin };
}

describe('MemberPicker', () => {
  it('asks who you are and says it is first names only', () => {
    setup();
    expect(screen.getByRole('heading', { name: 'Who are you?' })).toBeInTheDocument();
    expect(screen.getByText('First names only. No account.')).toBeInTheDocument();
  });

  it('shows a button for every player, named by first name', () => {
    setup();
    const grid = screen.getByRole('list');
    expect(within(grid).getAllByRole('button')).toHaveLength(16);
    expect(screen.getByRole('button', { name: 'Ana' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Carlo' })).toBeInTheDocument();
  });

  it('gives each circle the initials, hidden from screen readers', () => {
    setup();
    const ana = screen.getByRole('button', { name: 'Ana' });
    const tile = ana.querySelector('.member-tile');
    expect(tile).toHaveTextContent('AN');
    expect(tile).toHaveAttribute('aria-hidden', 'true');
  });

  it('adds a last initial when two players share a first name', () => {
    setup();
    expect(screen.getByRole('button', { name: 'Ben C.' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Ben D.' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Ben' })).toBeNull();
  });

  it('draws the circle from the name on the button, so the two Bens differ', () => {
    setup();
    expect(screen.getByRole('button', { name: 'Ben C.' }).querySelector('.member-tile')).toHaveTextContent('BC');
    expect(screen.getByRole('button', { name: 'Ben D.' }).querySelector('.member-tile')).toHaveTextContent('BD');
  });

  it('picks with the player id', async () => {
    const { onPick } = setup();
    await userEvent.click(screen.getByRole('button', { name: 'Ben D.' }));
    expect(onPick).toHaveBeenCalledExactlyOnceWith('p14');
  });

  it('filters as you type, ignoring case', async () => {
    setup();
    await userEvent.type(screen.getByRole('searchbox', { name: 'Search your name' }), 'aN');
    expect(screen.getByRole('button', { name: 'Ana' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Carlo' })).toBeNull();
  });

  it('matches a part of a name and ignores spaces at the ends', async () => {
    setup();
    await userEvent.type(screen.getByRole('searchbox'), ' ben ');
    expect(screen.getAllByRole('button', { name: /^Ben/ })).toHaveLength(2);
    expect(screen.queryByRole('button', { name: 'Ana' })).toBeNull();
  });

  it('says No match when nothing fits, and still offers Ask to join', async () => {
    setup();
    await userEvent.type(screen.getByRole('searchbox'), 'zzz');
    expect(screen.getByText('No match.')).toBeInTheDocument();
    expect(screen.queryByRole('list')).toBeNull();
    expect(screen.getByRole('button', { name: 'Not on the list? Ask to join.' })).toBeInTheDocument();
  });

  it('says there are no names yet for an empty roster, with no search field', () => {
    setup([]);
    expect(screen.getByText('No names yet. Ask your organizer.')).toBeInTheDocument();
    expect(screen.queryByRole('searchbox')).toBeNull();
    expect(screen.queryByText('No match.')).toBeNull();
    expect(screen.getByRole('button', { name: 'Not on the list? Ask to join.' })).toBeInTheDocument();
  });

  it('has a 16 px search field', () => {
    setup();
    expect(screen.getByRole('searchbox')).toHaveClass('member-search');
    expect(screen.getByRole('searchbox')).toHaveAttribute('placeholder', 'Search your name');
  });

  it('opens the Ask to join sheet and sends the name', async () => {
    const { onAskToJoin } = setup();
    expect(screen.queryByRole('dialog')).toBeNull();
    await userEvent.click(screen.getByRole('button', { name: 'Not on the list? Ask to join.' }));
    expect(screen.getByRole('dialog', { name: 'Ask to join' })).toBeInTheDocument();
    await userEvent.type(screen.getByLabelText('Your name'), 'Mika');
    await userEvent.click(screen.getByRole('button', { name: 'Send' }));
    expect(onAskToJoin).toHaveBeenCalledExactlyOnceWith('Mika');
  });

  it('closes the sheet on Escape', async () => {
    setup();
    await userEvent.click(screen.getByRole('button', { name: 'Not on the list? Ask to join.' }));
    await userEvent.keyboard('{Escape}');
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('never shows a last name or an answer', () => {
    setup();
    expect(document.body.textContent).not.toMatch(/\bout\b/i);
  });
});
