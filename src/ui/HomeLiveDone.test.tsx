import { act, cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Session } from '../engine';
import { finishGame } from '../engine/game';
import { makeCtx, newTestSession } from '../engine/testing';
import type { HistoryEntry } from '../store/historyDb';
import { useHistoryStore } from '../store/historyStore';
import { useSessionStore } from '../store/sessionStore';
import { timestampAt, useSlotsStore, type Slot } from '../store/slots';
import { HomeScreen } from './HomeScreen';
import { BLANK_SLOTS } from '../store/slotsFixture';

const share = vi.hoisted(() => ({ sharePictureFor: vi.fn() }));
vi.mock('./sharePicture', () => share);

const MIN = 60_000;
const HOUR = 60 * MIN;
const slots = (list: Slot[] = BLANK_SLOTS.slots) => useSlotsStore.setState({ slots: list.map((s) => ({ ...s })), venues: [], tonight: {}, persistent: true });

beforeEach(() => {
  localStorage.clear();
  slots();
  useHistoryStore.setState({ entries: [], loaded: true, persistent: true });
  useSessionStore.setState({ session: null, undoStack: [], saveFailed: false });
  share.sharePictureFor.mockReset().mockResolvedValue('shared');
  vi.useFakeTimers({ toFake: ['Date', 'setInterval', 'clearInterval'] });
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

function setup() {
  const onStart = vi.fn();
  const onResume = vi.fn();
  const onHistory = vi.fn();
  const onViewSummary = vi.fn();
  const user = userEvent.setup({ advanceTimers: () => {} });
  render(<HomeScreen onStart={onStart} onResume={onResume} onHistory={onHistory} onViewSummary={onViewSummary} />);
  return { user, onStart, onResume, onHistory, onViewSummary };
}

const chip = (name: string) => screen.getByRole('radio', { name });
const pill = () => document.querySelector('.home-pill')!.textContent;

/** A session of six that began at `created` with `games` games played; two players wait. */
function running(created: number, games = 2, over: Partial<Session> = {}): Session {
  const ctx = makeCtx(1, created);
  let s = newTestSession(['Ann', 'Ben', 'Cy', 'Dee', 'Eve', 'Fay'], { courts: 1 }, ctx);
  for (let i = 1; i <= games; i++) s = finishGame(s, s.courts[0].id, { ...ctx, now: created + i * 12 * MIN });
  return { ...s, name: 'Saturday open play', ...over };
}

/** Saturday 7 Nov 2026, 10:00: the session began; it is 11:12 now. */
const STARTED = new Date(2026, 10, 7, 10).getTime();

describe('HomeScreen while a session runs', () => {
  beforeEach(() => {
    vi.setSystemTime(STARTED + 72 * MIN);
    useSessionStore.setState({ session: running(STARTED, 2, { venue: 'Park', plannedEndAt: timestampAt(12 * 60, STARTED) }) });
  });

  it('hides the chips', () => {
    setup();
    expect(screen.queryByRole('radiogroup')).not.toBeInTheDocument();
    expect(screen.queryByRole('radio')).not.toBeInTheDocument();
  });

  it('shows the live hero: elapsed time, weekday, venue, end and the counts', () => {
    setup();
    expect(pill()).toBe('Live · 1h 12m');
    expect(screen.getByRole('heading', { level: 1, name: 'Saturday' })).toBeInTheDocument();
    expect(screen.getByText('Park · Ends 12:00 pm')).toBeInTheDocument();
    expect(screen.getByText('2 games')).toBeInTheDocument();
    expect(screen.getByText('6 players')).toBeInTheDocument();
    expect(screen.getByText('2 waiting')).toBeInTheDocument();
  });

  it('names the weekday the session began on, not today', () => {
    vi.setSystemTime(new Date(2026, 10, 8, 0, 30)); // Sunday, after midnight
    setup();
    expect(screen.getByRole('heading', { level: 1, name: 'Saturday' })).toBeInTheDocument();
  });

  it('names the slot weekday when the Tuesday slot was started on a Sunday', () => {
    const sunday = new Date(2026, 10, 8, 10).getTime();
    vi.setSystemTime(sunday + 72 * MIN);
    useSessionStore.setState({ session: running(sunday, 2, { name: 'Tuesday open play', weekday: 2 }) });
    setup();
    expect(screen.getByRole('heading', { level: 1, name: 'Tuesday' })).toBeInTheDocument();
  });

  it('still names the createdAt weekday for a saved session with no weekday', () => {
    const sunday = new Date(2026, 10, 8, 10).getTime();
    vi.setSystemTime(sunday + 72 * MIN);
    useSessionStore.setState({ session: running(sunday, 2) });
    setup();
    expect(screen.getByRole('heading', { level: 1, name: 'Sunday' })).toBeInTheDocument();
  });

  it('has no pencil and no dashed chips', () => {
    setup();
    expect(screen.queryByRole('button', { name: /^Edit/ })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^\+ Add/ })).not.toBeInTheDocument();
  });

  it('leaves out what is not set', () => {
    useSessionStore.setState({ session: running(STARTED, 1) });
    setup();
    expect(screen.queryByText(/Ends/)).not.toBeInTheDocument();
    expect(screen.getByText('1 game')).toBeInTheDocument();
    cleanup();
    useSessionStore.setState({ session: running(STARTED, 1, { venue: 'Park' }) });
    setup();
    expect(screen.getByText('Park')).toBeInTheDocument();
    expect(screen.queryByText(/Ends/)).not.toBeInTheDocument();
  });

  it('does not count players who left, and counts a player on a break as not waiting', () => {
    const s = running(STARTED, 2);
    useSessionStore.setState({
      session: { ...s, players: s.players.map((p) => (p.name === 'Fay' ? { ...p, status: 'left' as const } : p.name === 'Eve' ? { ...p, status: 'break' as const } : p)) },
    });
    setup();
    expect(screen.getByText('5 players')).toBeInTheDocument();
    expect(screen.getByText('1 waiting')).toBeInTheDocument();
  });

  it('shows 45m under an hour', () => {
    vi.setSystemTime(STARTED + 45 * MIN);
    setup();
    expect(pill()).toBe('Live · 45m');
  });

  it('refreshes the elapsed time every minute', () => {
    setup();
    expect(pill()).toBe('Live · 1h 12m');
    act(() => vi.advanceTimersByTime(30_000));
    expect(pill()).toBe('Live · 1h 12m');
    act(() => vi.advanceTimersByTime(30_000));
    expect(pill()).toBe('Live · 1h 13m');
    act(() => vi.advanceTimersByTime(10 * MIN));
    expect(pill()).toBe('Live · 1h 23m');
  });

  it('stops the timer when the screen goes away', () => {
    const before = vi.getTimerCount();
    setup();
    expect(vi.getTimerCount()).toBeGreaterThan(before);
    cleanup();
    expect(vi.getTimerCount()).toBe(before);
  });

  it('turns the Start bar into Back to session, which resumes', async () => {
    const { user, onResume, onStart } = setup();
    const button = screen.getByRole('button', { name: 'Back to session' });
    expect(button).toHaveAttribute('data-grade', 'primary');
    await user.click(button);
    expect(onResume).toHaveBeenCalledTimes(1);
    expect(onStart).not.toHaveBeenCalled();
    expect(screen.queryByRole('button', { name: /^Start/ })).not.toBeInTheDocument();
  });

  it('ignores a finished session that is still in history', () => {
    useHistoryStore.setState({ entries: [doneEntry(new Date(2026, 10, 7, 8), new Date(2026, 10, 7, 9))] });
    setup();
    expect(pill()).toBe('Live · 1h 12m');
    expect(screen.queryByRole('button', { name: 'Share as picture' })).not.toBeInTheDocument();
    expect(screen.queryByText('Good session, Saturday')).not.toBeInTheDocument();
    // View summary belongs to the done card only.
    expect(screen.queryByRole('button', { name: 'View summary' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^Last:/ })).not.toBeInTheDocument();
  });

  it('is not live for a session that has ended', () => {
    useSessionStore.setState({ session: { ...running(STARTED), endedAt: STARTED + HOUR } });
    setup();
    expect(screen.queryByText(/^Live/)).not.toBeInTheDocument();
    expect(screen.getByRole('radiogroup', { name: 'Sessions' })).toBeInTheDocument();
  });
});

function doneEntry(created: Date, ended: Date, venue?: string, id = 'done1'): HistoryEntry {
  const ctx = makeCtx(1, created.getTime());
  let s = newTestSession(['Ann', 'Ben', 'Cy', 'Dee', 'Eve', 'Fay'], { courts: 1 }, ctx);
  for (let i = 1; i <= 3; i++) s = finishGame(s, s.courts[0].id, { ...ctx, now: created.getTime() + i * 12 * MIN });
  s = { ...s, id, name: 'Open play', createdAt: created.getTime(), endedAt: ended.getTime(), ...(venue ? { venue } : {}) };
  return { id, name: s.name, createdAt: s.createdAt, endedAt: ended.getTime(), games: 3, session: s };
}

describe('HomeScreen after a session', () => {
  // Tuesday 10 Nov 2026, 19:00 to 21:30.
  const created = new Date(2026, 10, 10, 19);
  const ended = new Date(2026, 10, 10, 21, 30);

  beforeEach(() => {
    vi.setSystemTime(new Date(2026, 10, 10, 22));
    useHistoryStore.setState({ entries: [doneEntry(created, ended, 'Park')] });
  });

  it('shows the done card on the slot the session was played on', () => {
    setup();
    expect(chip('Tue 10')).toHaveAttribute('aria-checked', 'true');
    expect(pill()).toBe('Done tonight');
    expect(screen.getByRole('heading', { level: 1, name: 'Good session, Tuesday' })).toBeInTheDocument();
    expect(screen.getByText('Park · 7:00 to 9:30 pm')).toBeInTheDocument();
  });

  it('shows the games, players and duration', () => {
    setup();
    const stats = document.querySelector('.home-stats') as HTMLElement;
    const stat = (label: string) => within(stats).getByText(label).parentElement!.textContent;
    expect(stat('Games')).toBe('Games3');
    expect(stat('Players')).toBe('Players6');
    expect(stat('Duration')).toBe('Duration2h 30m');
  });

  it('leaves the venue out when there was none, and says Done yesterday after midnight', () => {
    useHistoryStore.setState({ entries: [doneEntry(created, ended)] });
    vi.setSystemTime(new Date(2026, 10, 11, 0, 30));
    setup();
    expect(screen.getByText('7:00 to 9:30 pm')).toBeInTheDocument();
    expect(pill()).toBe('Done yesterday');
  });

  it('has a lime check, no pencil and no lime hero', () => {
    setup();
    expect(document.querySelector('.home-check')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^Edit/ })).not.toBeInTheDocument();
    expect(document.querySelector('.home-hero-done')).toBeInTheDocument();
  });

  it('opens on the done slot even when the next slot is another day', () => {
    vi.setSystemTime(new Date(2026, 10, 11, 0, 30)); // Wednesday: the next slot is Thursday
    setup();
    expect(chip('Tue 17')).toHaveAttribute('aria-checked', 'true');
    expect(chip('Thu 12')).toHaveAttribute('aria-checked', 'false');
    expect(screen.getByRole('heading', { level: 1, name: 'Good session, Tuesday' })).toBeInTheDocument();
  });

  describe('for a Thursday slot that was started on a Sunday', () => {
    const sundayStart = new Date(2026, 10, 8, 19);
    const sundayEnd = new Date(2026, 10, 8, 21, 30);
    const thursdayEntry = (weekday?: number) => {
      const e = doneEntry(sundayStart, sundayEnd, 'Park');
      return { ...e, session: { ...e.session, ...(weekday === undefined ? {} : { weekday }) } };
    };
    beforeEach(() => vi.setSystemTime(new Date(2026, 10, 8, 22))); // Sunday: the next slot is Tuesday

    it('opens on the Thursday chip', () => {
      useHistoryStore.setState({ entries: [thursdayEntry(4)] });
      setup();
      expect(chip('Thu 12')).toHaveAttribute('aria-checked', 'true');
      expect(chip('Tue 10')).toHaveAttribute('aria-checked', 'false');
    });

    it('says Thursday on the done card', () => {
      useHistoryStore.setState({ entries: [thursdayEntry(4)] });
      setup();
      expect(screen.getByRole('heading', { level: 1, name: 'Good session, Thursday' })).toBeInTheDocument();
    });

    it('falls back to the createdAt weekday when the session has none', () => {
      useHistoryStore.setState({ entries: [thursdayEntry()] });
      setup();
      expect(screen.getByRole('heading', { level: 1, name: 'Tuesday' })).toBeInTheDocument();
      expect(chip('Tue 10')).toHaveAttribute('aria-checked', 'true');
    });
  });

  it('turns the bar into Share as picture and the slim row into View summary', async () => {
    const { user, onViewSummary, onHistory } = setup();
    expect(screen.queryByRole('button', { name: /^Start session/ })).not.toBeInTheDocument();
    expect(screen.queryByText(/^Last:/)).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Share as picture' })).toHaveAttribute('data-grade', 'primary');
    await user.click(screen.getByRole('button', { name: 'View summary' }));
    expect(onViewSummary).toHaveBeenCalledTimes(1);
    expect(onViewSummary).toHaveBeenCalledWith('done1');
    expect(onHistory).not.toHaveBeenCalled();
  });

  it('opens the summary of the latest session when there are several', async () => {
    const older = doneEntry(new Date(2026, 10, 10, 9), new Date(2026, 10, 10, 10), undefined, 'older');
    useHistoryStore.setState({ entries: [older, doneEntry(created, ended, 'Park')] });
    const { user, onViewSummary } = setup();
    await user.click(screen.getByRole('button', { name: 'View summary' }));
    expect(onViewSummary).toHaveBeenCalledWith('done1');
  });

  it('shares the picture of that session, with results off and the page theme', async () => {
    document.documentElement.dataset.theme = 'dark';
    try {
      const { user } = setup();
      await user.click(screen.getByRole('button', { name: 'Share as picture' }));
      expect(share.sharePictureFor).toHaveBeenCalledTimes(1);
      expect(share.sharePictureFor).toHaveBeenCalledWith(useHistoryStore.getState().entries[0].session, { results: false, theme: 'dark' });
    } finally {
      delete document.documentElement.dataset.theme;
    }
  });

  it('says so when the picture was saved to the device', async () => {
    share.sharePictureFor.mockResolvedValue('saved');
    const { user } = setup();
    await user.click(screen.getByRole('button', { name: 'Share as picture' }));
    expect(await screen.findByRole('status')).toHaveTextContent('Picture saved to this device.');
  });

  it('says nothing after the share sheet was used or closed', async () => {
    const { user } = setup();
    await user.click(screen.getByRole('button', { name: 'Share as picture' }));
    await waitFor(() => expect(share.sharePictureFor).toHaveBeenCalled());
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
    share.sharePictureFor.mockResolvedValue('cancelled');
    await user.click(screen.getByRole('button', { name: 'Share as picture' }));
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
  });

  it('says when the picture could not be made, and clears the message on the next try', async () => {
    share.sharePictureFor.mockRejectedValueOnce(new Error('no canvas'));
    const { user } = setup();
    await user.click(screen.getByRole('button', { name: 'Share as picture' }));
    expect(await screen.findByRole('status')).toHaveTextContent('Could not make the picture.');
    share.sharePictureFor.mockResolvedValue('shared');
    await user.click(screen.getByRole('button', { name: 'Share as picture' }));
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
  });

  it('shows Making picture and blocks a second tap while it works', async () => {
    let finish: (v: string) => void = () => {};
    share.sharePictureFor.mockReturnValue(new Promise((r) => (finish = r)));
    const { user } = setup();
    await user.click(screen.getByRole('button', { name: 'Share as picture' }));
    const busy = screen.getByRole('button', { name: /making picture/i });
    expect(busy).toBeDisabled();
    await act(async () => finish('shared'));
    expect(screen.getByRole('button', { name: 'Share as picture' })).toBeEnabled();
  });

  it('shows a normal hero on the other chips, and the done card again on the done chip', async () => {
    const { user, onStart } = setup();
    await user.click(chip('Thu 12'));
    expect(screen.getByRole('heading', { level: 1, name: 'Thursday' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Share as picture' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^Last:/ })).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Start session, Thursday' }));
    expect(onStart).toHaveBeenCalledWith({ slotId: 'thu', weekday: 4 });
    await user.click(chip('One-off session'));
    expect(screen.getByRole('heading', { level: 1, name: 'One-off session' })).toBeInTheDocument();
    await user.click(chip('Tue 10'));
    expect(screen.getByRole('heading', { level: 1, name: 'Good session, Tuesday' })).toBeInTheDocument();
  });

  it('shows the done card for a session that ended 23h59m ago, and not at 24h01m', () => {
    vi.setSystemTime(ended.getTime() + 24 * HOUR - MIN);
    setup();
    expect(screen.getByRole('heading', { level: 1, name: /^Good session/ })).toBeInTheDocument();
    cleanup();
    vi.setSystemTime(ended.getTime() + 24 * HOUR + MIN);
    setup();
    expect(screen.queryByRole('heading', { name: /^Good session/ })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Share as picture' })).not.toBeInTheDocument();
    // The next slot is Thursday, so the screen falls back to it.
    expect(screen.getByRole('heading', { level: 1, name: 'Thursday' })).toBeInTheDocument();
  });

  it('shows no done card for a session that ended 25 hours ago', () => {
    vi.setSystemTime(ended.getTime() + 25 * HOUR);
    setup();
    expect(screen.queryByRole('button', { name: 'View summary' })).not.toBeInTheDocument();
  });

  it('shows no done card when no slot falls on the weekday of the session', () => {
    slots([{ id: 'thu', weekday: 4 }]);
    setup();
    expect(screen.queryByRole('button', { name: 'Share as picture' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'View summary' })).not.toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 1, name: 'Thursday' })).toBeInTheDocument();
  });

  it('keeps the normal Start bar on a quiet Home with no recent session', () => {
    useHistoryStore.setState({ entries: [] });
    setup();
    expect(screen.getByRole('button', { name: 'Start session, Tuesday' })).toBeInTheDocument();
  });
});
