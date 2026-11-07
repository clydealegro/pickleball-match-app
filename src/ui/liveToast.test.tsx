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
const finishButton = () => screen.getByRole('button', { name: /^Game finished/ });
const toastEl = () => document.querySelector<HTMLElement>('.toast');

describe('the toast after Game finished', () => {
  it('names the new lineup with an Undo, and Undo puts the game back', async () => {
    const user = userEvent.setup();
    await startSession(user, names(5));
    expect(toastEl()).toBeNull();
    const before = useSessionStore.getState().session!.courts[0].game!;
    await user.click(finishButton());
    expect(toastEl()!.textContent).toMatch(/^Court 1: P\w and P\w vs P\w and P\wUndo$/);
    expect(screen.getByText('1 game played')).toBeInTheDocument();
    await user.click(within(toastEl()!).getByRole('button', { name: 'Undo' }));
    expect(toastEl()).toBeNull();
    expect(screen.getByText('0 games played')).toBeInTheDocument();
    expect(useSessionStore.getState().session!.courts[0].game).toEqual(before);
  });

  it('says what is missing when no new game can start', async () => {
    const user = userEvent.setup();
    await startSession(user, names(4));
    await user.click(finishButton());
    // Four players finished and are all waiting again, so the court starts straight away.
    expect(toastEl()!.textContent).toMatch(/^Court 1: /);
    await user.click(screen.getByRole('button', { name: 'Menu' }));
    await user.click(screen.getByRole('button', { name: 'Remove court 1' }));
    await user.click(finishButton());
    expect(toastEl()!.textContent).toMatch(/^Court 1 closed\./);
  });

  it('shows only the latest message when two courts finish one after the other', async () => {
    const user = userEvent.setup();
    await startSession(user, names(8));
    await user.click(finishButton());
    expect(toastEl()!.textContent).toMatch(/^Court 1:/);
    await user.click(screen.getAllByRole('tab')[1]);
    await user.click(finishButton());
    expect(document.querySelectorAll('.toast')).toHaveLength(1);
    expect(toastEl()!.textContent).toMatch(/^Court 2:/);
  });

  it('buzzes briefly by default, never when switched off, and survives a device that refuses', async () => {
    const user = userEvent.setup();
    const vibrate = vi.fn();
    Object.defineProperty(navigator, 'vibrate', { value: vibrate, configurable: true });
    await startSession(user, names(5));
    await user.click(finishButton());
    expect(vibrate).toHaveBeenCalledWith(25);

    vibrate.mockClear();
    localStorage.setItem('pickleball.vibrate', 'false');
    await user.click(finishButton());
    expect(vibrate).not.toHaveBeenCalled();

    localStorage.setItem('pickleball.vibrate', 'true');
    vibrate.mockImplementation(() => {
      throw new Error('not allowed');
    });
    await user.click(finishButton());
    expect(toastEl()).not.toBeNull();
  });
});
