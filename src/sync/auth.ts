import type { SupabaseClient } from '@supabase/supabase-js';
import { create } from 'zustand';
import { getSupabase } from './client';

/** The parts of Supabase Auth this app uses. */
export type AuthClient = Pick<
  SupabaseClient['auth'],
  'getSession' | 'onAuthStateChange' | 'signInWithOtp' | 'verifyOtp' | 'signOut'
>;

/**
 * `unknown`: there may be a saved session, but it could not be checked (no connection). The app then says neither
 * "signed in" nor "signed out", and anything that syncs must neither sync nor clear.
 */
export type AuthStatus = 'unconfigured' | 'loading' | 'unknown' | 'signedOut' | 'codeSent' | 'signedIn';

export interface AuthState {
  status: AuthStatus;
  /** The signed-in email, or the address a code was sent to. */
  email: string | null;
  error: string | null;
  busy: boolean;
  init: () => Promise<void>;
  sendCode: (email: string) => Promise<void>;
  verifyCode: (code: string) => Promise<void>;
  /** Go back from "enter the code" to "enter your email". */
  changeEmail: () => void;
  signOut: () => Promise<void>;
}

const TOO_MANY = 'Too many sign-in emails right now. Wait a few minutes and try again.';
const OFFLINE = 'No connection. Try again when you are online.';

/** Checking a saved session that needs a refresh can take about 25 seconds with no connection; do not wait for it. */
const SESSION_CHECK_MS = 3000;

function isRateLimited(error: { status?: number }): boolean {
  return error.status === 429;
}

/** Status 0 is how supabase-js reports a request that never reached the server. */
function isOffline(error: { status?: number }): boolean {
  return error.status === 0 || (typeof navigator !== 'undefined' && navigator.onLine === false);
}

/** A sign-in store over the given client. Pass a fake client (and a short check time) in tests. */
export function createAuthStore(getClient: () => { auth: AuthClient } | null, sessionCheckMs = SESSION_CHECK_MS) {
  let initialised = false;

  return create<AuthState>()((set, get) => {
    /** Runs one action: ignores a second call while one is running, and always clears `busy`, even if the client throws. */
    async function guarded(failure: string, work: () => Promise<void>) {
      if (get().busy) return;
      set({ busy: true, error: null });
      try {
        await work();
      } catch {
        set({ error: isOffline({}) ? OFFLINE : failure });
      } finally {
        set({ busy: false });
      }
    }

    return {
      status: 'loading',
      email: null,
      error: null,
      busy: false,

      async init() {
        if (initialised) return;
        initialised = true;
        const client = getClient();
        if (!client) {
          set({ status: 'unconfigured' });
          return;
        }
        let timer: ReturnType<typeof setTimeout> | undefined;
        try {
          // Keep the status in step with the session: sign-in, sign-out and a session that ended. The callback must
          // stay free of other Supabase calls.
          client.auth.onAuthStateChange((event, session) => {
            const email = session?.user.email;
            if (email) {
              if (get().status !== 'signedIn' || get().email !== email) set({ status: 'signedIn', email, error: null });
            } else if (event === 'SIGNED_OUT' && (get().status === 'signedIn' || get().status === 'unknown')) {
              set({ status: 'signedOut', email: null });
            }
          });
          const timeout = new Promise<'timeout'>((resolve) => {
            timer = setTimeout(() => resolve('timeout'), sessionCheckMs);
          });
          const result = await Promise.race([client.auth.getSession(), timeout]);
          if (get().status !== 'loading') return; // the listener got there first
          if (result === 'timeout') {
            set({ status: 'unknown' });
          } else if (result.data.session?.user.email) {
            set({ status: 'signedIn', email: result.data.session.user.email });
          } else {
            // An error with no session means "could not check", not "nobody is signed in".
            set({ status: result.error ? 'unknown' : 'signedOut', email: null });
          }
        } catch {
          if (get().status === 'loading') set({ status: 'unknown' });
        } finally {
          clearTimeout(timer);
        }
      },

      async sendCode(rawEmail) {
        const client = getClient();
        if (!client || get().busy) return;
        const email = rawEmail.trim();
        if (!/^\S+@\S+\.\S+$/.test(email)) {
          set({ error: 'Enter a valid email address.' });
          return;
        }
        const failure = "Couldn't send the code. Check the address and try again.";
        await guarded(failure, async () => {
          const { error } = await client.auth.signInWithOtp({ email });
          if (error) {
            set({ error: isRateLimited(error) ? TOO_MANY : isOffline(error) ? OFFLINE : failure });
            return;
          }
          set({ status: 'codeSent', email });
        });
      },

      async verifyCode(rawCode) {
        const client = getClient();
        const email = get().email;
        if (!client || !email || get().busy) return;
        const token = rawCode.trim();
        if (!/^\d{6}$/.test(token)) {
          set({ error: 'Enter the 6-digit code from the email.' });
          return;
        }
        const failure = 'That code did not work. Check it, or go back and ask for a new one.';
        await guarded(failure, async () => {
          const { data, error } = await client.auth.verifyOtp({ email, token, type: 'email' });
          if (error || !data.session) {
            set({ error: error && isRateLimited(error) ? TOO_MANY : error && isOffline(error) ? OFFLINE : failure });
            return;
          }
          set({ status: 'signedIn', email: data.session.user.email ?? email, error: null });
        });
      },

      changeEmail() {
        set({ status: 'signedOut', error: null });
      },

      async signOut() {
        const client = getClient();
        if (!client) return;
        await guarded("Couldn't sign out. Try again.", async () => {
          const { error } = await client.auth.signOut();
          // With no connection the client still removes the session on this device and tells the listener, which has
          // already moved us to signed out. Do not contradict that with an error.
          if (get().status === 'signedOut') return;
          if (error) {
            set({
              error: isOffline(error)
                ? "Can't sign out without a connection. Try again when you are online."
                : "Couldn't sign out. Try again.",
            });
            return;
          }
          set({ status: 'signedOut', email: null });
        });
      },
    };
  });
}

/** The app's sign-in store. */
export const useAuthStore = createAuthStore(getSupabase);
