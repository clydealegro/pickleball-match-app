import type { SupabaseClient } from '@supabase/supabase-js';
import { create } from 'zustand';
import { getSupabase } from './client';

/** The parts of Supabase Auth this app uses. */
export type AuthClient = Pick<
  SupabaseClient['auth'],
  'getSession' | 'onAuthStateChange' | 'signInWithOtp' | 'verifyOtp' | 'signOut'
>;

export type AuthStatus = 'unconfigured' | 'loading' | 'signedOut' | 'codeSent' | 'signedIn';

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

function isRateLimited(error: { status?: number }): boolean {
  return error.status === 429;
}

/** A sign-in store over the given client. Pass a fake client in tests. */
export function createAuthStore(getClient: () => { auth: AuthClient } | null) {
  let initialised = false;

  return create<AuthState>()((set, get) => ({
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
      // Keep the status in step with the session: sign-in, sign-out and a session that expired.
      client.auth.onAuthStateChange((_event, session) => {
        if (session?.user.email) set({ status: 'signedIn', email: session.user.email, error: null });
        else if (get().status === 'signedIn') set({ status: 'signedOut', email: null });
      });
      const { data } = await client.auth.getSession();
      const email = data.session?.user.email ?? null;
      set(email ? { status: 'signedIn', email } : { status: 'signedOut', email: null });
    },

    async sendCode(rawEmail) {
      const client = getClient();
      if (!client) return;
      const email = rawEmail.trim();
      if (!/^\S+@\S+\.\S+$/.test(email)) {
        set({ error: 'Enter a valid email address.' });
        return;
      }
      set({ busy: true, error: null });
      const { error } = await client.auth.signInWithOtp({ email });
      if (error) {
        set({ busy: false, error: isRateLimited(error) ? TOO_MANY : "Couldn't send the code. Check the address and try again." });
        return;
      }
      set({ busy: false, status: 'codeSent', email });
    },

    async verifyCode(rawCode) {
      const client = getClient();
      const email = get().email;
      if (!client || !email) return;
      const token = rawCode.trim();
      if (!/^\d{6}$/.test(token)) {
        set({ error: 'Enter the 6-digit code from the email.' });
        return;
      }
      set({ busy: true, error: null });
      const { data, error } = await client.auth.verifyOtp({ email, token, type: 'email' });
      if (error || !data.session) {
        set({
          busy: false,
          error: error && isRateLimited(error) ? TOO_MANY : 'That code did not work. Check it, or go back and ask for a new one.',
        });
        return;
      }
      set({ busy: false, status: 'signedIn', email: data.session.user.email ?? email, error: null });
    },

    changeEmail() {
      set({ status: 'signedOut', error: null });
    },

    async signOut() {
      const client = getClient();
      if (!client) return;
      set({ busy: true, error: null });
      const { error } = await client.auth.signOut();
      if (error) {
        set({ busy: false, error: "Couldn't sign out. Try again." });
        return;
      }
      set({ busy: false, status: 'signedOut', email: null });
    },
  }));
}

/** The app's sign-in store. */
export const useAuthStore = createAuthStore(getSupabase);
