import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useAttendanceStore } from '../sync/attendance/store';
import { useAuthStore } from '../sync/auth';
import { ATTENDANCE_PREVIEW_KEY, setBoolPref } from './prefs';
import { useAttendance } from './useAttendance';

const original = useAttendanceStore.getState().refresh;
let refresh: ReturnType<typeof vi.fn>;
let visibility: DocumentVisibilityState;

const signIn = () => useAuthStore.setState({ status: 'signedIn', email: 'o@example.com', userId: 'user-a' });
const setVisible = (v: DocumentVisibilityState) => {
  visibility = v;
  document.dispatchEvent(new Event('visibilitychange'));
};

beforeEach(() => {
  localStorage.clear();
  vi.useFakeTimers();
  refresh = vi.fn(async () => ({ ok: true as const }));
  useAttendanceStore.setState({ refresh });
  useAuthStore.setState({ status: 'unconfigured', email: null, userId: null, error: null, busy: false });
  visibility = 'visible';
  vi.spyOn(document, 'visibilityState', 'get').mockImplementation(() => visibility);
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.restoreAllMocks();
  useAttendanceStore.setState({ refresh: original });
});

describe('useAttendance', () => {
  it('does nothing while the preview is off', () => {
    signIn();
    const { result } = renderHook(() => useAttendance('tue'));
    vi.advanceTimersByTime(180_000);
    setVisible('visible');
    expect(refresh).not.toHaveBeenCalled();
    expect(result.current.active).toBe(false);
  });

  it('does nothing when nobody is signed in', () => {
    setBoolPref(ATTENDANCE_PREVIEW_KEY, true);
    for (const status of ['signedOut', 'unknown', 'loading', 'unconfigured', 'linkSent'] as const) {
      useAuthStore.setState({ status, userId: null });
      const { result, unmount } = renderHook(() => useAttendance('tue'));
      vi.advanceTimersByTime(120_000);
      expect(refresh).not.toHaveBeenCalled();
      expect(result.current.active).toBe(false);
      unmount();
    }
  });

  it('needs a user id as well as the signed-in status', () => {
    setBoolPref(ATTENDANCE_PREVIEW_KEY, true);
    useAuthStore.setState({ status: 'signedIn', userId: null });
    renderHook(() => useAttendance('tue'));
    expect(refresh).not.toHaveBeenCalled();
  });

  it('refreshes on mount, then every 60 seconds', () => {
    setBoolPref(ATTENDANCE_PREVIEW_KEY, true);
    signIn();
    const { result } = renderHook(() => useAttendance('tue'));
    expect(result.current.active).toBe(true);
    expect(refresh).toHaveBeenCalledTimes(1);
    expect(refresh).toHaveBeenLastCalledWith('tue');
    vi.advanceTimersByTime(59_000);
    expect(refresh).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(1_000);
    expect(refresh).toHaveBeenCalledTimes(2);
    vi.advanceTimersByTime(60_000);
    expect(refresh).toHaveBeenCalledTimes(3);
  });

  it('skips the timer while the page is hidden and refreshes when it shows again', () => {
    setBoolPref(ATTENDANCE_PREVIEW_KEY, true);
    signIn();
    renderHook(() => useAttendance('tue'));
    refresh.mockClear();
    visibility = 'hidden';
    vi.advanceTimersByTime(180_000);
    expect(refresh).not.toHaveBeenCalled();
    setVisible('hidden');
    expect(refresh).not.toHaveBeenCalled();
    setVisible('visible');
    expect(refresh).toHaveBeenCalledTimes(1);
    expect(refresh).toHaveBeenLastCalledWith('tue');
  });

  it('refreshes at once when the preview is switched on or the organizer signs in', () => {
    renderHook(() => useAttendance('tue'));
    expect(refresh).not.toHaveBeenCalled();
    act(() => signIn());
    expect(refresh).not.toHaveBeenCalled();
    act(() => setBoolPref(ATTENDANCE_PREVIEW_KEY, true));
    expect(refresh).toHaveBeenCalledTimes(1);
  });

  it('follows the slot it is given', () => {
    setBoolPref(ATTENDANCE_PREVIEW_KEY, true);
    signIn();
    const { rerender } = renderHook(({ id }) => useAttendance(id), { initialProps: { id: 'tue' } });
    rerender({ id: 'thu' });
    expect(refresh).toHaveBeenLastCalledWith('thu');
    refresh.mockClear();
    vi.advanceTimersByTime(60_000);
    expect(refresh).toHaveBeenCalledTimes(1);
    expect(refresh).toHaveBeenCalledWith('thu');
  });

  it('stops its timer and listener when it goes away', () => {
    setBoolPref(ATTENDANCE_PREVIEW_KEY, true);
    signIn();
    const add = vi.spyOn(document, 'addEventListener');
    const remove = vi.spyOn(document, 'removeEventListener');
    const { unmount } = renderHook(() => useAttendance('tue'));
    const added = add.mock.calls.filter(([type]) => type === 'visibilitychange');
    expect(added).toHaveLength(1);
    refresh.mockClear();
    unmount();
    expect(remove.mock.calls.filter(([type, fn]) => type === 'visibilitychange' && fn === added[0][1])).toHaveLength(1);
    vi.advanceTimersByTime(300_000);
    setVisible('visible');
    expect(refresh).not.toHaveBeenCalled();
  });

  it('stops when the organizer signs out', () => {
    setBoolPref(ATTENDANCE_PREVIEW_KEY, true);
    signIn();
    renderHook(() => useAttendance('tue'));
    refresh.mockClear();
    act(() => useAuthStore.setState({ status: 'signedOut', userId: null }));
    vi.advanceTimersByTime(180_000);
    expect(refresh).not.toHaveBeenCalled();
  });
});
