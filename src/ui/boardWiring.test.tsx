import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { newTestSession } from '../engine/testing';
import { resetHistoryDbForTests } from '../store/historyDb';
import { useHistoryStore } from '../store/historyStore';
import { resetRosterDbForTests } from '../store/rosterDb';
import { useRosterStore } from '../store/rosterStore';
import { useSessionStore } from '../store/sessionStore';
import { DEFAULT_SLOTS, useSlotsStore } from '../store/slots';
import css from '../styles/app.css?raw';
import App from './App';

const running = () => newTestSession(['Ann', 'Ben', 'Cy', 'Dee', 'Eve'], { courts: 2 });
const endedSession = () => ({ ...running(), endedAt: Date.now() });

beforeEach(async () => {
  localStorage.clear();
  localStorage.setItem('pickleball.autoStart', 'true');
  window.history.replaceState({ pk: 0, view: 'home' }, '');
  window.history.pushState(null, '');
  useSessionStore.setState({ session: null, undoStack: [], saveFailed: false });
  useSlotsStore.setState({ slots: DEFAULT_SLOTS.slots.map((s) => ({ ...s })), venues: [], tonight: {} });
  await resetRosterDbForTests();
  await resetHistoryDbForTests();
  useRosterStore.setState({ players: [], loaded: false });
  useHistoryStore.setState({ entries: [], loaded: false, persistent: true });
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date(2026, 10, 13, 12));
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.restoreAllMocks();
  window.history.replaceState(null, '');
});

const setup = () => userEvent.setup({ advanceTimers: () => {} });
type User = ReturnType<typeof setup>;
const state = () => window.history.state as { pk: number; view: string };
const board = () => screen.queryByRole('main', { name: 'Board' });
const liveTabs = () => screen.queryByRole('tablist', { name: 'Courts' });
const phoneBack = () => act(() => window.history.back());
const pop = (st: unknown) => act(() => void window.dispatchEvent(new PopStateEvent('popstate', { state: st })));
const settle = () => act(() => new Promise<void>((r) => setTimeout(r, 20)));
const menuLabels = () => within(document.querySelector<HTMLElement>('.menu-pop')!).getAllByRole('button').map((b) => b.textContent);
const openBoard = async (user: User) => {
  await user.click(screen.getByRole('button', { name: 'Menu' }));
  await user.click(screen.getByRole('button', { name: 'Show board' }));
};

describe('Show board in the live menu', () => {
  it('sits directly after Settings', async () => {
    useSessionStore.setState({ session: running() });
    const user = setup();
    render(<App />);
    await user.click(screen.getByRole('button', { name: 'Menu' }));
    const labels = menuLabels();
    expect(labels[0]).toBe('Settings');
    expect(labels[1]).toBe('Show board');
  });

  it('opens the board and pushes one history entry', async () => {
    useSessionStore.setState({ session: running() });
    const user = setup();
    render(<App />);
    const length = window.history.length;
    await openBoard(user);
    expect(board()).toBeInTheDocument();
    expect(liveTabs()).not.toBeInTheDocument();
    expect(state()).toEqual({ pk: 1, view: 'board' });
    expect(window.history.length).toBe(length + 1);
  });

  it('hides the app title bar while the board is open', async () => {
    useSessionStore.setState({ session: running() });
    const user = setup();
    render(<App />);
    await openBoard(user);
    expect(document.querySelector('.app-header')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Home' })).not.toBeInTheDocument();
  });
});

describe('closing the board', () => {
  it('Close returns to the live screen and steps the history back', async () => {
    useSessionStore.setState({ session: running() });
    const back = vi.spyOn(window.history, 'back');
    const user = setup();
    render(<App />);
    await openBoard(user);
    await user.click(screen.getByRole('button', { name: 'Close board' }));
    expect(board()).not.toBeInTheDocument();
    expect(liveTabs()).toBeInTheDocument();
    expect(back).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(state()).toEqual({ pk: 0, view: 'live' }));
  });

  it('the Escape key returns to the live screen and steps the history back', async () => {
    useSessionStore.setState({ session: running() });
    const back = vi.spyOn(window.history, 'back');
    const user = setup();
    render(<App />);
    await openBoard(user);
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(board()).not.toBeInTheDocument();
    expect(liveTabs()).toBeInTheDocument();
    expect(back).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(state()).toEqual({ pk: 0, view: 'live' }));
  });

  it('the phone Back button returns to the live screen', async () => {
    useSessionStore.setState({ session: running() });
    const user = setup();
    render(<App />);
    await openBoard(user);
    phoneBack();
    expect(await screen.findByRole('tablist', { name: 'Courts' })).toBeInTheDocument();
    expect(board()).not.toBeInTheDocument();
    expect(state().pk).toBe(0);
  });

  it('leaves the session object untouched by the round trip', async () => {
    const before = running();
    useSessionStore.setState({ session: before });
    const user = setup();
    render(<App />);
    await openBoard(user);
    await user.click(screen.getByRole('button', { name: 'Close board' }));
    expect(useSessionStore.getState().session).toBe(before);
  });

  it('can be opened again after closing, with the history staying in step', async () => {
    useSessionStore.setState({ session: running() });
    const user = setup();
    render(<App />);
    await openBoard(user);
    await user.click(screen.getByRole('button', { name: 'Close board' }));
    await waitFor(() => expect(state().pk).toBe(0));
    await openBoard(user);
    expect(board()).toBeInTheDocument();
    expect(state()).toEqual({ pk: 1, view: 'board' });
  });

  it('shows the board again for a forward step onto its entry while the session runs', async () => {
    useSessionStore.setState({ session: running() });
    const user = setup();
    render(<App />);
    await openBoard(user);
    phoneBack();
    await screen.findByRole('tablist', { name: 'Courts' });
    act(() => window.history.forward());
    expect(await screen.findByRole('main', { name: 'Board' })).toBeInTheDocument();
  });
});

describe('a session that ends while the board is open', () => {
  it('shows the summary, and the board does not come back', async () => {
    useSessionStore.setState({ session: running() });
    const user = setup();
    render(<App />);
    await openBoard(user);
    act(() => useSessionStore.setState({ session: endedSession() }));
    expect(board()).not.toBeInTheDocument();
    expect(screen.getByText('Session summary')).toBeInTheDocument();
    // The entry the board held now holds the live screen, so nothing can step back onto the board.
    expect(state()).toEqual({ pk: 1, view: 'live' });
    phoneBack();
    await settle();
    expect(board()).not.toBeInTheDocument();
    expect(screen.getByText('Session summary')).toBeInTheDocument();
    act(() => window.history.forward());
    await settle();
    expect(board()).not.toBeInTheDocument();
    expect(screen.getByText('Session summary')).toBeInTheDocument();
  });

  it('lands on Home after Done, as before', async () => {
    useSessionStore.setState({ session: running() });
    const user = setup();
    render(<App />);
    await openBoard(user);
    act(() => useSessionStore.setState({ session: endedSession() }));
    await user.click(screen.getByRole('button', { name: 'Done' }));
    await waitFor(() => expect(screen.getByRole('radiogroup', { name: 'Sessions' })).toBeInTheDocument());
    expect(board()).not.toBeInTheDocument();
    expect(state()).toEqual({ pk: 0, view: 'home' });
  });

  it('does not reopen the board for a session that starts afterwards', async () => {
    useSessionStore.setState({ session: running() });
    const user = setup();
    render(<App />);
    await openBoard(user);
    act(() => useSessionStore.setState({ session: endedSession() }));
    await user.click(screen.getByRole('button', { name: 'Done' }));
    await waitFor(() => expect(screen.getByRole('radiogroup', { name: 'Sessions' })).toBeInTheDocument());
    act(() => useSessionStore.setState({ session: running() }));
    expect(board()).not.toBeInTheDocument();
    expect(await screen.findByRole('tablist', { name: 'Courts' })).toBeInTheDocument();
  });
});

describe('an entry for the board that cannot be shown', () => {
  it('never renders for a missing session', () => {
    render(<App />);
    pop({ pk: 1, view: 'board' });
    expect(board()).not.toBeInTheDocument();
    expect(screen.getByRole('radiogroup', { name: 'Sessions' })).toBeInTheDocument();
  });

  it('never renders for an ended session', () => {
    useSessionStore.setState({ session: endedSession() });
    render(<App />);
    pop({ pk: 1, view: 'board' });
    expect(board()).not.toBeInTheDocument();
    expect(screen.getByText('Session summary')).toBeInTheDocument();
  });

  it('falls back to the live screen after a reload that left the board state behind', () => {
    useSessionStore.setState({ session: running() });
    window.history.replaceState({ pk: 1, view: 'board' }, '');
    render(<App />);
    expect(board()).not.toBeInTheDocument();
    expect(liveTabs()).toBeInTheDocument();
    expect(state()).toEqual({ pk: 0, view: 'live' });
  });

  it('falls back safely for a board entry with no pk or a null session after the entry is replayed', async () => {
    useSessionStore.setState({ session: running() });
    const user = setup();
    render(<App />);
    await openBoard(user);
    act(() => useSessionStore.setState({ session: null }));
    expect(board()).not.toBeInTheDocument();
    expect(document.body.textContent).not.toBe('');
    pop({ view: 'board' });
    expect(board()).not.toBeInTheDocument();
    expect(screen.getByRole('radiogroup', { name: 'Sessions' })).toBeInTheDocument();
  });
});

describe('the board overlay', () => {
  it('sits above every other layer, the sheets and the app bars included', () => {
    const own = /(?:^|\})\s*\.board\s*\{([^}]*)\}/m.exec(css)![1];
    const boardZ = Number(/z-index:\s*(\d+)/.exec(own)![1]);
    const all = [...css.matchAll(/z-index:\s*(\d+)/g)].map((m) => Number(m[1]));
    expect(all.length).toBeGreaterThan(4);
    // Its own is the only one at that height or above.
    expect(all.filter((z) => z >= boardZ)).toHaveLength(1);
  });

  it('covers the whole screen', () => {
    const m = /(?:^|\})\s*\.board\s*\{([^}]*)\}/m.exec(css)!;
    expect(m[1]).toMatch(/position:\s*fixed/);
    expect(m[1]).toMatch(/inset:\s*0/);
  });
});
