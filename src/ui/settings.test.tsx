import type { AuthError, Session } from '@supabase/supabase-js';
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// The app reads its Supabase client through getSupabase(); these tests hand it a fake one.
const backend = vi.hoisted(() => ({ client: null as unknown }));
vi.mock('../sync/client', () => ({ getSupabase: () => backend.client }));

const session = (email: string) => ({ user: { email } }) as unknown as Session;
const failure = (status: number) => ({ status, message: 'boom' }) as unknown as AuthError;

function fakeClient(over: Record<string, unknown> = {}) {
  return {
    auth: {
      getSession: vi.fn().mockResolvedValue({ data: { session: null }, error: null }),
      onAuthStateChange: vi.fn(() => ({ data: { subscription: { unsubscribe: vi.fn() } } })),
      signInWithOtp: vi.fn().mockResolvedValue({ data: {}, error: null }),
      verifyOtp: vi.fn().mockResolvedValue({ data: { session: session('ann@example.com') }, error: null }),
      signOut: vi.fn().mockResolvedValue({ error: null }),
      ...over,
    },
  };
}

/** A fresh copy of the app, so the sign-in store starts clean for every test. */
async function startApp(client: ReturnType<typeof fakeClient> | null) {
  vi.resetModules();
  backend.client = client;
  const { default: App } = await import('./App');
  render(<App />);
  return userEvent.setup();
}

beforeEach(() => {
  localStorage.clear();
});
afterEach(() => {
  cleanup();
});

async function openSettings(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByRole('button', { name: 'Settings' }));
  return screen.findByRole('heading', { name: 'Settings' });
}

describe('Settings screen', () => {
  it('explains that sign-in is not set up when the build has no backend', async () => {
    const user = await startApp(null);
    await openSettings(user);
    expect(await screen.findByText(/sign-in is not set up/i)).toBeInTheDocument();
    expect(screen.queryByLabelText('Email')).not.toBeInTheDocument();
  });

  it('goes back to Setup without losing what was typed there', async () => {
    const user = await startApp(null);
    await user.type(screen.getByLabelText('Session name'), 'Friday open play');
    await openSettings(user);
    await user.click(screen.getByRole('button', { name: 'Back' }));
    expect(screen.getByLabelText('Session name')).toHaveValue('Friday open play');
    expect(screen.queryByRole('heading', { name: 'Settings' })).not.toBeInTheDocument();
  });

  it('signs in with an emailed code, then signs out', async () => {
    const client = fakeClient();
    const user = await startApp(client);
    await openSettings(user);

    await user.type(await screen.findByLabelText('Email'), 'ann@example.com');
    await user.click(screen.getByRole('button', { name: 'Send me a code' }));
    expect(client.auth.signInWithOtp).toHaveBeenCalledWith({ email: 'ann@example.com' });
    expect(await screen.findByText(/we sent a 6-digit code to/i)).toHaveTextContent('ann@example.com');

    await user.type(screen.getByLabelText('6-digit code'), '123456');
    await user.click(screen.getByRole('button', { name: 'Sign in' }));
    expect(client.auth.verifyOtp).toHaveBeenCalledWith({ email: 'ann@example.com', token: '123456', type: 'email' });
    expect(await screen.findByText(/signed in as/i)).toHaveTextContent('ann@example.com');

    await user.click(screen.getByRole('button', { name: 'Sign out' }));
    expect(await screen.findByLabelText('Email')).toBeInTheDocument();
  });

  it('shows a plain message when the code is wrong and stays on the code step', async () => {
    const client = fakeClient({ verifyOtp: vi.fn().mockResolvedValue({ data: { session: null }, error: failure(403) }) });
    const user = await startApp(client);
    await openSettings(user);
    await user.type(await screen.findByLabelText('Email'), 'ann@example.com');
    await user.click(screen.getByRole('button', { name: 'Send me a code' }));
    await user.type(await screen.findByLabelText('6-digit code'), '000000');
    await user.click(screen.getByRole('button', { name: 'Sign in' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(/did not work/i);
    expect(screen.getByLabelText('6-digit code')).toBeInTheDocument();
  });

  it('explains a rate limit and lets the user go back to change the email', async () => {
    const client = fakeClient({ signInWithOtp: vi.fn().mockResolvedValueOnce({ data: {}, error: failure(429) }).mockResolvedValue({ data: {}, error: null }) });
    const user = await startApp(client);
    await openSettings(user);
    await user.type(await screen.findByLabelText('Email'), 'ann@example.com');
    await user.click(screen.getByRole('button', { name: 'Send me a code' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(/too many sign-in emails/i);

    await user.click(screen.getByRole('button', { name: 'Send me a code' }));
    await user.click(await screen.findByRole('button', { name: 'Use a different email' }));
    expect(screen.getByLabelText('Email')).toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('rejects an address that is not an email', async () => {
    const client = fakeClient();
    const user = await startApp(client);
    await openSettings(user);
    await user.type(await screen.findByLabelText('Email'), 'ann');
    await user.click(screen.getByRole('button', { name: 'Send me a code' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Enter a valid email address.');
    expect(client.auth.signInWithOtp).not.toHaveBeenCalled();
  });

  it('says it cannot check sign-in offline, and shows no forms, when a saved session cannot be checked', async () => {
    const client = fakeClient({ getSession: vi.fn().mockResolvedValue({ data: { session: null }, error: failure(0) }) });
    const user = await startApp(client);
    await openSettings(user);
    expect(await screen.findByText(/can't check sign-in without a connection/i)).toBeInTheDocument();
    expect(screen.queryByLabelText('Email')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Sign out' })).not.toBeInTheDocument();
  });

  it('accepts a code pasted with a space in it', async () => {
    const client = fakeClient();
    const user = await startApp(client);
    await openSettings(user);
    await user.type(await screen.findByLabelText('Email'), 'ann@example.com');
    await user.click(screen.getByRole('button', { name: 'Send me a code' }));
    await user.type(await screen.findByLabelText('6-digit code'), '123 456');
    expect(screen.getByLabelText('6-digit code')).toHaveValue('123456');
    await user.click(screen.getByRole('button', { name: 'Sign in' }));
    expect(client.auth.verifyOtp).toHaveBeenCalledWith({ email: 'ann@example.com', token: '123456', type: 'email' });
  });

  it('starts signed in when this device already has a session', async () => {
    const client = fakeClient({ getSession: vi.fn().mockResolvedValue({ data: { session: session('ann@example.com') }, error: null }) });
    const user = await startApp(client);
    await openSettings(user);
    expect(await screen.findByText(/signed in as/i)).toHaveTextContent('ann@example.com');
  });
});

describe('sign-in state on Saved players', () => {
  it('shows who is signed in, or that nobody is', async () => {
    const signedOut = await startApp(fakeClient());
    await signedOut.click(screen.getByRole('button', { name: 'Manage saved players' }));
    expect(await screen.findByText('Signed out')).toBeInTheDocument();
    cleanup();

    const user = await startApp(
      fakeClient({ getSession: vi.fn().mockResolvedValue({ data: { session: session('ann@example.com') }, error: null }) }),
    );
    await user.click(screen.getByRole('button', { name: 'Manage saved players' }));
    expect(await screen.findByText('Signed in as ann@example.com')).toBeInTheDocument();
  });

  it('shows nothing about sign-in when the build has no backend', async () => {
    const user = await startApp(null);
    await user.click(screen.getByRole('button', { name: 'Manage saved players' }));
    await screen.findByRole('heading', { name: 'Saved players' });
    expect(screen.queryByText(/signed (in|out)/i)).not.toBeInTheDocument();
  });
});
