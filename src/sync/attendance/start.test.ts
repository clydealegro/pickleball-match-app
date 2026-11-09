import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useSlotsStore } from '../../store/slots';
import { useAuthStore } from '../auth';
import type { AttendanceRemote } from './remote';
import { startAttendanceSync } from './start';
import { ATTENDANCE_KEY, resetAttendanceDeps, setAttendanceDeps, useAttendanceStore } from './store';
import { BLANK_SLOTS } from '../../store/slotsFixture';

const USER = '0a1b2c3d-0000-4000-8000-00000000000a';
const OTHER = '0a1b2c3d-0000-4000-8000-00000000000b';

let upserts: { slot_id: string; venue: string | null; start_min: number | null; title: string }[];
let stop: () => void;

/** A remote that only notes what it is asked. The store keeps the rest. */
const remote = (): AttendanceRemote => ({
  getLink: async () => null,
  upsertLink: async (row) => void upserts.push(row),
  view: async () => null,
  listWaiting: async () => [],
  listTonight: async () => [],
  setGuestState: async () => undefined,
  resetLink: async () => null,
  cancel: async () => undefined,
  undoCancel: async () => undefined,
  closeThrough: async () => undefined,
});

const seedCache = (userId: string) =>
  useAttendanceStore.setState({
    ownerId: userId,
    links: { tue: { code: 'c1' } },
    summaries: {},
    lastChange: {},
    lastError: {},
    pendingClose: [{ slotId: 'tue', date: '2026-11-10' }],
  });

beforeEach(() => {
  vi.useFakeTimers();
  localStorage.clear();
  upserts = [];
  useAuthStore.setState({ status: 'signedIn', userId: USER, email: 'a@b.c' });
  useSlotsStore.setState({ slots: BLANK_SLOTS.slots.map((s) => ({ ...s })), venues: [], tonight: {} });
  useAttendanceStore.getState().clear();
  setAttendanceDeps({ server: () => ({ remote: remote(), userId: USER }), now: () => 0, timezone: () => 'Asia/Manila' });
});
afterEach(() => {
  stop?.();
  resetAttendanceDeps();
  vi.useRealTimers();
});

describe('sending slot changes to their link', () => {
  it('updates the link 800 ms after a slot is saved, once for several quick saves', async () => {
    seedCache(USER);
    stop = startAttendanceSync();
    useSlotsStore.getState().saveSlot('tue', { venue: 'Hall' });
    await vi.advanceTimersByTimeAsync(700);
    useSlotsStore.getState().saveSlot('tue', { venue: 'Park', startMin: 1140 });
    await vi.advanceTimersByTimeAsync(799);
    expect(upserts).toEqual([]);
    await vi.advanceTimersByTimeAsync(1);
    expect(upserts).toHaveLength(1);
    expect(upserts[0]).toMatchObject({ slot_id: 'tue', venue: 'Park', start_min: 1140, title: 'Tuesday open play' });
  });

  it('does nothing for a slot with no link', async () => {
    seedCache(USER);
    stop = startAttendanceSync();
    useSlotsStore.getState().saveSlot('thu', { venue: 'Hall' });
    await vi.advanceTimersByTimeAsync(2000);
    expect(upserts).toEqual([]);
  });

  it('sends each slot that changed, and only that slot', async () => {
    seedCache(USER);
    useAttendanceStore.setState({ links: { tue: { code: 'c1' }, thu: { code: 'c2' } } });
    stop = startAttendanceSync();
    useSlotsStore.getState().saveSlot('tue', { courts: 2 });
    useSlotsStore.getState().saveSlot('thu', { courts: 3 });
    await vi.advanceTimersByTimeAsync(800);
    expect(upserts.map((u) => u.slot_id).sort()).toEqual(['thu', 'tue']);
  });

  it('sends a slot whose weekday changed', async () => {
    seedCache(USER);
    stop = startAttendanceSync();
    useSlotsStore.setState({ slots: useSlotsStore.getState().slots.map((s) => (s.id === 'tue' ? { ...s, weekday: 3 } : s)) });
    await vi.advanceTimersByTimeAsync(800);
    expect(upserts).toHaveLength(1);
  });

  it('never sends a this time only edit', async () => {
    seedCache(USER);
    stop = startAttendanceSync();
    useSlotsStore.getState().setTonight('tue', { venue: 'Elsewhere' });
    await vi.advanceTimersByTimeAsync(2000);
    expect(upserts).toEqual([]);
  });

  it('does not send when saving changed nothing, or when only venues were added', async () => {
    seedCache(USER);
    stop = startAttendanceSync();
    useSlotsStore.getState().saveSlot('tue', {});
    useSlotsStore.getState().addVenue('New venue');
    await vi.advanceTimersByTimeAsync(2000);
    expect(upserts).toEqual([]);
  });

  it('stops when torn down, and drops a change still waiting', async () => {
    seedCache(USER);
    stop = startAttendanceSync();
    useSlotsStore.getState().saveSlot('tue', { venue: 'Hall' });
    stop();
    await vi.advanceTimersByTimeAsync(2000);
    expect(upserts).toEqual([]);
    useSlotsStore.getState().saveSlot('tue', { venue: 'Park' });
    await vi.advanceTimersByTimeAsync(2000);
    expect(upserts).toEqual([]);
  });

  it('uses the delay it is given', async () => {
    seedCache(USER);
    stop = startAttendanceSync(50);
    useSlotsStore.getState().saveSlot('tue', { venue: 'Hall' });
    await vi.advanceTimersByTimeAsync(50);
    expect(upserts).toHaveLength(1);
  });
});

describe('clearing with the account', () => {
  it('clears when the organizer signs out', () => {
    seedCache(USER);
    stop = startAttendanceSync();
    expect(useAttendanceStore.getState().links.tue).toBeDefined();
    useAuthStore.setState({ status: 'signedOut', userId: null, email: null });
    expect(useAttendanceStore.getState()).toMatchObject({ ownerId: null, links: {}, pendingClose: [] });
    expect(localStorage.getItem(ATTENDANCE_KEY)).toBeNull();
  });

  it('clears when a different account signs in', () => {
    seedCache(USER);
    useAuthStore.setState({ status: 'loading', userId: null });
    stop = startAttendanceSync();
    useAuthStore.setState({ status: 'signedIn', userId: OTHER });
    expect(useAttendanceStore.getState()).toMatchObject({ ownerId: null, links: {}, pendingClose: [] });
  });

  it('clears at start when a saved copy belongs to a different account', () => {
    seedCache(USER);
    useAuthStore.setState({ status: 'signedIn', userId: OTHER });
    stop = startAttendanceSync();
    expect(useAttendanceStore.getState().links).toEqual({});
  });

  it('keeps the copy for the same account, while loading, and when the sign-in cannot be checked', () => {
    seedCache(USER);
    useAuthStore.setState({ status: 'loading', userId: null });
    stop = startAttendanceSync();
    expect(useAttendanceStore.getState().links.tue).toBeDefined();
    useAuthStore.setState({ status: 'unknown', userId: null });
    expect(useAttendanceStore.getState().links.tue).toBeDefined();
    useAuthStore.setState({ status: 'signedIn', userId: USER });
    expect(useAttendanceStore.getState().links.tue).toBeDefined();
  });

  it('stops watching the account when torn down', () => {
    seedCache(USER);
    stop = startAttendanceSync();
    stop();
    useAuthStore.setState({ status: 'signedOut', userId: null, email: null });
    expect(useAttendanceStore.getState().links.tue).toBeDefined();
  });
});
