import { act, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { resetRosterDbForTests } from '../store/rosterDb';
import { useRosterStore } from '../store/rosterStore';
import { useSessionStore } from '../store/sessionStore';
import { renderAtSetup } from '../test/renderAtSetup';

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

describe('the screen stays on during a session', () => {
  function stubWakeLock() {
    const release = vi.fn(async () => {});
    const request = vi.fn(async () => ({ released: false, release }));
    Object.defineProperty(navigator, 'wakeLock', { value: { request }, configurable: true });
    return { request, release };
  }

  it('asks once for the whole session, keeps it through Settings, and lets go when the session ends', async () => {
    const user = userEvent.setup();
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    const { request, release } = stubWakeLock();
    renderAtSetup();
    await act(async () => {});
    expect(request).not.toHaveBeenCalled(); // no session yet
    await user.type(screen.getByLabelText('Search or add players'), names(5));
    await user.keyboard('{Enter}');
    await user.click(await screen.findByRole('button', { name: 'Start 5 players' }));
    await waitFor(() => expect(request).toHaveBeenCalledTimes(1));
    await user.click(screen.getByRole('button', { name: /^Settings/ }));
    await user.click(screen.getByRole('button', { name: 'Back' }));
    expect(release).not.toHaveBeenCalled();
    expect(request).toHaveBeenCalledTimes(1);
    await user.click(screen.getByRole('button', { name: 'Menu' }));
    await user.click(screen.getByRole('button', { name: 'End session' }));
    await waitFor(() => expect(release).toHaveBeenCalledTimes(1));
  });

  it('asks for nothing when Keep the screen on is off in Settings', async () => {
    const user = userEvent.setup();
    const { request } = stubWakeLock();
    renderAtSetup();
    await user.click(screen.getByRole('button', { name: /^Settings/ }));
    const keep = screen.getByRole('switch', { name: 'Keep the screen on' });
    expect(keep).toBeChecked();
    await user.click(keep);
    expect(localStorage.getItem('pickleball.keepAwake')).toBe('false');
    await user.click(screen.getByRole('button', { name: 'Back' }));
    await user.type(screen.getByLabelText('Search or add players'), names(5));
    await user.keyboard('{Enter}');
    await user.click(await screen.findByRole('button', { name: 'Start 5 players' }));
    await act(async () => {});
    expect(request).not.toHaveBeenCalled();
  });
});

describe('Settings, During a session', () => {
  it('has two switches that start on and remember a change', async () => {
    const user = userEvent.setup();
    renderAtSetup();
    await user.click(screen.getByRole('button', { name: /^Settings/ }));
    const buzz = screen.getByRole('switch', { name: 'Buzz when a game finishes' });
    expect(buzz).toBeChecked();
    await user.click(buzz);
    expect(buzz).not.toBeChecked();
    expect(localStorage.getItem('pickleball.vibrate')).toBe('false');
    await user.click(buzz);
    expect(localStorage.getItem('pickleball.vibrate')).toBe('true');
  });
});

describe('courts are remembered', () => {
  it('starts the next New session with the number last used', async () => {
    const user = userEvent.setup();
    renderAtSetup();
    expect(screen.getByRole('group', { name: 'Courts' })).toHaveTextContent('2');
    await user.type(screen.getByLabelText('Search or add players'), names(4));
    await user.keyboard('{Enter}');
    await user.click(screen.getByRole('button', { name: 'More courts' }));
    await user.click(screen.getByRole('button', { name: 'More courts' }));
    await user.click(await screen.findByRole('button', { name: 'Start 4 players' }));
    expect(localStorage.getItem('pickleball.courts')).toBe('4');
    act(() => useSessionStore.getState().reset());
    // Resetting lands on Home, so open Who's playing again.
    await user.click(screen.getByRole('button', { name: 'Start a one-off session' }));
    expect(screen.getByRole('group', { name: 'Courts' })).toHaveTextContent('4');
  });

  it('ignores a bad stored value', () => {
    localStorage.setItem('pickleball.courts', 'lots');
    renderAtSetup();
    expect(screen.getByRole('group', { name: 'Courts' })).toHaveTextContent('2');
  });
});
