import type { Session } from '@supabase/supabase-js';
import { act, cleanup, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { resetRosterDbForTests } from '../store/rosterDb';
import type { SyncState } from '../sync/syncStore';

const backend = vi.hoisted(() => ({ client: null as unknown }));
vi.mock('../sync/client', () => ({ getSupabase: () => backend.client }));
const actions = vi.hoisted(() => ({ deleteAllMyData: vi.fn(), clearThisDevice: vi.fn() }));
vi.mock('../sync/dataActions', () => actions);

const session = { user: { email: 'ann@example.com', id: 'user-1' } } as unknown as Session;
function fakeClient(signedIn: boolean) {
  return {
    auth: {
      getSession: vi.fn().mockResolvedValue({ data: { session: signedIn ? session : null }, error: null }),
      onAuthStateChange: vi.fn(() => ({ data: { subscription: { unsubscribe: vi.fn() } } })),
      signInWithOtp: vi.fn().mockResolvedValue({ data: {}, error: null }),
      signOut: vi.fn().mockResolvedValue({ error: null }),
    },
    // The sync coordinator asks for tables only once a round runs; these tests never let one start.
    from: vi.fn(),
    storage: { from: vi.fn() },
  };
}

/** A fresh copy of the app and its stores, so every test starts clean. */
async function startApp(options: { client: ReturnType<typeof fakeClient> | null }) {
  vi.resetModules();
  backend.client = options.client;
  const { default: App } = await import('./App');
  const { useAuthStore } = await import('../sync/auth');
  const { useSyncStore } = await import('../sync/syncStore');
  const { useRosterStore } = await import('../store/rosterStore');
  render(<App />);
  return { user: userEvent.setup(), auth: useAuthStore, sync: useSyncStore, roster: useRosterStore };
}

const openSaved = async (user: ReturnType<typeof userEvent.setup>) => {
  // The Edit players link shows once there is someone saved.
  await user.type(screen.getByLabelText('Search or add players'), 'Ann{enter}');
  await user.click(await screen.findByRole('button', { name: /edit players/i }));
};
const openSettings = (user: ReturnType<typeof userEvent.setup>) => user.click(screen.getByRole('button', { name: 'Settings' }));

beforeEach(async () => {
  localStorage.clear();
  await resetRosterDbForTests();
  actions.deleteAllMyData.mockReset();
  actions.clearThisDevice.mockReset();
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('the sync line on Saved players', () => {
  it('says signed out when nobody is signed in', async () => {
    const { user } = await startApp({ client: fakeClient(false) });
    await openSaved(user);
    expect(await screen.findByText('Signed out')).toBeInTheDocument();
  });

  it('follows where syncing stands', async () => {
    const { user, auth, sync } = await startApp({ client: fakeClient(true) });
    await openSaved(user);
    await vi.waitFor(() => expect(auth.getState().status).toBe('signedIn'));
    const lines: [Partial<SyncState>, string][] = [
      [{ status: 'synced', pending: 0 }, 'Synced'],
      [{ status: 'syncing', pending: 0 }, 'Syncing…'],
      [{ status: 'offline', pending: 2 }, 'Offline, 2 changes waiting'],
      [{ status: 'error', pending: 0 }, "Can't reach server, will retry"],
    ];
    for (const [state, text] of lines) {
      act(() => sync.setState(state));
      expect(await screen.findByText(text)).toBeInTheDocument();
    }
    expect(auth.getState().status).toBe('signedIn');
  });

  it('shows nothing extra when the build has no backend', async () => {
    const { user } = await startApp({ client: null });
    await openSaved(user);
    expect(screen.queryByText('Signed out')).not.toBeInTheDocument();
    expect(screen.queryByText('Synced')).not.toBeInTheDocument();
  });
});

describe('the sign-in banner', () => {
  const banner = () => screen.queryByText(/sign in to back up and sync your players/i);

  it('waits until there is something to back up', async () => {
    const { roster } = await startApp({ client: fakeClient(false) });
    await vi.waitFor(() => expect(roster.getState().loaded).toBe(true));
    expect(banner()).not.toBeInTheDocument();
    await act(async () => {
      await roster.getState().add('Ann');
    });
    expect(banner()).toBeInTheDocument();
  });

  it('takes the organizer to Settings', async () => {
    const { user, roster } = await startApp({ client: fakeClient(false) });
    await act(async () => {
      await roster.getState().add('Ann');
    });
    await user.click(screen.getByRole('button', { name: 'Sign in' }));
    expect(await screen.findByRole('heading', { name: 'Settings' })).toBeInTheDocument();
  });

  it('goes away for good when dismissed', async () => {
    const { user, roster } = await startApp({ client: fakeClient(false) });
    await act(async () => {
      await roster.getState().add('Ann');
    });
    await user.click(screen.getByRole('button', { name: 'Not now' }));
    expect(banner()).not.toBeInTheDocument();
    cleanup();
    const again = await startApp({ client: fakeClient(false) });
    await vi.waitFor(() => expect(again.roster.getState().loaded).toBe(true));
    expect(banner()).not.toBeInTheDocument();
  });

  it('stays hidden when signed in, while a link is on its way, and with no backend', async () => {
    const signedIn = await startApp({ client: fakeClient(true) });
    await act(async () => {
      await signedIn.roster.getState().add('Ann');
    });
    expect(banner()).not.toBeInTheDocument();
    cleanup();
    const none = await startApp({ client: null });
    await act(async () => {
      await none.roster.getState().add('Ann');
    });
    expect(banner()).not.toBeInTheDocument();
    cleanup();
    const sent = await startApp({ client: fakeClient(false) });
    await act(async () => {
      await sent.roster.getState().add('Ann');
    });
    act(() => sent.auth.setState({ status: 'linkSent', email: 'a@b.co' }));
    expect(banner()).not.toBeInTheDocument();
  });
});

describe('a blocked upgrade', () => {
  it('tells the organizer to close other tabs, and stops when it is no longer blocked', async () => {
    const { roster } = await startApp({ client: null });
    const notice = () => screen.queryByText(/close other tabs of this app/i);
    expect(notice()).not.toBeInTheDocument();
    act(() => roster.setState({ blocked: true }));
    expect(notice()).toBeInTheDocument();
    act(() => roster.setState({ blocked: false }));
    expect(notice()).not.toBeInTheDocument();
  });
});

describe('Settings: your data', () => {
  it('can clear this device after asking, and says it did', async () => {
    actions.clearThisDevice.mockResolvedValue({ ok: true });
    const confirm = vi.spyOn(window, 'confirm').mockReturnValueOnce(false).mockReturnValue(true);
    const { user } = await startApp({ client: fakeClient(false) });
    await openSettings(user);
    const button = await screen.findByRole('button', { name: /clear saved players on this device/i });
    await user.click(button);
    expect(actions.clearThisDevice).not.toHaveBeenCalled();
    await user.click(button);
    expect(confirm).toHaveBeenCalledTimes(2);
    expect(actions.clearThisDevice).toHaveBeenCalledTimes(1);
    expect(await screen.findByText(/cleared\. this device has no saved players/i)).toBeInTheDocument();
  });

  it('offers to delete everything only to someone who is signed in', async () => {
    const out = await startApp({ client: fakeClient(false) });
    await openSettings(out.user);
    await screen.findByRole('button', { name: /clear saved players/i });
    expect(screen.queryByRole('button', { name: /delete all my data/i })).not.toBeInTheDocument();
    cleanup();
    const inn = await startApp({ client: fakeClient(true) });
    await openSettings(inn.user);
    expect(await screen.findByRole('button', { name: /delete all my data/i })).toBeInTheDocument();
  });

  it('deletes everything after asking, and says it did', async () => {
    actions.deleteAllMyData.mockResolvedValue({ ok: true });
    const confirm = vi.spyOn(window, 'confirm').mockReturnValueOnce(false).mockReturnValue(true);
    const { user } = await startApp({ client: fakeClient(true) });
    await openSettings(user);
    const button = await screen.findByRole('button', { name: /delete all my data/i });
    await user.click(button);
    expect(actions.deleteAllMyData).not.toHaveBeenCalled();
    await user.click(button);
    expect(confirm.mock.calls[1][0]).toMatch(/cannot be undone/i);
    expect(actions.deleteAllMyData).toHaveBeenCalledTimes(1);
    expect(await screen.findByText(/deleted\. your account and this device have no saved players/i)).toBeInTheDocument();
  });

  it('shows why a deletion failed, and keeps the buttons usable afterwards', async () => {
    actions.deleteAllMyData.mockResolvedValue({ ok: false, message: 'No connection. Nothing on this device was removed.' });
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    const { user } = await startApp({ client: fakeClient(true) });
    await openSettings(user);
    await user.click(await screen.findByRole('button', { name: /delete all my data/i }));
    expect(await screen.findByRole('alert')).toHaveTextContent(/no connection/i);
    expect(screen.getByRole('button', { name: /delete all my data/i })).toBeEnabled();
  });

  it('disables both buttons and says it is working while an action runs', async () => {
    let finish: (value: { ok: true }) => void = () => undefined;
    actions.deleteAllMyData.mockReturnValue(new Promise((resolve) => (finish = resolve)));
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    const { user } = await startApp({ client: fakeClient(true) });
    await openSettings(user);
    await user.click(await screen.findByRole('button', { name: /delete all my data/i }));
    expect(screen.getByText('Working…')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /delete all my data/i })).toBeDisabled();
    expect(screen.getByRole('button', { name: /clear saved players/i })).toBeDisabled();
    await act(async () => finish({ ok: true }));
    expect(screen.queryByText('Working…')).not.toBeInTheDocument();
  });

  it('explains the another-account state and points at the way out', async () => {
    const { user, sync } = await startApp({ client: fakeClient(true) });
    await openSettings(user);
    await screen.findByText('ann@example.com');
    act(() => sync.setState({ status: 'otherAccount' }));
    const alert = await screen.findByRole('alert');
    expect(within(alert).getByText(/different account/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /clear saved players on this device/i })).toBeInTheDocument();
  });

  it('shows the sync line under the signed-in email', async () => {
    const { user, sync } = await startApp({ client: fakeClient(true) });
    await openSettings(user);
    await screen.findByText('ann@example.com');
    act(() => sync.setState({ status: 'synced', pending: 0 }));
    expect(await screen.findByText('Synced')).toBeInTheDocument();
  });

  it('is not shown while the sign-in is being checked', async () => {
    const client = fakeClient(true);
    client.auth.getSession.mockReturnValue(new Promise(() => undefined));
    const { user } = await startApp({ client });
    await openSettings(user);
    expect(screen.queryByRole('heading', { name: 'Your data' })).not.toBeInTheDocument();
  });
});
