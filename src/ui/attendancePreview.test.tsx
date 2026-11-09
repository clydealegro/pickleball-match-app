import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { useAuthStore } from '../sync/auth';
import { SettingsScreen } from './SettingsScreen';
import { ATTENDANCE_PREVIEW_KEY, getBoolPref } from './prefs';

beforeEach(() => {
  localStorage.clear();
  useAuthStore.setState({ status: 'unconfigured', email: null, userId: null, error: null, busy: false });
});
afterEach(() => cleanup());

const row = () => screen.getByRole('switch', { name: 'Attendance link (preview)' });
const renderSettings = () => render(<SettingsScreen onBack={() => {}} onManage={() => {}} onHistory={() => {}} />);

describe('the attendance preview switch', () => {
  it('uses the pref key pikl.attendancePreview', () => {
    expect(ATTENDANCE_PREVIEW_KEY).toBe('pikl.attendancePreview');
  });

  it('has a Settings row that starts off, with its help line', () => {
    renderSettings();
    expect(row()).not.toBeChecked();
    expect(screen.getByText('Shows an attendance card on Home. Members cannot open the link yet.')).toBeInTheDocument();
    expect(getBoolPref(ATTENDANCE_PREVIEW_KEY, false)).toBe(false);
  });

  it('turns on and off and keeps the choice', async () => {
    const user = userEvent.setup();
    renderSettings();
    await user.click(row());
    expect(row()).toBeChecked();
    expect(localStorage.getItem('pikl.attendancePreview')).toBe('true');
    cleanup();
    renderSettings();
    expect(row()).toBeChecked();
    await user.click(row());
    expect(row()).not.toBeChecked();
    expect(localStorage.getItem('pikl.attendancePreview')).toBe('false');
  });
});
