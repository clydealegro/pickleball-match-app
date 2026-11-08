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
  useSessionStore.setState({ session: null, undoStack: [], saveFailed: false, lastAction: null });
  await resetRosterDbForTests();
  useRosterStore.setState({ players: [], loaded: false });
});
afterEach(() => vi.restoreAllMocks());

const names = (n: number) => Array.from({ length: n }, (_, i) => `P${String.fromCharCode(65 + i)}`).join('{enter}');
async function startSession(user: User, count: number) {
  render(<App />);
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

describe('the player sheet layout', () => {
  it('says where a player on a Ready court is, before anything else', async () => {
    const user = userEvent.setup();
    await startSession(user, 6);
    const who = lineup()[0];
    const dialog = await openSheet(user, courtTile(who));
    expect(dialog.getByText(/^Court 1, team [12], ready to start$/)).toBeInTheDocument();
    expect(dialog.getByText('0 games')).toBeInTheDocument();
  });

  it('says a game is running for a player in play', async () => {
    const user = userEvent.setup();
    await startSession(user, 6);
    await user.click(screen.getByRole('button', { name: /^Start game/ }));
    const dialog = await openSheet(user, courtTile(lineup()[0]));
    expect(dialog.getByText(/^Court 1, team [12], playing now$/)).toBeInTheDocument();
  });

  it('groups the actions: Right now first, then Break or leave', async () => {
    const user = userEvent.setup();
    await startSession(user, 6);
    const dialog = await openSheet(user, courtTile(lineup()[0]));
    const right = dialog.getByRole('group', { name: 'Right now' });
    const rest = dialog.getByRole('group', { name: 'Break or leave' });
    expect(within(right).getByRole('button', { name: 'Swap places…' })).toBeInTheDocument();
    expect(within(right).getByRole('button', { name: 'Not here' })).toBeInTheDocument();
    expect(within(rest).getByRole('button', { name: 'Leave session' })).toBeInTheDocument();
    expect(right.compareDocumentPosition(rest) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it('puts what each action does on that action, naming who steps in', async () => {
    const user = userEvent.setup();
    await startSession(user, 6);
    const who = lineup()[0];
    const next = waitingNames()[0];
    const dialog = await openSheet(user, courtTile(who));
    expect(dialog.getByRole('button', { name: 'Not here' })).toHaveAccessibleDescription(`${next} steps in and ${who} goes on a break.`);
    expect(dialog.getByRole('button', { name: 'Swap places…' })).toHaveAccessibleDescription(
      'Trade with someone waiting or on another court.',
    );
  });

  it('on a Ready court the break is Not here, so there is no second button that does the same', async () => {
    const user = userEvent.setup();
    await startSession(user, 6);
    const dialog = await openSheet(user, courtTile(lineup()[0]));
    expect(dialog.queryByRole('button', { name: /break/i })).not.toBeInTheDocument();
  });

  it('on a Ready court with nobody waiting, a break stays available and says what it does', async () => {
    const user = userEvent.setup();
    await startSession(user, 4);
    const dialog = await openSheet(user, courtTile(lineup()[0]));
    expect(dialog.getByRole('button', { name: 'Take a break' })).toHaveAccessibleDescription(
      'Takes them off the court. The court waits for another player.',
    );
  });

  it('in a running game the break waits for the game to end, and says so', async () => {
    const user = userEvent.setup();
    await startSession(user, 6);
    await user.click(screen.getByRole('button', { name: /^Start game/ }));
    const dialog = await openSheet(user, courtTile(lineup()[0]));
    expect(dialog.getByRole('button', { name: 'Break after this game' })).toBeInTheDocument();
    expect(dialog.queryByRole('button', { name: 'Take a break' })).not.toBeInTheDocument();
  });

  it('the photo action is the avatar, not a big button', async () => {
    const user = userEvent.setup();
    await startSession(user, 6);
    const dialog = await openSheet(user, courtTile(lineup()[0]));
    const photo = dialog.getByRole('button', { name: 'Add photo' });
    expect(photo.querySelector('.avatar')).not.toBeNull();
    expect(photo).not.toHaveClass('btn');
  });

  it('a waiting player sees Play next first, with what it does', async () => {
    const user = userEvent.setup();
    await startSession(user, 6);
    const dialog = await openSheet(user, within(screen.getByRole('list', { name: 'Waiting' })).getAllByRole('button')[0]);
    const right = dialog.getByRole('group', { name: 'Right now' });
    expect(within(right).getByRole('button', { name: 'Play next' })).toHaveAccessibleDescription('First in line for the next game.');
    expect(within(right).getByRole('button', { name: 'Skip this turn' })).toHaveAccessibleDescription('Moves to the back of the line.');
    expect(within(right).getByRole('button', { name: 'Swap onto a court…' })).toBeInTheDocument();
    expect(dialog.getByRole('group', { name: 'Break or leave' })).toBeInTheDocument();
  });
});
