import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { resetRosterDbForTests } from '../store/rosterDb';
import { useRosterStore } from '../store/rosterStore';
import { useSessionStore } from '../store/sessionStore';
import App from './App';

type User = ReturnType<typeof userEvent.setup>;

beforeEach(async () => {
  localStorage.clear();
  useSessionStore.setState({ session: null, undoStack: [], saveFailed: false });
  await resetRosterDbForTests();
  useRosterStore.setState({ players: [], loaded: false });
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  delete (navigator as unknown as Record<string, unknown>).vibrate;
  delete (navigator as unknown as Record<string, unknown>).wakeLock;
});

const names = (n: number) => Array.from({ length: n }, (_, i) => `P${String.fromCharCode(65 + i)}`).join('{enter}');

async function startSession(user: User, list: string) {
  render(<App />);
  await user.type(screen.getByLabelText('Search or add players'), list);
  await user.keyboard('{Enter}');
  const count = list.split('{enter}').length;
  await user.click(await screen.findByRole('button', { name: `Start ${count} players` }));
}

describe('why a player is waiting', () => {
  it('shows the place in line and the reason for a waiting player, and nothing for one on court', async () => {
    const user = userEvent.setup();
    await startSession(user, names(5));
    const waitingRow = within(screen.getByRole('list', { name: 'Waiting' })).getAllByRole('button')[0];
    await user.click(waitingRow);
    expect(await screen.findByText(/^1st in line\. Waiting for 3 more players to start a game\.$/)).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Close' }));
    await user.click(within(screen.getByRole('tabpanel', { name: 'Court 1' })).getAllByRole('button', { name: /^P/ })[0]);
    await screen.findByRole('dialog');
    expect(screen.queryByText(/in line\./)).not.toBeInTheDocument();
  });

  it('gives a fairness reason when a full game is waiting', async () => {
    const user = userEvent.setup();
    await startSession(user, names(12));
    await user.click(within(screen.getByRole('list', { name: 'Waiting' })).getAllByRole('button')[0]);
    expect(await screen.findByText(/^1st in line\. Tied with others, so the order is a fixed random pick\.$/)).toBeInTheDocument();
  });
});
