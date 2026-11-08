import { act, cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { newTestSession } from '../engine/testing';
import { resetHistoryDbForTests } from '../store/historyDb';
import { useHistoryStore } from '../store/historyStore';
import { resetRosterDbForTests } from '../store/rosterDb';
import { useRosterStore } from '../store/rosterStore';
import { useSessionStore } from '../store/sessionStore';
import { DEFAULT_SLOTS, useSlotsStore } from '../store/slots';
import { pastSession, seed } from '../test/historyFixtures';
import App from './App';

// Friday 13 Nov 2026, noon. The chips read Sat 14, Tue 17 and Thu 19.
const FRIDAY = new Date(2026, 10, 13, 12);
const running = () => newTestSession(['Ann', 'Ben', 'Cy', 'Dee', 'Eve'], { courts: 2 });

beforeEach(async () => {
  localStorage.clear();
  localStorage.setItem('pickleball.autoStart', 'true');
  // Real jsdom history. A known Home entry sits under the one the app mounts on, so a Back past the first
  // screen has somewhere harmless to land.
  window.history.replaceState({ pk: 0, view: 'home' }, '');
  window.history.pushState(null, '');
  useSessionStore.setState({ session: null, undoStack: [], saveFailed: false });
  useSlotsStore.setState({ slots: DEFAULT_SLOTS.slots.map((s) => ({ ...s })), venues: [], tonight: {} });
  await resetRosterDbForTests();
  await resetHistoryDbForTests();
  useRosterStore.setState({ players: [], loaded: false });
  useHistoryStore.setState({ entries: [], loaded: false, persistent: true });
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(FRIDAY);
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.restoreAllMocks();
  window.history.replaceState(null, '');
});

const setup = () => userEvent.setup({ advanceTimers: () => {} });
type User = ReturnType<typeof setup>;
const click = (user: User, name: string | RegExp) => user.click(screen.getByRole('button', { name }));
const state = () => window.history.state as { pk: number; view: string };
const sessions = () => screen.queryByRole('radiogroup', { name: 'Sessions' });
const whoIsPlaying = () => screen.queryByRole('heading', { name: 'Who’s playing?' });
const phoneBack = () => act(() => window.history.back());
const pop = (st: unknown) => act(() => void window.dispatchEvent(new PopStateEvent('popstate', { state: st })));
const toSetup = async (user: User) => {
  await user.click(screen.getByRole('radio', { name: 'Thu 19' }));
  await click(user, 'Start session, Thursday');
};

describe('the first entry', () => {
  it('is marked as the root on load, with Home', () => {
    render(<App />);
    expect(state()).toEqual({ pk: 0, view: 'home' });
  });

  it('is marked with the live screen when a session is running at load', () => {
    useSessionStore.setState({ session: running() });
    render(<App />);
    expect(state()).toEqual({ pk: 0, view: 'live' });
  });

  it('survives a reload that left a foreign state behind', () => {
    window.history.replaceState('something else', '');
    render(<App />);
    expect(state()).toEqual({ pk: 0, view: 'home' });
    expect(sessions()).toBeInTheDocument();
  });
});

describe('forward moves push an entry', () => {
  it('pushes Who’s playing from Home', async () => {
    const user = setup();
    render(<App />);
    const length = window.history.length;
    await toSetup(user);
    expect(state()).toEqual({ pk: 1, view: 'setup' });
    expect(window.history.length).toBe(length + 1);
  });

  it('pushes Settings, Saved players and Past sessions in turn', async () => {
    const user = setup();
    render(<App />);
    await click(user, /^Settings/);
    expect(state()).toEqual({ pk: 1, view: 'settings' });
    await click(user, 'Manage players');
    expect(state()).toEqual({ pk: 2, view: 'saved' });
  });

  it('pushes Settings from the live menu and Home from the house button', async () => {
    useSessionStore.setState({ session: running() });
    const user = setup();
    render(<App />);
    await click(user, 'Home');
    expect(state()).toEqual({ pk: 1, view: 'home' });
    await click(user, /^Settings/);
    expect(state()).toEqual({ pk: 2, view: 'settings' });
  });

  it('pushes the list and then the summary for View summary on Home', async () => {
    const group = ['Ann', 'Ben', 'Cy', 'Dee'];
    const ids = await seed(group);
    await pastSession(group, ids, 2026, 10, 12, 'Thursday night');
    const user = setup();
    render(<App />);
    await user.click(await screen.findByRole('button', { name: 'View summary' }));
    expect(state()).toEqual({ pk: 2, view: 'summary' });
  });
});

describe('the phone’s Back button', () => {
  it('goes from Who’s playing back to Home', async () => {
    const user = setup();
    render(<App />);
    await toSetup(user);
    expect(whoIsPlaying()).toBeInTheDocument();
    phoneBack();
    await waitFor(() => expect(sessions()).toBeInTheDocument());
    expect(whoIsPlaying()).not.toBeInTheDocument();
    expect(state().pk).toBe(0);
  });

  it('goes from Saved players to Settings to Home', async () => {
    const user = setup();
    render(<App />);
    await click(user, /^Settings/);
    await click(user, 'Manage players');
    expect(screen.getByRole('heading', { name: 'Saved players' })).toBeInTheDocument();
    phoneBack();
    expect(await screen.findByRole('heading', { name: 'Settings' })).toBeInTheDocument();
    phoneBack();
    await waitFor(() => expect(sessions()).toBeInTheDocument());
  });

  it('goes from a summary to Past sessions to Home', async () => {
    const group = ['Ann', 'Ben', 'Cy', 'Dee'];
    const ids = await seed(group);
    await pastSession(group, ids, 2026, 10, 5);
    const user = setup();
    render(<App />);
    await user.click(await screen.findByRole('button', { name: /^Last:/ }));
    await user.click(screen.getByRole('button', { name: /Open play/ }));
    expect(screen.getByRole('heading', { name: 'Session summary' })).toBeInTheDocument();
    expect(state()).toEqual({ pk: 2, view: 'summary' });
    phoneBack();
    expect(await screen.findByRole('heading', { name: 'Past sessions' })).toBeInTheDocument();
    phoneBack();
    await waitFor(() => expect(sessions()).toBeInTheDocument());
  });

  it('goes from Home back to the live screen', async () => {
    useSessionStore.setState({ session: running() });
    const user = setup();
    render(<App />);
    await click(user, 'Home');
    expect(screen.getByText(/^Live ·/)).toBeInTheDocument();
    phoneBack();
    expect(await screen.findByRole('tablist', { name: 'Courts' })).toBeInTheDocument();
  });

  it('unmounts Who’s playing once Back has left it for Home, as its own Back does', async () => {
    const user = setup();
    render(<App />);
    await toSetup(user);
    expect(screen.getByLabelText('Search or add players')).toBeInTheDocument();
    phoneBack();
    await waitFor(() => expect(sessions()).toBeInTheDocument());
    expect(screen.queryByLabelText('Search or add players', { selector: 'input' })).not.toBeInTheDocument();
    expect(document.querySelector('[hidden]')).toBeNull();
  });

  it('keeps a half-filled Who’s playing while Settings is open on top of it', async () => {
    const user = setup();
    render(<App />);
    await toSetup(user);
    await user.type(screen.getByLabelText('Search or add players'), 'Ann{enter}');
    await click(user, /^Settings/);
    phoneBack();
    await screen.findByRole('checkbox', { name: 'Ann' });
    expect(screen.getByRole('checkbox', { name: 'Ann' })).toBeChecked();
  });
});

describe('the in-app Back buttons', () => {
  it('show the previous screen at once and step the history back with it', async () => {
    const back = vi.spyOn(window.history, 'back');
    const user = setup();
    render(<App />);
    await toSetup(user);
    await click(user, 'Back');
    expect(sessions()).toBeInTheDocument();
    expect(back).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(state().pk).toBe(0));
    expect(sessions()).toBeInTheDocument();
  });

  it('leave the stack consistent, so a phone Back afterwards does not break', async () => {
    const user = setup();
    render(<App />);
    await toSetup(user);
    await click(user, 'Back');
    await waitFor(() => expect(state().pk).toBe(0));
    phoneBack();
    await new Promise((r) => setTimeout(r, 20));
    expect(sessions()).toBeInTheDocument();
    expect(whoIsPlaying()).not.toBeInTheDocument();
  });

  it('step Saved players, Settings and Home back one at a time', async () => {
    const user = setup();
    render(<App />);
    await click(user, /^Settings/);
    await click(user, 'Manage players');
    await click(user, 'Back');
    expect(screen.getByRole('heading', { name: 'Settings' })).toBeInTheDocument();
    await waitFor(() => expect(state()).toEqual({ pk: 1, view: 'settings' }));
    await click(user, 'Back');
    expect(sessions()).toBeInTheDocument();
    await waitFor(() => expect(state().pk).toBe(0));
  });

  it('step a summary back to Past sessions and then Home', async () => {
    const group = ['Ann', 'Ben', 'Cy', 'Dee'];
    const ids = await seed(group);
    await pastSession(group, ids, 2026, 10, 12, 'Thursday night');
    const user = setup();
    render(<App />);
    await user.click(await screen.findByRole('button', { name: 'View summary' }));
    await click(user, 'Back');
    expect(screen.getByRole('heading', { name: 'Past sessions' })).toBeInTheDocument();
    await waitFor(() => expect(state()).toEqual({ pk: 1, view: 'history' }));
    await click(user, 'Back');
    expect(sessions()).toBeInTheDocument();
    await waitFor(() => expect(state().pk).toBe(0));
  });

  it('return to the live screen from Settings opened in the live menu', async () => {
    useSessionStore.setState({ session: running() });
    const user = setup();
    render(<App />);
    await click(user, 'Menu');
    await click(user, 'Settings');
    await click(user, 'Back');
    expect(screen.getByRole('tablist', { name: 'Courts' })).toBeInTheDocument();
    await waitFor(() => expect(state()).toEqual({ pk: 0, view: 'live' }));
  });

  it('make Back to session step the history back when Home was pushed over the live screen', async () => {
    useSessionStore.setState({ session: running() });
    const back = vi.spyOn(window.history, 'back');
    const user = setup();
    render(<App />);
    await click(user, 'Home');
    await click(user, 'Back to session');
    expect(screen.getByRole('tablist', { name: 'Courts' })).toBeInTheDocument();
    expect(back).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(state()).toEqual({ pk: 0, view: 'live' }));
  });

  it('make Back to session push the live screen when Home is the entry below it', async () => {
    const user = setup();
    render(<App />);
    await toSetup(user);
    await user.type(screen.getByLabelText('Search or add players'), 'Ann{enter}Ben{enter}Cy{enter}Dee{enter}');
    await user.click(await screen.findByRole('button', { name: 'Start 4 players' }));
    expect(screen.getByRole('tablist', { name: 'Courts' })).toBeInTheDocument();
    expect(state()).toEqual({ pk: 1, view: 'live' });
    phoneBack();
    expect(await screen.findByText(/^Live ·/)).toBeInTheDocument();
    await click(user, 'Back to session');
    expect(screen.getByRole('tablist', { name: 'Courts' })).toBeInTheDocument();
    expect(state()).toEqual({ pk: 1, view: 'live' });
  });
});

describe('an entry the app cannot show', () => {
  it.each([
    ['null', null],
    ['a foreign object', { foo: 'bar' }],
    ['a string', 'garbage'],
    ['an unknown view', { pk: 2, view: 'nowhere' }],
  ])('falls back to Home for %s', async (_name, st) => {
    const user = setup();
    render(<App />);
    await click(user, /^Settings/);
    expect(screen.getByRole('heading', { name: 'Settings' })).toBeInTheDocument();
    pop(st);
    expect(sessions()).toBeInTheDocument();
  });

  it('falls back to the live screen when a session is running', async () => {
    useSessionStore.setState({ session: running() });
    const user = setup();
    render(<App />);
    await click(user, 'Home');
    pop(null);
    expect(screen.getByRole('tablist', { name: 'Courts' })).toBeInTheDocument();
  });

  it('shows Home for Who’s playing when there is no plan or draft', () => {
    render(<App />);
    pop({ pk: 1, view: 'setup' });
    expect(sessions()).toBeInTheDocument();
    expect(whoIsPlaying()).not.toBeInTheDocument();
  });

  it('shows Home for a summary entry that no longer knows its session', () => {
    render(<App />);
    pop({ pk: 2, view: 'summary' });
    expect(screen.getByRole('heading', { name: 'Past sessions' })).toBeInTheDocument();
  });
});

describe('Start new session', () => {
  it('lands on Home and replaces the current entry with the root marker', async () => {
    const ended = { ...newTestSession(['A', 'B', 'C', 'D'], { courts: 1 }), endedAt: Date.now() };
    useSessionStore.setState({ session: ended });
    const user = setup();
    render(<App />);
    expect(state()).toEqual({ pk: 0, view: 'live' });
    const length = window.history.length;
    await click(user, 'Start new session');
    await waitFor(() => expect(sessions()).toBeInTheDocument());
    expect(state()).toEqual({ pk: 0, view: 'home' });
    expect(window.history.length).toBe(length);
  });
});
