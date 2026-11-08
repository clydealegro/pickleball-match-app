import { act, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { resetRosterDbForTests } from '../store/rosterDb';
import { useRosterStore } from '../store/rosterStore';
import { useSessionStore } from '../store/sessionStore';
import { renderAtSetup } from '../test/renderAtSetup';

type User = ReturnType<typeof userEvent.setup>;

beforeEach(async () => {
  localStorage.clear();
  localStorage.setItem('pickleball.autoStart', 'true'); // these tests are about the live screen, not the Ready step
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
  renderAtSetup();
  await user.type(screen.getByLabelText('Search or add players'), list);
  await user.keyboard('{Enter}');
  const count = list.split('{enter}').length;
  await user.click(await screen.findByRole('button', { name: `Start ${count} players` }));
}

describe('a second window', () => {
  const change = (init: StorageEventInit) => act(() => void window.dispatchEvent(new StorageEvent('storage', init)));

  it('raises a notice when another window saves the session, and never by itself reloads', () => {
    renderAtSetup();
    expect(screen.queryByText(/changed in another window/)).not.toBeInTheDocument();
    change({ key: 'pickleball.session.v1', newValue: '{}' });
    expect(screen.getByText(/This session was changed in another window\./)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Reload' })).toBeInTheDocument();
  });

  it('also notices the other window clearing storage, but not unrelated keys', () => {
    const { unmount } = renderAtSetup();
    change({ key: 'pickleball.theme', newValue: 'dark' });
    expect(screen.queryByText(/changed in another window/)).not.toBeInTheDocument();
    unmount();
    renderAtSetup();
    change({ key: null });
    expect(screen.getByText(/changed in another window/)).toBeInTheDocument();
  });

  it('does not react to this window saving its own session', async () => {
    const user = userEvent.setup();
    await startSession(user, names(5));
    expect(screen.queryByText(/changed in another window/)).not.toBeInTheDocument();
  });
});
