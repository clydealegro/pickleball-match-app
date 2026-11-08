import { act, cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { finishGame } from '../engine/game';
import { makeCtx, newTestSession } from '../engine/testing';
import { resetHistoryDbForTests } from '../store/historyDb';
import { useHistoryStore } from '../store/historyStore';
import { resetRosterDbForTests } from '../store/rosterDb';
import { useRosterStore } from '../store/rosterStore';
import { useSessionStore } from '../store/sessionStore';
import { DEFAULT_SLOTS, useSlotsStore } from '../store/slots';
import { pastSession, seed } from '../test/historyFixtures';
import App from './App';

// Friday 13 Nov 2026, noon, as in the other screen history tests.
const FRIDAY = new Date(2026, 10, 13, 12);
const running = () => newTestSession(['Ann', 'Ben', 'Cy', 'Dee', 'Eve'], { courts: 2 });
const realSave = useHistoryStore.getState().save;

/** An ended session with one game, so leaving it can warn. */
function ended() {
  const ctx = makeCtx(1, 1_000_000);
  const live = newTestSession(['Ann', 'Ben', 'Cy', 'Dee'], { courts: 1 }, ctx);
  const s = finishGame(live, live.courts[0].id, { ...ctx, now: ctx.now + 600_000 });
  return { ...s, endedAt: ctx.now + 700_000 };
}

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
  useHistoryStore.setState({ entries: [], loaded: false, persistent: true, save: realSave });
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
const phoneBack = () => act(() => window.history.back());
/** The logo button in the app's title bar. */
const logo = () => within(document.querySelector<HTMLElement>('.app-header')!).getByRole('button', { name: 'Home' });
const toSetup = async (user: User) => {
  await user.click(screen.getByRole('radio', { name: 'Thu 19' }));
  await click(user, 'Start session, Thursday');
};
/** History that cannot keep the session, so the summary is the only copy. */
const unkept = () => useHistoryStore.setState({ save: vi.fn().mockResolvedValue(undefined) });

describe('the logo on Home', () => {
  it('is the Home button, marked as the current page, and does nothing', async () => {
    const user = setup();
    render(<App />);
    expect(logo()).toHaveAttribute('aria-current', 'page');
    expect(logo()).toBeDisabled();
    const length = window.history.length;
    await user.click(logo());
    expect(state()).toEqual({ pk: 0, view: 'home' });
    expect(window.history.length).toBe(length);
    expect(sessions()).toBeInTheDocument();
  });

  it('is inert on Home over a running session too', () => {
    useSessionStore.setState({ session: running() });
    render(<App />);
    act(() => void screen.getByRole('button', { name: 'Home' }).click());
    expect(screen.getByRole('button', { name: 'Home' })).toBeInTheDocument();
    expect(logo()).toHaveAttribute('aria-current', 'page');
  });

  it('has a decorative picture inside, so its name is just Home', () => {
    render(<App />);
    expect(logo().getAttribute('aria-label')).toBe('Home');
    expect(logo().querySelector('img')!.getAttribute('alt')).toBe('');
  });
});

describe('the logo from other screens', () => {
  it('is a live Home button on Settings, with no current-page mark', () => {
    render(<App />);
    act(() => void screen.getByRole('button', { name: /^Settings/ }).click());
    expect(logo()).toBeEnabled();
    expect(logo()).not.toHaveAttribute('aria-current');
  });

  it('goes Home from Who’s playing with one pushed entry, and Back returns to it with the half-filled form', async () => {
    const user = setup();
    render(<App />);
    await toSetup(user);
    await user.type(screen.getByLabelText('Search or add players'), 'Fri');
    const length = window.history.length;
    await user.click(logo());
    expect(sessions()).toBeInTheDocument();
    expect(state()).toEqual({ pk: 2, view: 'home' });
    expect(window.history.length).toBe(length + 1);
    phoneBack();
    await waitFor(() => expect(state()).toEqual({ pk: 1, view: 'setup' }));
    expect(screen.getByRole('heading', { name: 'Who’s playing?' })).toBeInTheDocument();
    expect(sessions()).not.toBeInTheDocument();
    expect(screen.getByLabelText('Search or add players')).toHaveValue('Fri');
  });

  it('goes Home from Settings, and Back returns to Settings', async () => {
    const user = setup();
    render(<App />);
    await click(user, /^Settings/);
    await user.click(logo());
    expect(sessions()).toBeInTheDocument();
    expect(state()).toEqual({ pk: 2, view: 'home' });
    phoneBack();
    expect(await screen.findByRole('heading', { name: 'Settings' })).toBeInTheDocument();
  });

  it('goes Home from Saved players, and Back returns to Saved players', async () => {
    const user = setup();
    render(<App />);
    await click(user, /^Settings/);
    await click(user, 'Manage players');
    await user.click(logo());
    expect(sessions()).toBeInTheDocument();
    expect(state()).toEqual({ pk: 3, view: 'home' });
    phoneBack();
    expect(await screen.findByRole('heading', { name: 'Saved players' })).toBeInTheDocument();
  });

  it('goes Home from Past sessions, and Back returns to the list', async () => {
    const group = ['Ann', 'Ben', 'Cy', 'Dee'];
    await pastSession(group, await seed(group), 2026, 10, 5);
    const user = setup();
    render(<App />);
    await user.click(await screen.findByRole('button', { name: /^Last:/ }));
    await user.click(logo());
    expect(sessions()).toBeInTheDocument();
    expect(state()).toEqual({ pk: 2, view: 'home' });
    phoneBack();
    expect(await screen.findByRole('heading', { name: 'Past sessions' })).toBeInTheDocument();
  });

  it('goes Home from a past session’s summary, and Back returns to the summary', async () => {
    const group = ['Ann', 'Ben', 'Cy', 'Dee'];
    await pastSession(group, await seed(group), 2026, 10, 5);
    const user = setup();
    render(<App />);
    await user.click(await screen.findByRole('button', { name: /^Last:/ }));
    await user.click(screen.getByRole('button', { name: /Open play/ }));
    await user.click(logo());
    expect(sessions()).toBeInTheDocument();
    expect(state()).toEqual({ pk: 3, view: 'home' });
    phoneBack();
    expect(await screen.findByText('Session summary')).toBeInTheDocument();
  });

  it('goes Home over a running session from Settings, keeping the session, and Back returns to Settings', async () => {
    useSessionStore.setState({ session: running() });
    const user = setup();
    render(<App />);
    await click(user, 'Home');
    await click(user, /^Settings/);
    await user.click(logo());
    expect(screen.getByText(/^Live ·/)).toBeInTheDocument();
    expect(useSessionStore.getState().session).not.toBeNull();
    expect(state()).toEqual({ pk: 3, view: 'home' });
    phoneBack();
    expect(await screen.findByRole('heading', { name: 'Settings' })).toBeInTheDocument();
  });

  it('is not on the live screen, which keeps its own house button', () => {
    useSessionStore.setState({ session: running() });
    render(<App />);
    expect(document.querySelector('.app-header')).toBeNull();
    expect(screen.getAllByRole('button', { name: 'Home' })).toHaveLength(1);
  });
});

describe('the logo on the summary of the session that just ended', () => {
  it('does what Done does when the session is kept: lands on Home and replaces the entry', async () => {
    useSessionStore.setState({ session: ended() });
    const confirm = vi.spyOn(window, 'confirm');
    const user = setup();
    render(<App />);
    await waitFor(() => expect(useHistoryStore.getState().entries).toHaveLength(1));
    expect(state()).toEqual({ pk: 0, view: 'live' });
    const length = window.history.length;
    await user.click(logo());
    await waitFor(() => expect(sessions()).toBeInTheDocument());
    expect(confirm).not.toHaveBeenCalled();
    expect(useSessionStore.getState().session).toBeNull();
    expect(state()).toEqual({ pk: 0, view: 'home' });
    expect(window.history.length).toBe(length);
  });

  it('asks first when the summary could not be kept and was not shared, and stays when declined', async () => {
    unkept();
    useSessionStore.setState({ session: ended() });
    const confirm = vi.spyOn(window, 'confirm').mockReturnValueOnce(false).mockReturnValueOnce(true);
    const user = setup();
    render(<App />);
    await user.click(logo());
    expect(confirm).toHaveBeenCalledWith('Close this summary? It could not be saved to Past sessions and you have not shared it yet.');
    expect(useSessionStore.getState().session).not.toBeNull();
    expect(screen.getByText('Session summary')).toBeInTheDocument();
    await user.click(logo());
    await waitFor(() => expect(sessions()).toBeInTheDocument());
    expect(useSessionStore.getState().session).toBeNull();
  });

  it('does not ask once the summary has been shared', async () => {
    unkept();
    useSessionStore.setState({ session: ended() });
    vi.stubGlobal('navigator', Object.assign(Object.create(navigator), { share: vi.fn().mockResolvedValue(undefined) }));
    const confirm = vi.spyOn(window, 'confirm');
    const user = setup();
    render(<App />);
    await click(user, 'Share');
    await click(user, 'As text');
    await user.click(logo());
    await waitFor(() => expect(sessions()).toBeInTheDocument());
    expect(confirm).not.toHaveBeenCalled();
    vi.unstubAllGlobals();
  });

  it('asks too from Settings opened over the summary, where the summary is not on screen to say it was shared', async () => {
    unkept();
    useSessionStore.setState({ session: ended() });
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false);
    const user = setup();
    render(<App />);
    await click(user, /^Settings/);
    await user.click(logo());
    expect(confirm).toHaveBeenCalledTimes(1);
    expect(useSessionStore.getState().session).not.toBeNull();
    expect(screen.getByRole('heading', { name: 'Settings' })).toBeInTheDocument();
  });

  it('is still the Done route when nothing was played: no question, Home at once', async () => {
    unkept();
    const empty = { ...newTestSession(['Ann', 'Ben', 'Cy', 'Dee'], { courts: 1 }), endedAt: 5 };
    useSessionStore.setState({ session: empty });
    const confirm = vi.spyOn(window, 'confirm');
    const user = setup();
    render(<App />);
    await user.click(logo());
    await waitFor(() => expect(sessions()).toBeInTheDocument());
    expect(confirm).not.toHaveBeenCalled();
  });
});
