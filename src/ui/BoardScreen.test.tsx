import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as engine from '../engine';
import type { Court, FinishedGame, Player, Session } from '../engine';
import { mkPlayer, mkSession } from '../engine/testing';
import { resetRosterDbForTests } from '../store/rosterDb';
import { useRosterStore } from '../store/rosterStore';
import { nameHue } from '../store/boardInfo';
import css from '../styles/app.css?raw';
import { BoardScreen } from './BoardScreen';

const SEC = 1000;
const MIN = 60 * SEC;
// 7:42 pm local, on the minute, so the minute timer fires at 7:43.
const NOW = new Date(2026, 10, 7, 19, 42).getTime();

const NAMES = ['Ana Reyes', 'Ben Cruz', 'Carlo Diaz', 'Dee Lim', 'Eli Tan', 'Fay Ong', 'Gus Sy', 'Hera Go', 'Ian Ko', 'Jo Ba', 'Kai Lu', 'Lee Wu', 'Mia Pe', 'Noa Ri'];

beforeEach(async () => {
  vi.useFakeTimers({ toFake: ['Date', 'setInterval', 'clearInterval'] });
  vi.setSystemTime(NOW);
  await resetRosterDbForTests();
  useRosterStore.setState({ players: [], loaded: false, persistent: true });
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

function court(number: number, over: Partial<Court> = {}): Court {
  return { id: `c${number}`, number, status: 'empty', closing: false, ...over };
}

const playing = (number: number, ids: string[], startedAt: number, over: Partial<Court> = {}): Court =>
  court(number, { status: 'playing', game: { team1: [ids[0], ids[1]], team2: [ids[2], ids[3]], startedAt }, ...over });

const ready = (number: number, ids: string[], over: Partial<Court> = {}): Court =>
  court(number, { status: 'ready', lineup: { team1: [ids[0], ids[1]], team2: [ids[2], ids[3]] }, ...over });

/** A queue-mode session of the first `count` names (ids p1, p2, ...), the queue running in reverse. */
function build(courts: Court[], over: Partial<Session> = {}, count = NAMES.length, patch: Partial<Player>[] = []): Session {
  const players = NAMES.slice(0, count).map((name, i) => mkPlayer(`p${i + 1}`, { name, ...patch[i] }));
  return mkSession(players, {
    name: 'Tuesday open play',
    mode: 'queue',
    courts,
    queueOrder: players.map((p) => p.id).reverse(),
    createdAt: NOW - 60 * MIN,
    ...over,
  });
}

const view = (s: Session, onClose = vi.fn()) => render(<BoardScreen session={s} onClose={onClose} />);
const main = () => screen.getByRole('main', { name: 'Board' });
const courtItems = () => within(screen.getByRole('list', { name: 'Courts' })).getAllByRole('listitem');
const tick = (ms: number) => act(() => void vi.advanceTimersByTime(ms));

describe('the board header', () => {
  it('shows the name, venue, end time, time of day and a Close button', () => {
    view(build([court(1)], { venue: 'Sample Hall', plannedEndAt: new Date(2026, 10, 7, 21).getTime() }));
    expect(screen.getByRole('heading', { name: 'Tuesday open play' })).toBeInTheDocument();
    expect(screen.getByText('Sample Hall')).toBeInTheDocument();
    expect(screen.getByText('Ends 9:00 pm')).toBeInTheDocument();
    expect(screen.getByText('7:42 pm')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Close board' })).toBeInTheDocument();
  });

  it('drops the venue and the end time when they are not set', () => {
    view(build([court(1)]));
    expect(screen.getByRole('heading', { name: 'Tuesday open play' })).toBeInTheDocument();
    expect(screen.queryByText(/Ends/)).not.toBeInTheDocument();
    expect(main().querySelector('.board-venue')).toBeNull();
    expect(main().querySelector('.board-end')).toBeNull();
    expect(screen.getByText('7:42 pm')).toBeInTheDocument();
  });

  it('refreshes the time of day each minute, not before', () => {
    view(build([court(1)]));
    tick(59 * SEC);
    expect(screen.getByText('7:42 pm')).toBeInTheDocument();
    tick(SEC);
    expect(screen.getByText('7:43 pm')).toBeInTheDocument();
    tick(60 * MIN);
    expect(screen.getByText('8:43 pm')).toBeInTheDocument();
  });

  it('uses one one-second interval for the courts and one one-minute interval for the time of day', () => {
    const spy = vi.spyOn(globalThis, 'setInterval');
    view(build([court(1)]));
    expect(spy.mock.calls.map((c) => c[1]).sort((a, b) => Number(a) - Number(b))).toEqual([SEC, MIN]);
    spy.mockRestore();
  });

  it('does not announce the time of day', () => {
    view(build([court(1)]));
    expect(screen.getByText('7:42 pm')).toHaveAttribute('aria-live', 'off');
  });

  it('says how many courts are left off the board when there are more than six', () => {
    view(build(Array.from({ length: 8 }, (_, i) => court(i + 1))));
    expect(screen.getByText('+2 more courts')).toBeInTheDocument();
  });

  it('says "+1 more court" for one hidden court and nothing for six or fewer', () => {
    const { unmount } = view(build(Array.from({ length: 7 }, (_, i) => court(i + 1))));
    expect(screen.getByText('+1 more court')).toBeInTheDocument();
    unmount();
    view(build(Array.from({ length: 6 }, (_, i) => court(i + 1))));
    expect(screen.queryByText(/more court/)).not.toBeInTheDocument();
  });
});

describe('the courts', () => {
  const full = () =>
    build([
      playing(1, ['p1', 'p2', 'p3', 'p4'], NOW - (12 * MIN + 41 * SEC)),
      ready(2, ['p5', 'p6', 'p7', 'p8']),
      court(3),
      playing(4, ['p9', 'p10', 'p11', 'p12'], NOW - 3 * MIN, { closing: true }),
    ]);

  it('is a main landmark called Board with the courts as a list', () => {
    view(full());
    expect(main()).toBeInTheDocument();
    expect(courtItems()).toHaveLength(4);
  });

  it('shows a playing court with its number, a lime clock and both teams', () => {
    view(full());
    const [one] = courtItems();
    expect(one).toHaveClass('board-court-playing');
    expect(within(one).getByText('Court 1')).toBeInTheDocument();
    expect(within(one).getByRole('timer')).toHaveTextContent('12:41');
    expect(within(one).queryByText('Up next')).not.toBeInTheDocument();
    expect(within(one).queryByText('Open')).not.toBeInTheDocument();
    expect(within(one).queryByText('Closing')).not.toBeInTheDocument();
  });

  it('shows a ready court with an Up next tag, no clock, and the lineup', () => {
    view(full());
    const two = courtItems()[1];
    expect(two).toHaveClass('board-court-ready');
    expect(within(two).getByText('Up next')).toBeInTheDocument();
    expect(within(two).queryByRole('timer')).not.toBeInTheDocument();
    expect(within(two).getByText('Eli')).toBeInTheDocument();
    expect(within(two).getByText('Hera')).toBeInTheDocument();
  });

  it('shows an empty court as Open with no avatars and no teams', () => {
    view(full());
    const three = courtItems()[2];
    expect(three).toHaveClass('board-court-open');
    expect(within(three).getByText('Open')).toBeInTheDocument();
    expect(three.querySelector('.avatar')).toBeNull();
    expect(within(three).queryByRole('group')).not.toBeInTheDocument();
    expect(within(three).queryByText('VS')).not.toBeInTheDocument();
    expect(within(three).queryByRole('timer')).not.toBeInTheDocument();
  });

  it('puts a Closing tag next to a playing court that is closing, and only on that court', () => {
    view(full());
    const four = courtItems()[3];
    expect(four).toHaveClass('board-court-playing');
    expect(four).toHaveClass('is-closing');
    expect(within(four).getByText('Closing')).toBeInTheDocument();
    expect(within(four).getByRole('timer')).toHaveTextContent('3:00');
    expect(screen.getAllByText('Closing')).toHaveLength(1);
    expect(courtItems()[0]).not.toHaveClass('is-closing');
  });

  it('can close an open court and a ready court too', () => {
    view(build([court(1, { closing: true }), ready(2, ['p1', 'p2', 'p3', 'p4'], { closing: true })]));
    const [one, two] = courtItems();
    expect(within(one).getByText('Open')).toBeInTheDocument();
    expect(within(one).getByText('Closing')).toBeInTheDocument();
    expect(within(two).getByText('Up next')).toBeInTheDocument();
    expect(within(two).getByText('Closing')).toBeInTheDocument();
  });

  it('lists the courts in court-number order', () => {
    view(build([court(3), court(1), court(2)]));
    expect(courtItems().map((li) => within(li).getByText(/^Court \d$/).textContent)).toEqual(['Court 1', 'Court 2', 'Court 3']);
  });

  it('gives each timer role timer and keeps it from being announced', () => {
    view(full());
    const timers = screen.getAllByRole('timer');
    expect(timers).toHaveLength(2);
    for (const t of timers) expect(t).toHaveAttribute('aria-live', 'off');
  });

  it('ticks every court clock each second and not before', () => {
    view(full());
    tick(999);
    expect(screen.getAllByRole('timer').map((t) => t.textContent)).toEqual(['12:41', '3:00']);
    tick(1);
    expect(screen.getAllByRole('timer').map((t) => t.textContent)).toEqual(['12:42', '3:01']);
    tick(3 * SEC);
    expect(screen.getAllByRole('timer').map((t) => t.textContent)).toEqual(['12:45', '3:04']);
  });

  it('uses one interval for all court clocks, plus one for the time of day, and clears both on unmount', () => {
    const { unmount } = view(full());
    expect(vi.getTimerCount()).toBe(2);
    unmount();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('shows the hours once a game passes an hour', () => {
    view(build([playing(1, ['p1', 'p2', 'p3', 'p4'], NOW - 62 * MIN - 3 * SEC)]));
    expect(screen.getByRole('timer')).toHaveTextContent('1:02:03');
  });
});

describe('the teams', () => {
  const one = () => build([playing(1, ['p1', 'p2', 'p3', 'p4'], NOW - MIN)]);

  it('has two outlined panels with the right players, and a VS between them', () => {
    view(one());
    const li = courtItems()[0];
    const a = within(li).getByRole('group', { name: 'Team A' });
    const b = within(li).getByRole('group', { name: 'Team B' });
    expect(a).not.toBe(b);
    expect(a).toHaveClass('board-team-a');
    expect(b).toHaveClass('board-team-b');
    expect(within(a).getByText('Ana')).toBeInTheDocument();
    expect(within(a).getByText('Ben')).toBeInTheDocument();
    expect(within(a).queryByText('Carlo')).not.toBeInTheDocument();
    expect(within(b).getByText('Carlo')).toBeInTheDocument();
    expect(within(b).getByText('Dee')).toBeInTheDocument();
    const vs = within(li).getByText('VS');
    expect(a.compareDocumentPosition(vs) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(vs.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(within(a).queryByText('VS')).not.toBeInTheDocument();
    expect(within(b).queryByText('VS')).not.toBeInTheDocument();
  });

  it('puts a circle for each player above the first name', () => {
    view(one());
    const li = courtItems()[0];
    expect(li.querySelectorAll('.avatar-fill')).toHaveLength(4);
    expect(within(li).getAllByText(/^(Ana|Ben|Carlo|Dee)$/)).toHaveLength(4);
  });

  it('adds a last initial when two players on the board share a first name', () => {
    const s = build([playing(1, ['p1', 'p2', 'p3', 'p4'], NOW - MIN)], {}, 6, [{}, {}, { name: 'Ana Santos' }]);
    view(s);
    const li = courtItems()[0];
    expect(within(li).getByText('Ana R.')).toBeInTheDocument();
    expect(within(li).getByText('Ana S.')).toBeInTheDocument();
    expect(within(li).getByText('Ben')).toBeInTheDocument();
  });

  it('adds a last initial when the same first name is waiting, not playing', () => {
    // p5 is waiting with the same first name as p1, who is playing.
    const s = build([playing(1, ['p1', 'p2', 'p3', 'p4'], NOW - MIN)], {}, 5, [{}, {}, {}, {}, { name: 'Ana Zed' }]);
    view(s);
    expect(screen.getByText('Ana R.')).toBeInTheDocument();
    expect(screen.getByText('Ana Z.')).toBeInTheDocument();
  });

  it('does not add an initial when the clash is a player who left', () => {
    const s = build([playing(1, ['p1', 'p2', 'p3', 'p4'], NOW - MIN)], {}, 5, [{}, {}, {}, {}, { name: 'Ana Zed', status: 'left' }]);
    view(s);
    expect(screen.getByText('Ana')).toBeInTheDocument();
    expect(screen.queryByText('Ana R.')).not.toBeInTheDocument();
  });

  it('shows initials on a colour from the name when the player has no photo', () => {
    view(one());
    const circle = courtItems()[0].querySelector('.avatar-fill') as HTMLElement;
    expect(circle).toHaveTextContent('AR');
    expect(circle.tagName).toBe('SPAN');
    expect(circle.style.getPropertyValue('--h')).toBe(String(nameHue('Ana Reyes')));
  });

  it("shows the saved player's photo when there is one", async () => {
    const ana = await useRosterStore.getState().add('Ana Reyes');
    await useRosterStore.getState().setPhoto(ana.id, { type: 'image/jpeg', data: new Uint8Array([1]).buffer });
    view(build([playing(1, ['p1', 'p2', 'p3', 'p4'], NOW - MIN)], {}, 14, [{ rosterId: ana.id }]));
    await waitFor(() => expect(courtItems()[0].querySelectorAll('img.avatar-fill')).toHaveLength(1));
    const imgs = courtItems()[0].querySelectorAll('img.avatar-fill');
    expect(imgs).toHaveLength(1);
    expect(imgs[0].getAttribute('src')).toMatch(/^blob:/);
    // The other three still show initials.
    expect(courtItems()[0].querySelectorAll('span.avatar-fill')).toHaveLength(3);
  });

  it('shows initials for a player whose roster entry has no photo', async () => {
    const ana = await useRosterStore.getState().add('Ana Reyes');
    view(build([playing(1, ['p1', 'p2', 'p3', 'p4'], NOW - MIN)], {}, 14, [{ rosterId: ana.id }]));
    await act(async () => {});
    expect(courtItems()[0].querySelectorAll('img')).toHaveLength(0);
    expect(within(courtItems()[0]).getByText('AR')).toBeInTheDocument();
  });
});

describe('the waiting row', () => {
  const strip = () => screen.getByRole('list', { name: 'Waiting players' });
  const items = () => within(strip()).getAllByRole('listitem');
  const nameOf = (li: HTMLElement) => li.querySelector('.board-pname')?.textContent;
  const numberOf = (li: HTMLElement) => li.querySelector('.board-no')?.textContent;

  it('lists the waiting players in the engine order, numbered from 1', () => {
    const s = build([playing(1, ['p1', 'p2', 'p3', 'p4'], NOW - MIN)], { pinned: ['p6'] }, 10);
    view(s);
    const expected = engine.orderedWaiting(s).map((p) => p.name.split(' ')[0]);
    expect(expected[0]).toBe('Fay'); // the pinned player goes first, so the order is not the roster order
    expect(expected.slice(1)).toEqual(['Jo', 'Ian', 'Hera', 'Gus', 'Eli']); // the queue runs in reverse
    expect(items().map(nameOf)).toEqual(expected);
    expect(items().map(numberOf)).toEqual(['1', '2', '3', '4', '5', '6']);
  });

  it('shows the count next to the Waiting label', () => {
    view(build([playing(1, ['p1', 'p2', 'p3', 'p4'], NOW - MIN)], {}, 10));
    const section = screen.getByRole('region', { name: 'Waiting' });
    expect(within(section).getByText('Waiting')).toBeInTheDocument();
    expect(section.querySelector('.board-wl-count')).toHaveTextContent(/^6$/);
  });

  it('gives number 1, and only number 1, the lime ring', () => {
    view(build([playing(1, ['p1', 'p2', 'p3', 'p4'], NOW - MIN)], {}, 8));
    const lis = items();
    expect(lis[0]).toHaveClass('is-first');
    for (const li of lis.slice(1)) expect(li).not.toHaveClass('is-first');
  });

  it('shows everyone when they all fit, with no +N circle', () => {
    view(build([court(1)], {}, 6));
    expect(items()).toHaveLength(6);
    expect(screen.queryByText(/^\+\d/)).not.toBeInTheDocument();
  });

  it('shows a dashed +N circle with the right N when they do not all fit (6 slots in jsdom)', () => {
    view(build([court(1)], {}, 9));
    const lis = items();
    expect(lis).toHaveLength(6);
    expect(lis.slice(0, 5).map(numberOf)).toEqual(['1', '2', '3', '4', '5']);
    expect(within(lis[5]).getByText('+4')).toBeInTheDocument();
    expect(lis[5]).toHaveClass('board-wmore');
    expect(numberOf(lis[5])).toBeUndefined();
    expect(screen.getByRole('region', { name: 'Waiting' }).querySelector('.board-wl-count')).toHaveTextContent(/^9$/);
  });

  it('says no one is waiting when the row is empty', () => {
    view(build([playing(1, ['p1', 'p2', 'p3', 'p4'], NOW - MIN)], {}, 4));
    expect(screen.getByText('No one is waiting.')).toBeInTheDocument();
    expect(screen.queryByRole('list', { name: 'Waiting players' })).not.toBeInTheDocument();
    expect(screen.getByRole('region', { name: 'Waiting' }).querySelector('.board-wl-count')).toHaveTextContent(/^0$/);
  });

  it('does not show players on a break or who left, or count them', () => {
    const s = build([playing(1, ['p1', 'p2', 'p3', 'p4'], NOW - MIN)], {}, 8, [{}, {}, {}, {}, {}, { status: 'break' }, { status: 'left' }]);
    view(s);
    const names = items().map(nameOf);
    expect(names).toHaveLength(2);
    expect(names).not.toContain('Fay');
    expect(names).not.toContain('Gus');
    expect(screen.getByRole('region', { name: 'Waiting' }).querySelector('.board-wl-count')).toHaveTextContent(/^2$/);
  });

  it('does not show players held in a ready lineup as waiting', () => {
    view(build([ready(1, ['p1', 'p2', 'p3', 'p4'])], {}, 6));
    expect(items().map(nameOf)).toEqual(['Fay', 'Eli']);
  });
});

describe('closing the board', () => {
  it('calls onClose from the Close button', () => {
    const onClose = vi.fn();
    view(build([court(1)]), onClose);
    fireEvent.click(screen.getByRole('button', { name: 'Close board' }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('calls onClose on Escape, and not on other keys', () => {
    const onClose = vi.fn();
    view(build([court(1)]), onClose);
    fireEvent.keyDown(document, { key: 'a' });
    fireEvent.keyDown(document, { key: 'Enter' });
    expect(onClose).not.toHaveBeenCalled();
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('stops listening for Escape after it unmounts', () => {
    const onClose = vi.fn();
    const { unmount } = view(build([court(1)]), onClose);
    unmount();
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(onClose).not.toHaveBeenCalled();
  });

  it('draws the X as a picture the screen reader skips', () => {
    view(build([court(1)]));
    const btn = screen.getByRole('button', { name: 'Close board' });
    expect(btn.querySelector('svg')).toHaveAttribute('aria-hidden', 'true');
    expect(btn).toHaveAttribute('type', 'button');
  });
});

describe('the layout by court count', () => {
  const grid = () => screen.getByRole('list', { name: 'Courts' });
  const dims = () => ({
    land: [grid().getAttribute('data-cols-land'), grid().getAttribute('data-rows-land')],
    port: [grid().getAttribute('data-cols-port'), grid().getAttribute('data-rows-port')],
    shown: grid().getAttribute('data-shown'),
    hidden: grid().getAttribute('data-hidden'),
  });

  it('1 court: one column and one row', () => {
    view(build([court(1)]));
    expect(dims()).toEqual({ land: ['1', '1'], port: ['1', '1'], shown: '1', hidden: '0' });
    expect(grid().style.getPropertyValue('--cols-land')).toBe('1');
    expect(grid().style.getPropertyValue('--rows-port')).toBe('1');
  });

  it('4 courts: 2 by 2 in landscape, stacked in portrait', () => {
    view(build(Array.from({ length: 4 }, (_, i) => court(i + 1))));
    expect(dims()).toEqual({ land: ['2', '2'], port: ['1', '4'], shown: '4', hidden: '0' });
    expect(grid().style.getPropertyValue('--cols-land')).toBe('2');
    expect(grid().style.getPropertyValue('--rows-land')).toBe('2');
    expect(grid().style.getPropertyValue('--cols-port')).toBe('1');
    expect(grid().style.getPropertyValue('--rows-port')).toBe('4');
  });

  it('7 courts: shows six in 3 by 2 or 2 by 3 and hides one', () => {
    view(build(Array.from({ length: 7 }, (_, i) => court(i + 1))));
    expect(dims()).toEqual({ land: ['3', '2'], port: ['2', '3'], shown: '6', hidden: '1' });
    expect(courtItems()).toHaveLength(6);
    expect(screen.queryByText('Court 7')).not.toBeInTheDocument();
  });
});

describe('what the board never shows', () => {
  it('has no scores, wins, losses or ratings, even when the games have them', () => {
    const game = (winner: 1 | 2, score: [number, number]): FinishedGame => ({
      team1: ['p1', 'p2'],
      team2: ['p3', 'p4'],
      courtNumber: 1,
      startedAt: NOW - 30 * MIN,
      finishedAt: NOW - 20 * MIN,
      winner,
      score,
    });
    const s = build([playing(1, ['p1', 'p2', 'p3', 'p4'], NOW - MIN)], { history: [game(1, [21, 13]), game(2, [17, 19])], gameSeq: 2 }, 10, [
      { rating: 8, gamesPlayed: 2 },
      { rating: 3 },
    ]);
    view(s);
    const text = main().textContent ?? '';
    expect(text).not.toMatch(/\b(won|win|wins|winner|lost|loss|losses|score|scores|rating|rated|games)\b/i);
    for (const n of ['21', '13', '17', '19']) expect(text).not.toContain(n);
  });

  it('keeps to the copy rules: no exclamation marks or em dashes', () => {
    view(build([playing(1, ['p1', 'p2', 'p3', 'p4'], NOW - MIN), ready(2, ['p5', 'p6', 'p7', 'p8']), court(3, { closing: true })], { venue: 'Hall', plannedEndAt: NOW + 60 * MIN }));
    expect(main().textContent).not.toMatch(/[!\u2014]/);
  });
});

// ----- the board's CSS -----

/** The declarations of the first rule whose selector is exactly this one, or undefined. */
function rule(selector: string, source = css): string | undefined {
  const esc = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`(?:^|\\})\\s*${esc}\\s*\\{([^}]*)\\}`, 'm').exec(source)?.[1];
}
const must = (selector: string, source = css): string => {
  const r = rule(selector, source);
  if (r === undefined) throw new Error(`no rule for ${selector}`);
  return r;
};

/** The body of the first @media block whose query starts with this text. */
function media(query: string): string {
  const start = css.indexOf(`@media ${query}`);
  if (start < 0) throw new Error(`no @media ${query}`);
  const open = css.indexOf('{', start);
  let depth = 0;
  for (let i = open; i < css.length; i++) {
    if (css[i] === '{') depth++;
    if (css[i] === '}' && --depth === 0) return css.slice(open + 1, i);
  }
  throw new Error('unbalanced');
}

const boardVars = () => must('.board');
const hexOf = (name: string) => {
  const m = new RegExp(`${name}:\\s*(#[0-9a-fA-F]{6})\\s*;`).exec(boardVars());
  if (!m) throw new Error(`no hex for ${name}`);
  return m[1];
};
const numOf = (name: string) => {
  const m = new RegExp(`${name}:\\s*(\\d+(?:\\.\\d+)?)%`).exec(boardVars());
  if (!m) throw new Error(`no percentage for ${name}`);
  return Number(m[1]);
};

const lin = (c: number) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
const lumOf = (r: number, g: number, b: number) => 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
const hexLum = (c: string) => lumOf(...([1, 3, 5].map((i) => parseInt(c.slice(i, i + 2), 16) / 255) as [number, number, number]));
const ratioOf = (a: number, b: number) => (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);

/** hsl(h s% l%) as a luminance. */
function hslLum(h: number, s: number, l: number): number {
  const sat = s / 100;
  const lig = l / 100;
  const c = (1 - Math.abs(2 * lig - 1)) * sat;
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
  const m = lig - c / 2;
  const [r, g, b] = h < 60 ? [c, x, 0] : h < 120 ? [x, c, 0] : h < 180 ? [0, c, x] : h < 240 ? [0, x, c] : h < 300 ? [x, 0, c] : [c, 0, x];
  return lumOf(r + m, g + m, b + m);
}

describe('the board colours', () => {
  it('knows black on white is 21 to 1 and hsl white is white', () => {
    expect(ratioOf(hexLum('#000000'), hexLum('#ffffff'))).toBeCloseTo(21, 5);
    expect(hslLum(0, 0, 100)).toBeCloseTo(1, 5);
    expect(hslLum(120, 100, 50)).toBeCloseTo(0.7152, 3);
  });

  it('sets its own dark colours as plain values, whatever the app theme is', () => {
    expect(boardVars()).toMatch(/color-scheme:\s*dark/);
    for (const name of ['--board-bg', '--board-fg', '--board-mut', '--board-card', '--board-edge', '--board-lime']) hexOf(name);
    expect(hexLum(hexOf('--board-bg'))).toBeLessThan(0.02);
    expect(hexLum(hexOf('--board-card'))).toBeLessThan(0.02);
    expect(boardVars()).toMatch(/background:\s*var\(--board-bg\)/);
    expect(boardVars()).toMatch(/color:\s*var\(--board-fg\)/);
  });

  it('does not use the app theme variables anywhere in the board section', () => {
    const section = css.slice(css.indexOf('/* Board */'));
    expect(section.length).toBeGreaterThan(200);
    for (const v of ['--bg)', '--surface)', '--ink)', '--muted)', '--line)']) expect(section).not.toContain(`var(${v}`);
  });

  it('has text at 4.5 to 1 or more on the board and on the cards, and the lime too', () => {
    for (const fg of ['--board-fg', '--board-mut', '--board-lime']) {
      for (const bg of ['--board-bg', '--board-card']) {
        expect(ratioOf(hexLum(hexOf(fg)), hexLum(hexOf(bg)))).toBeGreaterThanOrEqual(4.5);
      }
    }
    // Dark text on the lime number 1 badge.
    expect(ratioOf(hexLum(hexOf('--board-lime-ink')), hexLum(hexOf('--board-lime')))).toBeGreaterThanOrEqual(4.5);
  });

  it('has the dashed Open outline and the lime outline at 3 to 1 or more against the board', () => {
    expect(ratioOf(hexLum(hexOf('--board-edge')), hexLum(hexOf('--board-bg')))).toBeGreaterThanOrEqual(3);
    expect(ratioOf(hexLum(hexOf('--board-lime')), hexLum(hexOf('--board-bg')))).toBeGreaterThanOrEqual(3);
  });

  it('keeps white initials at 4.5 to 1 or more on the tile for every hue from 0 to 355', () => {
    const s = numOf('--board-tile-s');
    const l = numOf('--board-tile-l');
    expect(rule('.board .avatar-fill')).toMatch(/color:\s*#fff(fff)?\s*;/i);
    expect(rule('.board .avatar-fill')).toContain('hsl(var(--h');
    for (let h = 0; h < 360; h += 5) {
      expect(ratioOf(1, hslLum(h, s, l)), `hue ${h}`).toBeGreaterThanOrEqual(4.5);
    }
  });
});

describe('the board styles', () => {
  it('keeps the Close button at 44 px or more', () => {
    const r = must('.board-close');
    expect(r).toMatch(/width:\s*44px/);
    expect(r).toMatch(/height:\s*44px/);
  });

  it('puts the courts in one column of rows by default and uses the landscape grid in landscape', () => {
    const base = must('.board-courts');
    expect(base).toContain('--cols-port');
    expect(base).toContain('--rows-port');
    expect(base).not.toContain('--cols-land');
    const land = media('(orientation: landscape)');
    expect(rule('.board-courts', land)).toContain('--cols-land');
    expect(rule('.board-courts', land)).toContain('--rows-land');
  });

  it('lays a court out as a row in portrait and a column in landscape', () => {
    expect(must('.board-teams')).toMatch(/flex-direction:\s*row/);
    const land = media('(orientation: landscape)');
    expect(rule('.board-teams', land)).toMatch(/flex-direction:\s*column/);
  });

  it('only treats a screen as landscape when it is also wide enough', () => {
    expect(css).toMatch(/@media \(orientation: landscape\) and \(min-width: \d+px\)/);
  });

  it('measures the circles from the card, in container units and never in pixels', () => {
    expect(must('.board-court')).toMatch(/container-type:\s*size/);
    expect(must('.board-waiting')).toMatch(/container-type:\s*size/);
    const sizes = [...css.slice(css.indexOf('/* Board */')).matchAll(/--(?:d|wd|vs):\s*([^;]+);/g)].map((m) => m[1]);
    expect(sizes.length).toBeGreaterThanOrEqual(4);
    for (const v of sizes) {
      expect(v).toMatch(/cq(h|w|min)/);
      expect(v).not.toMatch(/\dpx/);
    }
  });

  it('drops the venue and end time on a narrow screen, never the name, clock or Close', () => {
    const narrow = media('(max-width: 520px)');
    const hidden = narrow.slice(0, narrow.indexOf('{'));
    expect(hidden).toContain('.board-venue');
    expect(hidden).toContain('.board-end');
    expect(narrow).toMatch(/display:\s*none/);
    for (const keep of ['.board-name', '.board-clock', '.board-close']) expect(narrow).not.toContain(keep);
  });

  it('uses the lime for the clock, the Up next tag and outline, and the next-in-line ring', () => {
    expect(must('.board-timer')).toContain('--board-lime');
    expect(must('.board-tag')).toContain('--board-lime');
    expect(must('.board-court-ready')).toMatch(/dashed var\(--board-lime\)/);
    expect(must('.board-court-open')).toMatch(/dashed var\(--board-edge\)/);
    expect(must('.board-wpf.is-first .board-circle')).toContain('--board-lime');
  });

  it('has a fill size for avatars that fills its container with a square shape', () => {
    const r = must('.avatar-fill');
    expect(r).toMatch(/width:\s*100%/);
    expect(r).toMatch(/aspect-ratio:\s*1/);
  });
});
