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

  it('says "unknown", not "signed out", when a saved session cannot be checked', async () => {
    const { client } = fakeClient({ getSession: vi.fn().mockResolvedValue({ data: { session: null }, error: failure(0) }) });
    const store = createAuthStore(() => client);
    await store.getState().init();
    expect(store.getState().status).toBe('unknown');
  });

  it('does not wait for a session check that never finishes', async () => {
    const { client } = fakeClient({ getSession: vi.fn(() => new Promise(() => undefined)) });
    const store = createAuthStore(() => client, 10);
    await store.getState().init();
    expect(store.getState().status).toBe('unknown');
  });

  it('survives a session check that throws', async () => {
    const { client } = fakeClient({ getSession: vi.fn().mockRejectedValue(new Error('boom')) });
    const store = createAuthStore(() => client);
    await store.getState().init();
    expect(store.getState().status).toBe('unknown');
  });

  it('moves on from "unknown" when the session turns out to be valid, or to be gone', async () => {
    const unchecked = () => fakeClient({ getSession: vi.fn().mockResolvedValue({ data: { session: null }, error: failure(0) }) });

    const valid = unchecked();
    const validStore = createAuthStore(() => valid.client);
    await validStore.getState().init();
    valid.emit('TOKEN_REFRESHED', session('ann@example.com'));
    expect(validStore.getState()).toMatchObject({ status: 'signedIn', email: 'ann@example.com' });

    const gone = unchecked();
    const goneStore = createAuthStore(() => gone.client);
    await goneStore.getState().init();
    gone.emit('SIGNED_OUT', null);
    expect(goneStore.getState().status).toBe('signedOut');
  });

  it('keeps an unrelated message when the session is refreshed in the background', async () => {
    const { client, emit } = fakeClient({ getSession: vi.fn().mockResolvedValue({ data: { session: session('ann@example.com') }, error: null }) });
    const store = createAuthStore(() => client);
    await store.getState().init();
    store.setState({ error: 'Some message' });
    emit('TOKEN_REFRESHED', session('ann@example.com'));
    expect(store.getState().error).toBe('Some message');
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

    it('says there is no connection, instead of blaming the address', async () => {
      const { client } = fakeClient({ signInWithOtp: vi.fn().mockResolvedValue({ data: {}, error: failure(0) }) });
      const store = createAuthStore(() => client);
      await store.getState().init();
      await store.getState().sendCode('ann@example.com');
      expect(store.getState().error).toBe('No connection. Try again when you are online.');
    });

    it('says there is no connection when the browser is offline and the request throws', async () => {
      const online = vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false);
      const { client } = fakeClient({ signInWithOtp: vi.fn().mockRejectedValue(new TypeError('fetch failed')) });
      const store = createAuthStore(() => client);
      await store.getState().init();
      await store.getState().sendCode('ann@example.com');
      online.mockRestore();
      expect(store.getState()).toMatchObject({ busy: false, error: 'No connection. Try again when you are online.' });
    });

    it('ignores a second request while one is running', async () => {
      const { client, auth } = fakeClient();
      const store = createAuthStore(() => client);
      await store.getState().init();
      await Promise.all([store.getState().sendCode('ann@example.com'), store.getState().sendCode('ann@example.com')]);
      expect(auth.signInWithOtp).toHaveBeenCalledTimes(1);
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

    it('says there is no connection when checking the code', async () => {
      const { store } = await codeSent({ verifyOtp: vi.fn().mockResolvedValue({ data: { session: null }, error: failure(0) }) });
      await store.getState().verifyCode('123456');
      expect(store.getState().status).toBe('codeSent');
      expect(store.getState().error).toBe('No connection. Try again when you are online.');
    });

    it('ignores a second submit while the first is running, so one good code is not spent twice', async () => {
      const { store, auth } = await codeSent();
      await Promise.all([store.getState().verifyCode('123456'), store.getState().verifyCode('123456')]);
      expect(auth.verifyOtp).toHaveBeenCalledTimes(1);
      expect(store.getState()).toMatchObject({ status: 'signedIn', error: null });
    });

    it('is ready again after the client throws', async () => {
      const { store } = await codeSent({ verifyOtp: vi.fn().mockRejectedValue(new Error('boom')) });
      await store.getState().verifyCode('123456');
      expect(store.getState()).toMatchObject({ status: 'codeSent', busy: false });
      expect(store.getState().error).toMatch(/did not work/i);
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

    it('ignores a second sign-out while one is running', async () => {
      const { store, auth } = await signedIn();
      await Promise.all([store.getState().signOut(), store.getState().signOut()]);
      expect(auth.signOut).toHaveBeenCalledTimes(1);
    });

    it('signs out', async () => {
      const { store, auth } = await signedIn();
      await store.getState().signOut();
      expect(auth.signOut).toHaveBeenCalledTimes(1);
      expect(store.getState()).toMatchObject({ status: 'signedOut', email: null });
    });

    it('does not call it a failure when the session was removed on this device but the server could not be told', async () => {
      const listener: { emit?: (event: string, session: Session | null) => void } = {};
      const { store, emit } = await signedIn({
        signOut: vi.fn(async () => {
          listener.emit?.('SIGNED_OUT', null); // what supabase-js does as it removes the session on this device
          return { error: failure(0) };
        }),
      });
      listener.emit = emit;
      await store.getState().signOut();
      expect(store.getState()).toMatchObject({ status: 'signedOut', error: null, busy: false });
    });

    it('says so when it cannot sign out without a connection and nothing was removed', async () => {
      const { store } = await signedIn({ signOut: vi.fn().mockResolvedValue({ error: failure(0) }) });
      await store.getState().signOut();
      expect(store.getState().status).toBe('signedIn');
      expect(store.getState().error).toMatch(/without a connection/i);
    });

    it('stays signed in and says so when sign-out fails', async () => {
      const { store } = await signedIn({ signOut: vi.fn().mockResolvedValue({ error: failure(500) }) });
      await store.getState().signOut();
      expect(store.getState().status).toBe('signedIn');
      expect(store.getState().error).toBe("Couldn't sign out. Try again.");
    });
  });
});
