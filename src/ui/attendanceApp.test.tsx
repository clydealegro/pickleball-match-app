import type { Session } from '@supabase/supabase-js';
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const backend = vi.hoisted(() => ({ client: null as unknown }));
vi.mock('../sync/client', () => ({ getSupabase: () => backend.client }));

const sync = vi.hoisted(() => ({ stop: vi.fn(), start: vi.fn() }));
vi.mock('../sync/attendance/start', () => ({
  startAttendanceSync: sync.start,
}));

const signedOutClient = () => ({
  auth: {
    getSession: vi.fn().mockResolvedValue({ data: { session: null as Session | null }, error: null }),
    onAuthStateChange: vi.fn(() => ({ data: { subscription: { unsubscribe: vi.fn() } } })),
    signInWithOtp: vi.fn(),
    signOut: vi.fn(),
  },
});

async function startApp() {
  vi.resetModules();
  const { default: App } = await import('./App');
  return render(<App />);
}

beforeEach(() => {
  localStorage.clear();
  sync.stop.mockReset();
  sync.start.mockReset().mockReturnValue(sync.stop);
  backend.client = signedOutClient();
});
afterEach(() => cleanup());

describe('App and the attendance link', () => {
  it('starts the attendance sync once and stops it when the app goes away', async () => {
    const view = await startApp();
    expect(sync.start).toHaveBeenCalledTimes(1);
    expect(sync.stop).not.toHaveBeenCalled();
    view.unmount();
    expect(sync.stop).toHaveBeenCalledTimes(1);
  });

  it('sends the card\'s Sign in to Settings', async () => {
    localStorage.setItem('pikl.attendancePreview', 'true');
    const user = userEvent.setup();
    await startApp();
    await user.click(await screen.findByRole('button', { name: 'Sign in' }));
    expect(await screen.findByRole('heading', { name: 'Settings' })).toBeInTheDocument();
  });

  it('shows no card on Home while the preview is off', async () => {
    await startApp();
    await screen.findByRole('radiogroup', { name: 'Sessions' });
    expect(screen.queryByRole('heading', { name: 'Attendance link' })).not.toBeInTheDocument();
  });
});
