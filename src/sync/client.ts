import { createClient, type SupabaseClient } from '@supabase/supabase-js';

/**
 * True for a key that must never reach a browser: a new-style secret key, or an old-style JWT whose role is
 * `service_role`. Everything in `VITE_*` is shipped to every visitor, so a secret key there would be public.
 */
export function isSecretKey(rawKey: string): boolean {
  const key = rawKey.trim();
  if (key.startsWith('sb_secret_')) return true;
  const payload = key.split('.')[1];
  if (!payload) return false;
  try {
    const json = atob(payload.replace(/-/g, '+').replace(/_/g, '/'));
    return (JSON.parse(json) as { role?: string }).role === 'service_role';
  } catch {
    return false;
  }
}

let client: SupabaseClient | null | undefined;

/**
 * The Supabase client, or null when this build has no backend (no URL or key set, a secret key set by mistake,
 * or a URL the client cannot use). The app works fully without one, signed out. Never throws.
 */
export function getSupabase(): SupabaseClient | null {
  if (client !== undefined) return client;
  const url = import.meta.env.VITE_SUPABASE_URL?.trim();
  const key = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY?.trim();
  if (!url || !key) {
    client = null;
  } else if (isSecretKey(key)) {
    console.error('VITE_SUPABASE_PUBLISHABLE_KEY holds a secret key. Ignoring it: use the publishable key.');
    client = null;
  } else {
    try {
      // Sign-in is an emailed link that brings the person back to the app with the session in the page address.
      client = createClient(url, key, { global: { headers: { 'x-pikl-sync-version': '2' } }, auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true } });
    } catch {
      // The message names the setting, never its value.
      console.error('Could not create the Supabase client. Check that VITE_SUPABASE_URL is the project address, like https://abc.supabase.co.');
      client = null;
    }
  }
  return client;
}
