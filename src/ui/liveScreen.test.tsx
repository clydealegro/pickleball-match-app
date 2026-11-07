import { act, fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { resetRosterDbForTests } from '../store/rosterDb';
import { useRosterStore } from '../store/rosterStore';
import { useAuthStore } from '../sync/auth';
import { useSyncStore } from '../sync/syncStore';
import { useUpdateStore } from '../pwa';
import { useSessionStore } from '../store/sessionStore';
import App from './App';

type User = ReturnType<typeof userEvent.setup>;

beforeEach(async () => {
  localStorage.clear();
  localStorage.setItem('pickleball.autoStart', 'true'); // these tests are about the live screen, not the Ready step
  useSessionStore.setState({ session: null, undoStack: [], saveFailed: false });
  useUpdateStore.setState({ ready: false, apply: null });
  await resetRosterDbForTests();
  useRosterStore.setState({ players: [], loaded: false });
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

async function startSession(user: User, names: string) {
  render(<App />);
  await user.type(screen.getByLabelText('Search or add players'), names);
  await user.keyboard('{Enter}');
  const count = names.split('{enter}').length;
  await user.click(await screen.findByRole('button', { name: `Start ${count} players` }));
}
const tabs = () => screen.getAllByRole('tab');
const FIVE = 'Ann{enter}Ben{enter}Cy{enter}Dee{enter}Eve';

describe('court tabs', () => {
  it('shows one court at a time, starting with Court 1, and each tab says what its court is doing', async () => {
    const user = userEvent.setup();
    await startSession(user, FIVE);
    expect(tabs().map((t) => t.textContent)).toEqual([expect.stringMatching(/^Court 1\d+:\d\d$/), 'Court 2Open']);
    expect(tabs()[0]).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByRole('tabpanel', { name: 'Court 1' })).toBeInTheDocument();
    expect(screen.queryByRole('tabpanel', { name: 'Court 2' })).not.toBeInTheDocument();
  });

  it('switches court by tap and by arrow keys, moving focus with the selection', async () => {
    const user = userEvent.setup();
    await startSession(user, FIVE);
    await user.click(tabs()[1]);
    expect(screen.getByRole('tabpanel', { name: 'Court 2' })).toHaveTextContent('Waiting for players');
    expect(tabs()[1]).toHaveAttribute('tabindex', '0');
    expect(tabs()[0]).toHaveAttribute('tabindex', '-1');

    await user.keyboard('{ArrowLeft}');
    expect(tabs()[0]).toHaveAttribute('aria-selected', 'true');
    expect(tabs()[0]).toHaveFocus();
    await user.keyboard('{ArrowLeft}');
    expect(tabs()[1]).toHaveAttribute('aria-selected', 'true'); // wraps round
    await user.keyboard('{Home}');
    expect(tabs()[0]).toHaveFocus();
    await user.keyboard('{End}');
    expect(tabs()[1]).toHaveFocus();
    await user.keyboard('{ArrowRight}');
    expect(tabs()[0]).toHaveFocus();
  });

  it('falls back to the first court when the one on show is removed', async () => {
    const user = userEvent.setup();
    await startSession(user, FIVE);
    await user.click(tabs()[1]);
    await user.click(screen.getByRole('button', { name: 'Menu' }));
    await user.click(screen.getByRole('button', { name: 'Remove court 2' }));
    expect(tabs()).toHaveLength(1);
    expect(screen.getByRole('tabpanel', { name: 'Court 1' })).toBeInTheDocument();
  });

  it('shows each pair as a team of its own, named for screen readers only', async () => {
    const user = userEvent.setup();
    await startSession(user, FIVE);
    const panel = screen.getByRole('tabpanel', { name: 'Court 1' });
    const teams = within(panel).getAllByRole('group');
    expect(teams.map((t) => t.getAttribute('aria-label'))).toEqual([
      expect.stringMatching(/^Team 1: \w+ and \w+$/),
      expect.stringMatching(/^Team 2: \w+ and \w+$/),
    ]);
    expect(teams[0]).toHaveClass('team-1');
    expect(teams[1]).toHaveClass('team-2');
    for (const team of teams) expect(within(team).getAllByRole('button')).toHaveLength(2);
    // The colour tells the pairs apart on screen; no team names are written on it.
    expect(panel).not.toHaveTextContent(/team/i);
  });

  it('finishes the game with one big button, and the panel shows the players as two teams', async () => {
    const user = userEvent.setup();
    await startSession(user, FIVE);
    const panel = screen.getByRole('tabpanel', { name: 'Court 1' });
    expect(panel.querySelectorAll('.team')).toHaveLength(2);
    expect(panel.querySelectorAll('.tile')).toHaveLength(4);
    expect(within(panel).getByText('vs')).toBeInTheDocument();
    await user.click(within(panel).getByRole('button', { name: /game finished/i }));
    await user.click(await screen.findByRole('button', { name: 'Skip result' }));
    expect(screen.getByText('1 game played')).toBeInTheDocument();
  });
});

describe('the menu', () => {
  it('opens, offers Add court, Remove court and End session, and closes on Escape with focus back on the button', async () => {
    const user = userEvent.setup();
    await startSession(user, FIVE);
    const button = screen.getByRole('button', { name: 'Menu' });
    expect(button).toHaveAttribute('aria-expanded', 'false');
    await user.click(button);
    expect(button).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getAllByRole('button').map((b) => b.textContent)).toEqual(
      expect.arrayContaining(['Add court', 'Remove court 1', 'End session']),
    );
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('button', { name: 'End session' })).not.toBeInTheDocument();
    expect(button).toHaveFocus();
  });

  it('closes when something else is tapped', async () => {
    const user = userEvent.setup();
    await startSession(user, FIVE);
    await user.click(screen.getByRole('button', { name: 'Menu' }));
    await user.click(screen.getByRole('heading', { level: 1 }));
    expect(screen.queryByRole('button', { name: 'End session' })).not.toBeInTheDocument();
  });

  it('has the Remove court action for the court on show, and it is not on the court itself', async () => {
    const user = userEvent.setup();
    await startSession(user, FIVE);
    expect(within(screen.getByRole('tabpanel', { name: 'Court 1' })).queryByRole('button', { name: /remove court/i })).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Menu' }));
    expect(screen.getByRole('button', { name: 'Remove court 1' })).toBeInTheDocument();
    await user.keyboard('{Escape}');
    await user.click(tabs()[1]);
    await user.click(screen.getByRole('button', { name: 'Menu' }));
    expect(screen.getByRole('button', { name: 'Remove court 2' })).toBeInTheDocument();
  });

  it('offers to keep a court open once it is closing', async () => {
    const user = userEvent.setup();
    await startSession(user, FIVE);
    await user.click(screen.getByRole('button', { name: 'Menu' }));
    await user.click(screen.getByRole('button', { name: 'Remove court 1' }));
    await user.click(screen.getByRole('button', { name: 'Menu' }));
    expect(screen.getByRole('button', { name: 'Keep court 1 open' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Remove court 1' })).not.toBeInTheDocument();
  });

  it('adds a court', async () => {
    const user = userEvent.setup();
    await startSession(user, FIVE);
    await user.click(screen.getByRole('button', { name: 'Menu' }));
    await user.click(screen.getByRole('button', { name: 'Add court' }));
    expect(tabs()).toHaveLength(3);
  });

  it('keeps the session when ending it is not confirmed', async () => {
    const user = userEvent.setup();
    vi.spyOn(window, 'confirm').mockReturnValue(false);
    await startSession(user, FIVE);
    await user.click(screen.getByRole('button', { name: 'Menu' }));
    await user.click(screen.getByRole('button', { name: 'End session' }));
    expect(screen.queryByRole('heading', { name: 'Session summary' })).not.toBeInTheDocument();
    expect(tabs()).toHaveLength(2);
  });

  it('opens Settings in the middle of a session, and Back returns to the live screen', async () => {
    const user = userEvent.setup();
    await startSession(user, FIVE);
    await user.click(screen.getByRole('button', { name: /^Settings/ }));
    expect(await screen.findByRole('heading', { name: 'Settings' })).toBeInTheDocument();
    expect(screen.queryByRole('tablist')).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Back' }));
    expect(screen.getByRole('tablist', { name: 'Courts' })).toBeInTheDocument();
  });
});

describe('the top bar', () => {
  it('is one slim row, with no separate title bar above it and no Undo icon', async () => {
    const user = userEvent.setup();
    await startSession(user, FIVE);
    expect(screen.queryByText('PIKLMatch')).not.toBeInTheDocument();
    const bar = document.querySelector<HTMLElement>('.live-header')!;
    expect(within(bar).getByRole('button', { name: /^Settings/ })).toBeInTheDocument();
    expect(within(bar).getByRole('heading', { level: 1 })).toBeInTheDocument();
    expect(within(bar).queryByRole('button', { name: 'Undo' })).not.toBeInTheDocument();
    expect(within(bar).getByRole('button', { name: 'Menu' })).toBeInTheDocument();
  });

  it('brings the title bar back outside a live session', async () => {
    render(<App />);
    expect(screen.getByText('PIKLMatch')).toBeInTheDocument();
  });

  it('no longer holds a theme switch', async () => {
    const user = userEvent.setup();
    await startSession(user, FIVE);
    await user.click(screen.getByRole('button', { name: 'Menu' }));
    expect(screen.queryByRole('button', { name: /theme/i })).not.toBeInTheDocument();
  });
});

describe('swiping between courts', () => {
  /** A finger drag across the court on show, from (x1, y1) to (x2, y2). */
  function swipe(x1: number, y1: number, x2: number, y2: number, target = () => screen.getByRole('tabpanel')) {
    fireEvent.touchStart(target(), { touches: [{ clientX: x1, clientY: y1 }] });
    fireEvent.touchEnd(target(), { changedTouches: [{ clientX: x2, clientY: y2 }] });
  }
  const selectedTab = () => screen.getByRole('tab', { selected: true }).textContent;

  it('moves to the next court on a swipe left, and back on a swipe right, and stops at the ends', async () => {
    const user = userEvent.setup();
    await startSession(user, FIVE);
    expect(selectedTab()).toMatch(/^Court 1/);
    swipe(300, 400, 100, 410);
    expect(selectedTab()).toMatch(/^Court 2/);
    swipe(300, 400, 100, 400); // already on the last court
    expect(selectedTab()).toMatch(/^Court 2/);
    swipe(100, 400, 300, 390);
    expect(selectedTab()).toMatch(/^Court 1/);
    swipe(100, 400, 300, 400); // already on the first court
    expect(selectedTab()).toMatch(/^Court 1/);
  });

  it('slides the new court in from the side it came from', async () => {
    const user = userEvent.setup();
    await startSession(user, FIVE);
    swipe(300, 400, 100, 400);
    expect(document.querySelector('.court-slot')).toHaveClass('slide-from-right');
    swipe(100, 400, 300, 400);
    expect(document.querySelector('.court-slot')).toHaveClass('slide-from-left');
  });

  it('ignores a short drag, a mostly vertical drag, a slow drag and a second finger', async () => {
    const user = userEvent.setup();
    await startSession(user, FIVE);
    swipe(300, 400, 270, 400); // too short
    swipe(300, 300, 150, 520); // mostly vertical: the page scrolling
    expect(selectedTab()).toMatch(/^Court 1/);

    const now = vi.spyOn(Date, 'now');
    now.mockReturnValue(1_000);
    fireEvent.touchStart(screen.getByRole('tabpanel'), { touches: [{ clientX: 300, clientY: 400 }] });
    now.mockReturnValue(2_000); // a second later is a slow drag
    fireEvent.touchEnd(screen.getByRole('tabpanel'), { changedTouches: [{ clientX: 100, clientY: 400 }] });
    expect(selectedTab()).toMatch(/^Court 1/);

    now.mockRestore();
    fireEvent.touchStart(screen.getByRole('tabpanel'), {
      touches: [
        { clientX: 300, clientY: 400 },
        { clientX: 320, clientY: 400 },
      ],
    });
    fireEvent.touchEnd(screen.getByRole('tabpanel'), { changedTouches: [{ clientX: 100, clientY: 400 }] });
    expect(selectedTab()).toMatch(/^Court 1/);
  });

  it('forgets a drag that was cancelled', async () => {
    const user = userEvent.setup();
    await startSession(user, FIVE);
    fireEvent.touchStart(screen.getByRole('tabpanel'), { touches: [{ clientX: 300, clientY: 400 }] });
    fireEvent.touchCancel(screen.getByRole('tabpanel'));
    fireEvent.touchEnd(screen.getByRole('tabpanel'), { changedTouches: [{ clientX: 100, clientY: 400 }] });
    expect(selectedTab()).toMatch(/^Court 1/);
  });

  it('also slides when a tab is tapped, towards the court tapped', async () => {
    const user = userEvent.setup();
    await startSession(user, FIVE);
    await user.click(tabs()[1]);
    expect(document.querySelector('.court-slot')).toHaveClass('slide-from-right');
    await user.click(tabs()[0]);
    expect(document.querySelector('.court-slot')).toHaveClass('slide-from-left');
  });
});

describe('the account button', () => {
  it('opens Settings from the round button at the top left', async () => {
    const user = userEvent.setup();
    await startSession(user, FIVE);
    await user.click(screen.getByRole('button', { name: /^Settings/ }));
    expect(await screen.findByRole('heading', { name: 'Settings' })).toBeInTheDocument();
  });

  it('carries the sync state in its name and a coloured dot', async () => {
    const user = userEvent.setup();
    await startSession(user, FIVE);
    act(() => useAuthStore.setState({ status: 'signedIn', email: 'a@b.co', userId: 'u1' }));
    const dot = () => document.querySelector('.account-btn .dot');
    const cases: [Partial<ReturnType<typeof useSyncStore.getState>>, string, string][] = [
      [{ status: 'synced', pending: 0 }, 'Synced', 'dot-ok'],
      [{ status: 'syncing', pending: 0 }, 'Syncing', 'dot-busy'],
      [{ status: 'offline', pending: 2 }, 'Offline, 2 changes waiting', 'dot-warn'],
      [{ status: 'error', pending: 0 }, "Can't reach server", 'dot-bad'],
    ];
    for (const [state, name, tone] of cases) {
      act(() => useSyncStore.setState(state));
      expect(screen.getByRole('button', { name: new RegExp(`^Settings\\. ${name}`) })).toBeInTheDocument();
      expect(dot()).toHaveClass(tone);
    }
    act(() => useAuthStore.setState({ status: 'signedOut', userId: null }));
    expect(dot()).toBeNull();
    act(() => useAuthStore.setState({ status: 'unconfigured' }));
    expect(screen.getByRole('button', { name: 'Settings' })).toBeInTheDocument();
  });
});

describe('the waiting sheet', () => {
  it('peeks the next game and opens and closes from its handle', async () => {
    const user = userEvent.setup();
    await startSession(user, 'Ann{enter}Ben{enter}Cy{enter}Dee{enter}Eve{enter}Fay{enter}Gus{enter}Hal{enter}Ivy');
    // Eight on two courts, one waiting: not enough for a game.
    expect(screen.getByText(/need 3 more waiting/i)).toBeInTheDocument();
    const handle = screen.getByRole('button', { name: /^Waiting \(1\)/ });
    expect(handle).toHaveAttribute('aria-expanded', 'false');
    await user.click(handle);
    expect(handle).toHaveAttribute('aria-expanded', 'true');
    await user.keyboard('{Escape}');
    expect(handle).toHaveAttribute('aria-expanded', 'false');
  });

  it('says which court the next game will be on, when four are waiting and a court is open', async () => {
    const user = userEvent.setup();
    await startSession(user, FIVE);
    const panel = screen.getByRole('tabpanel', { name: 'Court 1' });
    await user.click(within(panel).getByRole('button', { name: /game finished/i }));
    await user.click(await screen.findByRole('button', { name: 'Skip result' }));
    expect(screen.getByRole('list', { name: 'Next game players' })).toBeInTheDocument();
  });

  it('is a plain panel with no handle on a wide screen', async () => {
    vi.stubGlobal('matchMedia', (query: string) => ({
      matches: true,
      media: query,
      addEventListener: () => undefined,
      removeEventListener: () => undefined,
    }));
    const user = userEvent.setup();
    await startSession(user, FIVE);
    expect(screen.queryByRole('button', { name: /^Waiting/ })).not.toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Waiting (1)' })).toBeInTheDocument();
  });

  it('keeps every action on the open list: the waiting rows, with Add player always at the top', async () => {
    const user = userEvent.setup();
    await startSession(user, FIVE);
    await user.click(screen.getByRole('button', { name: /^Waiting/ }));
    expect(within(screen.getByRole('list', { name: 'Waiting' })).getAllByRole('button')).toHaveLength(1);
    expect(screen.getByRole('button', { name: 'Add player' })).toBeInTheDocument();
  });
});
