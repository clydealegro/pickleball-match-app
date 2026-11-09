import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { isSecretKey } from '../sync/client';

let client: SupabaseClient | null | undefined;

/**
 * The member page's own anonymous client, or null when this build has no backend. It keeps no session, so an
 * organizer signed in on the same phone cannot turn a member's request into a "signed out". Never throws.
 */
export function getMemberClient(): SupabaseClient | null {
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
      client = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } });
    } catch {
      console.error('Could not create the Supabase client. Check that VITE_SUPABASE_URL is the project address, like https://abc.supabase.co.');
      client = null;
    }
  }
  return client;
}
