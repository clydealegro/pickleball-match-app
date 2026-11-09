import { act, cleanup, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { LiveBoard } from '../sync/live/board';
import { LiveBoardView, LivePaused, STALE_AFTER_S, agoText } from './LiveBoardView';

const NOW = new Date(2026, 10, 10, 17, 0, 0).getTime();
const BOARD: LiveBoard = {
  title: 'Tuesday open play',
  venue: 'Nitro Pickleyard',
  startMin: 960,
  endMin: 1140,
  courts: [
    { n: 1, status: 'playing', closing: false, startedAt: NOW - 9 * 60_000, teams: [['a', 'b'], ['c', 'd']] },
    { n: 2, status: 'ready', closing: false, teams: [['e', 'f'], ['g', 'h']] },
    { n: 3, status: 'empty', closing: false },
  ],
  players: {
    a: { f: 'Ana', l: 'R', r: 'r-a' },
    b: { f: 'Ben', l: 'C', r: null },
    c: { f: 'Ben', l: 'D', r: null },
    d: { f: 'Dee', l: null, r: null },
    e: { f: 'Eli', l: null, r: null },
    f: { f: 'Fay', l: null, r: null },
    g: { f: 'Gio', l: null, r: null },
    h: { f: 'Hana', l: null, r: null },
    i: { f: 'Ivy', l: null, r: null },
    j: { f: 'Jo', l: null, r: null },
    k: { f: 'Kai', l: null, r: null },
    l: { f: 'Lu', l: null, r: null },
    m: { f: 'Mo', l: null, r: null },
  },
  waiting: ['i', 'j', 'k', 'l', 'm'],
  onBreak: ['f'],
  next: { court: 3, ids: ['i', 'j', 'k', 'l'] },
};

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(NOW);
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

const show = (over: Partial<Parameters<typeof LiveBoardView>[0]> = {}) =>
  render(<LiveBoardView board={BOARD} faces={{}} ageS={4} fetchedAt={NOW} failed={false} {...over} />);

describe('LiveBoardView', () => {
  it('shows the title, the place and the time, and that it is live', () => {
    show();
    expect(screen.getByRole('heading', { level: 1, name: 'Tuesday open play' })).toBeInTheDocument();
    expect(screen.getByText('Nitro Pickleyard · 4 to 7 pm')).toBeInTheDocument();
    expect(screen.getByText('Live')).toBeInTheDocument();
  });

  it('shows each court with who is on it and how long the game has run', () => {
    show();
    const courts = screen.getAllByRole('listitem').filter((li) => li.classList.contains('live-court'));
    expect(courts).toHaveLength(3);
    expect(within(courts[0]).getByText('Court 1')).toBeInTheDocument();
    expect(within(courts[0]).getByText('9 min in')).toBeInTheDocument();
    expect(within(courts[0]).getByText('Ana')).toBeInTheDocument();
    expect(within(courts[1]).getByText('Up next, starting soon')).toBeInTheDocument();
    expect(within(courts[2]).getByText('Free')).toBeInTheDocument();
    expect(within(courts[2]).getByText('Nobody on this court.')).toBeInTheDocument();
  });

  it('adds a last initial only where two players share a first name', () => {
    show();
    expect(screen.getByText('Ben C.')).toBeInTheDocument();
    expect(screen.getByText('Ben D.')).toBeInTheDocument();
    expect(screen.getByText('Ana')).toBeInTheDocument();
  });

  it('numbers the waiting players, marks the likely next four, and says on which court', () => {
    show();
    expect(screen.getByRole('heading', { name: 'Waiting · likely next on Court 3' })).toBeInTheDocument();
    const rows = [...document.querySelectorAll('.live-queue-row')];
    expect(rows.map((r) => [r.querySelector('.live-pos')?.textContent, r.querySelector('.live-name')?.textContent, !!r.querySelector('.live-next')])).toEqual([
      ['1', 'Ivy', true],
      ['2', 'Jo', true],
      ['3', 'Kai', true],
      ['4', 'Lu', true],
      ['5', 'Mo', false],
    ]);
  });

  it('lists players on a break, and says when nobody is waiting', () => {
    show();
    const heading = screen.getByRole('heading', { name: 'On a break' });
    expect(heading.nextElementSibling?.querySelector('.live-name')?.textContent).toBe('Fay');
    cleanup();
    show({ board: { ...BOARD, waiting: [], onBreak: [], next: undefined } });
    expect(screen.getByRole('heading', { name: 'Waiting' })).toBeInTheDocument();
    expect(screen.getByText('Nobody is waiting.')).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'On a break' })).not.toBeInTheDocument();
  });

  it('shows a face where there is one and initials where there is not', () => {
    show({ faces: { 'r-a': 'data:image/jpeg;base64,AAAA' } });
    const imgs = document.querySelectorAll('img.live-face');
    expect(imgs).toHaveLength(1);
    expect(imgs[0]).toHaveAttribute('src', 'data:image/jpeg;base64,AAAA');
    expect(document.querySelectorAll('.member-tile').length).toBeGreaterThan(5);
  });

  it('says how long ago it was updated, and keeps counting', () => {
    show({ ageS: 4 });
    expect(screen.getByText('Updated just now')).toBeInTheDocument();
    act(() => {
      vi.advanceTimersByTime(60_000);
    });
    expect(screen.getByText(/^Updated 1 min ago$/)).toBeInTheDocument();
  });

  it('warns that the organizer may have lost signal after two minutes without an update', () => {
    show({ ageS: STALE_AFTER_S + 5 });
    expect(screen.getByText('Waiting for update')).toBeInTheDocument();
    expect(screen.getByRole('status')).toHaveTextContent('No update for 2 min. The organizer may have lost signal. Showing the last board.');
  });

  it('says the visitor may be offline when asking failed', () => {
    show({ failed: true });
    expect(screen.getByRole('status')).toHaveTextContent('You seem to be offline. Showing the last board.');
  });

  it('draws nothing it was not given: no ratings, no scores', () => {
    show();
    expect(document.body.textContent).not.toMatch(/rating|score|won|lost/i);
  });
});

describe('agoText', () => {
  it('reads naturally', () => {
    expect(agoText(3)).toBe('just now');
    expect(agoText(26)).toBe('20 seconds ago');
    expect(agoText(95)).toBe('1 min ago');
    expect(agoText(400)).toBe('6 min ago');
  });
});

describe('LivePaused', () => {
  it('says the organizer paused it and that it will come back', () => {
    render(<LivePaused />);
    expect(screen.getByRole('status')).toHaveTextContent('The organizer paused the live board. It will come back by itself.');
  });
});
