import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { useAuthStore } from '../sync/auth';
import * as prefs from './prefs';
import { SettingsScreen } from './SettingsScreen';

beforeEach(() => {
  localStorage.clear();
  useAuthStore.setState({ status: 'unconfigured', email: null, userId: null, error: null, busy: false });
});
afterEach(() => cleanup());

// The attendance card used to sit behind a Settings switch while members could not open the link yet. The member page is
// live, so every signed-in organizer sees the card and the switch is gone.
describe('the attendance preview switch', () => {
  it('is gone from Settings', () => {
    render(<SettingsScreen onBack={() => {}} onManage={() => {}} onHistory={() => {}} />);
    expect(screen.queryByRole('switch', { name: 'Attendance link (preview)' })).not.toBeInTheDocument();
    expect(screen.queryByText(/Members cannot open the link yet/)).not.toBeInTheDocument();
    expect(screen.queryByText(/preview/i)).not.toBeInTheDocument();
  });

  it('is gone from the preferences', () => {
    expect('ATTENDANCE_PREVIEW_KEY' in prefs).toBe(false);
  });
});
