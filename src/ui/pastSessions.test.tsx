import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { makeCtx, newTestSession } from '../engine/testing';
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

describe('Past sessions', () => {
  it('is empty at first', async () => {
    const user = userEvent.setup();
    render(<App />);
    await openSettings(user);
    await user.click(screen.getByRole('button', { name: 'Past sessions' }));
    expect(await screen.findByText(/Nothing here yet/)).toBeInTheDocument();
  });

  it('lists sessions newest first, opens one read-only, and comes back', async () => {
    const names = ['Ann', 'Ben', 'Cy', 'Dee', 'Eve'];
    const ids = await seed(names);
    await pastSession(names, ids, 2026, 9, 1, 'Older night');
    await pastSession(names, ids, 2026, 10, 4, 'Newer night');
    const user = userEvent.setup();
    render(<App />);
    await openSettings(user);
    await user.click(screen.getByRole('button', { name: 'Past sessions' }));
    const rows = within(await screen.findByRole('list', { name: 'Past sessions' })).getAllByRole('button');
    expect(rows.map((r) => r.querySelector('.row-name')?.textContent)).toEqual(['Newer night', 'Older night']);
    expect(rows[0]).toHaveTextContent('Wed 4 Nov · 1 game · 5 players');
    await user.click(rows[0]);
    expect(screen.getByText('Session summary')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Done' })).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Back' }));
    expect(screen.getByRole('heading', { name: 'Past sessions' })).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Back' }));
    expect(screen.getByRole('heading', { name: 'Settings' })).toBeInTheDocument();
  });
});

describe('Past sessions venue', () => {
  async function openList(user: ReturnType<typeof userEvent.setup>) {
    render(<App />);
    await openSettings(user);
    await user.click(screen.getByRole('button', { name: 'Past sessions' }));
    return within(await screen.findByRole('list', { name: 'Past sessions' })).getAllByRole('button');
  }

  it('puts the venue between the date and the games when one is set', async () => {
    const names = ['Ann', 'Ben', 'Cy', 'Dee', 'Eve'];
    await pastSession(names, await seed(names), 2026, 10, 4, 'Hall night', 'Tacloban Sports Hall');
    const rows = await openList(userEvent.setup());
    expect(rows[0]).toHaveTextContent('Wed 4 Nov · Tacloban Sports Hall · 1 game · 5 players');
  });

  it('leaves the row as it was when there is no venue', async () => {
    const names = ['Ann', 'Ben', 'Cy', 'Dee', 'Eve'];
    await pastSession(names, await seed(names), 2026, 10, 4, 'Plain night');
    const rows = await openList(userEvent.setup());
    expect(rows[0]).toHaveTextContent(/^Plain nightWed 4 Nov · 1 game · 5 players$/);
  });
});

describe('ending a session keeps it', () => {
  it('shows an ended session in Past sessions after Done', async () => {
    const names = ['Ann', 'Ben', 'Cy', 'Dee'];
    const ids = await seed(names);
    const ctx = makeCtx(1, 1_000_000);
    const live = newTestSession(names, { courts: 1 }, ctx);
    useSessionStore.setState({
      session: { ...live, players: live.players.map((p) => ({ ...p, rosterId: ids.get(p.name) })), endedAt: ctx.now + 5 },
    });
    const user = userEvent.setup();
    render(<App />);
    await waitFor(() => expect(useHistoryStore.getState().entries).toHaveLength(1));
    await user.click(screen.getByRole('button', { name: 'Done' }));
    await openSettings(user);
    await user.click(screen.getByRole('button', { name: 'Past sessions' }));
    expect(await screen.findByRole('list', { name: 'Past sessions' })).toBeInTheDocument();
  });
});
