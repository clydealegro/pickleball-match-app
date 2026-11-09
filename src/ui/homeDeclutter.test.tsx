import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkPlayer, mkSession } from '../engine/fixtures';
import type { FinishedGame } from '../engine/types';
import type { HistoryEntry } from '../store/historyDb';
import { useHistoryStore } from '../store/historyStore';
import { useRosterStore } from '../store/rosterStore';
import { useSessionStore } from '../store/sessionStore';
import { DEFAULT_SLOTS, useSlotsStore } from '../store/slots';
import { resetAttendanceDeps, setAttendanceDeps, useAttendanceStore } from '../sync/attendance/store';
import { useAuthStore } from '../sync/auth';
import { useSyncStore } from '../sync/syncStore';
import { HomeScreen } from './HomeScreen';

// jsdom has no PointerEvent, so give it one that carries the pointer's position.
class TestPointerEvent extends MouseEvent {
  pointerId: number;
  pointerType: string;
  constructor(type: string, init: PointerEventInit = {}) {
    super(type, init);
    this.pointerId = init.pointerId ?? 1;
    this.pointerType = init.pointerType ?? 'touch';
  }
}
Object.defineProperty(window, 'PointerEvent', { value: TestPointerEvent, configurable: true, writable: true });

// Saturday 7 Nov 2026, noon. Chips: Sat 7, Tue 10, Thu 12. The Saturday before is 31 Oct.
const NOW = new Date(2026, 10, 7, 12).getTime();
const SAT_31 = new Date(2026, 9, 31, 9).getTime();

const game = (team1: [string, string], team2: [string, string], at: number, winner: 1 | 2): FinishedGame => ({
  team1,
  team2,
  courtNumber: 1,
  startedAt: at,
  finishedAt: at + 600_000,
  winner,
});

function lastSaturday(): HistoryEntry {
  const session = mkSession(
    [mkPlayer('Ann', { name: 'Ann', gamesPlayed: 4 }), mkPlayer('Ben', { name: 'Ben', gamesPlayed: 3 }), mkPlayer('Cy', { name: 'Cy', gamesPlayed: 3 }), mkPlayer('Dee', { name: 'Dee', gamesPlayed: 2 })],
    {
      createdAt: SAT_31,
      history: [
        game(['Ann', 'Ben'], ['Cy', 'Dee'], 0, 1),
        game(['Ann', 'Cy'], ['Ben', 'Dee'], 1, 1),
        game(['Ann', 'Ben'], ['Cy', 'Dee'], 2, 1),
        game(['Ann', 'Cy'], ['Ben', 'Dee'], 3, 1),
      ],
    },
  );
  return { id: 'sat31', name: 'Open play', createdAt: SAT_31, endedAt: SAT_31 + 3_600_000, games: 4, session };
}

beforeEach(() => {
  localStorage.clear();
  useAuthStore.setState({ status: 'unconfigured', email: null, userId: null, error: null, busy: false });
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
  delete (navigator as unknown as Record<string, unknown>).share;
});

function setup(onSignIn = vi.fn()) {
  const user = userEvent.setup({ advanceTimers: () => {} });
  render(<HomeScreen onStart={vi.fn()} onResume={vi.fn()} onHistory={vi.fn()} onViewSummary={vi.fn()} onSignIn={onSignIn} />);
  return { user, onSignIn };
}

const swipe = (from: number, to: number) => {
  const el = document.querySelector('.home-swipe') as HTMLElement;
  fireEvent.pointerDown(el, { clientX: from, clientY: 100, pointerId: 1 });
  fireEvent.pointerMove(el, { clientX: to, clientY: 104, pointerId: 1 });
  fireEvent.pointerUp(el, { clientX: to, clientY: 104, pointerId: 1 });
};
const checked = () => screen.getByRole('radio', { checked: true }).textContent;

describe('last session stats on Home', () => {
  it('shows who played, won and lost most the last time this weekday was played', () => {
    useHistoryStore.setState({ entries: [lastSaturday()] });
    setup();
    const card = screen.getByRole('region', { name: 'Last session' });
    expect(within(card).getByText('Last Saturday · 31 Oct')).toBeInTheDocument();
    expect(within(card).getByText('4 games')).toBeInTheDocument();
    expect(within(card).getAllByRole('term').map((t) => t.textContent)).toEqual(['Most played', 'Most wins', 'Most losses']);
    expect(card.querySelector('.home-last-stat b')?.textContent).toBe('4');
  });

  it('is not there without an earlier session on that weekday', () => {
    setup();
    expect(screen.queryByRole('region', { name: 'Last session' })).not.toBeInTheDocument();
  });

  it('follows the selected weekday', async () => {
    useHistoryStore.setState({ entries: [lastSaturday()] });
    const { user } = setup();
    await user.click(screen.getByRole('radio', { name: 'Tue 10' }));
    expect(screen.queryByRole('region', { name: 'Last session' })).not.toBeInTheDocument();
  });
});

describe('swiping between sessions', () => {
  it('moves to the next chip on a left swipe and back on a right swipe', () => {
    setup();
    expect(checked()).toBe('Sat 7');
    swipe(300, 150);
    expect(checked()).toBe('Tue 10');
    swipe(300, 150);
    expect(checked()).toBe('Thu 12');
    swipe(150, 300);
    expect(checked()).toBe('Tue 10');
  });

  it('reaches the one-off last and stops at both ends', () => {
    setup();
    swipe(150, 300);
    expect(checked()).toBe('Sat 7');
    for (let i = 0; i < 6; i += 1) swipe(300, 150);
    expect(screen.getByRole('radio', { name: 'One-off session', checked: true })).toBeInTheDocument();
  });

  it('ignores a short drag and a mostly vertical one', () => {
    setup();
    swipe(300, 270);
    expect(checked()).toBe('Sat 7');
    const el = document.querySelector('.home-swipe') as HTMLElement;
    fireEvent.pointerDown(el, { clientX: 200, clientY: 100, pointerId: 1 });
    fireEvent.pointerMove(el, { clientX: 120, clientY: 400, pointerId: 1 });
    fireEvent.pointerUp(el, { clientX: 120, clientY: 400, pointerId: 1 });
    expect(checked()).toBe('Sat 7');
  });

  it('shows one dot per session and the one-off, with the current one marked', () => {
    setup();
    const dots = document.querySelectorAll('.home-dots i');
    expect(dots).toHaveLength(4);
    expect(dots[0]).toHaveClass('on');
    swipe(300, 150);
    expect(document.querySelectorAll('.home-dots i')[1]).toHaveClass('on');
  });

  it('is not swipeable while a session runs or on the done card', () => {
    useSessionStore.setState({ session: { ...mkSession([mkPlayer('A'), mkPlayer('B'), mkPlayer('C'), mkPlayer('D')], { createdAt: NOW - 1_800_000 }) } });
    setup();
    expect(document.querySelector('.home-swipe')).toBeNull();
    expect(document.querySelector('.home-dots')).toBeNull();
  });
});

describe('the venue drawer', () => {
  it('lists saved places newest first and picks one for every week', async () => {
    useSlotsStore.setState({ venues: ['Gym', 'Park'] });
    const { user } = setup();
    await user.click(screen.getByRole('button', { name: '+ Add a venue' }));
    const rows = within(screen.getByRole('radiogroup', { name: 'Saved places' })).getAllByRole('radio');
    expect(rows.map((r) => r.textContent)).toEqual(['Park', 'Gym']);
    await user.click(rows[1]);
    await user.click(screen.getByRole('button', { name: 'Save' }));
    expect(useSlotsStore.getState().slots.find((s) => s.id === 'sat')?.venue).toBe('Gym');
    expect(screen.getByText('Gym')).toBeInTheDocument();
  });

  it('saves a new location and uses it', async () => {
    const { user } = setup();
    await user.click(screen.getByRole('button', { name: '+ Add a venue' }));
    expect(screen.getByRole('button', { name: 'Save' })).toBeDisabled();
    await user.type(screen.getByLabelText('New location'), 'Palo Court');
    await user.click(screen.getByRole('button', { name: 'Save and use' }));
    expect(useSlotsStore.getState().venues).toEqual(['Palo Court']);
    expect(useSlotsStore.getState().slots.find((s) => s.id === 'sat')?.venue).toBe('Palo Court');
  });

  it('can apply just this time, which leaves the saved slot alone', async () => {
    useSlotsStore.setState({ venues: ['Gym'] });
    const { user } = setup();
    await user.click(screen.getByRole('button', { name: '+ Add a venue' }));
    await user.click(screen.getByRole('radio', { name: 'Gym' }));
    await user.click(screen.getByRole('radio', { name: 'Just this time' }));
    await user.click(screen.getByRole('button', { name: 'Save' }));
    expect(useSlotsStore.getState().slots.find((s) => s.id === 'sat')?.venue).toBeUndefined();
    expect(useSlotsStore.getState().tonight.sat).toEqual({ venue: 'Gym' });
  });

  it('keeps a this-time-only time when only the venue is saved for every week', async () => {
    useSlotsStore.setState({ venues: ['Gym'], tonight: { sat: { startMin: 600 } } });
    const { user } = setup();
    await user.click(screen.getByRole('button', { name: '+ Add a venue' }));
    await user.click(screen.getByRole('radio', { name: 'Gym' }));
    await user.click(screen.getByRole('button', { name: 'Save' }));
    expect(useSlotsStore.getState().tonight.sat).toEqual({ startMin: 600 });
  });

  it('shows a search box only once there are more than six places', async () => {
    useSlotsStore.setState({ venues: ['A', 'B', 'C', 'D', 'E', 'F'] });
    const first = setup();
    await first.user.click(screen.getByRole('button', { name: '+ Add a venue' }));
    expect(screen.queryByLabelText('Search places')).not.toBeInTheDocument();
    cleanup();
    useSlotsStore.setState({ venues: ['A', 'B', 'C', 'D', 'E', 'F', 'G'] });
    const second = setup();
    await second.user.click(screen.getByRole('button', { name: '+ Add a venue' }));
    await second.user.type(screen.getByLabelText('Search places'), 'g');
    expect(within(screen.getByRole('radiogroup', { name: 'Saved places' })).getAllByRole('radio').map((r) => r.textContent)).toEqual(['G']);
  });

  it('clears the venue when the chosen place is tapped again', async () => {
    useSlotsStore.setState({ venues: ['Gym'], slots: [{ id: 'sat', weekday: 6, venue: 'Gym' }] });
    const { user } = setup();
    await user.click(screen.getByText('Gym'));
    await user.click(screen.getByRole('radio', { name: 'Gym' }));
    await user.click(screen.getByRole('button', { name: 'Save' }));
    expect(useSlotsStore.getState().slots.find((s) => s.id === 'sat')?.venue).toBeUndefined();
  });
});

describe('who is in, and the Share button', () => {
  const seedLink = () => {
    useAuthStore.setState({ status: 'signedIn', email: 'o@example.com', userId: 'user-a', error: null, busy: false });
    useAttendanceStore.setState({
      ownerId: 'user-a',
      links: { sat: { code: 'code-sat' } },
      summaries: {
        sat: {
          slotId: 'sat',
          code: 'code-sat',
          playDate: '2026-11-07',
          cancelled: null,
          counts: { in: 2, maybe: 1, out: 0, late: 0 },
          friends: 0,
          waiting: [],
          tonight: [],
          lateIds: [],
          answers: { a: 'in', b: 'in', c: 'maybe' },
          names: { a: 'Ana', b: 'Ben', c: 'Cy' },
          fetchedAt: NOW,
        },
      },
      lastChange: {},
      lastError: { sat: null },
      busy: {},
    });
  };

  it('shows the answers as plain text with a face for each player who is in', () => {
    seedLink();
    setup();
    const row = screen.getByRole('button', { name: 'Attendance: 2 in · 1 maybe' });
    expect(row.querySelectorAll('.avatar')).toHaveLength(2);
  });

  it('says Nobody yet when there are no answers', () => {
    seedLink();
    useAttendanceStore.setState({ summaries: { sat: { ...useAttendanceStore.getState().summaries.sat, counts: { in: 0, maybe: 0, out: 0, late: 0 }, answers: {} } } });
    setup();
    expect(screen.getByRole('button', { name: 'Attendance: Nobody yet' })).toBeInTheDocument();
  });

  it('shares the link from the hero with the phone’s share menu', async () => {
    seedLink();
    const share = vi.fn(async () => {});
    Object.defineProperty(navigator, 'share', { value: share, configurable: true, writable: true });
    const { user } = setup();
    await user.click(screen.getByRole('button', { name: 'Share link' }));
    expect(share).toHaveBeenCalledWith({ title: expect.any(String), url: `${window.location.origin}/#/j/code-sat` });
  });

  it('copies the link and says so when there is no share menu', async () => {
    seedLink();
    const { user } = setup();
    // user-event installs its own clipboard when it is set up, so the stub goes in after it.
    const writeText = vi.fn(async () => {});
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true, writable: true });
    await user.click(screen.getByRole('button', { name: 'Share link' }));
    expect(writeText).toHaveBeenCalledWith(`${window.location.origin}/#/j/code-sat`);
    expect(await screen.findByRole('button', { name: 'Link copied' })).toBeInTheDocument();
  });

  it('shows the regulars in the hero when attendance is not set up', () => {
    useHistoryStore.setState({ entries: [lastSaturday()] });
    setup();
    expect(screen.queryByRole('button', { name: 'Share link' })).not.toBeInTheDocument();
  });

  it('says Cancelled this week and hides Share for a cancelled week', () => {
    seedLink();
    useAttendanceStore.setState({ summaries: { sat: { ...useAttendanceStore.getState().summaries.sat, cancelled: { reason: null } } } });
    setup();
    expect(screen.getByRole('button', { name: 'Attendance: Cancelled this week' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Share link' })).not.toBeInTheDocument();
  });
});
