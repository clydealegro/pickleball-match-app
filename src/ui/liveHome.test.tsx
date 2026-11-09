import { cleanup, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { newTestSession } from '../engine/testing';
import { resetHistoryDbForTests } from '../store/historyDb';
import { useHistoryStore } from '../store/historyStore';
import { resetRosterDbForTests } from '../store/rosterDb';
import { useRosterStore } from '../store/rosterStore';
import { useSessionStore } from '../store/sessionStore';
import { useSlotsStore } from '../store/slots';
import App from './App';
import { LiveScreen } from './LiveScreen';
import { BLANK_SLOTS } from '../store/slotsFixture';

// Friday 13 Nov 2026, noon.
const FRIDAY = new Date(2026, 10, 13, 12);
const running = () => newTestSession(['Ann', 'Ben', 'Cy', 'Dee', 'Eve'], { courts: 2 });

beforeEach(async () => {
  localStorage.clear();
  localStorage.setItem('pickleball.autoStart', 'true');
  window.history.replaceState(null, '');
  useSessionStore.setState({ session: null, undoStack: [], saveFailed: false });
  useSlotsStore.setState({ slots: BLANK_SLOTS.slots.map((s) => ({ ...s })), venues: [], tonight: {} });
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
});

const setup = () => userEvent.setup({ advanceTimers: () => {} });
const menuItems = () => within(document.querySelector<HTMLElement>('.menu-pop')!).getAllByRole('button').map((b) => b.textContent);

describe('the live screen header', () => {
  it('has a Home button that calls onHome, and no account button', async () => {
    const onHome = vi.fn();
    const user = setup();
    render(<LiveScreen session={running()} onHome={onHome} onSettings={() => {}} onShowBoard={() => {}} />);
    await user.click(screen.getByRole('button', { name: 'Home' }));
    expect(onHome).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole('button', { name: /^Settings/ })).not.toBeInTheDocument();
  });

  it('puts Settings first in the menu and calls onSettings from it', async () => {
    const onSettings = vi.fn();
    const user = setup();
    render(<LiveScreen session={running()} onHome={() => {}} onSettings={onSettings} onShowBoard={() => {}} />);
    await user.click(screen.getByRole('button', { name: 'Menu' }));
    expect(menuItems()[0]).toBe('Settings');
    await user.click(screen.getByRole('button', { name: 'Settings' }));
    expect(onSettings).toHaveBeenCalledTimes(1);
  });
});

describe('the Show board item', () => {
  it('follows Settings in the menu and calls onShowBoard', async () => {
    const onShowBoard = vi.fn();
    const user = setup();
    render(<LiveScreen session={running()} onHome={() => {}} onSettings={() => {}} onShowBoard={onShowBoard} />);
    await user.click(screen.getByRole('button', { name: 'Menu' }));
    expect(menuItems().slice(0, 2)).toEqual(['Settings', 'Show board']);
    await user.click(screen.getByRole('button', { name: 'Show board' }));
    expect(onShowBoard).toHaveBeenCalledTimes(1);
  });
});

describe('Home from the live screen, in the app', () => {
  it('opens Settings from the menu, and Back returns to the live screen', async () => {
    useSessionStore.setState({ session: running() });
    const user = setup();
    render(<App />);
    await user.click(screen.getByRole('button', { name: 'Menu' }));
    await user.click(screen.getByRole('button', { name: 'Settings' }));
    expect(screen.getByRole('heading', { name: 'Settings' })).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Back' }));
    expect(screen.getByRole('tablist', { name: 'Courts' })).toBeInTheDocument();
  });

  it('shows the Live hero on Home and hides the chips', async () => {
    useSessionStore.setState({ session: running() });
    const user = setup();
    render(<App />);
    await user.click(screen.getByRole('button', { name: 'Home' }));
    expect(screen.getByText(/^Live ·/)).toBeInTheDocument();
    expect(screen.queryByRole('radiogroup', { name: 'Sessions' })).not.toBeInTheDocument();
    expect(screen.queryByRole('tablist', { name: 'Courts' })).not.toBeInTheDocument();
  });

  it('returns to the live screen from Back to session', async () => {
    useSessionStore.setState({ session: running() });
    const user = setup();
    render(<App />);
    await user.click(screen.getByRole('button', { name: 'Home' }));
    await user.click(screen.getByRole('button', { name: 'Back to session' }));
    expect(screen.getByRole('tablist', { name: 'Courts' })).toBeInTheDocument();
  });

  it('leaves the running session untouched by the round trip', async () => {
    const before = running();
    useSessionStore.setState({ session: before });
    const user = setup();
    render(<App />);
    await user.click(screen.getByRole('button', { name: 'Home' }));
    await user.click(screen.getByRole('button', { name: 'Back to session' }));
    expect(useSessionStore.getState().session).toBe(before);
  });

  it('cannot start another session from Home over a running session', async () => {
    useSessionStore.setState({ session: running() });
    const user = setup();
    render(<App />);
    await user.click(screen.getByRole('button', { name: 'Home' }));
    expect(screen.queryByRole('button', { name: /^Start/ })).not.toBeInTheDocument();
    expect(screen.queryByRole('radio')).not.toBeInTheDocument();
    expect(screen.getAllByRole('button', { name: 'Back to session' })).toHaveLength(1);
  });

  it('lands on the live screen with a running session at load, and on Home without one', () => {
    useSessionStore.setState({ session: running() });
    const { unmount } = render(<App />);
    expect(screen.getByRole('tablist', { name: 'Courts' })).toBeInTheDocument();
    unmount();
    useSessionStore.setState({ session: null });
    render(<App />);
    expect(screen.getByRole('radiogroup', { name: 'Sessions' })).toBeInTheDocument();
  });
});
