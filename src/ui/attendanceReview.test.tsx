import type { PGlite } from '@electric-sql/pglite';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { useHistoryStore } from '../store/historyStore';
import type { RosterPlayer } from '../store/rosterDb';
import { useRosterStore } from '../store/rosterStore';
import { useSessionStore } from '../store/sessionStore';
import { useSlotsStore, type Slot } from '../store/slots';
import { fakeAttendanceRemote, type FakeFlags } from '../sync/attendance/fakeRemote';
import { resetAttendanceDeps, setAttendanceDeps, useAttendanceStore } from '../sync/attendance/store';
import type { Summary, WaitingName } from '../sync/attendance/types';
import { useAuthStore } from '../sync/auth';
import { USER_A, createDb } from '../sync/db/harness';
import { useSyncStore } from '../sync/syncStore';
import { AttendanceCard } from './AttendanceCard';
import { BLANK_SLOTS } from '../store/slotsFixture';

// Monday 9 Nov 2026, 4:20 pm. Date is faked and timers stay real.
const NOW = new Date(2026, 10, 9, 16, 20).getTime();
const TUE: Slot = { id: 'tue', weekday: 2, startMin: 1140, endMin: 1260, venue: 'Hall', courts: 3 };
const OFFLINE = 'No connection. Try again when you are online.';
const realStore = useAttendanceStore.getState();
const actions = {
  refresh: realStore.refresh,
  ensureLink: realStore.ensureLink,
  resetLink: realStore.resetLink,
  cancelWeek: realStore.cancelWeek,
  undoCancel: realStore.undoCancel,
  setGuestState: realStore.setGuestState,
};
const realAdd = useRosterStore.getState().add;

const player = (id: string, name: string): RosterPlayer => ({ id, name, photoVersion: 0, photoSeq: 0, updatedAt: 1 });
const guest = (id: string, name: string, broughtBy: string | null = null): WaitingName => ({ id, name, broughtBy });

function resetEverything() {
  localStorage.clear();
  useAuthStore.setState({ status: 'signedIn', email: 'o@example.com', userId: USER_A, error: null, busy: false });
  useSyncStore.setState({ status: 'off', pending: 0, lastSyncedAt: null });
  useSlotsStore.setState({ slots: BLANK_SLOTS.slots.map((s) => ({ ...s })), venues: [], tonight: {}, persistent: true });
  useSessionStore.setState({ session: null, undoStack: [], saveFailed: false });
  useHistoryStore.setState({ entries: [], loaded: true, persistent: true });
  useRosterStore.setState({ players: [], loaded: true, add: realAdd });
  useAttendanceStore.getState().clear();
  useAttendanceStore.setState(actions);
}

const summary = (over: Partial<Summary> = {}): Summary => ({
  slotId: 'tue',
  code: 'abc123',
  playDate: '2026-11-10',
  cancelled: null,
  counts: { in: 2, maybe: 0, out: 0, late: 0 },
  friends: 0,
  waiting: [],
  tonight: [],
  lateIds: [],
  answers: {},
  names: {},
  fetchedAt: NOW,
  ...over,
});

function seed(over: Partial<Summary> = {}) {
  useAttendanceStore.setState({
    ownerId: USER_A,
    links: { tue: { code: 'abc123' } },
    summaries: { tue: summary(over) },
    lastChange: { tue: null },
    lastError: { tue: null },
    busy: { tue: false },
  });
}

function setup() {
  const user = userEvent.setup({ advanceTimers: () => {} });
  const view = render(<AttendanceCard slot={TUE} onSignIn={vi.fn()} />);
  // Nudge the maybes sits under More, so More starts open.
  const more = screen.queryByRole('button', { name: 'More' });
  if (more) fireEvent.click(more);
  return { user, ...view };
}

const stubClipboard = (writeText: unknown) =>
  Object.defineProperty(navigator, 'clipboard', { value: writeText === undefined ? undefined : { writeText }, configurable: true, writable: true });

beforeEach(() => {
  resetEverything();
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(NOW);
  setAttendanceDeps({ server: () => null, now: () => Date.now(), timezone: () => 'Asia/Manila' });
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.restoreAllMocks();
  resetAttendanceDeps();
  delete (navigator as unknown as Record<string, unknown>).clipboard;
});

const row = (name: string) => within(screen.getByText(name, { selector: '.review-name' }).closest('li') as HTMLElement);
const WAITING = [guest('g1', 'Mika'), guest('g2', 'Rico', 'p-ana')];
const NAMES = { 'p-ana': 'Ana' };

describe('the review button on the card', () => {
  it('is a button with the same words, and the right plural', () => {
    seed({ waiting: [guest('g1', 'Mika')] });
    const one = setup();
    expect(screen.getByRole('button', { name: '1 new name to review' })).toBeEnabled();
    one.unmount();
    seed({ waiting: WAITING });
    setup();
    expect(screen.getByRole('button', { name: '2 new names to review' })).toBeInTheDocument();
  });

  it('has the full-width review class and the 44 px button class', () => {
    seed({ waiting: WAITING });
    setup();
    const button = screen.getByRole('button', { name: '2 new names to review' });
    expect(button).toHaveClass('attendance-btn');
    expect(button).toHaveClass('attendance-review');
  });

  it('is not there when nobody is waiting, or in the cancelled and signed-out states', () => {
    seed();
    const a = setup();
    expect(screen.queryByRole('button', { name: /to review/ })).not.toBeInTheDocument();
    a.unmount();
    seed({ waiting: WAITING, cancelled: { reason: null } });
    const b = setup();
    expect(screen.queryByRole('button', { name: /to review/ })).not.toBeInTheDocument();
    b.unmount();
    useAuthStore.setState({ status: 'signedOut', userId: null });
    seed({ waiting: WAITING });
    setup();
    expect(screen.queryByRole('button', { name: /to review/ })).not.toBeInTheDocument();
  });

  it('opens the review sheet with a title that counts the names', async () => {
    seed({ waiting: WAITING, names: NAMES });
    const { user } = setup();
    await user.click(screen.getByRole('button', { name: '2 new names to review' }));
    const dialog = screen.getByRole('dialog', { name: '2 to review' });
    expect(within(dialog).getAllByRole('listitem')).toHaveLength(2);
  });
});

describe('the review sheet rows', () => {
  async function open(over: Partial<Summary> = {}, roster: RosterPlayer[] = []) {
    useRosterStore.setState({ players: roster });
    seed({ waiting: WAITING, names: NAMES, ...over });
    const view = setup();
    await view.user.click(screen.getByRole('button', { name: /to review/ }));
    return view;
  }

  it('shows a new member with its note and the two actions', async () => {
    await open();
    const mika = row('Mika');
    expect(mika.getByText('New name, asked to join')).toBeInTheDocument();
    expect(mika.getAllByRole('button').map((b) => b.textContent)).toEqual(['Add to roster', 'Dismiss']);
  });

  it('shows a friend with the first name of the sponsor and the three actions', async () => {
    await open();
    const rico = row('Rico');
    expect(rico.getByText('Friend of Ana')).toBeInTheDocument();
    expect(rico.getAllByRole('button').map((b) => b.textContent)).toEqual(['Play tonight', 'Add to roster', 'Dismiss']);
  });

  it('keeps the sponsor initial when the card shows one, and says Friend when the sponsor is unknown', async () => {
    await open({ names: { 'p-ana': 'Ben K.' }, waiting: [guest('g2', 'Rico', 'p-ana'), guest('g3', 'Lou', 'p-gone')] });
    expect(row('Rico').getByText('Friend of Ben K.')).toBeInTheDocument();
    expect(row('Lou').getByText('Friend')).toBeInTheDocument();
  });

  it('shows the footer line', async () => {
    await open();
    expect(screen.getByText("Added players are saved to your roster. Tick them in Who's playing.")).toBeInTheDocument();
  });

  it('shows no hint for a new name', async () => {
    await open({}, [player('r1', 'Zed')]);
    expect(screen.queryByText(/already saved/)).not.toBeInTheDocument();
  });

  it('hints an exact match, ignoring case and spaces, and Add to roster reads Mark as done', async () => {
    await open({ waiting: [guest('g1', '  mika ')] }, [player('r1', 'Mika')]);
    const mika = row('mika');
    expect(mika.getByText('Already saved as Mika.')).toBeInTheDocument();
    expect(mika.getByRole('button', { name: 'Mark as done' })).toBeInTheDocument();
    expect(mika.queryByRole('button', { name: 'Add to roster' })).not.toBeInTheDocument();
  });

  it('hints a likely match on the first word and still offers Add to roster', async () => {
    await open({ waiting: [guest('g1', 'Mika Tan')] }, [player('r1', 'Mika Reyes')]);
    const mika = row('Mika Tan');
    expect(mika.getByText('Could be Mika Reyes, who is already saved.')).toBeInTheDocument();
    expect(mika.getByRole('button', { name: 'Add to roster' })).toBeInTheDocument();
    expect(mika.queryByRole('button', { name: 'Mark as done' })).not.toBeInTheDocument();
  });

  it('gives a friend with an exact match the Mark as done label too', async () => {
    await open({ waiting: [guest('g2', 'Rico', 'p-ana')] }, [player('r1', 'Rico')]);
    expect(row('Rico').getAllByRole('button').map((b) => b.textContent)).toEqual(['Play tonight', 'Mark as done', 'Dismiss']);
  });
});

describe('the review sheet actions', () => {
  const setGuestState = vi.fn();
  const add = vi.fn();
  beforeEach(() => {
    setGuestState.mockReset().mockResolvedValue({ ok: true });
    add.mockReset().mockImplementation(async (name: string) => player('r-new', name));
    useAttendanceStore.setState({ setGuestState });
    useRosterStore.setState({ add });
  });

  async function open(over: Partial<Summary> = {}) {
    seed({ waiting: WAITING, names: NAMES, ...over });
    const view = setup();
    await view.user.click(screen.getByRole('button', { name: /to review/ }));
    return view;
  }

  it('Add to roster saves the name first, then marks the guest added', async () => {
    const { user } = await open();
    await user.click(row('Mika').getByRole('button', { name: 'Add to roster' }));
    expect(add).toHaveBeenCalledWith('Mika');
    expect(setGuestState).toHaveBeenCalledWith('tue', 'g1', 'added');
    expect(add.mock.invocationCallOrder[0]).toBeLessThan(setGuestState.mock.invocationCallOrder[0]);
  });

  it('Add to roster on a friend does the same', async () => {
    const { user } = await open();
    await user.click(row('Rico').getByRole('button', { name: 'Add to roster' }));
    expect(add).toHaveBeenCalledWith('Rico');
    expect(setGuestState).toHaveBeenCalledWith('tue', 'g2', 'added');
  });

  it('Mark as done still goes through add, which returns the saved player', async () => {
    useRosterStore.setState({ players: [player('r1', 'Mika')] });
    const { user } = await open();
    await user.click(row('Mika').getByRole('button', { name: 'Mark as done' }));
    expect(add).toHaveBeenCalledWith('Mika');
    expect(setGuestState).toHaveBeenCalledWith('tue', 'g1', 'added');
  });

  it('Play tonight sets play_tonight and does not touch the roster', async () => {
    const { user } = await open();
    await user.click(row('Rico').getByRole('button', { name: 'Play tonight' }));
    expect(setGuestState).toHaveBeenCalledWith('tue', 'g2', 'play_tonight');
    expect(add).not.toHaveBeenCalled();
  });

  it('Dismiss sets dismissed and does not touch the roster', async () => {
    const { user } = await open();
    await user.click(row('Mika').getByRole('button', { name: 'Dismiss' }));
    expect(setGuestState).toHaveBeenCalledWith('tue', 'g1', 'dismissed');
    expect(add).not.toHaveBeenCalled();
  });

  it('disables only that row while its write runs, then lets go', async () => {
    let release: (r: { ok: true }) => void = () => {};
    setGuestState.mockImplementationOnce(() => new Promise((resolve) => (release = resolve)));
    const { user } = await open();
    await user.click(row('Mika').getByRole('button', { name: 'Dismiss' }));
    for (const b of row('Mika').getAllByRole('button')) expect(b).toBeDisabled();
    for (const b of row('Rico').getAllByRole('button')) expect(b).toBeEnabled();
    await act(async () => release({ ok: true }));
    for (const b of row('Mika').getAllByRole('button')) expect(b).toBeEnabled();
  });

  it('shows the store message in an alert inside the sheet when the write fails, and keeps the row', async () => {
    setGuestState.mockResolvedValueOnce({ ok: false, message: OFFLINE });
    const { user } = await open();
    await user.click(row('Mika').getByRole('button', { name: 'Dismiss' }));
    const alert = await within(screen.getByRole('dialog')).findByRole('alert');
    expect(alert).toHaveTextContent(OFFLINE);
    expect(row('Mika').getByRole('button', { name: 'Dismiss' })).toBeEnabled();
    expect(document.querySelectorAll('[role="alert"]')).toHaveLength(1);
  });

  it('shows the roster message when saving the name fails, and does not mark the guest', async () => {
    add.mockRejectedValueOnce(new Error('That name is not valid.'));
    const { user } = await open();
    await user.click(row('Mika').getByRole('button', { name: 'Add to roster' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('That name is not valid.');
    expect(setGuestState).not.toHaveBeenCalled();
  });

  it('falls back to a plain message when the roster failure has no text', async () => {
    add.mockRejectedValueOnce('boom');
    const { user } = await open();
    await user.click(row('Mika').getByRole('button', { name: 'Add to roster' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Could not add that player.');
  });

  it('clears the message on the next try', async () => {
    setGuestState.mockResolvedValueOnce({ ok: false, message: OFFLINE });
    const { user } = await open();
    await user.click(row('Mika').getByRole('button', { name: 'Dismiss' }));
    await screen.findByRole('alert');
    await user.click(row('Mika').getByRole('button', { name: 'Dismiss' }));
    await waitFor(() => expect(screen.queryByRole('alert')).not.toBeInTheDocument());
  });

  it('closes with All done on the card when the list empties', async () => {
    const { user } = await open({ waiting: [guest('g1', 'Mika')] });
    setGuestState.mockImplementationOnce(async () => {
      useAttendanceStore.setState({ summaries: { tue: summary({ waiting: [] }) } });
      return { ok: true };
    });
    await user.click(row('Mika').getByRole('button', { name: 'Dismiss' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(screen.getByRole('status')).toHaveTextContent('All done.');
    expect(screen.queryByRole('button', { name: /to review/ })).not.toBeInTheDocument();
  });

  it('keeps the sheet open while names are left, and shows no All done', async () => {
    const { user } = await open();
    setGuestState.mockImplementationOnce(async () => {
      useAttendanceStore.setState({ summaries: { tue: summary({ waiting: [guest('g2', 'Rico', 'p-ana')], names: NAMES }) } });
      return { ok: true };
    });
    await user.click(row('Mika').getByRole('button', { name: 'Dismiss' }));
    await waitFor(() => expect(screen.queryByText('Mika', { selector: '.review-name' })).not.toBeInTheDocument());
    expect(screen.getByRole('dialog', { name: '1 to review' })).toBeInTheDocument();
    expect(screen.queryByText('All done.')).not.toBeInTheDocument();
  });

  it('closes with the close key and shows no All done while names are waiting', async () => {
    const { user } = await open();
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(screen.queryByText('All done.')).not.toBeInTheDocument();
  });

  it('drops All done the next time the sheet opens', async () => {
    const { user } = await open({ waiting: [guest('g1', 'Mika')] });
    setGuestState.mockImplementationOnce(async () => {
      useAttendanceStore.setState({ summaries: { tue: summary({ waiting: [] }) } });
      return { ok: true };
    });
    await user.click(row('Mika').getByRole('button', { name: 'Dismiss' }));
    await screen.findByText('All done.');
    await act(async () => {
      useAttendanceStore.setState({ summaries: { tue: summary({ waiting: [guest('g9', 'Zed')] }) } });
    });
    expect(screen.queryByText('All done.')).not.toBeInTheDocument();
  });
});

describe('the review sheet against the real store', () => {
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
    flags = { offline: false, calls: [] };
    setAttendanceDeps({
      server: () => ({ remote: fakeAttendanceRemote(db, USER_A, flags), userId: USER_A }),
      now: () => Date.now(),
      timezone: () => 'Asia/Manila',
    });
  });

  it('dismisses a name: the row leaves, All done shows, and the guest is dismissed in the database', async () => {
    await db.exec(`insert into public.attendance_links (owner_id, slot_id, title, weekday, timezone) values ('${USER_A}', 'tue', 'Tuesday open play', 2, 'Asia/Manila')`);
    await db.exec(`insert into public.attendance_guests (owner_id, slot_id, play_date, name, state) values ('${USER_A}', 'tue', '2026-11-10', 'Mika', 'pending')`);
    const { user } = setup();
    await user.click(await screen.findByRole('button', { name: '1 new name to review' }));
    await user.click(row('Mika').getByRole('button', { name: 'Dismiss' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(screen.getByText('All done.')).toBeInTheDocument();
    expect((await db.query<{ state: string }>('select state from public.attendance_guests')).rows[0].state).toBe('dismissed');
    expect(flags.calls.some((c) => c.startsWith('setGuestState:') && c.endsWith(':dismissed'))).toBe(true);
  });
});

describe('the nudge button', () => {
  const answers = { a: 'in', b: 'in', c: 'maybe', d: 'maybe', e: 'out' } as const;
  const names = { a: 'Ana', b: 'Ben', c: 'Cai', d: 'Dee', e: 'Eli' };
  const full = (over: Partial<Summary> = {}) =>
    seed({ counts: { in: 2, maybe: 2, out: 1, late: 0 }, answers: { ...answers }, names, ...over });
  const NUDGE = 'Cai and Dee, are you in for Tuesday?';

  it('sits under More with Reset link and Cancel this week, after the Share link button', () => {
    full();
    setup();
    expect(screen.getByRole('button', { name: 'Share link' })).toBeInTheDocument();
    const rows = [...document.querySelectorAll('.attendance-actions')];
    const names_ = within(rows[rows.length - 1] as HTMLElement)
      .getAllByRole('button')
      .map((b) => b.textContent);
    expect(names_).toEqual(['Nudge the maybes', 'Reset link', 'Cancel this week']);
  });

  it('hides Nudge the maybes at zero maybes', () => {
    seed({ counts: { in: 2, maybe: 0, out: 0, late: 0 }, answers: { a: 'in' }, names });
    setup();
    expect(screen.queryByRole('button', { name: 'Nudge the maybes' })).not.toBeInTheDocument();
  });

  it('is not there in the cancelled state, signed out, or while the link is missing', () => {
    full({ cancelled: { reason: null } });
    const a = setup();
    expect(screen.queryByRole('button', { name: /Nudge/ })).not.toBeInTheDocument();
    a.unmount();
    useAuthStore.setState({ status: 'signedOut', userId: null });
    full();
    const b = setup();
    expect(screen.queryByRole('button', { name: /Nudge/ })).not.toBeInTheDocument();
    b.unmount();
    useAuthStore.setState({ status: 'signedIn', userId: USER_A });
    useAttendanceStore.getState().clear();
    useAttendanceStore.setState({ lastError: { tue: null } });
    setup();
    expect(screen.queryByRole('button', { name: /Nudge/ })).not.toBeInTheDocument();
  });

  it('copies the nudge and says so', async () => {
    full();
    const { user } = setup();
    const writeText = vi.fn(async () => {});
    stubClipboard(writeText);
    await user.click(screen.getByRole('button', { name: 'Nudge the maybes' }));
    expect(writeText).toHaveBeenCalledWith(NUDGE);
    expect(await screen.findByRole('status')).toHaveTextContent('Message copied');
  });

  it('shows the text selected in a read-only box when the clipboard refuses', async () => {
    full();
    const { user } = setup();
    stubClipboard(vi.fn(async () => { throw new Error('denied'); }));
    await user.click(screen.getByRole('button', { name: 'Nudge the maybes' }));
    expect(await screen.findByText('Could not copy. Select the text below.')).toBeInTheDocument();
    const box = screen.getByLabelText('Text to copy') as HTMLTextAreaElement;
    expect(box).toHaveAttribute('readonly');
    expect(box.value).toBe(NUDGE);
    expect(box.selectionStart).toBe(0);
    expect(box.selectionEnd).toBe(NUDGE.length);
    expect(screen.queryByText('Message copied')).not.toBeInTheDocument();
  });

  it('falls back the same way when there is no clipboard at all, and sizes the box to a short message', async () => {
    full();
    const { user } = setup();
    stubClipboard(undefined);
    await user.click(screen.getByRole('button', { name: 'Nudge the maybes' }));
    const box = (await screen.findByLabelText('Text to copy')) as HTMLTextAreaElement;
    expect(box).toHaveValue(NUDGE);
    expect(Number(box.getAttribute('rows'))).toBeGreaterThanOrEqual(3);
    expect(Number(box.getAttribute('rows'))).toBeLessThanOrEqual(4);
  });

  it('drops the message line when Share link is pressed', async () => {
    full();
    const { user } = setup();
    stubClipboard(vi.fn(async () => {}));
    await user.click(screen.getByRole('button', { name: 'Nudge the maybes' }));
    expect(await screen.findByText('Message copied')).toBeInTheDocument();
    Object.defineProperty(navigator, 'share', { value: vi.fn(async () => {}), configurable: true, writable: true });
    await user.click(screen.getByRole('button', { name: 'Share link' }));
    expect(screen.queryByText('Message copied')).not.toBeInTheDocument();
    delete (navigator as unknown as Record<string, unknown>).share;
  });

  it('drops the Link copied line when the nudge is copied', async () => {
    full();
    const { user } = setup();
    stubClipboard(vi.fn(async () => {}));
    await user.click(screen.getByRole('button', { name: 'Share link' }));
    await screen.findByText('Link copied');
    await user.click(screen.getByRole('button', { name: 'Nudge the maybes' }));
    await screen.findByText('Message copied');
    expect(screen.queryByText('Link copied')).not.toBeInTheDocument();
  });

  it('keeps the nudge usable while a write is running', () => {
    full();
    useAttendanceStore.setState({ busy: { tue: true } });
    setup();
    expect(screen.getByRole('button', { name: 'Nudge the maybes' })).toBeEnabled();
  });
});
