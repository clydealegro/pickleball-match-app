import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { resetRosterDbForTests } from '../store/rosterDb';
import { useRosterStore } from '../store/rosterStore';
import { useSessionStore } from '../store/sessionStore';
import { renderAtSetup } from '../test/renderAtSetup';

type User = ReturnType<typeof userEvent.setup>;

// No auto-start preference is set here, so these tests run the real default: games wait for Start.
beforeEach(async () => {
  localStorage.clear();
  useSessionStore.setState({ session: null, undoStack: [], saveFailed: false });
  await resetRosterDbForTests();
  useRosterStore.setState({ players: [], loaded: false });
});
afterEach(() => {
  vi.restoreAllMocks();
});

const names = (n: number) => Array.from({ length: n }, (_, i) => `P${String.fromCharCode(65 + i)}`).join('{enter}');

async function startSession(user: User, count: number) {
  renderAtSetup();
  await user.type(screen.getByLabelText('Search or add players'), names(count));
  await user.keyboard('{Enter}');
  await user.click(await screen.findByRole('button', { name: `Start ${count} players` }));
}
const panel = (n = 1) => screen.getByRole('tabpanel', { name: `Court ${n}` });
const startButton = () => within(screen.getByRole('tabpanel')).getByRole('button', { name: /^Start game/ });
const tabs = () => screen.getAllByRole('tab');
const undoBar = () => document.querySelector<HTMLElement>('.undo-bar');
const court = (n: number) => useSessionStore.getState().session!.courts[n - 1];

describe('a new session', () => {
  it('opens with the first game Ready, not running', async () => {
    const user = userEvent.setup();
    await startSession(user, 5);
    expect(within(panel()).getByText('Next up')).toBeInTheDocument();
    expect(within(panel()).getAllByRole('button', { name: /^P/ })).toHaveLength(4);
    expect(within(panel()).queryByRole('button', { name: /^Game finished/ })).not.toBeInTheDocument();
    expect(startButton()).toBeInTheDocument();
    expect(tabs()[0].textContent).toBe('Court 1Ready');
    expect(tabs()[0]).toHaveClass('is-ready');
    expect(tabs()[0]).not.toHaveClass('is-live');
    expect(court(1).status).toBe('ready');
    expect(court(1).game).toBeUndefined();
  });

  it('records that it waits for Start, so a later change in Settings does not alter it', async () => {
    const user = userEvent.setup();
    await startSession(user, 5);
    expect(useSessionStore.getState().session!.autoStart).toBe(false);
  });
});

describe('pressing Start', () => {
  it('starts the game with the same four, and the clock runs from that moment', async () => {
    const user = userEvent.setup();
    await startSession(user, 5);
    const lineup = court(1).lineup!;
    const before = Date.now();
    await user.click(startButton());
    const c = court(1);
    expect(c.status).toBe('playing');
    expect(c.lineup).toBeUndefined();
    expect(c.game!.team1).toEqual(lineup.team1);
    expect(c.game!.team2).toEqual(lineup.team2);
    expect(c.game!.startedAt).toBeGreaterThanOrEqual(before);
    expect(within(panel()).queryByText('Next up')).not.toBeInTheDocument();
    expect(within(panel()).getByRole('button', { name: /^Game finished/ })).toBeInTheDocument();
    expect(tabs()[0].textContent).toMatch(/^Court 1\d+:\d\d$/);
  });

  it('is one undo step, back to Ready', async () => {
    const user = userEvent.setup();
    await startSession(user, 5);
    await user.click(startButton());
    await user.click(screen.getByRole('button', { name: 'Undo' }));
    expect(court(1).status).toBe('ready');
    expect(startButton()).toBeInTheDocument();
  });
});

describe('finishing a game', () => {
  it('makes the court Ready with the next four, says what happened with an Undo, and Undo restores the game', async () => {
    const user = userEvent.setup();
    await startSession(user, 5);
    await user.click(startButton());
    const startedAt = court(1).game!.startedAt;
    await user.click(within(panel()).getByRole('button', { name: /^Game finished/ }));
    await user.click(await screen.findByRole('button', { name: 'Skip result' }));
    expect(court(1).status).toBe('ready');
    expect(undoBar()!.textContent).toBe('Game finished on Court 1Undo');
    expect(startButton()).toBeInTheDocument();
    await user.click(within(undoBar()!).getByRole('button', { name: 'Undo' }));
    expect(court(1).status).toBe('playing');
    expect(court(1).game!.startedAt).toBe(startedAt);
  });
});

describe('pressing Start on one of two Ready courts', () => {
  it('starts only that court and leaves the other Ready', async () => {
    const user = userEvent.setup();
    await startSession(user, 8);
    await user.click(startButton());
    expect(court(1).status).toBe('playing');
    expect(court(2).status).toBe('ready');
    expect(tabs()[0]).toHaveClass('is-live');
    expect(tabs()[1]).toHaveClass('is-ready');
  });
});

describe('Start all ready courts', () => {
  it('is offered in the menu once two courts are Ready, and starts them together', async () => {
    const user = userEvent.setup();
    await startSession(user, 8);
    expect(tabs().map((t) => t.textContent)).toEqual(['Court 1Ready', 'Court 2Ready']);
    await user.click(screen.getByRole('button', { name: 'Menu' }));
    await user.click(screen.getByRole('button', { name: 'Start all ready courts' }));
    expect(court(1).status).toBe('playing');
    expect(court(2).status).toBe('playing');
    expect(court(1).game!.startedAt).toBe(court(2).game!.startedAt);
    await user.click(screen.getByRole('button', { name: 'Menu' }));
    expect(screen.queryByRole('button', { name: 'Start all ready courts' })).not.toBeInTheDocument();
  });

  it('is not offered with only one Ready court', async () => {
    const user = userEvent.setup();
    await startSession(user, 5);
    await user.click(screen.getByRole('button', { name: 'Menu' }));
    expect(screen.queryByRole('button', { name: 'Start all ready courts' })).not.toBeInTheDocument();
  });
});

describe('fixing a no-show before the game starts', () => {
  it('a break on a Ready player takes effect at once and the waiting player steps in', async () => {
    const user = userEvent.setup();
    await startSession(user, 5);
    const waitingName = within(screen.getByRole('list', { name: 'Waiting' })).getAllByRole('button')[0].textContent!.match(/P[A-Z]/)![0];
    const tile = within(panel()).getAllByRole('button', { name: /^P/ })[0];
    const outName = tile.textContent!.match(/P[A-Z]/)![0];
    await user.click(tile);
    await user.click(await screen.findByRole('button', { name: 'Take a break' }));
    const names = within(panel()).getAllByRole('button', { name: /^P/ }).map((b) => b.textContent!.match(/P[A-Z]/)![0]);
    expect(names).toContain(waitingName);
    expect(names).not.toContain(outName);
    const onBreak = within(screen.getByRole('list', { name: 'On break' }));
    expect(onBreak.getAllByRole('listitem')).toHaveLength(1);
    expect(onBreak.getByRole('button').textContent).toContain(outName);
    expect(court(1).status).toBe('ready');
    expect(useSessionStore.getState().session!.players.find((p) => p.name === outName)!.pendingStatus).toBeUndefined();
  });
});

describe('the Waiting sheet', () => {
  it('says who is next in line when every court holds a lineup and four more are waiting', async () => {
    const user = userEvent.setup();
    await startSession(user, 12);
    expect(screen.getByText('Next in line')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Menu' }));
    await user.click(screen.getByRole('button', { name: 'Start all ready courts' }));
    expect(screen.getByText('Next in line')).toBeInTheDocument();
  });
});

describe('removing a Ready court', () => {
  it('takes it away at once and the four go back to waiting', async () => {
    const user = userEvent.setup();
    await startSession(user, 8);
    await user.click(tabs()[1]);
    await user.click(screen.getByRole('button', { name: 'Menu' }));
    await user.click(screen.getByRole('button', { name: 'Remove court 2' }));
    expect(tabs()).toHaveLength(1);
    expect(within(screen.getByRole('list', { name: 'Waiting' })).getAllByRole('listitem')).toHaveLength(4);
  });
});

describe('Settings: Start the next game by itself', () => {
  it('is off by default, remembers a change, and makes new sessions start at once', async () => {
    const user = userEvent.setup();
    renderAtSetup();
    await user.click(screen.getByRole('button', { name: /^Settings/ }));
    const auto = screen.getByRole('switch', { name: 'Start the next game by itself' });
    expect(auto).not.toBeChecked();
    await user.click(auto);
    expect(localStorage.getItem('pickleball.autoStart')).toBe('true');
    await user.click(screen.getByRole('button', { name: 'Back' }));
    await user.type(screen.getByLabelText('Search or add players'), names(5));
    await user.keyboard('{Enter}');
    await user.click(await screen.findByRole('button', { name: 'Start 5 players' }));
    await waitFor(() => expect(court(1).status).toBe('playing'));
    expect(within(panel()).getByRole('button', { name: /^Game finished/ })).toBeInTheDocument();
    expect(useSessionStore.getState().session!.autoStart).toBe(true);
  });
});
