import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { resetRosterDbForTests } from '../store/rosterDb';
import { useRosterStore } from '../store/rosterStore';
import { useSessionStore } from '../store/sessionStore';
import { renderAtSetup } from '../test/renderAtSetup';

type User = ReturnType<typeof userEvent.setup>;

// The real default: games wait for Start, so the first games are Ready lineups.
beforeEach(async () => {
  localStorage.clear();
  useSessionStore.setState({ session: null, undoStack: [], saveFailed: false, lastAction: null });
  await resetRosterDbForTests();
  useRosterStore.setState({ players: [], loaded: false });
});
afterEach(() => vi.restoreAllMocks());

const names = (n: number) => Array.from({ length: n }, (_, i) => `P${String.fromCharCode(65 + i)}`).join('{enter}');

async function startSession(user: User, count: number) {
  renderAtSetup();
  await user.type(screen.getByLabelText('Search or add players'), names(count));
  await user.keyboard('{Enter}');
  await user.click(await screen.findByRole('button', { name: `Start ${count} players` }));
}
const session = () => useSessionStore.getState().session!;
const nameOf = (id: string) => session().players.find((p) => p.id === id)!.name;
const bar = () => document.querySelector<HTMLElement>('.undo-bar');
const waitingRows = () => within(screen.getByRole('list', { name: 'Waiting' })).getAllByRole('button');
const waitingNames = () => waitingRows().map((b) => b.textContent!.match(/P[A-Z]/)![0]);
const panel = (n = 1) => screen.getByRole('tabpanel', { name: `Court ${n}` });
const courtTile = (name: string) => within(screen.getByRole('tabpanel')).getByRole('button', { name: new RegExp(`^${name}`) });
const lineup = (court = 0) => {
  const c = session().courts[court];
  const g = c.game ?? c.lineup!;
  return [...g.team1, ...g.team2].map(nameOf);
};
async function openSheet(user: User, button: HTMLElement) {
  await user.click(button);
  return screen.findByRole('dialog');
}

describe('the player sheet for a waiting player', () => {
  it('offers Play next up front, Skip this turn and Swap onto a court under More, and not Not here', async () => {
    const user = userEvent.setup();
    await startSession(user, 6);
    const dialog = within(await openSheet(user, waitingRows()[0]));
    expect(dialog.getByRole('button', { name: 'Play next' })).toBeInTheDocument();
    await user.click(dialog.getByRole('button', { name: 'More' }));
    expect(dialog.getByRole('button', { name: 'Skip this turn' })).toBeInTheDocument();
    expect(dialog.getByRole('button', { name: 'Swap onto a court…' })).toBeInTheDocument();
    expect(dialog.queryByRole('button', { name: 'Not here' })).not.toBeInTheDocument();
    expect(dialog.queryByRole('button', { name: 'Swap places…' })).not.toBeInTheDocument();
  });

  it('Play next moves them to the front with a Next tag, says so on the Undo bar, and Undo takes it back', async () => {
    const user = userEvent.setup();
    await startSession(user, 12);
    const before = waitingNames();
    const chosen = before[3];
    await user.click(waitingRows()[3]);
    await user.click(within(await screen.findByRole('dialog')).getByRole('button', { name: 'Play next' }));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(bar()!.textContent).toBe(`${chosen} plays nextUndo`);
    expect(waitingNames()[0]).toBe(chosen);
    expect(waitingRows()[0].textContent).toContain('Next');
    expect(session().pinned).toHaveLength(1);
    await user.click(within(bar()!).getByRole('button', { name: 'Undo' }));
    expect(session().pinned).toBeUndefined();
    expect(waitingNames()).toEqual(before);
  });

  it('shows Playing next instead of the button, and the reason, for a player who was asked', async () => {
    const user = userEvent.setup();
    await startSession(user, 12);
    await user.click(waitingRows()[2]);
    await user.click(within(await screen.findByRole('dialog')).getByRole('button', { name: 'Play next' }));
    const dialog = within(await openSheet(user, waitingRows()[0]));
    expect(dialog.getByText('Playing next.')).toBeInTheDocument();
    expect(dialog.queryByRole('button', { name: 'Play next' })).not.toBeInTheDocument();
    expect(dialog.getByText(/You are playing next\./)).toBeInTheDocument();
  });

  it('Skip this turn sends them to the back of the line and says so', async () => {
    const user = userEvent.setup();
    await startSession(user, 12);
    const first = waitingNames()[0];
    await user.click(waitingRows()[0]);
    await user.click(within(await screen.findByRole('dialog')).getByRole('button', { name: 'More' }));
    await user.click(within(await screen.findByRole('dialog')).getByRole('button', { name: 'Skip this turn' }));
    expect(bar()!.textContent).toBe(`${first} skipped a turnUndo`);
    expect(waitingNames().at(-1)).toBe(first);
  });
});

describe('the player sheet for a player on a court', () => {
  it('offers Swap places and Not here, with what Not here does, and not Play next', async () => {
    const user = userEvent.setup();
    await startSession(user, 6);
    const who = lineup()[0];
    const dialog = within(await openSheet(user, courtTile(who)));
    expect(dialog.getByRole('button', { name: 'Swap places…' })).toBeInTheDocument();
    expect(dialog.getByRole('button', { name: 'Not here' })).toBeInTheDocument();
    expect(dialog.getByRole('button', { name: 'Not here' })).toHaveAccessibleDescription(
      `${waitingNames()[0]} steps in and ${who} goes on a break.`,
    );
    expect(dialog.queryByRole('button', { name: 'Play next' })).not.toBeInTheDocument();
    expect(dialog.queryByRole('button', { name: 'Skip this turn' })).not.toBeInTheDocument();
  });

  it('Not here brings in the next waiting player and puts the absent one on a break, as one Undo step', async () => {
    const user = userEvent.setup();
    await startSession(user, 6);
    const absent = lineup()[1];
    const replacement = waitingNames()[0];
    const stack = useSessionStore.getState().undoStack.length;
    await user.click(courtTile(absent));
    await user.click(within(await screen.findByRole('dialog')).getByRole('button', { name: 'Not here' }));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(lineup()).toContain(replacement);
    expect(lineup()).not.toContain(absent);
    const onBreak = within(screen.getByRole('list', { name: 'On break' }));
    expect(onBreak.getByRole('button').textContent).toContain(absent);
    expect(bar()!.textContent).toBe(`${absent} not here, the next player steps inUndo`);
    expect(useSessionStore.getState().undoStack.length).toBe(stack + 1);
    await user.click(within(bar()!).getByRole('button', { name: 'Undo' }));
    expect(lineup()).toContain(absent);
  });

  it('Not here says so and keeps the sheet open when nobody is waiting', async () => {
    const user = userEvent.setup();
    await startSession(user, 4);
    await user.click(courtTile(lineup()[0]));
    await user.click(within(await screen.findByRole('dialog')).getByRole('button', { name: 'Not here' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('No one is waiting to take their place.');
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    expect(session().courts[0].status).toBe('ready');
  });

  it('works inside a game that is running too', async () => {
    const user = userEvent.setup();
    await startSession(user, 6);
    await user.click(screen.getByRole('button', { name: /^Start game/ }));
    const absent = lineup()[0];
    const replacement = waitingNames()[0];
    await user.click(courtTile(absent));
    await user.click(within(await screen.findByRole('dialog')).getByRole('button', { name: 'Not here' }));
    expect(lineup()).toContain(replacement);
    expect(session().courts[0].status).toBe('playing');
  });
});

describe('the swap picker', () => {
  it('from a court player lists the waiting players first and then the players on courts, and Back returns', async () => {
    const user = userEvent.setup();
    await startSession(user, 10);
    const me = lineup(0)[0];
    await user.click(screen.getAllByRole('tab')[0]);
    await user.click(await within(panel(1)).findByRole('button', { name: new RegExp(`^${me}`) }));
    await user.click(within(await screen.findByRole('dialog')).getByRole('button', { name: 'Swap places…' }));
    const dialog = within(screen.getByRole('dialog', { name: `Swap ${me}` }));
    const waiting = dialog.getByRole('list', { name: 'Swap with a waiting player' });
    const onCourt = dialog.getByRole('list', { name: 'Swap with a player on a court' });
    expect(within(waiting).getAllByRole('button').map((b) => b.textContent!.match(/P[A-Z]/)![0])).toEqual(waitingNames());
    expect(within(onCourt).getAllByRole('button')).toHaveLength(8 - 2); // 8 on courts, minus themselves and their partner
    expect(onCourt.textContent).toContain('Court 2, team 1, ready');
    await user.click(dialog.getByRole('button', { name: 'Back' }));
    expect(screen.getByRole('dialog', { name: me })).toBeInTheDocument();
  });

  it('swaps with a waiting player in one tap, and says who stepped in', async () => {
    const user = userEvent.setup();
    await startSession(user, 6);
    const me = lineup()[2];
    const inName = waitingNames()[0];
    await user.click(courtTile(me));
    await user.click(within(await screen.findByRole('dialog')).getByRole('button', { name: 'Swap places…' }));
    await user.click(within(screen.getByRole('list', { name: 'Swap with a waiting player' })).getByRole('button', { name: new RegExp(inName) }));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(bar()!.textContent).toBe(`${inName} swapped in for ${me} on Court 1Undo`);
    expect(lineup()).toContain(inName);
    expect(waitingNames()).toContain(me);
  });

  it('swaps two players on different courts, and says they swapped places', async () => {
    const user = userEvent.setup();
    await startSession(user, 10);
    const me = lineup(0)[0];
    const other = lineup(1)[3];
    await user.click(await within(panel(1)).findByRole('button', { name: new RegExp(`^${me}`) }));
    await user.click(within(await screen.findByRole('dialog')).getByRole('button', { name: 'Swap places…' }));
    await user.click(within(screen.getByRole('list', { name: 'Swap with a player on a court' })).getByRole('button', { name: new RegExp(other) }));
    expect(bar()!.textContent).toBe(`${me} and ${other} swapped placesUndo`);
    expect(lineup(0)).toContain(other);
    expect(lineup(1)).toContain(me);
  });

  it('from a waiting player lists only the players on courts, and swaps them onto a court', async () => {
    const user = userEvent.setup();
    await startSession(user, 6);
    const me = waitingNames()[1];
    const swapOut = lineup()[0];
    await user.click(waitingRows()[1]);
    await user.click(within(await screen.findByRole('dialog')).getByRole('button', { name: 'More' }));
    await user.click(within(await screen.findByRole('dialog')).getByRole('button', { name: 'Swap onto a court…' }));
    const dialog = within(screen.getByRole('dialog', { name: `Swap ${me}` }));
    expect(dialog.queryByRole('list', { name: 'Swap with a waiting player' })).not.toBeInTheDocument();
    expect(within(dialog.getByRole('list', { name: 'Swap with a player on a court' })).getAllByRole('button')).toHaveLength(4);
    await user.click(within(dialog.getByRole('list', { name: 'Swap with a player on a court' })).getByRole('button', { name: new RegExp(swapOut) }));
    expect(bar()!.textContent).toBe(`${me} swapped in for ${swapOut} on Court 1Undo`);
    expect(lineup()).toContain(me);
  });

  it('keeps a swap that was asked to play next honest: the player stepping in is no longer asked', async () => {
    const user = userEvent.setup();
    await startSession(user, 12);
    await user.click(waitingRows()[1]);
    await user.click(within(await screen.findByRole('dialog')).getByRole('button', { name: 'Play next' }));
    const chosen = waitingNames()[0];
    await user.click(waitingRows()[0]);
    await user.click(within(await screen.findByRole('dialog')).getByRole('button', { name: 'More' }));
    await user.click(within(await screen.findByRole('dialog')).getByRole('button', { name: 'Swap onto a court…' }));
    const target = lineup()[0];
    await user.click(within(screen.getByRole('list', { name: 'Swap with a player on a court' })).getByRole('button', { name: new RegExp(target) }));
    await waitFor(() => expect(lineup()).toContain(chosen));
    expect(session().pinned).toBeUndefined();
  });
});
