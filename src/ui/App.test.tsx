import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { resetRosterDbForTests } from '../store/rosterDb';
import { useRosterStore } from '../store/rosterStore';
import { useSessionStore } from '../store/sessionStore';
import App from './App';

beforeEach(async () => {
  localStorage.clear();
  useSessionStore.setState({ session: null, undoStack: [], saveFailed: false });
  await resetRosterDbForTests();
  useRosterStore.setState({ players: [], loaded: false });
});

async function startFivePlayerSession(user: ReturnType<typeof userEvent.setup>) {
  render(<App />);
  await user.type(screen.getByLabelText('Add players'), 'Ann{enter}Ben{enter}Cy{enter}Dee{enter}Eve');
  await user.click(screen.getByRole('button', { name: 'Add' }));
  await user.click(await screen.findByRole('button', { name: 'Start session (5 players)' }));
}

describe('App', () => {
  it('disables Start until four players are selected', async () => {
    const user = userEvent.setup();
    render(<App />);
    expect(screen.getByRole('button', { name: 'Start session' })).toBeDisabled();
    await user.type(screen.getByLabelText('Add players'), 'Ann{enter}Ben{enter}Cy');
    await user.click(screen.getByRole('button', { name: 'Add' }));
    await screen.findByText('Players (3 selected)');
    expect(screen.getByRole('button', { name: 'Start session' })).toBeDisabled();
  });

  it('runs a session: start, finish a game, the waiting player gets on court', async () => {
    const user = userEvent.setup();
    await startFivePlayerSession(user);

    const court = screen.getByRole('region', { name: 'Court 1' });
    expect(within(court).getAllByText(/^(Ann|Ben|Cy|Dee|Eve)$/)).toHaveLength(4);

    const waitingList = screen.getByRole('list', { name: 'Waiting' });
    const waiting = within(waitingList).getAllByRole('listitem');
    expect(waiting).toHaveLength(1);
    const waiterName = waiting[0].querySelector('.row-name')!.textContent!;

    await user.click(within(court).getByRole('button', { name: 'Game finished' }));

    const courtAfter = screen.getByRole('region', { name: 'Court 1' });
    expect(within(courtAfter).getByText(waiterName)).toBeInTheDocument();
    expect(screen.getByText('1 game played')).toBeInTheDocument();
  });

  it('puts a waiting player on break and undo brings them back', async () => {
    const user = userEvent.setup();
    await startFivePlayerSession(user);

    const waitingList = screen.getByRole('list', { name: 'Waiting' });
    const waiterName = within(waitingList).getAllByRole('listitem')[0].querySelector('.row-name')!
      .textContent!;

    await user.click(within(waitingList).getByRole('button'));
    await user.click(await screen.findByRole('button', { name: 'Take a break' }));

    const breakList = await screen.findByRole('list', { name: 'On break' });
    expect(within(breakList).getByText(waiterName)).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Undo' }));
    expect(screen.queryByRole('list', { name: 'On break' })).not.toBeInTheDocument();
  });

  it('adds a late player from the Add player sheet', async () => {
    const user = userEvent.setup();
    await startFivePlayerSession(user);

    await user.click(screen.getByRole('button', { name: '+ Add player' }));
    await user.type(screen.getByLabelText('New player name'), 'Fay');
    await user.click(screen.getByRole('button', { name: 'Add to session' }));

    const waitingList = await screen.findByRole('list', { name: 'Waiting' });
    await waitFor(() => expect(within(waitingList).getByText('Fay')).toBeInTheDocument());
  });

  it('rejects a duplicate name in the Add player sheet', async () => {
    const user = userEvent.setup();
    await startFivePlayerSession(user);

    await user.click(screen.getByRole('button', { name: '+ Add player' }));
    await user.type(screen.getByLabelText('New player name'), 'ann');
    await user.click(screen.getByRole('button', { name: 'Add to session' }));

    expect(await screen.findByRole('alert')).toHaveTextContent(/already/i);
  });

  it('ends the session, shows the summary, and remembers the players for next time', async () => {
    const user = userEvent.setup();
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    await startFivePlayerSession(user);

    await user.click(screen.getByRole('button', { name: 'End session' }));
    expect(await screen.findByRole('heading', { name: 'Session summary' })).toBeInTheDocument();
    expect(screen.getByRole('table')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Start new session' }));
    await user.click(await screen.findByRole('button', { name: 'Same as last session' }));
    expect(await screen.findByRole('button', { name: 'Start session (5 players)' })).toBeEnabled();
    vi.restoreAllMocks();
  });
});
