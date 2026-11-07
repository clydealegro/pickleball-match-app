import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { resetHistoryDbForTests } from '../store/historyDb';
import { useHistoryStore } from '../store/historyStore';
import { resetRosterDbForTests } from '../store/rosterDb';
import { useRosterStore } from '../store/rosterStore';
import { useSessionStore } from '../store/sessionStore';
import { pastSession, seed } from '../test/historyFixtures';
import App from './App';
import { setDefaultMode } from './matchmaking';

beforeEach(async () => {
  localStorage.clear();
  setDefaultMode('fairness');
  useSessionStore.setState({ session: null, undoStack: [], saveFailed: false });
  await resetRosterDbForTests();
  await resetHistoryDbForTests();
  useRosterStore.setState({ players: [], loaded: false });
  useHistoryStore.setState({ entries: [], loaded: false, persistent: true });
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

const openSettings = (user: ReturnType<typeof userEvent.setup>) => user.click(screen.getByRole('button', { name: 'Settings' }));

describe('Saved players shows who comes', () => {
  it('says how often and when, and that someone has not played', async () => {
    const names = ['Ann', 'Ben', 'Cy', 'Dee'];
    const ids = await seed([...names, 'Newbie']);
    await pastSession(names, ids, 2026, 10, 4);
    await pastSession(names.slice(0, 2).concat(['Cy', 'Dee']), ids, 2026, 10, 11);
    const user = userEvent.setup();
    render(<App />);
    await user.click(await screen.findByRole('button', { name: /edit players/i }));
    expect(await screen.findAllByText('2 sessions, last Wed 11 Nov')).toHaveLength(4);
    const rows = screen.getAllByRole('listitem');
    expect(rows.find((r) => r.textContent?.includes('Newbie'))).toHaveTextContent('No sessions yet');
  });
});

describe('Setup puts regulars first', () => {
  async function names() {
    const user = userEvent.setup();
    render(<App />);
    await waitFor(() => expect(useHistoryStore.getState().loaded).toBe(true));
    await waitFor(() => expect(useRosterStore.getState().loaded).toBe(true));
    return { user, order: () => within(screen.getByRole('list', { name: 'Saved players' })).getAllByRole('listitem').map((li) => li.querySelector('.row-name')?.textContent) };
  }

  it('lists the most frequent players first', async () => {
    const all = ['Ann', 'Ben', 'Cy', 'Dee', 'Zed'];
    const ids = await seed(all);
    await pastSession(['Zed', 'Cy', 'Ann', 'Ben'], ids, 2026, 10, 1);
    await pastSession(['Zed', 'Cy', 'Dee', 'Ben'], ids, 2026, 10, 2);
    await pastSession(['Zed', 'Cy', 'Dee', 'Ann'], ids, 2026, 10, 3);
    const { order } = await names();
    await waitFor(() => expect(order()[0]).toBe('Cy'));
    expect(order()).toEqual(['Cy', 'Zed', 'Ann', 'Dee', 'Ben']);
  });

  it('keeps alphabetical order when switched off in Settings', async () => {
    const ids = await seed(['Ann', 'Ben', 'Cy', 'Dee', 'Zed']);
    await pastSession(['Zed', 'Cy', 'Dee', 'Ben'], ids, 2026, 10, 1);
    await pastSession(['Zed', 'Cy', 'Dee', 'Ben'], ids, 2026, 10, 2);
    localStorage.setItem('pickleball.regularsFirst', 'false');
    const { order } = await names();
    expect(order()).toEqual(['Ann', 'Ben', 'Cy', 'Dee', 'Zed']);
  });

  it('has the switch in Settings, on by default', async () => {
    const user = userEvent.setup();
    render(<App />);
    await openSettings(user);
    const sw = screen.getByRole('switch', { name: 'Show regulars first' });
    expect(sw).toBeChecked();
    await user.click(sw);
    expect(localStorage.getItem('pickleball.regularsFirst')).toBe('false');
  });
});

describe('the weekday chip', () => {
  const group = ['Ann', 'Ben', 'Cy', 'Dee'];
  it('offers this weekday’s regulars once they have come twice', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date(2026, 10, 18, 12)); // a Wednesday
    const ids = await seed([...group, 'Eve']);
    await pastSession(group, ids, 2026, 10, 4);
    await pastSession(group, ids, 2026, 10, 11);
    await pastSession(['Eve', 'Ann', 'Ben', 'Cy'], ids, 2026, 10, 12); // a Thursday
    render(<App />);
    const chip = await screen.findByRole('button', { name: 'Wednesday regulars (4)' });
    vi.useRealTimers();
    await userEvent.setup().click(chip);
    expect(screen.getByText('4 selected')).toBeInTheDocument();
    expect(screen.getByRole('checkbox', { name: /Eve/ })).not.toBeChecked();
  });

  it('is not offered when fewer than four are regulars', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date(2026, 10, 18, 12)); // a Wednesday
    const ids = await seed([...group, 'Eve']);
    await pastSession(group, ids, 2026, 10, 4);
    await pastSession(['Ann', 'Ben', 'Cy', 'Eve'], ids, 2026, 10, 11);
    render(<App />);
    await waitFor(() => expect(useHistoryStore.getState().loaded).toBe(true));
    expect(screen.queryByRole('button', { name: /regulars \(/ })).not.toBeInTheDocument();
  });

  it('is not offered with fewer than four, or on a day with no pattern', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date(2026, 10, 19, 12)); // a Thursday
    const ids = await seed(group);
    await pastSession(group, ids, 2026, 10, 4);
    await pastSession(group, ids, 2026, 10, 11);
    render(<App />);
    await waitFor(() => expect(useHistoryStore.getState().loaded).toBe(true));
    expect(screen.queryByRole('button', { name: /regulars \(/ })).not.toBeInTheDocument();
  });
});
