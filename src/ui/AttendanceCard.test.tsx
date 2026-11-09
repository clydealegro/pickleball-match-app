import type { PGlite } from '@electric-sql/pglite';
import { act, cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { useHistoryStore } from '../store/historyStore';
import { useRosterStore } from '../store/rosterStore';
import { useSessionStore } from '../store/sessionStore';
import { DEFAULT_SLOTS, useSlotsStore, type Slot } from '../store/slots';
import { fakeAttendanceRemote, type FakeFlags } from '../sync/attendance/fakeRemote';
import { resetAttendanceDeps, setAttendanceDeps, useAttendanceStore } from '../sync/attendance/store';
import type { ChangeNote, Summary } from '../sync/attendance/types';
import { useAuthStore } from '../sync/auth';
import { USER_A, createDb, run } from '../sync/db/harness';
import { useSyncStore } from '../sync/syncStore';
import { AttendanceCard } from './AttendanceCard';
import { ATTENDANCE_PREVIEW_KEY, setBoolPref } from './prefs';

// Monday 9 Nov 2026, 4:20 pm. Date is faked and timers stay real.
const NOW = new Date(2026, 10, 9, 16, 20).getTime();
const TUE: Slot = { id: 'tue', weekday: 2, startMin: 1140, endMin: 1260, venue: 'Hall', courts: 3 };
const OFFLINE = 'No connection. Try again when you are online.';
const actions = (() => {
  const s = useAttendanceStore.getState();
  return { refresh: s.refresh, ensureLink: s.ensureLink, resetLink: s.resetLink, cancelWeek: s.cancelWeek, undoCancel: s.undoCancel };
})();

function resetEverything() {
  localStorage.clear();
  useAuthStore.setState({ status: 'unconfigured', email: null, userId: null, error: null, busy: false });
  useSyncStore.setState({ status: 'off', pending: 0, lastSyncedAt: null });
  useSlotsStore.setState({ slots: DEFAULT_SLOTS.slots.map((s) => ({ ...s })), venues: [], tonight: {}, persistent: true });
  useSessionStore.setState({ session: null, undoStack: [], saveFailed: false });
  useHistoryStore.setState({ entries: [], loaded: true, persistent: true });
  useRosterStore.setState({ players: [], loaded: true });
  useAttendanceStore.getState().clear();
  useAttendanceStore.setState(actions);
}

const signIn = (status: 'signedIn' | 'unknown' = 'signedIn') =>
  useAuthStore.setState({ status, email: 'o@example.com', userId: status === 'signedIn' ? USER_A : null });

const summary = (over: Partial<Summary> = {}): Summary => ({
  slotId: 'tue',
  code: 'abc123',
  playDate: '2026-11-10',
  cancelled: null,
  counts: { in: 11, maybe: 3, out: 2, late: 0 },
  friends: 1,
  waiting: [],
  answers: {},
  names: {},
  fetchedAt: NOW,
  ...over,
});

/** A link with answers already on the device. */
function seed(over: Partial<Summary> = {}, extra: { change?: ChangeNote | null; error?: 'offline' | 'auth' | 'server' | null; busy?: boolean } = {}) {
  useAttendanceStore.setState({
    ownerId: USER_A,
    links: { tue: { code: 'abc123' } },
    summaries: { tue: summary(over) },
    lastChange: { tue: extra.change ?? null },
    lastError: { tue: extra.error ?? null },
    busy: { tue: extra.busy ?? false },
  });
}

function setup(slot: Slot = TUE) {
  const onSignIn = vi.fn();
  const user = userEvent.setup({ advanceTimers: () => {} });
  const view = render(<AttendanceCard slot={slot} onSignIn={onSignIn} />);
  return { user, onSignIn, ...view };
}

const stubShare = (share: unknown, writeText?: unknown) => {
  Object.defineProperty(navigator, 'share', { value: share, configurable: true, writable: true });
  Object.defineProperty(navigator, 'clipboard', { value: writeText === undefined ? undefined : { writeText }, configurable: true, writable: true });
};

beforeEach(() => {
  resetEverything();
  setBoolPref(ATTENDANCE_PREVIEW_KEY, true);
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(NOW);
  // The display tests have no server: a refresh on mount changes nothing.
  setAttendanceDeps({ server: () => null, now: () => Date.now(), timezone: () => 'Asia/Manila' });
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.restoreAllMocks();
  resetAttendanceDeps();
  delete (navigator as unknown as Record<string, unknown>).share;
  delete (navigator as unknown as Record<string, unknown>).clipboard;
});

describe('which states show', () => {
  it('shows nothing while the preview is off, whatever else is true', () => {
    localStorage.clear();
    signIn();
    seed();
    const { container } = setup();
    expect(container).toBeEmptyDOMElement();
  });

  it.each(['unconfigured', 'loading'] as const)('shows nothing while sign-in is %s', (status) => {
    useAuthStore.setState({ status });
    seed();
    const { container } = setup();
    expect(container).toBeEmptyDOMElement();
  });

  it.each(['signedOut', 'linkSent'] as const)('asks to sign in when status is %s, and the button calls onSignIn', async (status) => {
    useAuthStore.setState({ status });
    seed();
    const { user, onSignIn } = setup();
    expect(screen.getByRole('heading', { name: 'Attendance link' })).toBeInTheDocument();
    expect(screen.getByText('Sign in to share an attendance link with your players.')).toBeInTheDocument();
    expect(screen.queryByText('11 in')).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Sign in' }));
    expect(onSignIn).toHaveBeenCalledTimes(1);
  });

  it('shows the saved answers when sign-in cannot be checked, and never asks to sign in', () => {
    signIn('unknown');
    seed();
    setup();
    expect(screen.getByText('11 in')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Sign in' })).not.toBeInTheDocument();
  });

  it('shows nothing when sign-in cannot be checked and there is nothing saved', () => {
    signIn('unknown');
    const { container } = setup();
    expect(container).toBeEmptyDOMElement();
  });

  it('does not show another account\'s saved answers', () => {
    signIn();
    seed();
    useAttendanceStore.setState({ ownerId: 'someone-else' });
    setup();
    expect(screen.queryByText('11 in')).not.toBeInTheDocument();
    expect(screen.getByText('Checking answers')).toBeInTheDocument();
  });

  it('says it is checking until the first answer comes back', () => {
    signIn();
    setup();
    expect(screen.getByText('Checking answers')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Create link' })).not.toBeInTheDocument();
  });

  it('says it is checking when there is a link but no answers yet', () => {
    signIn();
    useAttendanceStore.setState({ ownerId: USER_A, links: { tue: { code: 'abc123' } }, lastError: { tue: null } });
    setup();
    expect(screen.getByText('Checking answers')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Share' })).not.toBeInTheDocument();
  });

  it('offers Create link once it is known there is none', () => {
    signIn();
    useAttendanceStore.setState({ lastError: { tue: null } });
    setup();
    expect(screen.getByRole('heading', { name: 'Attendance link' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Create link' })).toBeEnabled();
    expect(screen.queryByText('Checking answers')).not.toBeInTheDocument();
  });

  it.each(['offline', 'auth', 'server'] as const)('says it could not load, with Retry, when a %s failure left nothing saved', async (error) => {
    signIn();
    useAttendanceStore.setState({ lastError: { tue: error } });
    const { user } = setup();
    expect(screen.getByText('Could not load the answers. Try again.')).toBeInTheDocument();
    expect(screen.queryByText('Checking answers')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Create link' })).not.toBeInTheDocument();
    const refresh = vi.fn(async () => ({ ok: true as const }));
    useAttendanceStore.setState({ refresh });
    await user.click(screen.getByRole('button', { name: 'Retry' }));
    expect(refresh).toHaveBeenCalledWith('tue');
  });

  it('says it could not load when there is a link, no answers and a failure', () => {
    signIn();
    useAttendanceStore.setState({ ownerId: USER_A, links: { tue: { code: 'abc123' } }, lastError: { tue: 'server' } });
    setup();
    expect(screen.getByText('Could not load the answers. Try again.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Retry' })).toBeInTheDocument();
  });
});

describe('the link state', () => {
  beforeEach(() => signIn());

  it('shows the heading, the weekday, the pills, the link and the three buttons', () => {
    seed();
    setup();
    expect(screen.getByRole('heading', { name: 'Attendance link' })).toBeInTheDocument();
    expect(screen.getByText('Tuesday')).toBeInTheDocument();
    const pills = within(screen.getByRole('list', { name: 'Answers' })).getAllByRole('listitem');
    expect(pills.map((p) => p.textContent)).toEqual(['11 in', '3 maybe', '2 out', '1 friend']);
    expect(screen.getByText(`${window.location.origin}/j/abc123`)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Share' })).toBeEnabled();
    expect(screen.getByRole('button', { name: 'Reset link' })).toBeEnabled();
    expect(screen.getByRole('button', { name: 'Cancel this week' })).toBeEnabled();
  });

  it('names the weekday of the slot it is given', () => {
    seed();
    setup({ id: 'tue', weekday: 4 });
    expect(screen.getByText('Thursday')).toBeInTheDocument();
  });

  it('shows zero counts for in, maybe and out, and no friend pill when there are none', () => {
    seed({ counts: { in: 0, maybe: 0, out: 0, late: 0 }, friends: 0 });
    setup();
    const pills = within(screen.getByRole('list', { name: 'Answers' })).getAllByRole('listitem');
    expect(pills.map((p) => p.textContent)).toEqual(['0 in', '0 maybe', '0 out']);
  });

  it('pluralises friends', () => {
    seed({ friends: 2 });
    setup();
    expect(screen.getByText('2 friends')).toBeInTheDocument();
  });

  it('shows no stale line while the answers are fresh', () => {
    seed({ fetchedAt: NOW - 119_000 });
    setup();
    expect(screen.queryByText(/Updated/)).not.toBeInTheDocument();
    expect(screen.queryByText(/Offline/)).not.toBeInTheDocument();
  });

  it('keeps the stale line off at exactly 2 minutes and shows it past that', () => {
    seed({ fetchedAt: NOW - 120_000 });
    const first = setup();
    expect(screen.queryByText(/Updated/)).not.toBeInTheDocument();
    first.unmount();
    seed({ fetchedAt: new Date(2026, 10, 9, 16, 12).getTime() });
    setup();
    expect(screen.getByText('Updated 4:12 pm')).toBeInTheDocument();
    expect(screen.queryByText(/Offline/)).not.toBeInTheDocument();
  });

  it('shows the stale line for answers a few minutes old', () => {
    seed({ fetchedAt: NOW - 181_000 });
    setup();
    expect(screen.getByText('Updated 4:16 pm')).toBeInTheDocument();
  });

  it('uses the 12-hour clock for the morning and for noon', () => {
    vi.setSystemTime(new Date(2026, 10, 9, 13, 0));
    seed({ fetchedAt: new Date(2026, 10, 9, 12, 5).getTime() });
    setup();
    expect(screen.getByText('Updated 12:05 pm')).toBeInTheDocument();
    cleanup();
    seed({ fetchedAt: new Date(2026, 10, 9, 9, 30).getTime() });
    vi.setSystemTime(new Date(2026, 10, 9, 10, 0));
    setup();
    expect(screen.getByText('Updated 9:30 am')).toBeInTheDocument();
  });

  it('shows the update time and the offline line when the last fetch failed offline', () => {
    seed({}, { error: 'offline' });
    setup();
    expect(screen.getByText('Updated 4:20 pm')).toBeInTheDocument();
    expect(screen.getByText('Offline, showing the last list')).toBeInTheDocument();
    expect(screen.getByText('11 in')).toBeInTheDocument();
  });

  it.each(['auth', 'server'] as const)('shows the update time but not the offline line after a %s failure', (error) => {
    seed({}, { error });
    setup();
    expect(screen.getByText('Updated 4:20 pm')).toBeInTheDocument();
    expect(screen.queryByText(/Offline/)).not.toBeInTheDocument();
  });

  it('shows the last change line', () => {
    seed({}, { change: { player: 'Ben', from: 'in', to: 'out', at: new Date(2026, 10, 9, 16, 10).getTime() } });
    setup();
    expect(screen.getByText('Ben changed to Out at 4:10 pm.')).toBeInTheDocument();
  });

  it.each([
    ['in', 'In'],
    ['maybe', 'Maybe'],
    ['out', 'Out'],
  ] as const)('words a change to %s as %s', (to, label) => {
    seed({}, { change: { player: 'Ana', from: to === 'in' ? 'out' : 'in', to, at: NOW } });
    setup();
    expect(screen.getByText(`Ana changed to ${label} at 4:20 pm.`)).toBeInTheDocument();
  });

  it('shows no change line when nothing changed', () => {
    seed();
    setup();
    expect(screen.queryByText(/changed to/)).not.toBeInTheDocument();
  });

  it('counts the new names to review, with the right plural', () => {
    seed({ waiting: [{ id: 'g1', name: 'Mika', broughtBy: null }] });
    const one = setup();
    expect(screen.getByText('1 new name to review')).toBeInTheDocument();
    one.unmount();
    seed({
      waiting: [
        { id: 'g1', name: 'Mika', broughtBy: null },
        { id: 'g2', name: 'Rico', broughtBy: 'Ana' },
      ],
    });
    setup();
    expect(screen.getByText('2 new names to review')).toBeInTheDocument();
  });

  it('shows no review line when nobody is waiting', () => {
    seed();
    setup();
    expect(screen.queryByText(/to review/)).not.toBeInTheDocument();
  });

  it('puts the lines in order: pills, stale, change, review, link, buttons', () => {
    seed({ fetchedAt: new Date(2026, 10, 9, 16, 12).getTime(), waiting: [{ id: 'g1', name: 'Mika', broughtBy: null }] }, { change: { player: 'Ben', from: 'in', to: 'out', at: NOW } });
    const { container } = setup();
    const text = container.textContent!;
    const order = ['Attendance link', '11 in', 'Updated 4:12 pm', 'Ben changed to Out', '1 new name to review', '/j/abc123', 'Share'].map((t) => text.indexOf(t));
    expect(order.every((i) => i >= 0)).toBe(true);
    expect([...order].sort((a, b) => a - b)).toEqual(order);
  });

  it('keeps the small lines together in one block, and has no block when there are none', () => {
    seed({ fetchedAt: new Date(2026, 10, 9, 16, 12).getTime(), waiting: [{ id: 'g1', name: 'Mika', broughtBy: null }] }, { change: { player: 'Ben', from: 'in', to: 'out', at: NOW } });
    const first = setup();
    const meta = document.querySelectorAll('.attendance-meta');
    expect(meta).toHaveLength(1);
    expect(meta[0].textContent).toBe('Updated 4:12 pmBen changed to Out at 4:20 pm.1 new name to review');
    first.unmount();
    seed();
    setup();
    expect(document.querySelector('.attendance-meta')).toBeNull();
  });

  it('puts only the stale lines in the block of a cancelled week', () => {
    seed({ cancelled: { reason: null }, fetchedAt: new Date(2026, 10, 9, 16, 12).getTime() });
    setup();
    expect(document.querySelector('.attendance-meta')!.textContent).toBe('Updated 4:12 pm');
  });

  it('disables every button while a write is running', () => {
    seed({}, { busy: true });
    setup();
    for (const name of ['Share', 'Reset link', 'Cancel this week']) expect(screen.getByRole('button', { name })).toBeDisabled();
  });

  it('disables Create link while it runs', () => {
    useAttendanceStore.setState({ lastError: { tue: null }, busy: { tue: true } });
    setup();
    expect(screen.getByRole('button', { name: 'Create link' })).toBeDisabled();
  });
});

describe('a cancelled week', () => {
  beforeEach(() => signIn());

  it('shows the notice with the date and the reason, and hides the counts and buttons', () => {
    seed({ cancelled: { reason: 'Venue closed' }, waiting: [{ id: 'g1', name: 'Mika', broughtBy: null }] });
    setup();
    expect(screen.getByText('Cancelled for Tue 10 Nov. Venue closed')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Undo' })).toBeEnabled();
    expect(screen.queryByText('11 in')).not.toBeInTheDocument();
    expect(screen.queryByText(/to review/)).not.toBeInTheDocument();
    for (const name of ['Share', 'Reset link', 'Cancel this week']) expect(screen.queryByRole('button', { name })).not.toBeInTheDocument();
  });

  it('shows the notice without a reason', () => {
    seed({ cancelled: { reason: null } });
    setup();
    expect(screen.getByText('Cancelled for Tue 10 Nov.')).toBeInTheDocument();
  });

  it('builds the date from the play date as a local date', () => {
    seed({ cancelled: { reason: null }, playDate: '2027-01-01' });
    setup();
    expect(screen.getByText('Cancelled for Fri 1 Jan.')).toBeInTheDocument();
  });

  it('calls undoCancel for the slot', async () => {
    seed({ cancelled: { reason: null } });
    const undoCancel = vi.fn(async () => ({ ok: true as const }));
    useAttendanceStore.setState({ undoCancel });
    const { user } = setup();
    await user.click(screen.getByRole('button', { name: 'Undo' }));
    expect(undoCancel).toHaveBeenCalledWith('tue');
  });

  it('shows the message when undo fails', async () => {
    seed({ cancelled: { reason: null } });
    useAttendanceStore.setState({ undoCancel: vi.fn(async () => ({ ok: false as const, message: OFFLINE })) });
    const { user } = setup();
    await user.click(screen.getByRole('button', { name: 'Undo' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(OFFLINE);
  });

  it('disables Undo while a write is running', () => {
    seed({ cancelled: { reason: null } }, { busy: true });
    setup();
    expect(screen.getByRole('button', { name: 'Undo' })).toBeDisabled();
  });

  it('keeps the stale line in the cancelled state', () => {
    seed({ cancelled: { reason: null } }, { error: 'offline' });
    setup();
    expect(screen.getByText('Offline, showing the last list')).toBeInTheDocument();
  });
});

describe('Create link', () => {
  beforeEach(() => signIn());

  it('calls ensureLink with the slot and clears an old message when it works', async () => {
    useAttendanceStore.setState({ lastError: { tue: null } });
    const ensureLink = vi.fn(async () => ({ ok: true as const }));
    useAttendanceStore.setState({ ensureLink });
    const { user } = setup();
    await user.click(screen.getByRole('button', { name: 'Create link' }));
    expect(ensureLink).toHaveBeenCalledWith(TUE);
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('shows the store message when it fails', async () => {
    useAttendanceStore.setState({ lastError: { tue: null } });
    useAttendanceStore.setState({ ensureLink: vi.fn(async () => ({ ok: false as const, message: OFFLINE })) });
    const { user } = setup();
    await user.click(screen.getByRole('button', { name: 'Create link' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(OFFLINE);
  });
});

describe('a message from an earlier try', () => {
  it('goes away when the next try starts', async () => {
    signIn();
    useAttendanceStore.setState({ lastError: { tue: null } });
    let release: () => void = () => {};
    const ensureLink = vi
      .fn()
      .mockResolvedValueOnce({ ok: false, message: OFFLINE })
      .mockImplementationOnce(() => new Promise((resolve) => (release = () => resolve({ ok: true }))));
    useAttendanceStore.setState({ ensureLink });
    const { user } = setup();
    await user.click(screen.getByRole('button', { name: 'Create link' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(OFFLINE);
    await user.click(screen.getByRole('button', { name: 'Create link' }));
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    await act(async () => release());
  });
});

describe('Share', () => {
  beforeEach(() => {
    signIn();
    seed();
  });
  const URL = () => `${window.location.origin}/j/abc123`;

  it('uses the share sheet when the browser has one', async () => {
    const { user } = setup();
    const share = vi.fn(async () => {});
    const writeText = vi.fn(async () => {});
    stubShare(share, writeText);
    await user.click(screen.getByRole('button', { name: 'Share' }));
    expect(share).toHaveBeenCalledWith({ title: 'Tuesday open play', url: URL() });
    expect(writeText).not.toHaveBeenCalled();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(screen.queryByText('Link copied')).not.toBeInTheDocument();
  });

  it('treats a cancelled share as no error and copies nothing', async () => {
    const { user } = setup();
    const writeText = vi.fn(async () => {});
    stubShare(vi.fn(async () => { throw new DOMException('cancelled', 'AbortError'); }), writeText);
    await user.click(screen.getByRole('button', { name: 'Share' }));
    expect(writeText).not.toHaveBeenCalled();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(screen.queryByText('Link copied')).not.toBeInTheDocument();
    expect(screen.queryByLabelText('Link')).not.toBeInTheDocument();
  });

  it('copies the link when sharing fails some other way', async () => {
    const { user } = setup();
    const writeText = vi.fn(async () => {});
    stubShare(vi.fn(async () => { throw new Error('nope'); }), writeText);
    await user.click(screen.getByRole('button', { name: 'Share' }));
    expect(writeText).toHaveBeenCalledWith(URL());
    expect(await screen.findByText('Link copied')).toBeInTheDocument();
  });

  it('copies the link when there is no share sheet', async () => {
    const { user } = setup();
    const writeText = vi.fn(async () => {});
    stubShare(undefined, writeText);
    await user.click(screen.getByRole('button', { name: 'Share' }));
    expect(writeText).toHaveBeenCalledWith(URL());
    expect(await screen.findByText('Link copied')).toBeInTheDocument();
    expect(screen.queryByLabelText('Link')).not.toBeInTheDocument();
  });

  it('shows the link selected in a read-only field when nothing else works', async () => {
    const { user } = setup();
    stubShare(undefined, undefined);
    await user.click(screen.getByRole('button', { name: 'Share' }));
    const field = (await screen.findByLabelText('Link')) as HTMLInputElement;
    expect(field).toHaveValue(URL());
    expect(field).toHaveAttribute('readonly');
    expect(field.selectionStart).toBe(0);
    expect(field.selectionEnd).toBe(URL().length);
    expect(screen.queryByText('Link copied')).not.toBeInTheDocument();
  });

  it('shows the field when copying is refused', async () => {
    const { user } = setup();
    stubShare(undefined, vi.fn(async () => { throw new Error('denied'); }));
    await user.click(screen.getByRole('button', { name: 'Share' }));
    expect(await screen.findByLabelText('Link')).toHaveValue(URL());
    expect(screen.queryByText('Link copied')).not.toBeInTheDocument();
  });

  it('forgets the last result when Share is pressed again', async () => {
    const { user } = setup();
    stubShare(undefined, vi.fn(async () => {}));
    await user.click(screen.getByRole('button', { name: 'Share' }));
    expect(await screen.findByText('Link copied')).toBeInTheDocument();
    stubShare(vi.fn(async () => {}), undefined);
    await user.click(screen.getByRole('button', { name: 'Share' }));
    expect(screen.queryByText('Link copied')).not.toBeInTheDocument();
  });
});

describe('the Reset link sheet', () => {
  beforeEach(() => {
    signIn();
    seed();
  });
  const dialog = () => screen.getByRole('dialog');

  it('asks first, moves focus into the sheet and offers Reset link and Keep it', async () => {
    const { user } = setup();
    const resetLink = vi.fn(async () => ({ ok: true as const }));
    useAttendanceStore.setState({ resetLink });
    await user.click(screen.getByRole('button', { name: 'Reset link' }));
    expect(dialog()).toHaveFocus();
    expect(within(dialog()).getByText('Members who have the old link will need the new one. Answers are kept.')).toBeInTheDocument();
    expect(within(dialog()).getByRole('button', { name: 'Reset link' })).toBeEnabled();
    expect(within(dialog()).getByRole('button', { name: 'Keep it' })).toBeEnabled();
    expect(resetLink).not.toHaveBeenCalled();
  });

  it('closes on Keep it without resetting', async () => {
    const { user } = setup();
    const resetLink = vi.fn(async () => ({ ok: true as const }));
    useAttendanceStore.setState({ resetLink });
    await user.click(screen.getByRole('button', { name: 'Reset link' }));
    await user.click(within(dialog()).getByRole('button', { name: 'Keep it' }));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(resetLink).not.toHaveBeenCalled();
  });

  it('closes on Escape and gives focus back to the button', async () => {
    const { user } = setup();
    await user.click(screen.getByRole('button', { name: 'Reset link' }));
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Reset link' })).toHaveFocus();
  });

  it('resets the link for the slot and closes when it works', async () => {
    const { user } = setup();
    const resetLink = vi.fn(async () => ({ ok: true as const }));
    useAttendanceStore.setState({ resetLink });
    await user.click(screen.getByRole('button', { name: 'Reset link' }));
    await user.click(within(dialog()).getByRole('button', { name: 'Reset link' }));
    expect(resetLink).toHaveBeenCalledWith('tue');
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('stays open and shows the message when it fails', async () => {
    const { user } = setup();
    useAttendanceStore.setState({ resetLink: vi.fn(async () => ({ ok: false as const, message: OFFLINE })) });
    await user.click(screen.getByRole('button', { name: 'Reset link' }));
    await user.click(within(dialog()).getByRole('button', { name: 'Reset link' }));
    expect(await within(dialog()).findByRole('alert')).toHaveTextContent(OFFLINE);
    expect(screen.getAllByRole('alert')).toHaveLength(1);
    expect(dialog()).toBeInTheDocument();
  });

  it('disables its buttons while a write is running', async () => {
    const { user } = setup();
    await user.click(screen.getByRole('button', { name: 'Reset link' }));
    act(() => useAttendanceStore.setState({ busy: { tue: true } }));
    expect(within(dialog()).getByRole('button', { name: 'Reset link' })).toBeDisabled();
    expect(within(dialog()).getByRole('button', { name: 'Keep it' })).toBeDisabled();
  });
});

describe('the Cancel this week sheet', () => {
  beforeEach(() => {
    signIn();
    seed();
  });
  const dialog = () => screen.getByRole('dialog');
  const open = async (user: ReturnType<typeof userEvent.setup>) => user.click(screen.getByRole('button', { name: 'Cancel this week' }));

  it('names the date, has an optional reason field and moves focus into the sheet', async () => {
    const { user } = setup();
    await open(user);
    expect(within(dialog()).getByRole('heading', { name: 'Cancel Tue 10 Nov?' })).toBeInTheDocument();
    expect(dialog()).toHaveFocus();
    const reason = within(dialog()).getByLabelText('Reason (optional)');
    expect(reason).toHaveAttribute('maxlength', '140');
    expect(reason).not.toBeRequired();
    expect(within(dialog()).getByRole('button', { name: 'Cancel this week' })).toBeEnabled();
    expect(within(dialog()).getByRole('button', { name: 'Keep it on' })).toBeEnabled();
  });

  it('cancels with the typed reason and closes when it works', async () => {
    const { user } = setup();
    const cancelWeek = vi.fn(async () => ({ ok: true as const }));
    useAttendanceStore.setState({ cancelWeek });
    await open(user);
    await user.type(within(dialog()).getByLabelText('Reason (optional)'), 'Venue closed');
    await user.click(within(dialog()).getByRole('button', { name: 'Cancel this week' }));
    expect(cancelWeek).toHaveBeenCalledWith('tue', 'Venue closed');
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('cancels without a reason', async () => {
    const { user } = setup();
    const cancelWeek = vi.fn(async () => ({ ok: true as const }));
    useAttendanceStore.setState({ cancelWeek });
    await open(user);
    await user.click(within(dialog()).getByRole('button', { name: 'Cancel this week' }));
    expect(cancelWeek).toHaveBeenCalledWith('tue', '');
  });

  it('closes on Keep it on and on Escape without cancelling', async () => {
    const { user } = setup();
    const cancelWeek = vi.fn(async () => ({ ok: true as const }));
    useAttendanceStore.setState({ cancelWeek });
    await open(user);
    await user.click(within(dialog()).getByRole('button', { name: 'Keep it on' }));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    await open(user);
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(cancelWeek).not.toHaveBeenCalled();
  });

  it('shows a character count only near the limit, and stops at 140', async () => {
    const { user } = setup();
    await open(user);
    const reason = within(dialog()).getByLabelText('Reason (optional)');
    await user.click(reason);
    await user.paste('a'.repeat(119));
    expect(within(dialog()).queryByText(/\/140/)).not.toBeInTheDocument();
    await user.paste('a');
    expect(within(dialog()).getByText('120/140')).toBeInTheDocument();
    await user.paste('b'.repeat(40));
    expect(within(dialog()).getByText('140/140')).toBeInTheDocument();
    expect((reason as HTMLInputElement).value).toHaveLength(140);
  });

  it('stays open and shows the message when it fails', async () => {
    const { user } = setup();
    useAttendanceStore.setState({ cancelWeek: vi.fn(async () => ({ ok: false as const, message: OFFLINE })) });
    await open(user);
    await user.click(within(dialog()).getByRole('button', { name: 'Cancel this week' }));
    expect(await within(dialog()).findByRole('alert')).toHaveTextContent(OFFLINE);
    expect(dialog()).toBeInTheDocument();
  });

  it('disables its buttons while a write is running', async () => {
    const { user } = setup();
    await open(user);
    act(() => useAttendanceStore.setState({ busy: { tue: true } }));
    expect(within(dialog()).getByRole('button', { name: 'Cancel this week' })).toBeDisabled();
    expect(within(dialog()).getByRole('button', { name: 'Keep it on' })).toBeDisabled();
  });
});

describe('against the real rules', () => {
  let db: PGlite;
  let flags: FakeFlags;
  beforeAll(async () => {
    db = await createDb();
  });
  afterAll(async () => {
    await db.close();
  });
  beforeEach(async () => {
    await db.exec('truncate public.players, public.attendance_links cascade');
    await db.exec(`insert into public.players (owner_id, id, name) values ('${USER_A}', '11111111-1111-4111-8111-111111111111', 'Ana Reyes')`);
    flags = { offline: false, calls: [] };
    signIn();
    setAttendanceDeps({
      server: () => ({ remote: fakeAttendanceRemote(db, USER_A, flags), userId: USER_A }),
      now: () => Date.now(),
      timezone: () => 'Asia/Manila',
    });
  });
  const code = async () => (await db.query<{ code: string }>('select code from public.attendance_links')).rows[0]?.code;

  it('finds there is no link, creates one and shows the empty counts', async () => {
    const { user } = setup();
    await user.click(await screen.findByRole('button', { name: 'Create link' }));
    expect(await screen.findByText('0 in')).toBeInTheDocument();
    expect(screen.getByText(`${window.location.origin}/j/${await code()}`)).toBeInTheDocument();
  });

  it('shows the answers a member gave, after a refresh', async () => {
    const { user } = setup();
    await user.click(await screen.findByRole('button', { name: 'Create link' }));
    await screen.findByText('0 in');
    await run(db, 'anon', 'select public.attendance_answer($1, $2, $3, $4)', [await code(), '11111111-1111-4111-8111-111111111111', 'in', false]);
    await act(async () => {
      await useAttendanceStore.getState().refresh('tue');
    });
    expect(screen.getByText('1 in')).toBeInTheDocument();
  });

  it('resets the link through the sheet and shows the new code', async () => {
    const { user } = setup();
    await user.click(await screen.findByRole('button', { name: 'Create link' }));
    await screen.findByText('0 in');
    const before = await code();
    await user.click(screen.getByRole('button', { name: 'Reset link' }));
    await user.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Reset link' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    const after = await code();
    expect(after).not.toBe(before);
    expect(await screen.findByText(`${window.location.origin}/j/${after}`)).toBeInTheDocument();
  });

  it('cancels the week with a reason, then undoes it', async () => {
    const { user } = setup();
    await user.click(await screen.findByRole('button', { name: 'Create link' }));
    await screen.findByText('0 in');
    await user.click(screen.getByRole('button', { name: 'Cancel this week' }));
    await user.type(screen.getByLabelText('Reason (optional)'), 'Venue closed');
    await user.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Cancel this week' }));
    expect(await screen.findByText(/^Cancelled for \w{3} \d{1,2} \w{3}\. Venue closed$/)).toBeInTheDocument();
    expect(screen.queryByText('0 in')).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Undo' }));
    expect(await screen.findByText('0 in')).toBeInTheDocument();
    expect(screen.queryByText(/Cancelled for/)).not.toBeInTheDocument();
  });

  it('shows the offline message and keeps the sheet open when a reset cannot be sent', async () => {
    const { user } = setup();
    await user.click(await screen.findByRole('button', { name: 'Create link' }));
    await screen.findByText('0 in');
    const before = await code();
    flags.offline = true;
    await user.click(screen.getByRole('button', { name: 'Reset link' }));
    await user.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Reset link' }));
    expect(await within(screen.getByRole('dialog')).findByRole('alert')).toHaveTextContent(OFFLINE);
    flags.offline = false;
    expect(await code()).toBe(before);
  });

  it('shows the offline message when a link cannot be created', async () => {
    // The mount refresh would learn it is offline first, so it is held back here.
    useAttendanceStore.setState({ refresh: vi.fn(async () => ({ ok: true as const })), lastError: { tue: null } });
    flags.offline = true;
    const { user } = setup();
    await user.click(screen.getByRole('button', { name: 'Create link' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(OFFLINE);
    expect(flags.calls.some((c) => c.startsWith('upsertLink'))).toBe(true);
  });
});
