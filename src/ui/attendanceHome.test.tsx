import { cleanup, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { newTestSession } from '../engine/testing';
import { useHistoryStore } from '../store/historyStore';
import { useRosterStore } from '../store/rosterStore';
import { useSessionStore } from '../store/sessionStore';
import { DEFAULT_SLOTS, useSlotsStore } from '../store/slots';
import { resetAttendanceDeps, setAttendanceDeps, useAttendanceStore } from '../sync/attendance/store';
import type { Summary } from '../sync/attendance/types';
import { useAuthStore } from '../sync/auth';
import { useSyncStore } from '../sync/syncStore';
import { HomeScreen } from './HomeScreen';

// Saturday 7 Nov 2026, noon: the Saturday slot is selected.
const NOW = new Date(2026, 10, 7, 12).getTime();

const summary = (slotId: string): Summary => ({
  slotId,
  code: `code-${slotId}`,
  playDate: '2026-11-07',
  cancelled: null,
  counts: { in: 4, maybe: 1, out: 0, late: 0 },
  friends: 0,
  waiting: [],
  tonight: [],
  lateIds: [],
  answers: {},
  names: {},
  fetchedAt: NOW,
});

function seedLinks() {
  useAttendanceStore.setState({
    ownerId: 'user-a',
    links: { sat: { code: 'code-sat' }, tue: { code: 'code-tue' } },
    summaries: { sat: summary('sat'), tue: summary('tue') },
    lastChange: {},
    lastError: { sat: null, tue: null },
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
  seedLinks();
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(NOW);
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
  resetAttendanceDeps();
});

function setup(onSignIn?: () => void) {
  const user = userEvent.setup({ advanceTimers: () => {} });
  render(<HomeScreen onStart={vi.fn()} onResume={vi.fn()} onHistory={vi.fn()} onViewSummary={vi.fn()} onSignIn={onSignIn} />);
  return user;
}

const openCard = (user: ReturnType<typeof userEvent.setup>) => user.click(screen.getByRole('button', { name: /^Attendance:/ }));
const card = () => screen.queryByRole('region', { name: 'Attendance link' });
const inCard = () => within(document.querySelector<HTMLElement>('.attendance')!);

describe('the attendance card on Home', () => {
  it('shows one slim row inside the hero, and opens the full card from it', async () => {
    const user = setup();
    const row = screen.getByRole('button', { name: 'Attendance: 4 in · 1 maybe' });
    expect(document.querySelector('.home-hero')!.contains(row)).toBe(true);
    expect(card()).not.toBeInTheDocument();
    await openCard(user);
    expect(card()).toBeInTheDocument();
    expect(screen.getByRole('dialog', { name: 'Saturday attendance' })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: '4 In' })).toBeInTheDocument();
  });

  it('shows the count of new names to review on the row', () => {
    useAttendanceStore.setState({ summaries: { sat: { ...summary('sat'), waiting: [{ id: 'a', name: 'Al', broughtBy: null }, { id: 'b', name: 'Bo', broughtBy: null }] } } });
    setup();
    expect(screen.getByText('2 new')).toBeInTheDocument();
  });

  it('follows the chip that is picked', async () => {
    const user = setup();
    await user.click(screen.getByRole('radio', { name: 'Tue 10' }));
    await openCard(user);
    expect(screen.getByRole('dialog', { name: 'Tuesday attendance' })).toBeInTheDocument();
    await user.keyboard('{Escape}');
    await user.click(screen.getByRole('radio', { name: 'Thu 12' }));
    // Thursday has no link and nothing saved: it is checking, and it still shows its own weekday.
    await openCard(user);
    expect(screen.getByRole('dialog', { name: 'Thursday attendance' })).toBeInTheDocument();
    expect(inCard().getByText('Checking answers')).toBeInTheDocument();
    expect(screen.queryByRole('tab', { name: '4 In' })).not.toBeInTheDocument();
  });

  it('does not show for a one-off session', async () => {
    const user = setup();
    await user.click(screen.getByRole('radio', { name: 'One-off session' }));
    expect(screen.queryByRole('button', { name: /^Attendance:/ })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Share link' })).not.toBeInTheDocument();
  });

  it('does not show while a session is live', () => {
    useSessionStore.setState({ session: { ...newTestSession(['A', 'B', 'C', 'D'], { courts: 1 }), createdAt: NOW - 1_800_000 } });
    setup();
    expect(screen.getByRole('button', { name: 'Back to session' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^Attendance:/ })).not.toBeInTheDocument();
  });

  it('does not show on the done card', () => {
    const created = new Date(2026, 10, 7, 8).getTime();
    useHistoryStore.setState({
      entries: [{ id: 'd1', name: 'Open play', createdAt: created, endedAt: created + 3_600_000, games: 3, session: { ...newTestSession(['A', 'B', 'C', 'D'], { courts: 1 }), createdAt: created, endedAt: created + 3_600_000 } }],
    });
    setup();
    expect(document.querySelector('.home-hero-done')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^Attendance:/ })).not.toBeInTheDocument();
  });

  it('calls onSignIn from the Sign in button in the card', async () => {
    useAuthStore.setState({ status: 'signedOut', userId: null });
    const onSignIn = vi.fn();
    const user = setup(onSignIn);
    expect(screen.queryByRole('button', { name: /^Attendance:/ })).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Sign in to share' }));
    expect(onSignIn).toHaveBeenCalledTimes(1);
  });

  it('does not fail when no onSignIn is given', async () => {
    useAuthStore.setState({ status: 'signedOut', userId: null });
    const user = setup();
    await user.click(screen.getByRole('button', { name: 'Sign in to share' }));
    expect(screen.getByRole('button', { name: 'Sign in to share' })).toBeInTheDocument();
  });
});
