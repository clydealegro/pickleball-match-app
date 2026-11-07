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

describe('Add player on the live screen', () => {
  it('is one tap away with the Waiting sheet closed, and does not open the sheet', async () => {
    const user = userEvent.setup();
    await startSession(user, names(5));
    const handle = screen.getByRole('button', { name: /^Waiting/ });
    expect(handle).toHaveAttribute('aria-expanded', 'false');
    await user.click(screen.getByRole('button', { name: 'Add player' }));
    expect(await screen.findByRole('dialog', { name: 'Add player' })).toBeInTheDocument();
    expect(handle).toHaveAttribute('aria-expanded', 'false');
  });

  it('is also the first item of the menu', async () => {
    const user = userEvent.setup();
    await startSession(user, names(5));
    await user.click(screen.getByRole('button', { name: 'Menu' }));
    const pop = document.querySelector<HTMLElement>('.menu-pop')!;
    expect(within(pop).getAllByRole('button')[0]).toHaveTextContent('Add player');
    await user.click(within(pop).getByRole('button', { name: 'Add player' }));
    expect(await screen.findByRole('dialog', { name: 'Add player' })).toBeInTheDocument();
  });
});
