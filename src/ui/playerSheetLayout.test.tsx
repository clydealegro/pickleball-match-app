import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { resetRosterDbForTests } from '../store/rosterDb';
import { useRosterStore } from '../store/rosterStore';
import { useSessionStore } from '../store/sessionStore';
import { renderAtSetup } from '../test/renderAtSetup';

type User = ReturnType<typeof userEvent.setup>;

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
const lineup = () => {
  const c = session().courts[0];
  const g = c.game ?? c.lineup!;
  return [...g.team1, ...g.team2].map(nameOf);
};
const waitingNames = () =>
  within(screen.getByRole('list', { name: 'Waiting' }))
    .getAllByRole('button')
    .map((b) => b.textContent!.match(/P[A-Z]/)![0]);
const courtTile = (name: string) => within(screen.getByRole('tabpanel')).getByRole('button', { name: new RegExp(`^${name}`) });
async function openSheet(user: User, button: HTMLElement) {
  await user.click(button);
  return within(await screen.findByRole('dialog'));
}
const nameOfButton = (b: HTMLElement) => {
  const by = b.getAttribute('aria-labelledby');
  return (b.getAttribute('aria-label') ?? (by ? document.getElementById(by)!.textContent! : b.textContent!)).replace(/\s*[▾▴]$/, '').trim();
};
const buttonNames = (d: Pick<typeof screen, 'getAllByRole'>) => d.getAllByRole('button').map(nameOfButton);
const openMore = (user: User, d: Pick<typeof screen, 'getByRole'>) => user.click(d.getByRole('button', { name: 'More' }));
const waitingTile = () => within(screen.getByRole('list', { name: 'Waiting' })).getAllByRole('button')[0];
function around(id: string) {
  const c = session().courts[0];
  const g = (c.game ?? c.lineup)!;
  const mine = g.team1.includes(id) ? g.team1 : g.team2;
  const theirs = mine === g.team1 ? g.team2 : g.team1;
  return { partner: nameOf(mine.find((x) => x !== id)!), against: theirs.map(nameOf).join(' and ') };
}

describe('the simplified player sheet', () => {
  it('says where a player on a Ready court is, with their partner and opponents, and no team number', async () => {
    const user = userEvent.setup();
    await startSession(user, 6);
    const who = lineup()[0];
    const { partner, against } = around(session().players.find((p) => p.name === who)!.id);
    const dialog = await openSheet(user, courtTile(who));
    expect(dialog.getByText('Court 1, ready to start')).toBeInTheDocument();
    expect(dialog.getByText(`With ${partner}, against ${against}`)).toBeInTheDocument();
    expect(dialog.queryByText(/team [12]/i)).not.toBeInTheDocument();
  });

  it('says a game is running for a player in play', async () => {
    const user = userEvent.setup();
    await startSession(user, 6);
    await user.click(screen.getByRole('button', { name: /^Start game/ }));
    const dialog = await openSheet(user, courtTile(lineup()[0]));
    expect(dialog.getByText('Court 1, playing now')).toBeInTheDocument();
  });

  it('shows two actions for a player on a court, and a More button', async () => {
    const user = userEvent.setup();
    await startSession(user, 6);
    const dialog = await openSheet(user, courtTile(lineup()[0]));
    expect(buttonNames(dialog)).toEqual(['Close', 'Add photo', 'Not here', 'Swap places…', 'More']);
    expect(dialog.getByRole('button', { name: 'Not here' })).toHaveClass('psheet-primary');
  });

  it('keeps More closed until it is tapped, and tapping again closes it', async () => {
    const user = userEvent.setup();
    await startSession(user, 6);
    const dialog = await openSheet(user, courtTile(lineup()[0]));
    const more = dialog.getByRole('button', { name: 'More' });
    expect(more).toHaveAttribute('aria-expanded', 'false');
    expect(dialog.queryByRole('button', { name: 'Leave session' })).not.toBeInTheDocument();
    await user.click(more);
    expect(more).toHaveAttribute('aria-expanded', 'true');
    expect(dialog.getByRole('button', { name: 'Leave session' })).toBeInTheDocument();
    await user.click(more);
    expect(dialog.queryByRole('button', { name: 'Leave session' })).not.toBeInTheDocument();
  });

  it('puts a line only where the result is not obvious: Not here names who steps in, Swap places has none', async () => {
    const user = userEvent.setup();
    await startSession(user, 6);
    const who = lineup()[0];
    const next = waitingNames()[0];
    const dialog = await openSheet(user, courtTile(who));
    expect(dialog.getByRole('button', { name: 'Not here' })).toHaveAccessibleDescription(`${next} steps in and ${who} goes on a break.`);
    expect(dialog.getByRole('button', { name: 'Swap places…' })).not.toHaveAccessibleDescription();
  });

  it('on a Ready court with someone waiting there is no break anywhere, because Not here does it', async () => {
    const user = userEvent.setup();
    await startSession(user, 6);
    const dialog = await openSheet(user, courtTile(lineup()[0]));
    await openMore(user, dialog);
    expect(dialog.queryByRole('button', { name: /break/i })).not.toBeInTheDocument();
  });

  it('on a Ready court with nobody waiting, More has a break that takes them off the court', async () => {
    const user = userEvent.setup();
    await startSession(user, 4);
    const dialog = await openSheet(user, courtTile(lineup()[0]));
    await openMore(user, dialog);
    expect(dialog.getByRole('button', { name: 'Take a break' })).toHaveAccessibleDescription(
      'Takes them off the court. The court waits for another player.',
    );
  });

  it('in a running game, More has Break after this game, and choosing it shows Cancel break up front', async () => {
    const user = userEvent.setup();
    await startSession(user, 6);
    await user.click(screen.getByRole('button', { name: /^Start game/ }));
    const who = lineup()[0];
    let dialog = await openSheet(user, courtTile(who));
    await openMore(user, dialog);
    expect(dialog.queryByRole('button', { name: 'Take a break' })).not.toBeInTheDocument();
    await user.click(dialog.getByRole('button', { name: 'Break after this game' }));
    dialog = await openSheet(user, courtTile(who));
    expect(dialog.getByText('Will go on break when the current game ends.')).toBeInTheDocument();
    expect(buttonNames(dialog)).toContain('Cancel break');
    expect(dialog.queryByRole('button', { name: 'More' })).not.toBeInTheDocument();
  });

  it('the photo action is the avatar, not a big button, and games are not shown on a court', async () => {
    const user = userEvent.setup();
    await startSession(user, 6);
    const dialog = await openSheet(user, courtTile(lineup()[0]));
    const photo = dialog.getByRole('button', { name: 'Add photo' });
    expect(photo.querySelector('.avatar')).not.toBeNull();
    expect(photo).not.toHaveClass('btn');
    expect(dialog.queryByText(/^\d+ games?$/)).not.toBeInTheDocument();
  });

  it('a waiting player sees Play next and Take a break, with the rest under More', async () => {
    const user = userEvent.setup();
    await startSession(user, 6);
    const dialog = await openSheet(user, waitingTile());
    expect(buttonNames(dialog)).toEqual(['Close', 'Add photo', 'Play next', 'Take a break', 'More']);
    expect(dialog.getByRole('button', { name: 'Play next' })).toHaveAccessibleDescription('First in line for the next game.');
    expect(dialog.getByText('0 games')).toBeInTheDocument();
    await openMore(user, dialog);
    expect(buttonNames(dialog).slice(-4)).toEqual(['More', 'Skip this turn', 'Swap onto a court…', 'Leave session']);
    expect(dialog.getByRole('button', { name: 'Skip this turn' })).toHaveAccessibleDescription('Moves to the back of the line.');
  });

  it('a player on a break sees Return to play, with Leave session under More', async () => {
    const user = userEvent.setup();
    await startSession(user, 6);
    let dialog = await openSheet(user, waitingTile());
    await user.click(dialog.getByRole('button', { name: 'Take a break' }));
    dialog = await openSheet(user, within(await screen.findByRole('list', { name: 'On break' })).getByRole('button'));
    expect(dialog.getByText('On a break')).toBeInTheDocument();
    expect(buttonNames(dialog)).toEqual(['Close', 'Add photo', 'Return to play', 'More']);
    expect(dialog.getByRole('button', { name: 'Return to play' })).toHaveClass('psheet-primary');
    await openMore(user, dialog);
    expect(dialog.getByRole('button', { name: 'Leave session' })).toBeInTheDocument();
  });
});
