import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { resetRosterDbForTests } from '../store/rosterDb';
import { useRosterStore } from '../store/rosterStore';
import { useSessionStore } from '../store/sessionStore';
import App from './App';

type User = ReturnType<typeof userEvent.setup>;

// The real default: games wait for Start.
beforeEach(async () => {
  localStorage.clear();
  useSessionStore.setState({ session: null, undoStack: [], saveFailed: false, lastAction: null });
  await resetRosterDbForTests();
  useRosterStore.setState({ players: [], loaded: false });
});
afterEach(() => vi.restoreAllMocks());

const names = (n: number) => Array.from({ length: n }, (_, i) => `P${String.fromCharCode(65 + i)}`).join('{enter}');

async function startSession(user: User, count: number) {
  render(<App />);
  await user.type(screen.getByLabelText('Search or add players'), names(count));
  await user.keyboard('{Enter}');
  await user.click(await screen.findByRole('button', { name: `Start ${count} players` }));
}
const bar = () => document.querySelector<HTMLElement>('.undo-bar');
const menu = async (user: User) => {
  await user.click(screen.getByRole('button', { name: 'Menu' }));
  return document.querySelector<HTMLElement>('.menu-pop')!;
};
const court = (n: number) => useSessionStore.getState().session!.courts[n - 1];

describe('one Undo, where the mistake happens', () => {
  it('has no Undo icon in the header, and no bar before anything has happened', async () => {
    const user = userEvent.setup();
    await startSession(user, 5);
    expect(document.querySelector('.live-header')!.querySelector('button[aria-label="Undo"]')).toBeNull();
    expect(bar()).toBeNull();
  });

  it('says what each action did, in one line, and Undo takes it back', async () => {
    const user = userEvent.setup();
    await startSession(user, 5);
    await user.click(screen.getByRole('button', { name: /^Start game/ }));
    expect(bar()!.textContent).toBe('Started Court 1Undo');
    await user.click(screen.getByRole('button', { name: /^Game finished/ }));
    expect(bar()!.textContent).toBe('Game finished on Court 1Undo');
    expect(document.querySelectorAll('.undo-bar')).toHaveLength(1);
    await user.click(within(bar()!).getByRole('button', { name: 'Undo' }));
    expect(bar()).toBeNull();
    expect(court(1).status).toBe('playing');
  });

  it('labels adding a player, a break, and adding or removing a court', async () => {
    const user = userEvent.setup();
    await startSession(user, 5);
    await user.click(screen.getByRole('button', { name: 'Add player' }));
    await user.type(await screen.findByLabelText('New player name'), 'Zed{enter}');
    // The player is saved first, then added, so the bar arrives a moment after the Enter.
    await waitFor(() => expect(bar()?.textContent).toBe('Added ZedUndo'));

    await user.click(within(screen.getByRole('list', { name: 'Waiting' })).getAllByRole('button')[0]);
    await user.click(await screen.findByRole('button', { name: 'Take a break' }));
    expect(bar()!.textContent).toMatch(/^(P[A-Z]|Zed) on a breakUndo$/);

    await user.click(await menuButton(user, 'Add court'));
    expect(bar()!.textContent).toBe('Court addedUndo');
  });

  it('says a Ready court is removed at once', async () => {
    const user = userEvent.setup();
    await startSession(user, 8);
    await user.click(screen.getAllByRole('tab')[1]);
    await user.click(await menuButton(user, 'Remove court 2'));
    expect(bar()!.textContent).toBe('Court 2 removedUndo');
  });

  it('says a court in play will close after its game, and then that it will stay open', async () => {
    const user = userEvent.setup();
    await startSession(user, 8);
    await user.click(await menuButton(user, 'Start all ready courts'));
    await user.click(screen.getAllByRole('tab')[1]);
    await user.click(await menuButton(user, 'Remove court 2'));
    expect(bar()!.textContent).toBe('Court 2 will close after its gameUndo');
    await user.click(await menuButton(user, 'Keep court 2 open'));
    expect(bar()!.textContent).toBe('Court 2 will stay openUndo');
  });
});

async function menuButton(user: User, name: string) {
  const pop = await menu(user);
  return within(pop).getByRole('button', { name });
}

describe('Undo in the menu', () => {
  it('is not there before anything can be undone', async () => {
    const user = userEvent.setup();
    await startSession(user, 5);
    const pop = await menu(user);
    expect(within(pop).queryByRole('button', { name: /^Undo/ })).not.toBeInTheDocument();
  });

  it('says what it will undo, is the first item, and works', async () => {
    const user = userEvent.setup();
    await startSession(user, 5);
    await user.click(screen.getByRole('button', { name: /^Start game/ }));
    const pop = await menu(user);
    const first = within(pop).getAllByRole('button')[0];
    expect(first).toHaveTextContent('Undo: Started Court 1');
    await user.click(first);
    expect(court(1).status).toBe('ready');
  });

  it('falls back to a plain label when the action is no longer known, for example after a reload', async () => {
    const user = userEvent.setup();
    await startSession(user, 5);
    await user.click(screen.getByRole('button', { name: /^Start game/ }));
    const { act } = await import('@testing-library/react');
    act(() => useSessionStore.setState({ lastAction: null }));
    const pop = await menu(user);
    expect(within(pop).getAllByRole('button')[0]).toHaveTextContent('Undo last action');
  });
});
