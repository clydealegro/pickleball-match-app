import { afterEach, describe, expect, it, vi } from 'vitest';

const jwt = (role: string) => {
  const part = (o: object) => btoa(JSON.stringify(o)).replace(/=+$/, '').replace(/\+/g, '-').replace(/\//g, '_');
  return `${part({ alg: 'HS256', typ: 'JWT' })}.${part({ role, iss: 'supabase' })}.signature`;
};

async function load(env: Record<string, string>) {
  vi.resetModules();
  for (const [name, value] of Object.entries(env)) vi.stubEnv(name, value);
  return import('./client');
}

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
  vi.doUnmock('@supabase/supabase-js');
});

describe('isSecretKey', () => {
  it('flags new-style secret keys and old-style service role keys', async () => {
    const { isSecretKey } = await load({});
    expect(isSecretKey('sb_secret_abc123')).toBe(true);
    expect(isSecretKey(jwt('service_role'))).toBe(true);
  });

  it('is not fooled by spaces around the key', async () => {
    const { isSecretKey } = await load({});
    expect(isSecretKey('  sb_secret_abc123 ')).toBe(true);
    expect(isSecretKey(` ${jwt('service_role')} `)).toBe(true);
  });

  it('accepts publishable keys and old-style anon keys', async () => {
    const { isSecretKey } = await load({});
    expect(isSecretKey('sb_publishable_abc123')).toBe(false);
    expect(isSecretKey(jwt('anon'))).toBe(false);
  });

  it('does not choke on text that is not a key', async () => {
    const { isSecretKey } = await load({});
    expect(isSecretKey('')).toBe(false);
    expect(isSecretKey('a.b.c')).toBe(false);
    expect(isSecretKey('not-a-key')).toBe(false);
  });
});

describe('getSupabase', () => {
  it('is null when nothing is configured, so the app runs without a backend', async () => {
    const { getSupabase } = await load({ VITE_SUPABASE_URL: '', VITE_SUPABASE_PUBLISHABLE_KEY: '' });
    expect(getSupabase()).toBeNull();
  });

  it('is null when only one of the two is set', async () => {
    const { getSupabase } = await load({ VITE_SUPABASE_URL: 'https://abc.supabase.co', VITE_SUPABASE_PUBLISHABLE_KEY: '' });
    expect(getSupabase()).toBeNull();
  });

  it('refuses a secret key and says so', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const { getSupabase } = await load({ VITE_SUPABASE_URL: 'https://abc.supabase.co', VITE_SUPABASE_PUBLISHABLE_KEY: 'sb_secret_oops' });
    expect(getSupabase()).toBeNull();
    expect(error).toHaveBeenCalledWith(expect.stringMatching(/secret key/i));
  });

  it('keeps the session on the device and does not look for one in the page address', async () => {
    const createClient = vi.fn(() => ({ auth: {} }));
    vi.resetModules();
    vi.doMock('@supabase/supabase-js', () => ({ createClient }));
    vi.stubEnv('VITE_SUPABASE_URL', 'https://abc.supabase.co');
    vi.stubEnv('VITE_SUPABASE_PUBLISHABLE_KEY', 'sb_publishable_abc123');
    const { getSupabase } = await import('./client');
    getSupabase();
    expect(createClient).toHaveBeenCalledWith('https://abc.supabase.co', 'sb_publishable_abc123', {
      auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: false },
    });
  });

  it('does not throw on a URL the client cannot use, and never prints the settings', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const { getSupabase } = await load({ VITE_SUPABASE_URL: 'not a url', VITE_SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_abc123' });
    expect(getSupabase()).toBeNull();
    expect(error).toHaveBeenCalledTimes(1);
    const printed = String(error.mock.calls[0][0]);
    expect(printed).toMatch(/VITE_SUPABASE_URL/);
    expect(printed).not.toContain('not a url');
    expect(printed).not.toContain('sb_publishable_abc123');
  });

  it('ignores spaces around the two settings', async () => {
    const createClient = vi.fn(() => ({ auth: {} }));
    vi.resetModules();
    vi.doMock('@supabase/supabase-js', () => ({ createClient }));
    vi.stubEnv('VITE_SUPABASE_URL', ' https://abc.supabase.co ');
    vi.stubEnv('VITE_SUPABASE_PUBLISHABLE_KEY', ' sb_publishable_abc123 ');
    const { getSupabase } = await import('./client');
    getSupabase();
    expect(createClient).toHaveBeenCalledWith('https://abc.supabase.co', 'sb_publishable_abc123', expect.anything());
  });

  it('builds one client from a publishable key and reuses it', async () => {
    const { getSupabase } = await load({ VITE_SUPABASE_URL: 'https://abc.supabase.co', VITE_SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_abc123' });
    const first = getSupabase();
    expect(first).not.toBeNull();
    expect(typeof first!.auth.signInWithOtp).toBe('function');
    expect(getSupabase()).toBe(first);
  });
});
