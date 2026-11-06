import { createClient, type SupabaseClient } from '@supabase/supabase-js';

/**
 * True for a key that must never reach a browser: a new-style secret key, or an old-style JWT whose role is
 * `service_role`. Everything in `VITE_*` is shipped to every visitor, so a secret key there would be public.
 */
export function isSecretKey(key: string): boolean {
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
 * The Supabase client, or null when this build has no backend (no URL or key set, or a secret key was set by
 * mistake). The app works fully without one, signed out.
 */
export function getSupabase(): SupabaseClient | null {
  if (client !== undefined) return client;
  const url = import.meta.env.VITE_SUPABASE_URL;
  const key = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY;
  if (!url || !key) {
    client = null;
  } else if (isSecretKey(key)) {
    console.error('VITE_SUPABASE_PUBLISHABLE_KEY holds a secret key. Ignoring it: use the publishable key.');
    client = null;
  } else {
    // Sign-in uses a code typed into the app, not a link, so there is nothing to pick up from the page address.
    client = createClient(url, key, { auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: false } });
  }
  return client;
}
