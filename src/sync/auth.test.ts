import type { AuthError, Session } from '@supabase/supabase-js';
import { describe, expect, it, vi } from 'vitest';
import { createAuthStore, type AuthClient } from './auth';

const session = (email: string) => ({ user: { email } }) as unknown as Session;
const failure = (status?: number) => ({ status, message: 'boom' }) as unknown as AuthError;

type Listener = (event: string, session: Session | null) => void;

function fakeClient(over: Partial<Record<keyof AuthClient, unknown>> = {}) {
  let listener: Listener | undefined;
  const auth = {
    getSession: vi.fn().mockResolvedValue({ data: { session: null }, error: null }),
    onAuthStateChange: vi.fn((cb: Listener) => {
      listener = cb;
      return { data: { subscription: { unsubscribe: vi.fn() } } };
    }),
    signInWithOtp: vi.fn().mockResolvedValue({ data: {}, error: null }),
    verifyOtp: vi.fn().mockResolvedValue({ data: { session: session('ann@example.com') }, error: null }),
    signOut: vi.fn().mockResolvedValue({ error: null }),
    ...over,
  };
  return { client: { auth: auth as unknown as AuthClient }, auth, emit: (e: string, s: Session | null) => listener?.(e, s) };
}

describe('auth store', () => {
  it('is "unconfigured" when the build has no backend, and never touches the network', async () => {
    const store = createAuthStore(() => null);
    await store.getState().init();
    expect(store.getState().status).toBe('unconfigured');
    await store.getState().sendCode('ann@example.com');
    expect(store.getState().status).toBe('unconfigured');
  });

  it('starts signed out when there is no saved session', async () => {
    const { client } = fakeClient();
    const store = createAuthStore(() => client);
    expect(store.getState().status).toBe('loading');
    await store.getState().init();
    expect(store.getState()).toMatchObject({ status: 'signedOut', email: null });
  });

  it('starts signed in when a session was saved on this device', async () => {
    const { client } = fakeClient({ getSession: vi.fn().mockResolvedValue({ data: { session: session('ann@example.com') }, error: null }) });
    const store = createAuthStore(() => client);
    await store.getState().init();
    expect(store.getState()).toMatchObject({ status: 'signedIn', email: 'ann@example.com' });
  });

  it('only listens for session changes once, even if init is called twice', async () => {
    const { client, auth } = fakeClient();
    const store = createAuthStore(() => client);
    await Promise.all([store.getState().init(), store.getState().init()]);
    expect(auth.onAuthStateChange).toHaveBeenCalledTimes(1);
    expect(auth.getSession).toHaveBeenCalledTimes(1);
  });

  it('follows the session when it ends elsewhere', async () => {
    const { client, emit } = fakeClient({ getSession: vi.fn().mockResolvedValue({ data: { session: session('ann@example.com') }, error: null }) });
    const store = createAuthStore(() => client);
    await store.getState().init();
    emit('SIGNED_OUT', null);
    expect(store.getState()).toMatchObject({ status: 'signedOut', email: null });
  });

  describe('sending a code', () => {
    it('asks for the code and remembers the address', async () => {
      const { client, auth } = fakeClient();
      const store = createAuthStore(() => client);
      await store.getState().init();
      await store.getState().sendCode('  ann@example.com ');
      expect(auth.signInWithOtp).toHaveBeenCalledWith({ email: 'ann@example.com' });
      expect(store.getState()).toMatchObject({ status: 'codeSent', email: 'ann@example.com', error: null, busy: false });
    });

    it('rejects an address that is not an email without asking Supabase', async () => {
      const { client, auth } = fakeClient();
      const store = createAuthStore(() => client);
      await store.getState().init();
      await store.getState().sendCode('ann');
      expect(auth.signInWithOtp).not.toHaveBeenCalled();
      expect(store.getState()).toMatchObject({ status: 'signedOut', error: 'Enter a valid email address.' });
    });

    it('explains a rate limit in plain words', async () => {
      const { client } = fakeClient({ signInWithOtp: vi.fn().mockResolvedValue({ data: {}, error: failure(429) }) });
      const store = createAuthStore(() => client);
      await store.getState().init();
      await store.getState().sendCode('ann@example.com');
      expect(store.getState().status).toBe('signedOut');
      expect(store.getState().error).toMatch(/too many sign-in emails/i);
      expect(store.getState().busy).toBe(false);
    });

    it('shows a gentle message for any other failure, without Supabase\'s wording', async () => {
      const { client } = fakeClient({ signInWithOtp: vi.fn().mockResolvedValue({ data: {}, error: failure(500) }) });
      const store = createAuthStore(() => client);
      await store.getState().init();
      await store.getState().sendCode('ann@example.com');
      expect(store.getState().error).toBe("Couldn't send the code. Check the address and try again.");
    });
  });

  describe('entering the code', () => {
    async function codeSent(over: Partial<Record<keyof AuthClient, unknown>> = {}) {
      const fake = fakeClient(over);
      const store = createAuthStore(() => fake.client);
      await store.getState().init();
      await store.getState().sendCode('ann@example.com');
      return { store, ...fake };
    }

    it('signs in with the six digits', async () => {
      const { store, auth } = await codeSent();
      await store.getState().verifyCode(' 123456 ');
      expect(auth.verifyOtp).toHaveBeenCalledWith({ email: 'ann@example.com', token: '123456', type: 'email' });
      expect(store.getState()).toMatchObject({ status: 'signedIn', email: 'ann@example.com', error: null });
    });

    it('rejects anything but six digits without asking Supabase', async () => {
      const { store, auth } = await codeSent();
      await store.getState().verifyCode('12345');
      await store.getState().verifyCode('12345a');
      expect(auth.verifyOtp).not.toHaveBeenCalled();
      expect(store.getState()).toMatchObject({ status: 'codeSent', error: 'Enter the 6-digit code from the email.' });
    });

    it('tells the user a wrong or expired code did not work and keeps them on the code step', async () => {
      const { store } = await codeSent({ verifyOtp: vi.fn().mockResolvedValue({ data: { session: null }, error: failure(403) }) });
      await store.getState().verifyCode('000000');
      expect(store.getState().status).toBe('codeSent');
      expect(store.getState().error).toMatch(/did not work/i);
    });

    it('explains a rate limit', async () => {
      const { store } = await codeSent({ verifyOtp: vi.fn().mockResolvedValue({ data: { session: null }, error: failure(429) }) });
      await store.getState().verifyCode('000000');
      expect(store.getState().error).toMatch(/too many/i);
    });

    it('lets the user go back and use a different email', async () => {
      const { store } = await codeSent();
      store.getState().changeEmail();
      expect(store.getState()).toMatchObject({ status: 'signedOut', error: null });
    });
  });

  describe('signing out', () => {
    async function signedIn(over: Partial<Record<keyof AuthClient, unknown>> = {}) {
      const fake = fakeClient({ getSession: vi.fn().mockResolvedValue({ data: { session: session('ann@example.com') }, error: null }), ...over });
      const store = createAuthStore(() => fake.client);
      await store.getState().init();
      return { store, ...fake };
    }

    it('signs out', async () => {
      const { store, auth } = await signedIn();
      await store.getState().signOut();
      expect(auth.signOut).toHaveBeenCalledTimes(1);
      expect(store.getState()).toMatchObject({ status: 'signedOut', email: null });
    });

    it('stays signed in and says so when sign-out fails', async () => {
      const { store } = await signedIn({ signOut: vi.fn().mockResolvedValue({ error: failure(500) }) });
      await store.getState().signOut();
      expect(store.getState().status).toBe('signedIn');
      expect(store.getState().error).toBe("Couldn't sign out. Try again.");
    });
  });
});
