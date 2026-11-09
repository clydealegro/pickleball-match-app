import { act, cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Session } from '../engine';
import { newTestSession } from '../engine/testing';
import { resetHistoryDbForTests } from '../store/historyDb';
import { useHistoryStore } from '../store/historyStore';
import { resetRosterDbForTests } from '../store/rosterDb';
import { useRosterStore } from '../store/rosterStore';
import { useSessionStore } from '../store/sessionStore';
import { useSlotsStore } from '../store/slots';
import App from './App';
import { BLANK_SLOTS } from '../store/slotsFixture';

// Every session the board was drawn with, so a render for an ended session shows up even if it lasts one frame.
const drawn: Session[] = [];
vi.mock('./BoardScreen', async (importOriginal) => {
  const real = await importOriginal<typeof import('./BoardScreen')>();
  return {
    ...real,
    BoardScreen: (props: Parameters<typeof real.BoardScreen>[0]) => {
      drawn.push(props.session);
      return real.BoardScreen(props);
    },
  };
});

const running = () => newTestSession(['Ann', 'Ben', 'Cy', 'Dee', 'Eve'], { courts: 2 });

beforeEach(async () => {
  drawn.length = 0;
  localStorage.clear();
  localStorage.setItem('pickleball.autoStart', 'true');
  window.history.replaceState({ pk: 0, view: 'home' }, '');
  window.history.pushState(null, '');
  useSessionStore.setState({ session: null, undoStack: [], saveFailed: false });
  useSlotsStore.setState({ slots: BLANK_SLOTS.slots.map((s) => ({ ...s })), venues: [], tonight: {} });
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

describe('the board is only ever drawn for a running session', () => {
  it('is drawn with the running session while open', async () => {
    useSessionStore.setState({ session: running() });
    const user = userEvent.setup({ advanceTimers: () => {} });
    render(<App />);
    await user.click(screen.getByRole('button', { name: 'Menu' }));
    await user.click(screen.getByRole('button', { name: 'Show board' }));
    expect(drawn.length).toBeGreaterThan(0);
    expect(drawn.every((s) => s.endedAt === undefined)).toBe(true);
  });

  it('is not drawn again, not even for one frame, once the session has ended', async () => {
    useSessionStore.setState({ session: running() });
    const user = userEvent.setup({ advanceTimers: () => {} });
    render(<App />);
    await user.click(screen.getByRole('button', { name: 'Menu' }));
    await user.click(screen.getByRole('button', { name: 'Show board' }));
    drawn.length = 0;
    act(() => useSessionStore.setState({ session: { ...running(), endedAt: Date.now() } }));
    expect(drawn).toEqual([]);
    expect(screen.getByText('Session summary')).toBeInTheDocument();
  });

  it('is not drawn for an ended session found at load with a board entry', () => {
    useSessionStore.setState({ session: { ...running(), endedAt: Date.now() } });
    window.history.replaceState({ pk: 1, view: 'board' }, '');
    render(<App />);
    act(() => void window.dispatchEvent(new PopStateEvent('popstate', { state: { pk: 1, view: 'board' } })));
    expect(drawn).toEqual([]);
  });
});
