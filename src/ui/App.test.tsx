import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { resetRosterDbForTests } from '../store/rosterDb';
import { useRosterStore } from '../store/rosterStore';
import { useUpdateStore } from '../pwa';
import { useSessionStore } from '../store/sessionStore';
import App from './App';
import { ErrorBoundary } from './ErrorBoundary';

type User = ReturnType<typeof userEvent.setup>;

const NAMES = /^(Ann|Ben|Cy|Dee|Eve)$/;

beforeEach(async () => {
  localStorage.clear();
  delete document.documentElement.dataset.theme;
  useSessionStore.setState({ session: null, undoStack: [], saveFailed: false });
  useUpdateStore.setState({ ready: false, apply: null });
  await resetRosterDbForTests();
  useRosterStore.setState({ players: [], loaded: false });
});

afterEach(() => {
  vi.restoreAllMocks();
});

async function addPlayers(user: User, text: string) {
  await user.type(screen.getByLabelText('Search or add players'), text);
  await user.keyboard('{Enter}');
}

async function startFivePlayerSession(user: User) {
  render(<App />);
  await addPlayers(user, 'Ann{enter}Ben{enter}Cy{enter}Dee{enter}Eve');
  await user.click(await screen.findByRole('button', { name: 'Start 5 players' }));
}

async function menuItem(user: User, name: RegExp) {
  await user.click(screen.getByRole('button', { name: 'Menu' }));
  await user.click(screen.getByRole('button', { name }));
}

async function endSessionFromMenu(user: User) {
  await user.click(screen.getByRole('button', { name: 'Menu' }));
  await user.click(screen.getByRole('button', { name: 'End session' }));
}

/** The name of the single player waiting after startFivePlayerSession. */
function waitingName(): string {
  const item = within(screen.getByRole('list', { name: 'Waiting' })).getAllByRole('listitem')[0];
  return within(item).getByText(NAMES).textContent!;
}

describe('App', () => {
  it('disables Start until four players are selected', async () => {
    const user = userEvent.setup();
    render(<App />);
    expect(screen.getByRole('button', { name: 'Pick at least 4' })).toBeDisabled();
    await addPlayers(user, 'Ann{enter}Ben{enter}Cy');
    await screen.findByText('3 selected');
    expect(screen.getByRole('button', { name: 'Pick at least 4' })).toBeDisabled();
  });

  it('runs a session: start, finish a game, the waiting player gets on court', async () => {
    const user = userEvent.setup();
    await startFivePlayerSession(user);

    const court = screen.getByRole('tabpanel', { name: 'Court 1' });
    expect(within(court).getAllByText(NAMES)).toHaveLength(4);

    expect(within(screen.getByRole('list', { name: 'Waiting' })).getAllByRole('listitem')).toHaveLength(1);
    const waiterName = waitingName();

    await user.click(within(court).getByRole('button', { name: /game finished/i }));

    const courtAfter = screen.getByRole('tabpanel', { name: 'Court 1' });
    expect(within(courtAfter).getByText(waiterName)).toBeInTheDocument();
    expect(screen.getByText('1 game played')).toBeInTheDocument();
  });

  it('puts a waiting player on break and undo brings them back', async () => {
    const user = userEvent.setup();
    await startFivePlayerSession(user);

    const waiterName = waitingName();

    await user.click(within(screen.getByRole('list', { name: 'Waiting' })).getByRole('button'));
    await user.click(await screen.findByRole('button', { name: 'Take a break' }));

    const breakList = await screen.findByRole('list', { name: 'On break' });
    expect(within(breakList).getByText(waiterName)).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Undo' }));
    expect(screen.queryByRole('list', { name: 'On break' })).not.toBeInTheDocument();
    expect(within(screen.getByRole('list', { name: 'Waiting' })).getByText(waiterName)).toBeInTheDocument();
  });

  it('shows "Break next" for a player on court, then moves them to On break when the game ends', async () => {
    const user = userEvent.setup();
    await startFivePlayerSession(user);

    const court = screen.getByRole('tabpanel', { name: 'Court 1' });
    const playerName = within(court).getAllByText(NAMES)[0].textContent!;
    await user.click(within(court).getByRole('button', { name: new RegExp(playerName) }));
    await user.click(await screen.findByRole('button', { name: 'Take a break' }));

    expect(within(screen.getByRole('tabpanel', { name: 'Court 1' })).getByText('Break next')).toBeInTheDocument();

    await user.click(within(screen.getByRole('tabpanel', { name: 'Court 1' })).getByRole('button', { name: /game finished/i }));

    const breakList = await screen.findByRole('list', { name: 'On break' });
    expect(within(breakList).getByText(playerName)).toBeInTheDocument();
  });

  it('marks a live court as closing and lets you keep it open again', async () => {
    const user = userEvent.setup();
    await startFivePlayerSession(user);

    const court = () => screen.getByRole('tabpanel', { name: 'Court 1' });
    await menuItem(user, /remove court 1/i);
    expect(within(court()).getByText('Closing after this game')).toBeInTheDocument();

    await menuItem(user, /keep court 1 open/i);
    expect(within(court()).queryByText('Closing after this game')).not.toBeInTheDocument();
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

  it('clears a stale error once another sheet is opened', async () => {
    const user = userEvent.setup();
    await startFivePlayerSession(user);

    // The setup default is two courts: remove the idle one (Court 2), then try to remove the last one.
    await user.click(screen.getByRole('tab', { name: /court 2/i }));
    await menuItem(user, /remove court 2/i);
    await menuItem(user, /remove court 1/i);
    expect(await screen.findByRole('alert')).toHaveTextContent('At least one court must stay open.');

    const waitingList = screen.getByRole('list', { name: 'Waiting' });
    await user.click(within(waitingList).getByRole('button'));

    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('offers saved players that are not already in the session when adding mid-session', async () => {
    const user = userEvent.setup();
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    await startFivePlayerSession(user);
    await endSessionFromMenu(user);
    await user.click(await screen.findByRole('button', { name: 'Start new session' }));

    for (const name of ['Ann', 'Ben', 'Cy', 'Dee']) {
      await user.click(await screen.findByRole('checkbox', { name }));
    }
    await user.click(screen.getByRole('button', { name: 'Start 4 players' }));

    await user.click(screen.getByRole('button', { name: '+ Add player' }));
    const offered = await screen.findByRole('list', { name: 'Saved players not in this session' });
    expect(within(offered).getAllByRole('listitem')).toHaveLength(1);
    expect(within(offered).queryByText('Ann')).not.toBeInTheDocument();

    await user.click(within(offered).getByRole('button', { name: 'Eve' }));
    await waitFor(() =>
      expect(within(screen.getByRole('list', { name: 'Waiting' })).getByText('Eve')).toBeInTheDocument(),
    );
  });

  it('ends the session, shows the summary, and remembers the players for next time', async () => {
    const user = userEvent.setup();
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    await startFivePlayerSession(user);

    await endSessionFromMenu(user);
    expect(await screen.findByRole('heading', { name: 'Session summary' })).toBeInTheDocument();
    expect(screen.getByRole('list', { name: 'Games per player' })).toBeInTheDocument();
    // The roster is told who played in the background, so wait for that before asking for "Same as last session".
    await waitFor(() => expect(useRosterStore.getState().players.filter((p) => p.lastPlayedAt !== undefined)).toHaveLength(5));

    await user.click(screen.getByRole('button', { name: 'Start new session' }));
    await user.click(await screen.findByRole('button', { name: /^Same as last time/ }));
    expect(await screen.findByRole('button', { name: 'Start 5 players' })).toBeEnabled();
  });

  it('keeps the half-filled setup form when visiting Saved players and coming back', async () => {
    const user = userEvent.setup();
    render(<App />);
    await user.type(screen.getByLabelText('Search or add players'), 'Ann{enter}Ben{enter}Cy{enter}Fri');
    await screen.findByText('3 selected');
    await user.click(screen.getByRole('button', { name: 'Edit players' }));
    expect(await screen.findByRole('heading', { name: 'Saved players' })).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Back' }));
    expect(screen.getByLabelText('Search or add players')).toHaveValue('Fri');
    expect(screen.getByText('3 selected')).toBeInTheDocument();
  });

  it('offers a new version only when ready, and reloads only after a click', async () => {
    const user = userEvent.setup();
    const { unmount } = render(<App />);
    expect(screen.queryByText(/A new version is ready/)).not.toBeInTheDocument();
    unmount();

    const apply = vi.fn();
    useUpdateStore.setState({ ready: true, apply });
    render(<App />);
    const notice = screen.getByText(/A new version is ready\./);
    expect(notice).toBeVisible();
    expect(notice).toHaveAttribute('role', 'status');
    expect(apply).not.toHaveBeenCalled();
    await user.click(screen.getByRole('button', { name: 'Reload now' }));
    expect(apply).toHaveBeenCalledTimes(1);
  });

  it('sets the theme in Settings and remembers the choice', async () => {
    const user = userEvent.setup();
    render(<App />);
    await user.click(screen.getByRole('button', { name: /^Settings/ }));
    const group = within(screen.getByRole('radiogroup', { name: 'Theme' }));
    await user.click(group.getByRole('radio', { name: 'Dark' }));
    expect(document.documentElement.dataset.theme).toBe('dark');
    expect(localStorage.getItem('pickleball.theme')).toBe('dark');

    await user.click(group.getByRole('radio', { name: 'Light' }));
    expect(document.documentElement.dataset.theme).toBe('light');
    expect(localStorage.getItem('pickleball.theme')).toBe('light');
    expect(group.getByRole('radio', { name: 'Light' })).toBeChecked();
  });

  it('has a PIKLMatch title bar with the account button, and no theme button there', () => {
    render(<App />);
    const bar = document.querySelector<HTMLElement>('.app-header')!;
    expect(within(bar).getByText('PIKLMatch')).toBeInTheDocument();
    expect(within(bar).getByRole('button', { name: /^Settings/ })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /theme/i })).not.toBeInTheDocument();
    expect(screen.getAllByRole('button', { name: /^Settings/ })).toHaveLength(1);
  });

  it('Select all and Clear change the selection, and Simple queue starts a queue session', async () => {
    const user = userEvent.setup();
    render(<App />);
    await addPlayers(user, 'Ann{enter}Ben{enter}Cy{enter}Dee');
    await screen.findByText('4 selected');

    await user.click(screen.getByRole('button', { name: 'Clear' }));
    expect(screen.getByText('0 selected')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Select all' }));
    expect(screen.getByText('4 selected')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: /^Settings/ }));
    await user.click(screen.getByRole('radio', { name: /simple queue/i }));
    await user.click(screen.getByRole('button', { name: 'Back' }));
    expect(screen.getByText(/Simple queue matchmaking/)).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Start 4 players' }));
    expect(useSessionStore.getState().session?.mode).toBe('queue');
  });

  it('adds one saved player when the same name is pasted twice in different case', async () => {
    const user = userEvent.setup();
    render(<App />);
    await addPlayers(user, 'Ann{enter}ann');
    await screen.findByText('1 selected');
    const list = screen.getByRole('list', { name: 'Saved players' });
    expect(within(list).getAllByRole('listitem')).toHaveLength(1);
  });

  describe('Saved players screen', () => {
    async function openSavedPlayers(user: User) {
      render(<App />);
      await addPlayers(user, 'Ann{enter}Ben');
      await screen.findByText('2 selected');
      await user.click(screen.getByRole('button', { name: 'Edit players' }));
      await screen.findByRole('heading', { name: 'Saved players' });
    }

    // Setup stays mounted (hidden) behind this screen, so scope queries to the visible list.
    const savedList = () => within(screen.getByRole('list', { name: 'Saved players' }));

    it('renames a player', async () => {
      const user = userEvent.setup();
      await openSavedPlayers(user);

      await user.click(screen.getByRole('button', { name: 'Rename Ann' }));
      const input = screen.getByLabelText('New name for Ann');
      expect(input).toHaveFocus();
      await user.clear(input);
      await user.type(input, 'Annie{enter}');

      expect(await savedList().findByText('Annie')).toBeInTheDocument();
      expect(savedList().queryByText('Ann')).not.toBeInTheDocument();
    });

    it('cancels a rename with Escape', async () => {
      const user = userEvent.setup();
      await openSavedPlayers(user);

      await user.click(screen.getByRole('button', { name: 'Rename Ann' }));
      await user.type(screen.getByLabelText('New name for Ann'), 'x{Escape}');

      expect(screen.queryByLabelText('New name for Ann')).not.toBeInTheDocument();
      expect(savedList().getByText('Ann')).toBeInTheDocument();
    });

    it('rejects renaming to a duplicate name', async () => {
      const user = userEvent.setup();
      await openSavedPlayers(user);

      await user.click(screen.getByRole('button', { name: 'Rename Ben' }));
      const input = screen.getByLabelText('New name for Ben');
      await user.clear(input);
      await user.type(input, 'ann{enter}');

      expect(await screen.findByRole('alert')).toHaveTextContent(/already/i);
    });

    it('removes a player after confirming', async () => {
      const user = userEvent.setup();
      vi.spyOn(window, 'confirm').mockReturnValue(true);
      await openSavedPlayers(user);

      await user.click(screen.getByRole('button', { name: 'Remove Ben' }));
      await waitFor(() => expect(savedList().queryByText('Ben')).not.toBeInTheDocument());
      expect(savedList().getByText('Ann')).toBeInTheDocument();
    });
  });

  describe('sheets', () => {
    it('closes on Escape and gives focus back to the button that opened it', async () => {
      const user = userEvent.setup();
      await startFivePlayerSession(user);

      const trigger = within(screen.getByRole('list', { name: 'Waiting' })).getByRole('button');
      await user.click(trigger);
      expect(await screen.findByRole('dialog')).toHaveFocus();

      await user.keyboard('{Escape}');
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
      expect(trigger).toHaveFocus();
    });

    it('closes on a backdrop click and gives focus back, and keeps Tab inside', async () => {
      const user = userEvent.setup();
      await startFivePlayerSession(user);

      const trigger = screen.getByRole('button', { name: '+ Add player' });
      await user.click(trigger);
      const dialog = await screen.findByRole('dialog', { name: 'Add player' });

      for (let i = 0; i < 6; i++) {
        await user.tab();
        expect(dialog).toContainElement(document.activeElement as HTMLElement);
      }

      await user.click(dialog.parentElement!);
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
      expect(trigger).toHaveFocus();
    });
  });
});

describe('ErrorBoundary', () => {
  it('shows a fallback for a render error and "Start over" resets the session', async () => {
    const user = userEvent.setup();
    vi.spyOn(console, 'error').mockImplementation(() => {});
    useSessionStore.getState().start({
      name: 'Test',
      mode: 'fairness',
      courtCount: 1,
      players: ['A', 'B', 'C', 'D'].map((name) => ({ name })),
    });
    expect(useSessionStore.getState().session).not.toBeNull();

    let shouldThrow = true;
    function Maybe() {
      if (shouldThrow) throw new Error('boom');
      return <p>All good</p>;
    }
    render(
      <ErrorBoundary>
        <Maybe />
      </ErrorBoundary>,
    );
    expect(screen.getByRole('heading', { name: 'Something went wrong' })).toBeInTheDocument();

    shouldThrow = false;
    await user.click(screen.getByRole('button', { name: 'Start over' }));
    expect(screen.queryByRole('heading', { name: 'Something went wrong' })).not.toBeInTheDocument();
    expect(screen.getByText('All good')).toBeInTheDocument();
    expect(useSessionStore.getState().session).toBeNull();
  });
});
