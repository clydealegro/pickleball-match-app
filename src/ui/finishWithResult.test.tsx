import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { resetRosterDbForTests } from '../store/rosterDb';
import { useRosterStore } from '../store/rosterStore';
import { useSessionStore } from '../store/sessionStore';
import App from './App';

type User = ReturnType<typeof userEvent.setup>;

// Games start by themselves here, so the court in view is already playing.
beforeEach(async () => {
  localStorage.clear();
  localStorage.setItem('pickleball.autoStart', 'true');
  useSessionStore.setState({ session: null, undoStack: [], saveFailed: false, lastAction: null });
  await resetRosterDbForTests();
  useRosterStore.setState({ players: [], loaded: false });
});
afterEach(() => vi.restoreAllMocks());

const names = (n: number) => Array.from({ length: n }, (_, i) => `P${String.fromCharCode(65 + i)}`).join('{enter}');

async function startSession(user: User, count = 5) {
  render(<App />);
  await user.type(screen.getByLabelText('Search or add players'), names(count));
  await user.keyboard('{Enter}');
  await user.click(await screen.findByRole('button', { name: `Start ${count} players` }));
}
const finishButton = () => screen.getByRole('button', { name: /^Game finished/ });
const sheet = (name: RegExp | string) => screen.findByRole('dialog', { name });
const history = () => useSessionStore.getState().session!.history;
const bar = () => document.querySelector<HTMLElement>('.undo-bar');
const teamNames = () => {
  const game = useSessionStore.getState().session!.courts[0].game!;
  const nameOf = (id: string) => useSessionStore.getState().session!.players.find((p) => p.id === id)!.name;
  return { team1: game.team1.map(nameOf), team2: game.team2.map(nameOf) };
};

describe('pressing Game finished', () => {
  it('asks who won first, and the game keeps running until the organizer answers', async () => {
    const user = userEvent.setup();
    await startSession(user);
    await user.click(finishButton());
    expect(await sheet('Court 1: who won?')).toBeInTheDocument();
    expect(history()).toHaveLength(0);
    expect(useSessionStore.getState().session!.courts[0].status).toBe('playing');
  });

  it('names both teams on the winner buttons', async () => {
    const user = userEvent.setup();
    await startSession(user);
    const { team1, team2 } = teamNames();
    await user.click(finishButton());
    const dialog = within(await sheet('Court 1: who won?'));
    expect(dialog.getByRole('button', { name: team1.join(' and ') })).toBeInTheDocument();
    expect(dialog.getByRole('button', { name: team2.join(' and ') })).toBeInTheDocument();
  });

  it('closing the sheet leaves the game running and records nothing', async () => {
    const user = userEvent.setup();
    await startSession(user);
    await user.click(finishButton());
    await user.click(within(await sheet('Court 1: who won?')).getByRole('button', { name: 'Close' }));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(history()).toHaveLength(0);
    expect(useSessionStore.getState().session!.courts[0].status).toBe('playing');
    expect(bar()).toBeNull();
  });
});

describe('recording a result', () => {
  it('takes two taps: the winner, then the losing score, and saves winner and score', async () => {
    const user = userEvent.setup();
    await startSession(user);
    const { team1 } = teamNames();
    await user.click(finishButton());
    await user.click(within(await sheet('Court 1: who won?')).getByRole('button', { name: team1.join(' and ') }));
    await user.click(within(await sheet('Court 1: score')).getByRole('button', { name: '7' }));
    expect(history()).toHaveLength(1);
    expect(history()[0]).toMatchObject({ winner: 1, score: [11, 7] });
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('says the result on the Undo bar, and Undo takes the whole result back', async () => {
    const user = userEvent.setup();
    await startSession(user);
    const { team2 } = teamNames();
    await user.click(finishButton());
    await user.click(within(await sheet('Court 1: who won?')).getByRole('button', { name: team2.join(' and ') }));
    await user.click(within(await sheet('Court 1: score')).getByRole('button', { name: '9' }));
    expect(bar()!.textContent).toBe(`Court 1: ${team2.join(' and ')} won 11 to 9Undo`);
    await user.click(within(bar()!).getByRole('button', { name: 'Undo' }));
    expect(history()).toHaveLength(0);
    expect(useSessionStore.getState().session!.courts[0].status).toBe('playing');
  });

  it('records a winner alone with Skip score, and says it without a score', async () => {
    const user = userEvent.setup();
    await startSession(user);
    const { team1 } = teamNames();
    await user.click(finishButton());
    await user.click(within(await sheet('Court 1: who won?')).getByRole('button', { name: team1.join(' and ') }));
    await user.click(within(await sheet('Court 1: score')).getByRole('button', { name: 'Skip score' }));
    expect(history()[0].winner).toBe(1);
    expect(history()[0]).not.toHaveProperty('score');
    expect(bar()!.textContent).toBe(`Court 1: ${team1.join(' and ')} wonUndo`);
  });

  it('records nothing with Skip result, and the Undo bar just says the game finished', async () => {
    const user = userEvent.setup();
    await startSession(user);
    await user.click(finishButton());
    await user.click(within(await sheet('Court 1: who won?')).getByRole('button', { name: 'Skip result' }));
    expect(history()).toHaveLength(1);
    expect(history()[0]).not.toHaveProperty('winner');
    expect(bar()!.textContent).toBe('Game finished on Court 1Undo');
  });

  it('still starts the next game as before, and counts the game for everyone', async () => {
    const user = userEvent.setup();
    await startSession(user);
    await user.click(finishButton());
    await user.click(within(await sheet('Court 1: who won?')).getByRole('button', { name: 'Skip result' }));
    const session = useSessionStore.getState().session!;
    expect(session.players.filter((p) => p.gamesPlayed === 1)).toHaveLength(4);
    expect(session.courts[0].status).toBe('playing');
  });

  it('is one undo step', async () => {
    const user = userEvent.setup();
    await startSession(user);
    const before = useSessionStore.getState().undoStack.length;
    await user.click(finishButton());
    await user.click(within(await sheet('Court 1: who won?')).getByRole('button', { name: 'Skip result' }));
    expect(useSessionStore.getState().undoStack.length).toBe(before + 1);
  });
});

describe('Settings, Play to', () => {
  it('starts at 11, remembers 15 or 21, and sets where the winning score starts', async () => {
    const user = userEvent.setup();
    await startSession(user);
    await user.click(screen.getByRole('button', { name: /^Settings/ }));
    const group = within(screen.getByRole('radiogroup', { name: 'Play to' }));
    expect(group.getByRole('radio', { name: '11' })).toBeChecked();
    await user.click(group.getByRole('radio', { name: '15' }));
    expect(localStorage.getItem('pickleball.playTo')).toBe('15');
    await user.click(screen.getByRole('button', { name: 'Back' }));
    await user.click(finishButton());
    await user.click(within(await sheet('Court 1: who won?')).getAllByRole('button')[1]);
    const winning = screen.getByRole('group', { name: /won with$/ }).querySelector('output')!;
    expect(winning.textContent).toBe('15');
  });

  it('treats a value it does not know as 11', async () => {
    localStorage.setItem('pickleball.playTo', '13');
    const user = userEvent.setup();
    await startSession(user);
    await user.click(screen.getByRole('button', { name: /^Settings/ }));
    expect(within(screen.getByRole('radiogroup', { name: 'Play to' })).getByRole('radio', { name: '11' })).toBeChecked();
  });
});
