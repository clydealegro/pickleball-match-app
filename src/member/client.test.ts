import { afterEach, describe, expect, it, vi } from 'vitest';

const KEY = 'sb_publishable_abc';

async function load(env: Record<string, string>) {
  const createClient = vi.fn(() => ({ marker: 'client' }));
  vi.resetModules();
  vi.doMock('@supabase/supabase-js', () => ({ createClient }));
  for (const [name, value] of Object.entries(env)) vi.stubEnv(name, value);
  const mod = await import('./client');
  return { ...mod, createClient };
}

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
  vi.doUnmock('@supabase/supabase-js');
});

describe('getMemberClient', () => {
  it('is null with no URL and no key', async () => {
    const { getMemberClient, createClient } = await load({ VITE_SUPABASE_URL: '', VITE_SUPABASE_PUBLISHABLE_KEY: '' });
    expect(getMemberClient()).toBeNull();
    expect(createClient).not.toHaveBeenCalled();
  });

  it('is null when only the URL is set', async () => {
    const { getMemberClient } = await load({ VITE_SUPABASE_URL: 'https://abc.supabase.co', VITE_SUPABASE_PUBLISHABLE_KEY: '' });
    expect(getMemberClient()).toBeNull();
  });

  it('is null when only the key is set', async () => {
    const { getMemberClient } = await load({ VITE_SUPABASE_URL: '', VITE_SUPABASE_PUBLISHABLE_KEY: KEY });
    expect(getMemberClient()).toBeNull();
  });

  it('is null for a secret key, and does not build a client', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const { getMemberClient, createClient } = await load({
      VITE_SUPABASE_URL: 'https://abc.supabase.co',
      VITE_SUPABASE_PUBLISHABLE_KEY: 'sb_secret_oops',
    });
    expect(getMemberClient()).toBeNull();
    expect(createClient).not.toHaveBeenCalled();
  });

  it('builds an anonymous client that keeps no session and reads no sign-in from the address', async () => {
    const { getMemberClient, createClient } = await load({ VITE_SUPABASE_URL: ' https://abc.supabase.co ', VITE_SUPABASE_PUBLISHABLE_KEY: ` ${KEY} ` });
    expect(getMemberClient()).toEqual({ marker: 'client' });
    expect(createClient).toHaveBeenCalledWith('https://abc.supabase.co', KEY, {
      auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    });
  });

  it('builds the client once', async () => {
    const { getMemberClient, createClient } = await load({ VITE_SUPABASE_URL: 'https://abc.supabase.co', VITE_SUPABASE_PUBLISHABLE_KEY: KEY });
    getMemberClient();
    getMemberClient();
    expect(createClient).toHaveBeenCalledTimes(1);
  });

  it('is null, without throwing, when the client cannot be made', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    vi.resetModules();
    vi.doMock('@supabase/supabase-js', () => ({
      createClient: () => {
        throw new Error('Invalid URL');
      },
    }));
    vi.stubEnv('VITE_SUPABASE_URL', 'not a url');
    vi.stubEnv('VITE_SUPABASE_PUBLISHABLE_KEY', KEY);
    const { getMemberClient } = await import('./client');
    expect(getMemberClient()).toBeNull();
  });
});
