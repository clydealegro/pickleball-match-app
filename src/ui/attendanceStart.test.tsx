import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useHistoryStore } from '../store/historyStore';
import { useRosterStore } from '../store/rosterStore';
import { useSessionStore } from '../store/sessionStore';
import { DEFAULT_SLOTS, useSlotsStore } from '../store/slots';
import { resetAttendanceDeps, setAttendanceDeps, useAttendanceStore } from '../sync/attendance/store';
import type { Summary } from '../sync/attendance/types';
import { useAuthStore } from '../sync/auth';
import { useSyncStore } from '../sync/syncStore';
import { HomeScreen, type SessionPlan } from './HomeScreen';

// Saturday 7 Nov 2026, noon: the Saturday slot is selected.
const NOW = new Date(2026, 10, 7, 12).getTime();

const summary = (over: Partial<Summary> = {}): Summary => ({
  slotId: 'sat',
  code: 'code-sat',
  playDate: '2026-11-07',
  cancelled: null,
  counts: { in: 2, maybe: 1, out: 0, late: 1 },
  friends: 1,
  waiting: [],
  tonight: [{ id: 'g1', name: 'Rico', broughtBy: 'p1' }],
  lateIds: ['p2'],
  answers: { p1: 'in', p2: 'in', p3: 'maybe', p4: 'out' },
  names: { p1: 'Ana', p2: 'Ben', p3: 'Cai', p4: 'Dee' },
  fetchedAt: NOW,
  ...over,
});

function seed(over: Partial<Summary> | null = {}, owner: string | null = 'user-a') {
  useAttendanceStore.setState({
    ownerId: owner,
    links: { sat: { code: 'code-sat' } },
    summaries: over === null ? {} : { sat: summary(over) },
    lastChange: {},
    lastError: { sat: null },
    busy: {},
  });
}

beforeEach(() => {
  localStorage.clear();
  useAuthStore.setState({ status: 'signedIn', email: 'o@example.com', userId: 'user-a', error: null, busy: false });
  useSyncStore.setState({ status: 'off', pending: 0, lastSyncedAt: null });
  useSlotsStore.setState({ slots: DEFAULT_SLOTS.slots.map((s) => ({ ...s })), venues: [], tonight: {}, persistent: true });
  useSessionStore.setState({ session: null, undoStack: [], saveFailed: false });
  useHistoryStore.setState({ entries: [], loaded: true, persistent: true });
  useRosterStore.setState({ players: [], loaded: true });
  useAttendanceStore.getState().clear();
  setAttendanceDeps({ server: () => null, now: () => Date.now(), timezone: () => 'Asia/Manila' });
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(NOW);
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
  resetAttendanceDeps();
});

async function start(): Promise<SessionPlan | undefined> {
  const onStart = vi.fn();
  const user = userEvent.setup({ advanceTimers: () => {} });
  render(<HomeScreen onStart={onStart} onResume={vi.fn()} onHistory={vi.fn()} onViewSummary={vi.fn()} />);
  await user.click(screen.getByRole('button', { name: /Start session/ }));
  expect(onStart).toHaveBeenCalledTimes(1);
  return onStart.mock.calls[0][0];
}

describe('Home hands the answers to Setup', () => {
  it('builds the prefill from the answers when everything lines up', async () => {
    seed();
    const plan = await start();
    expect(plan?.attendance).toEqual({
      inIds: ['p1', 'p2'],
      lateIds: ['p2'],
      maybeIds: ['p3'],
      friends: [{ id: 'g1', name: 'Rico' }],
    });
  });

  it('keeps the rest of the plan as it was', async () => {
    seed();
    const plan = await start();
    expect(plan).toMatchObject({ slotId: 'sat', weekday: 6 });
  });

  it('adds nothing when the play date is not today', async () => {
    seed({ playDate: '2026-11-14' });
    expect(await start()).not.toHaveProperty('attendance');
  });

  it('adds nothing when the play date was yesterday', async () => {
    seed({ playDate: '2026-11-06' });
    expect(await start()).not.toHaveProperty('attendance');
  });

  it('adds nothing when the day is cancelled', async () => {
    seed({ cancelled: { reason: 'Rain' } });
    expect(await start()).not.toHaveProperty('attendance');
  });

  it('adds nothing when there is no summary', async () => {
    seed(null);
    expect(await start()).not.toHaveProperty('attendance');
  });

  it('adds nothing when the summary is for another slot', async () => {
    seed({ slotId: 'tue' });
    expect(await start()).not.toHaveProperty('attendance');
  });

  it('adds nothing when the copy belongs to another account', async () => {
    seed({}, 'user-b');
    expect(await start()).not.toHaveProperty('attendance');
  });

  it('adds nothing when the device has no saved owner', async () => {
    seed({}, null);
    expect(await start()).not.toHaveProperty('attendance');
  });

  it.each(['signedOut', 'linkSent', 'unknown'] as const)('adds nothing when sign-in is %s', async (status) => {
    useAuthStore.setState({ status, userId: status === 'unknown' ? null : null });
    seed();
    expect(await start()).not.toHaveProperty('attendance');
  });

  it('adds nothing for a one-off session', async () => {
    seed();
    const onStart = vi.fn();
    const user = userEvent.setup({ advanceTimers: () => {} });
    render(<HomeScreen onStart={onStart} onResume={vi.fn()} onHistory={vi.fn()} onViewSummary={vi.fn()} />);
    await user.click(screen.getByRole('radio', { name: 'One-off session' }));
    await user.click(screen.getByRole('button', { name: 'Start a one-off session' }));
    expect(onStart).toHaveBeenCalledWith(undefined);
  });

  it('reads the date on the device clock, not in UTC, just after local midnight', async () => {
    vi.setSystemTime(new Date(2026, 10, 7, 0, 30).getTime());
    seed();
    expect((await start())?.attendance?.inIds).toEqual(['p1', 'p2']);
  });

  it('reads the date on the device clock, not in UTC, just before local midnight', async () => {
    vi.setSystemTime(new Date(2026, 10, 7, 23, 59).getTime());
    seed();
    expect((await start())?.attendance?.inIds).toEqual(['p1', 'p2']);
  });
});
