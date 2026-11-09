import type { SupabaseClient } from '@supabase/supabase-js';
import { create } from 'zustand';
import { getSupabase } from './client';

/** The parts of Supabase Auth this app uses. */
export type AuthClient = Pick<
  SupabaseClient['auth'],
  'getSession' | 'onAuthStateChange' | 'signInWithOtp' | 'signOut'
>;

/**
 * `unknown`: there may be a saved session, but it could not be checked (no connection). The app then says neither
 * "signed in" nor "signed out", and anything that syncs must neither sync nor clear.
 */
export type AuthStatus = 'unconfigured' | 'loading' | 'unknown' | 'signedOut' | 'linkSent' | 'signedIn';

export interface AuthState {
  status: AuthStatus;
  /** The signed-in email, or the address a sign-in link was sent to. */
  email: string | null;
  /** The signed-in account's id, which names its rows and photo files online. Null unless signed in. */
  userId: string | null;
  error: string | null;
  busy: boolean;
  init: () => Promise<void>;
  sendLink: (email: string) => Promise<void>;
  /** Go back from "check your email" to "enter your email". */
  changeEmail: () => void;
  signOut: () => Promise<void>;
}

const TOO_MANY = 'Too many sign-in emails right now. Wait a few minutes and try again.';
const OFFLINE = 'No connection. Try again when you are online.';
const BAD_LINK = 'That sign-in link did not work. It may have expired or been used already. Ask for a new one.';

/** Checking a saved session that needs a refresh can take about 25 seconds with no connection; do not wait for it. */
const SESSION_CHECK_MS = 3000;

/**
 * A sign-in link that failed (expired, or already used) comes back with the reason in the page address. Supabase does
 * not report it to the app, so read it here, say so, and tidy the address. Returns true when there was one.
 */
function takeLinkError(): boolean {
  if (typeof window === 'undefined') return false;
  const params = new URLSearchParams(window.location.hash.replace(/^#/, ''));
  if (!params.has('error') && !params.has('error_code') && !params.has('error_description')) return false;
  window.history.replaceState(window.history.state, '', window.location.pathname + window.location.search);
  return true;
}

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
      userId: null,
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
        if (takeLinkError()) set({ error: BAD_LINK });
        try {
          // Keep the status in step with the session: sign-in, sign-out and a session that ended. The callback must
          // stay free of other Supabase calls.
          client.auth.onAuthStateChange((event, session) => {
            const email = session?.user.email;
            if (email && session) {
              const userId = session.user.id;
              if (get().status !== 'signedIn' || get().email !== email || get().userId !== userId) {
                set({ status: 'signedIn', email, userId, error: null });
              }
            } else if ((event === 'SIGNED_OUT' && (get().status === 'signedIn' || get().status === 'unknown')) || (event === 'INITIAL_SESSION' && (get().status === 'loading' || get().status === 'unknown'))) {
              set({ status: 'signedOut', email: null, userId: null });
            }
          });
          const timeout = new Promise<'timeout'>((resolve) => {
            timer = setTimeout(() => resolve('timeout'), sessionCheckMs);
          });
          const sessionCheck = client.auth.getSession().then((result) => {
            // The check may complete after our UI timeout. Only resolve the initial unknown state;
            // a sign-in, sign-out or link request in the meantime takes precedence.
            if (get().status === 'unknown' && !result.error) {
              const user = result.data.session?.user;
              set(user?.email
                ? { status: 'signedIn', email: user.email, userId: user.id }
                : { status: 'signedOut', email: null, userId: null });
            }
            return result;
          });
          const result = await Promise.race([sessionCheck, timeout]);
          if (get().status !== 'loading') return; // the listener got there first
          if (result === 'timeout') {
            set({ status: 'unknown' });
          } else if (result.data.session?.user.email) {
            set({ status: 'signedIn', email: result.data.session.user.email, userId: result.data.session.user.id });
          } else {
            // An error with no session means "could not check", not "nobody is signed in".
            set({ status: result.error ? 'unknown' : 'signedOut', email: null, userId: null });
          }
        } catch {
          if (get().status === 'loading') set({ status: 'unknown' });
        } finally {
          clearTimeout(timer);
        }
      },

      async sendLink(rawEmail) {
        const client = getClient();
        if (!client || get().busy) return;
        const email = rawEmail.trim();
        if (!/^\S+@\S+\.\S+$/.test(email)) {
          set({ error: 'Enter a valid email address.' });
          return;
        }
        const failure = "Couldn't send the link. Check the address and try again.";
        await guarded(failure, async () => {
          // The link brings the person back to this app; supabase-js picks the session up from the page address.
          const { error } = await client.auth.signInWithOtp({ email, options: { emailRedirectTo: window.location.origin } });
          if (error) {
            set({ error: isRateLimited(error) ? TOO_MANY : isOffline(error) ? OFFLINE : failure });
            return;
          }
          set({ status: 'linkSent', email });
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
          set({ status: 'signedOut', email: null, userId: null });
        });
      },
    };
  });
}

/** The app's sign-in store. */
export const useAuthStore = createAuthStore(getSupabase);
