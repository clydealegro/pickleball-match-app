# Board view (Phase 4b) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A full-screen board for a TV or a phone on a stand that shows every court with its teams as large circular photos, the game clocks, who plays next, and who is waiting, live from the same session.

**Architecture:** Pure helpers decide the content (court states, clocks, names, grid, waiting capacity). One screen draws it in its own dark colours, with sizes taken from the space through container query units. The live menu opens it as a screen with its own history entry. Nothing is synced and nothing leaves the device.

**Tech Stack:** React, TypeScript, Vite, Vitest. No new dependencies.

---

## Decisions (settled 2026-11-08)

1. **Entry:** a "Show board" item in the live menu, directly after "Settings". The board is a screen of its own and only opens for a running session.
2. **Closing:** the Close button, the Escape key and the phone's Back button all close it (one history entry). If the session ends while it is open, the summary shows and the board does not come back.
3. **Always dark.** The board draws in its own dark colours whatever the app theme is. Lime is for the game clock, the "Up next" tag and outline, and the number 1 ring in the waiting row.
4. **Faces first.** Every player is a circular avatar (their photo, or initials on a colour made from their name, with the lightness capped so white initials stay readable), with the first name under it. If two players on the board share a first name, a last initial is added ("Ana R.").
5. **Courts.** Each court is a card with its number and one of four states: playing (a lime game clock), up next (a lime "Up next" tag and a dashed lime outline), open (a dashed grey outline and the word "Open"), closing (a "Closing" tag). Team A and Team B are two outlined panels (bluish and warm) with a VS between them.
6. **Layout by court count.** Landscape: 1 to 3 courts are columns, 4 is 2 by 2, 5 or 6 is 3 by 2, more than 6 shows 6 and the header says "+N more courts". Portrait: 1 to 4 courts stack, 5 or 6 use two columns. A court stacks its teams (Team A, VS, Team B) only when its card is about square or taller and at least 400 px tall; otherwise the two teams sit side by side. This changes the earlier idea of tying stacking to orientation.
7. **Waiting.** A row of circular avatars in the app's own order (`orderedWaiting`), numbered from 1, with a lime ring on number 1 and a dashed "+N" circle when not all fit. When nobody is waiting it says "No one is waiting." People on a break are not shown.
8. **No scores, no wins or losses, no ratings** anywhere on the board.
9. **Nothing new to keep the screen awake:** the existing wake lock already covers a running session.

**Left for later, on purpose:** a second device showing the board over a live link (Phase 5); a "Show board" shortcut on Home; sound; a light board theme.

**Known limits:** on a phone in portrait with 5 or more courts the circles are small (about 28 px); on a phone held sideways the circles are small inside tall team panels.

## File structure

| File | Job |
|---|---|
| `src/store/boardInfo.ts` | court views, game clock, board names, grid, waiting capacity, name colour |
| `src/ui/BoardScreen.tsx`, `BoardCourt.tsx`, `BoardTeam.tsx`, `BoardWaiting.tsx` | the board |
| `src/ui/Avatar.tsx`, `PlayerAvatar.tsx` | a `fill` size that fills its container |
| `src/styles/app.css` | the `/* Board */` section |
| `src/ui/LiveScreen.tsx`, `App.tsx` | the menu item and the board view with its history entry |
| `docs/superpowers/sketches/board-v5-circles.html` and `.png` | the design the board follows (stand-in portraits) |

Each task below is one commit. A task writes its tests first, runs them and sees them fail, then writes the code. The code in this plan is the code that was built and proven first: it was run against the full suite and 83 deliberate breaks, looked at in a browser at TV and phone sizes, then replayed from this document onto a clean checkout of production.

---


### Task 1: The board helpers (courts, clock, names, layout)

Everything the board decides lives in pure helpers first: the state of each court, the game clock text, first names with a last initial when two players share one, how many courts go in the grid, and how many waiting faces fit.

**Files:**
- Create: `src/store/boardInfo.test.ts`
- Create: `src/store/boardInfo.ts`

- [ ] **Step 1: Write the failing tests**

Create `src/store/boardInfo.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import type { Court } from '../engine';
import { mkPlayer, mkSession } from '../engine/testing';
import { boardName, courtViews, gameClock, gridFor, nameHue, waitingCapacity } from './boardInfo';

const SEC = 1000;
const MIN = 60 * SEC;
const HOUR = 60 * MIN;
const NOW = 10_000_000;

const players = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'].map((id) => mkPlayer(id, { name: id.toUpperCase() }));

function court(number: number, over: Partial<Court> = {}): Court {
  return { id: `c${number}`, number, status: 'empty', closing: false, ...over };
}

const names = (team: { name: string }[]) => team.map((p) => p.name);

describe('courtViews', () => {
  it('gives an empty court as open with no teams and no clock', () => {
    const [v] = courtViews(mkSession(players, { courts: [court(1)] }), NOW);
    expect(v).toEqual({ id: 'c1', number: 1, state: 'open', closing: false, teamA: [], teamB: [] });
  });

  it('gives a playing court its clock and both teams from the game', () => {
    const s = mkSession(players, {
      courts: [court(1, { status: 'playing', game: { team1: ['a', 'b'], team2: ['c', 'd'], startedAt: NOW - 12 * MIN - 41 * SEC } })],
    });
    const [v] = courtViews(s, NOW);
    expect(v.state).toBe('playing');
    expect(v.clock).toBe('12:41');
    expect(names(v.teamA)).toEqual(['A', 'B']);
    expect(names(v.teamB)).toEqual(['C', 'D']);
  });

  it('gives a ready court its teams from the lineup and no clock', () => {
    const s = mkSession(players, {
      courts: [court(1, { status: 'ready', lineup: { team1: ['e', 'f'], team2: ['g', 'h'] } })],
    });
    const [v] = courtViews(s, NOW);
    expect(v.state).toBe('ready');
    expect(v.clock).toBeUndefined();
    expect(names(v.teamA)).toEqual(['E', 'F']);
    expect(names(v.teamB)).toEqual(['G', 'H']);
  });

  it('treats a ready or playing court without its lineup or game as open', () => {
    const s = mkSession(players, { courts: [court(1, { status: 'ready' }), court(2, { status: 'playing' })] });
    expect(courtViews(s, NOW).map((v) => v.state)).toEqual(['open', 'open']);
  });

  it('keeps the closing flag with any state', () => {
    const s = mkSession(players, {
      courts: [
        court(1, { closing: true }),
        court(2, { closing: true, status: 'playing', game: { team1: ['a', 'b'], team2: ['c', 'd'], startedAt: NOW } }),
        court(3),
      ],
    });
    expect(courtViews(s, NOW).map((v) => v.closing)).toEqual([true, true, false]);
  });

  it('resolves teams by id and drops an id that is not in the session', () => {
    const s = mkSession(players, {
      courts: [court(1, { status: 'ready', lineup: { team1: ['a', 'zzz'], team2: ['c', 'd'] } })],
    });
    const [v] = courtViews(s, NOW);
    expect(names(v.teamA)).toEqual(['A']);
    expect(names(v.teamB)).toEqual(['C', 'D']);
  });

  it('lists the courts in court-number order', () => {
    const s = mkSession(players, { courts: [court(3), court(1), court(2)] });
    expect(courtViews(s, NOW).map((v) => v.number)).toEqual([1, 2, 3]);
  });

  it('does not change the session it is given', () => {
    const s = mkSession(players, { courts: [court(2), court(1)] });
    courtViews(s, NOW);
    expect(s.courts.map((c) => c.number)).toEqual([2, 1]);
  });
});

describe('gameClock', () => {
  const at = (ms: number) => gameClock(NOW - ms, NOW);

  it('starts at 0:00', () => expect(at(0)).toBe('0:00'));
  it('pads the seconds', () => expect(at(9 * SEC)).toBe('0:09'));
  it('shows 59 seconds', () => expect(at(59 * SEC)).toBe('0:59'));
  it('turns 60 seconds into a minute', () => expect(at(60 * SEC)).toBe('1:00'));
  it('drops the part of a second', () => expect(at(9 * SEC + 999)).toBe('0:09'));
  it('shows minutes and seconds', () => expect(at(12 * MIN + 41 * SEC)).toBe('12:41'));
  it('shows 59:59 just before an hour', () => expect(at(HOUR - SEC)).toBe('59:59'));
  it('switches to h:mm:ss at exactly one hour', () => expect(at(HOUR)).toBe('1:00:00'));
  it('pads minutes and seconds over an hour', () => expect(at(HOUR + 2 * MIN + 3 * SEC)).toBe('1:02:03'));
  it('keeps counting hours', () => expect(at(10 * HOUR + 5 * MIN + 9 * SEC)).toBe('10:05:09'));
  it('is never negative when the start is in the future', () => {
    expect(at(-5 * SEC)).toBe('0:00');
    expect(at(-3 * HOUR)).toBe('0:00');
  });
});

describe('boardName', () => {
  const p = (id: string, name: string) => mkPlayer(id, { name });

  it('is the first name when first names are unique', () => {
    const all = [p('1', 'Ana Reyes'), p('2', 'Ben Cruz')];
    expect(boardName(all[0], all)).toBe('Ana');
  });

  it('adds the last initial when another player shares the first name', () => {
    const all = [p('1', 'Ana Reyes'), p('2', 'Ana Cruz')];
    expect(boardName(all[0], all)).toBe('Ana R.');
    expect(boardName(all[1], all)).toBe('Ana C.');
  });

  it('uses the last word as the last name and upper-cases the initial', () => {
    const all = [p('1', 'Ana maria santos'), p('2', 'Ana Cruz')];
    expect(boardName(all[0], all)).toBe('Ana S.');
  });

  it('matches first names without caring about case', () => {
    const all = [p('1', 'ANA Reyes'), p('2', 'ana Cruz')];
    expect(boardName(all[0], all)).toBe('ANA R.');
  });

  it('gives a single-word name as it is', () => {
    const all = [p('1', 'Ana'), p('2', 'Ben')];
    expect(boardName(all[0], all)).toBe('Ana');
  });

  it('ignores extra spaces', () => {
    const all = [p('1', '  Ana   Reyes  '), p('2', 'Ben')];
    expect(boardName(all[0], all)).toBe('Ana');
    const dup = [p('1', '  Ana   Reyes  '), p('2', 'Ana  Cruz ')];
    expect(boardName(dup[0], dup)).toBe('Ana R.');
  });

  it('adds nothing for a player with no last name, even when the first name is shared', () => {
    const all = [p('1', 'Ana'), p('2', 'Ana Cruz')];
    expect(boardName(all[0], all)).toBe('Ana');
    expect(boardName(all[1], all)).toBe('Ana C.');
  });

  it('does not count the player as a clash with themselves', () => {
    const me = p('1', 'Ana Reyes');
    expect(boardName(me, [me])).toBe('Ana');
  });
});

describe('gridFor', () => {
  const land = (n: number) => gridFor(n, true);
  const port = (n: number) => gridFor(n, false);

  it('has nothing to show for no courts', () => {
    expect(land(0)).toMatchObject({ shown: 0, hidden: 0 });
    expect(port(0)).toMatchObject({ shown: 0, hidden: 0 });
    expect(land(0).columns).toBeGreaterThanOrEqual(1);
    expect(land(0).rows).toBeGreaterThanOrEqual(1);
  });

  it.each([
    [1, 1, 1],
    [2, 2, 1],
    [3, 3, 1],
    [4, 2, 2],
    [5, 3, 2],
    [6, 3, 2],
    [7, 3, 2],
    [8, 3, 2],
  ])('landscape %i courts: %i columns by %i rows', (n, columns, rows) => {
    expect(land(n)).toMatchObject({ columns, rows });
  });

  it.each([
    [1, 1, 1],
    [2, 1, 2],
    [3, 1, 3],
    [4, 1, 4],
    [5, 2, 3],
    [6, 2, 3],
    [7, 2, 3],
    [8, 2, 3],
  ])('portrait %i courts: %i columns by %i rows', (n, columns, rows) => {
    expect(port(n)).toMatchObject({ columns, rows });
  });

  it.each([
    [0, 0, 0],
    [1, 1, 0],
    [4, 4, 0],
    [6, 6, 0],
    [7, 6, 1],
    [8, 6, 2],
  ])('%i courts show %i and hide %i in both orientations', (n, shown, hidden) => {
    expect(land(n)).toMatchObject({ shown, hidden });
    expect(port(n)).toMatchObject({ shown, hidden });
  });

  it('has room for every court it shows', () => {
    for (let n = 1; n <= 8; n++) {
      for (const g of [land(n), port(n)]) expect(g.columns * g.rows).toBeGreaterThanOrEqual(g.shown);
    }
  });
});

describe('waitingCapacity', () => {
  // A 100 px strip of 20 px circles with a 5 px gap fits 4: 4 * 20 + 3 * 5 = 95.
  it('shows everyone when they all fit, with no room kept for +N', () => {
    expect(waitingCapacity(100, 20, 5, 4)).toBe(4);
    expect(waitingCapacity(100, 20, 5, 3)).toBe(3);
    expect(waitingCapacity(100, 20, 5, 1)).toBe(1);
  });

  it('keeps one slot for the +N circle when they do not all fit', () => {
    expect(waitingCapacity(100, 20, 5, 5)).toBe(3);
    expect(waitingCapacity(100, 20, 5, 40)).toBe(3);
  });

  it('counts the gap: one more circle fits only when its gap fits too', () => {
    expect(waitingCapacity(95, 20, 5, 4)).toBe(4); // 4 * 20 + 3 * 5 = 95 fits exactly
    expect(waitingCapacity(94, 20, 5, 4)).toBe(2); // only 3 fit, so 4 people need a +N slot
  });

  it('shows at least one person on a very small strip', () => {
    expect(waitingCapacity(10, 20, 5, 6)).toBe(1);
    expect(waitingCapacity(0, 20, 5, 6)).toBe(1);
    expect(waitingCapacity(30, 20, 5, 6)).toBe(1); // 1 fits, the +N slot would leave none
  });

  it('shows no one when no one waits', () => {
    expect(waitingCapacity(100, 20, 5, 0)).toBe(0);
  });

  it('gives 6 slots for a strip of 6 units, the jsdom default', () => {
    expect(waitingCapacity(6, 1, 0, 6)).toBe(6);
    expect(waitingCapacity(6, 1, 0, 7)).toBe(5);
  });
});

describe('nameHue', () => {
  it('is the same each time for the same name', () => {
    expect(nameHue('Ana Reyes')).toBe(nameHue('Ana Reyes'));
  });

  it('is a whole number from 0 to 359', () => {
    for (const name of ['', 'a', 'Ana', 'Ana Reyes', 'Zoë', 'x'.repeat(500), '😀 Ann', 'Ben', 'Cy']) {
      const h = nameHue(name);
      expect(Number.isInteger(h)).toBe(true);
      expect(h).toBeGreaterThanOrEqual(0);
      expect(h).toBeLessThan(360);
    }
  });

  it('gives different names different hues, for the pairs we know', () => {
    const pairs = [['Ana', 'Ben'], ['Ana', 'Carlo'], ['Jun', 'Mia'], ['Ben', 'Liza'], ['Eli', 'Fay']];
    for (const [a, b] of pairs) expect(nameHue(a)).not.toBe(nameHue(b));
  });

  it('spreads a set of names over many hues', () => {
    const hues = new Set(['Ana', 'Ben', 'Carlo', 'Dee', 'Eli', 'Fay', 'Gus', 'Hera', 'Ian', 'Jo', 'Kai', 'Lee'].map(nameHue));
    expect(hues.size).toBeGreaterThanOrEqual(10);
  });
});
```

- [ ] **Step 2: Run them and watch them fail**

Run: `npx vitest run src/store/boardInfo.test.ts`
Expected: the file fails to load because `./boardInfo` does not exist.

- [ ] **Step 3: Write the code**

Create `src/store/boardInfo.ts`:

```ts
import type { Court, Player, Session } from '../engine';

export interface CourtView {
  id: string;
  number: number;
  state: 'playing' | 'ready' | 'open';
  closing: boolean;
  /** The game clock, only while a game is playing. */
  clock?: string;
  teamA: Player[];
  teamB: Player[];
}

/** The players for these ids, in the same order. An id that is not in the session is dropped. */
function resolve(byId: Map<string, Player>, ids: readonly string[]): Player[] {
  return ids.flatMap((id) => {
    const p = byId.get(id);
    return p ? [p] : [];
  });
}

function view(court: Court, byId: Map<string, Player>, nowMs: number): CourtView {
  const base = { id: court.id, number: court.number, closing: court.closing };
  if (court.status === 'playing' && court.game) {
    const { team1, team2, startedAt } = court.game;
    return { ...base, state: 'playing', clock: gameClock(startedAt, nowMs), teamA: resolve(byId, team1), teamB: resolve(byId, team2) };
  }
  if (court.status === 'ready' && court.lineup) {
    const { team1, team2 } = court.lineup;
    return { ...base, state: 'ready', teamA: resolve(byId, team1), teamB: resolve(byId, team2) };
  }
  return { ...base, state: 'open', teamA: [], teamB: [] };
}

/** Every court as the board shows it, in court-number order. */
export function courtViews(session: Session, nowMs: number): CourtView[] {
  const byId = new Map(session.players.map((p) => [p.id, p]));
  return [...session.courts].sort((a, b) => a.number - b.number).map((c) => view(c, byId, nowMs));
}

const pad = (n: number) => String(n).padStart(2, '0');

/** Time since a game started: "0:09", "12:41", then "1:02:03" from one hour. Never negative. */
export function gameClock(startedAt: number, nowMs: number): string {
  const total = Math.max(0, Math.floor((nowMs - startedAt) / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  return h > 0 ? `${h}:${pad(m)}:${pad(s)}` : `${m}:${pad(s)}`;
}

const words = (name: string) => name.trim().split(/\s+/).filter(Boolean);

/** The first name, plus the last initial ("Ana R.") when someone else on the board has the same first name. */
export function boardName(player: Player, everyone: Player[]): string {
  const [first = '', ...rest] = words(player.name);
  const clash = everyone.some((o) => o.id !== player.id && (words(o.name)[0] ?? '').toLowerCase() === first.toLowerCase());
  if (!clash || rest.length === 0) return first;
  return `${first} ${Array.from(rest[rest.length - 1])[0].toUpperCase()}.`;
}

export interface BoardGrid {
  columns: number;
  rows: number;
  /** How many courts fit on the board. */
  shown: number;
  /** How many courts are left off, named in the header. */
  hidden: number;
}

const MAX_SHOWN = 6;

/** Columns and rows for this many courts. At most six show; the rest are counted in the header. */
export function gridFor(courtCount: number, landscape: boolean): BoardGrid {
  const shown = Math.min(courtCount, MAX_SHOWN);
  const hidden = courtCount - shown;
  if (shown === 0) return { columns: 1, rows: 1, shown, hidden };
  if (landscape) {
    if (shown <= 3) return { columns: shown, rows: 1, shown, hidden };
    if (shown === 4) return { columns: 2, rows: 2, shown, hidden };
    return { columns: 3, rows: 2, shown, hidden };
  }
  if (shown <= 4) return { columns: 1, rows: shown, shown, hidden };
  return { columns: 2, rows: 3, shown, hidden };
}

/**
 * How many waiting players to draw in a strip. When everyone fits, everyone shows. When not, one slot is kept for
 * the "+N" circle. Someone always shows when someone waits.
 */
export function waitingCapacity(stripWidth: number, itemWidth: number, gap: number, total: number): number {
  if (total <= 0) return 0;
  const fit = Math.floor((stripWidth + gap) / (itemWidth + gap));
  if (total <= fit) return total;
  return Math.max(1, fit - 1);
}

/** A hue from 0 to 359 for this name, the same every time. */
export function nameHue(name: string): number {
  let h = 0;
  for (const ch of name) h = (Math.imul(h, 31) + (ch.codePointAt(0) ?? 0)) >>> 0;
  return h % 360;
}
```

- [ ] **Step 4: Run them, then the whole project**

Run: `npx vitest run src/store/boardInfo.test.ts`
Expected: all tests in the file pass.

Then run `npx tsc --noEmit && npx vitest run`.
Expected: `tsc` prints nothing and the suite shows 1381 tests across 115 files.

- [ ] **Step 5: Commit**

```bash
git add src/store/boardInfo.test.ts src/store/boardInfo.ts
git commit -m "Add the board helpers: courts, clock, names and layout"
```

### Task 2: The board screen (courts, teams, clocks, waiting row)

The screen itself: a header, one card per court with the game clock, Team A and Team B as outlined panels with circular avatars and a VS between them, and a numbered waiting row in the app's own order. It always draws in dark colours, and it shows no scores.

**Files:**
- Modify: `src/styles/app.css`
- Modify: `src/ui/Avatar.tsx`
- Create: `src/ui/BoardCourt.tsx`
- Create: `src/ui/BoardScreen.test.tsx`
- Create: `src/ui/BoardScreen.tsx`
- Create: `src/ui/BoardTeam.tsx`
- Create: `src/ui/BoardWaiting.tsx`
- Modify: `src/ui/PlayerAvatar.tsx`

- [ ] **Step 1: Write the failing tests**

Create `src/ui/BoardScreen.test.tsx`:

```tsx
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
```

- [ ] **Step 2: Run them and watch them fail**

Run: `npx vitest run src/ui/BoardScreen.test.tsx`
Expected: the file fails to load because `./BoardScreen` does not exist.

- [ ] **Step 3: Write the code**

Create `src/ui/BoardCourt.tsx`:

```tsx
import type { Player } from '../engine';
import type { CourtView } from '../store/boardInfo';
import { BoardTeam } from './BoardTeam';

/** One court card: its number and state, then both teams with a VS between them. */
export function BoardCourt({ court, everyone }: { court: CourtView; everyone: Player[] }) {
  const cls = ['board-court', `board-court-${court.state}`, court.closing && 'is-closing'].filter(Boolean).join(' ');
  return (
    <li className={cls}>
      <div className="board-court-head">
        <span className="board-court-n">Court {court.number}</span>
        {court.state === 'playing' && (
          <span className="board-timer" role="timer" aria-live="off">
            {court.clock}
          </span>
        )}
        {court.state === 'ready' && <span className="board-tag">Up next</span>}
        {court.closing && <span className="board-closing">Closing</span>}
      </div>
      {court.state === 'open' ? (
        <p className="board-open">Open</p>
      ) : (
        <div className="board-teams">
          <BoardTeam side="a" players={court.teamA} everyone={everyone} />
          <span className="board-vs">VS</span>
          <BoardTeam side="b" players={court.teamB} everyone={everyone} />
        </div>
      )}
    </li>
  );
}
```

Create `src/ui/BoardScreen.tsx`:

```tsx
import { useEffect, useMemo, useState } from 'react';
import { orderedWaiting, type Session } from '../engine';
import { courtViews, gridFor } from '../store/boardInfo';
import { formatClock } from '../store/slots';
import { BoardCourt } from './BoardCourt';
import { BoardWaiting } from './BoardWaiting';

const SECOND = 1000;
const MINUTE = 60_000;

/** The current time in ms, refreshed on its own interval. */
function useNow(every: number): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), every);
    return () => clearInterval(id);
  }, [every]);
  return now;
}

function timeOfDay(ms: number): string {
  const d = new Date(ms);
  return formatClock(d.getHours() * 60 + d.getMinutes());
}

interface HeaderProps {
  session: Session;
  hidden: number;
  onClose: () => void;
}

function BoardHeader({ session, hidden, onClose }: HeaderProps) {
  const now = useNow(MINUTE);
  return (
    <header className="board-head">
      <div className="board-head-l">
        <h1 className="board-name">{session.name}</h1>
        {session.venue && <span className="board-venue">{session.venue}</span>}
      </div>
      <div className="board-head-r">
        {hidden > 0 && <span className="board-more">+{hidden} more {hidden === 1 ? 'court' : 'courts'}</span>}
        {session.plannedEndAt !== undefined && <span className="board-end">Ends {timeOfDay(session.plannedEndAt)}</span>}
        <time className="board-clock" aria-live="off">
          {timeOfDay(now)}
        </time>
        <button type="button" className="board-close" aria-label="Close board" onClick={onClose}>
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" aria-hidden="true">
            <path d="M6 6l12 12M18 6L6 18" />
          </svg>
        </button>
      </div>
    </header>
  );
}

/** The courts. The one-second interval lives here so only the courts redraw each second. */
function BoardCourts({ session, everyone }: { session: Session; everyone: Session['players'] }) {
  const now = useNow(SECOND);
  const grid = gridFor(session.courts.length, true);
  const portrait = gridFor(session.courts.length, false);
  const views = useMemo(() => courtViews(session, now).slice(0, grid.shown), [session, now, grid.shown]);
  const vars = {
    '--cols-land': grid.columns,
    '--rows-land': grid.rows,
    '--cols-port': portrait.columns,
    '--rows-port': portrait.rows,
  } as React.CSSProperties;
  return (
    <ul
      className="board-courts"
      aria-label="Courts"
      style={vars}
      data-cols-land={grid.columns}
      data-rows-land={grid.rows}
      data-cols-port={portrait.columns}
      data-rows-port={portrait.rows}
      data-shown={grid.shown}
      data-hidden={grid.hidden}
    >
      {views.map((v) => (
        <BoardCourt key={v.id} court={v} everyone={everyone} />
      ))}
    </ul>
  );
}

/** A full-screen board for a TV or a phone on a stand: every court, both teams, and who is waiting. */
export function BoardScreen({ session, onClose }: { session: Session; onClose: () => void }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  const grid = gridFor(session.courts.length, true);
  const waiting = orderedWaiting(session);
  // Everyone drawn on the board, so two players with the same first name get a last initial.
  const everyone = useMemo(() => {
    const onCourts = courtViews(session, 0)
      .slice(0, grid.shown)
      .flatMap((v) => [...v.teamA, ...v.teamB]);
    return [...onCourts, ...waiting];
  }, [session, grid.shown, waiting]);

  return (
    <main className="board" aria-label="Board">
      <BoardHeader session={session} hidden={grid.hidden} onClose={onClose} />
      <BoardCourts session={session} everyone={everyone} />
      <BoardWaiting waiting={waiting} everyone={everyone} />
    </main>
  );
}
```

Create `src/ui/BoardTeam.tsx`:

```tsx
import type { Player } from '../engine';
import { boardName } from '../store/boardInfo';
import { PlayerAvatar } from './PlayerAvatar';

interface Props {
  side: 'a' | 'b';
  players: Player[];
  /** Everyone on the board, to tell players with the same first name apart. */
  everyone: Player[];
}

/** One team's outlined panel: a circle and a first name for each player. */
export function BoardTeam({ side, players, everyone }: Props) {
  return (
    <div className={`board-team board-team-${side}`} role="group" aria-label={side === 'a' ? 'Team A' : 'Team B'}>
      {players.map((p) => (
        <div key={p.id} className="board-pf">
          <div className="board-circle">
            <PlayerAvatar name={p.name} rosterId={p.rosterId} size="fill" />
          </div>
          <span className="board-pname">{boardName(p, everyone)}</span>
        </div>
      ))}
    </div>
  );
}
```

Create `src/ui/BoardWaiting.tsx`:

```tsx
import { useEffect, useRef, useState } from 'react';
import type { Player } from '../engine';
import { boardName, waitingCapacity } from '../store/boardInfo';
import { PlayerAvatar } from './PlayerAvatar';

/** Where nothing has a size (tests): room for six circles. */
const FALLBACK = { width: 6, item: 1, gap: 0 };

/** How many of `total` waiting players fit in the strip, measured from the page. */
function useCapacity(total: number) {
  const strip = useRef<HTMLOListElement>(null);
  const [size, setSize] = useState(FALLBACK);

  useEffect(() => {
    const el = strip.current;
    if (!el || typeof ResizeObserver === 'undefined') return;
    const measure = () => {
      const first = el.firstElementChild;
      const item = first ? first.getBoundingClientRect().width : 0;
      const width = el.clientWidth;
      if (!item || !width) return setSize(FALLBACK);
      const gap = parseFloat(getComputedStyle(el).columnGap) || 0;
      setSize((old) => (old.width === width && old.item === item && old.gap === gap ? old : { width, item, gap }));
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [total > 0]);

  return { strip, shown: waitingCapacity(size.width, size.item, size.gap, total) };
}

interface Props {
  waiting: Player[];
  everyone: Player[];
}

/** The strip along the bottom: who is waiting, in the order they will play. */
export function BoardWaiting({ waiting, everyone }: Props) {
  const { strip, shown } = useCapacity(waiting.length);
  const hidden = waiting.length - shown;
  return (
    <section className="board-waiting" aria-label="Waiting">
      <div className="board-wl">
        <span className="board-wl-label">Waiting</span>
        <b className="board-wl-count">{waiting.length}</b>
      </div>
      {waiting.length === 0 ? (
        <p className="board-none">No one is waiting.</p>
      ) : (
        <ol className="board-wstrip" aria-label="Waiting players" ref={strip}>
          {waiting.slice(0, shown).map((p, i) => (
            <li key={p.id} className={`board-wpf${i === 0 ? ' is-first' : ''}`}>
              <div className="board-circle">
                <PlayerAvatar name={p.name} rosterId={p.rosterId} size="fill" />
              </div>
              <span className="board-no">{i + 1}</span>
              <span className="board-pname">{boardName(p, everyone)}</span>
            </li>
          ))}
          {hidden > 0 && (
            <li className="board-wpf board-wmore" aria-label={`${hidden} more waiting`}>
              <div className="board-circle board-more-circle">+{hidden}</div>
            </li>
          )}
        </ol>
      )}
    </section>
  );
}
```

Apply this patch (save it as `step.patch`, run `git apply step.patch`, then delete it). It changes `src/styles/app.css`, `src/ui/Avatar.tsx`, `src/ui/PlayerAvatar.tsx`:

```diff
diff --git a/src/styles/app.css b/src/styles/app.css
--- a/src/styles/app.css
+++ b/src/styles/app.css
@@ -2250 +2250,424 @@ caption {
 }
+
+/* Board */
+/* A full-screen board for a TV or a phone on a stand. It sets its own dark colours whatever the app theme is. */
+.board {
+  --board-bg: #0f0f0e;
+  --board-fg: #f5f5f0;
+  --board-mut: #9b9b94;
+  --board-card: #1a1a19;
+  --board-line: #2a2a28;
+  --board-edge: #77776f;
+  --board-lime: #c8f03c;
+  --board-lime-ink: #0f0f0e;
+  --board-a: #18202e;
+  --board-a-line: #34445f;
+  --board-b: #2b1d1f;
+  --board-b-line: #5a3a3e;
+  /* Initials tile: lightness 32% keeps white text at 4.5 to 1 or more for every hue. */
+  --board-tile-s: 42%;
+  --board-tile-l: 32%;
+  position: fixed;
+  inset: 0;
+  z-index: 30;
+  box-sizing: border-box;
+  display: flex;
+  flex-direction: column;
+  gap: 1.4vmin;
+  padding: 2vmin;
+  overflow: hidden;
+  background: var(--board-bg);
+  color: var(--board-fg);
+  color-scheme: dark;
+  line-height: 1.2;
+}
+
+.board-head {
+  flex: none;
+  display: flex;
+  align-items: center;
+  justify-content: space-between;
+  gap: 12px;
+}
+
+.board-head-l,
+.board-head-r {
+  display: flex;
+  align-items: center;
+  gap: 12px;
+  min-width: 0;
+}
+
+.board-name {
+  margin: 0;
+  font-size: clamp(16px, 2.6vmin, 30px);
+  font-weight: 600;
+  white-space: nowrap;
+  overflow: hidden;
+  text-overflow: ellipsis;
+}
+
+.board-venue,
+.board-end,
+.board-more {
+  color: var(--board-mut);
+  font-size: clamp(13px, 2vmin, 22px);
+  white-space: nowrap;
+}
+
+.board-clock {
+  font-size: clamp(16px, 2.6vmin, 30px);
+  font-weight: 600;
+  font-variant-numeric: tabular-nums;
+  white-space: nowrap;
+}
+
+.board-close {
+  flex: none;
+  display: inline-flex;
+  align-items: center;
+  justify-content: center;
+  width: 44px;
+  height: 44px;
+  padding: 0;
+  border: 1px solid var(--board-edge);
+  border-radius: 50%;
+  background: transparent;
+  color: var(--board-fg);
+  cursor: pointer;
+}
+
+.board-close:focus-visible {
+  outline: 2px solid var(--board-lime);
+  outline-offset: 2px;
+}
+
+/* Portrait: courts stacked in rows. Landscape: columns, set below. */
+.board-courts {
+  flex: 1;
+  min-height: 0;
+  margin: 0;
+  padding: 0;
+  list-style: none;
+  display: grid;
+  gap: 1.4vmin;
+  grid-template-columns: repeat(var(--cols-port, 1), minmax(0, 1fr));
+  grid-template-rows: repeat(var(--rows-port, 1), minmax(0, 1fr));
+}
+
+.board-court {
+  container-type: size;
+  box-sizing: border-box;
+  min-width: 0;
+  min-height: 0;
+  display: flex;
+  flex-direction: column;
+  gap: 2cqmin;
+  padding: 3cqmin;
+  overflow: hidden;
+  border: 1px solid var(--board-line);
+  border-radius: 14px;
+  background: var(--board-card);
+}
+
+.board-court-ready {
+  border: 1.5px dashed var(--board-lime);
+  background: transparent;
+}
+
+.board-court-open {
+  border: 1.5px dashed var(--board-edge);
+  background: transparent;
+}
+
+.board-court-head {
+  flex: none;
+  display: flex;
+  align-items: center;
+  justify-content: space-between;
+  gap: 8px;
+  min-height: 0;
+}
+
+.board-court-n {
+  color: var(--board-mut);
+  font-size: clamp(11px, 4cqmin, 20px);
+  letter-spacing: 0.08em;
+  text-transform: uppercase;
+}
+
+.board-timer {
+  color: var(--board-lime);
+  font-size: clamp(18px, 9cqmin, 56px);
+  font-weight: 600;
+  font-variant-numeric: tabular-nums;
+  letter-spacing: -0.03em;
+  line-height: 1;
+}
+
+.board-tag {
+  color: var(--board-lime);
+  font-size: clamp(12px, 5cqmin, 24px);
+  font-weight: 600;
+}
+
+.board-closing {
+  padding: 0 0.6em;
+  border: 1px solid var(--board-edge);
+  border-radius: 999px;
+  color: var(--board-fg);
+  font-size: clamp(11px, 4cqmin, 20px);
+  white-space: nowrap;
+}
+
+.board-open {
+  flex: 1;
+  margin: 0;
+  display: flex;
+  align-items: center;
+  justify-content: center;
+  color: var(--board-mut);
+  font-size: clamp(16px, 10cqmin, 44px);
+}
+
+/* Portrait: Team A, VS and Team B side by side. */
+.board-teams {
+  --d: min(48cqh, 19cqw);
+  --vs: min(20cqh, 9cqw);
+  flex: 1;
+  min-height: 0;
+  display: flex;
+  flex-direction: row;
+  align-items: stretch;
+  gap: 1.5cqmin;
+}
+
+.board-team {
+  flex: 1;
+  min-width: 0;
+  min-height: 0;
+  display: flex;
+  align-items: center;
+  justify-content: space-evenly;
+  box-sizing: border-box;
+  padding: 2cqmin 1cqmin;
+  border-radius: 13px;
+}
+
+.board-team-a {
+  background: var(--board-a);
+  box-shadow: inset 0 0 0 1.5px var(--board-a-line);
+}
+
+.board-team-b {
+  background: var(--board-b);
+  box-shadow: inset 0 0 0 1.5px var(--board-b-line);
+}
+
+.board-pf {
+  flex: 1;
+  min-width: 0;
+  display: flex;
+  flex-direction: column;
+  align-items: center;
+  gap: 0.4em;
+  font-size: clamp(11px, 3.4cqmin, 22px);
+}
+
+.board-circle {
+  flex: none;
+  width: var(--d);
+  border-radius: 50%;
+  box-shadow: 0 0 0 2px rgba(255, 255, 255, 0.14);
+}
+
+.board-pname {
+  max-width: 100%;
+  overflow: hidden;
+  font-weight: 600;
+  text-overflow: ellipsis;
+  white-space: nowrap;
+}
+
+.board-vs {
+  flex: none;
+  align-self: center;
+  box-sizing: border-box;
+  display: flex;
+  align-items: center;
+  justify-content: center;
+  width: var(--vs);
+  height: var(--vs);
+  border: 1.5px solid var(--board-edge);
+  border-radius: 50%;
+  background: var(--board-bg);
+  font-size: calc(var(--vs) * 0.38);
+  font-weight: 700;
+  letter-spacing: 0.04em;
+}
+
+/* Circles that fill their container, with a photo or initials on a colour from the name. */
+.avatar-fill {
+  width: 100%;
+  height: auto;
+  aspect-ratio: 1;
+}
+
+.board .avatar-fill {
+  background: radial-gradient(
+    circle at 50% 36%,
+    hsl(var(--h, 0) var(--board-tile-s) var(--board-tile-l)),
+    hsl(var(--h, 0) 45% 20%)
+  );
+  color: #fff;
+  font-size: calc(var(--d, var(--wd)) * 0.36);
+  font-weight: 600;
+  object-fit: cover;
+  object-position: 50% 25%;
+}
+
+/* Waiting */
+.board-waiting {
+  container-type: size;
+  flex: none;
+  height: 17%;
+  box-sizing: border-box;
+  display: flex;
+  flex-direction: column;
+  gap: 1cqmin;
+}
+
+.board-wl {
+  flex: none;
+  display: flex;
+  align-items: baseline;
+  justify-content: space-between;
+  padding: 0 3px;
+}
+
+.board-wl-label {
+  color: var(--board-mut);
+  font-size: clamp(11px, 2cqmin, 18px);
+  letter-spacing: 0.08em;
+  text-transform: uppercase;
+}
+
+.board-wl-count {
+  font-size: clamp(14px, 3cqmin, 30px);
+  font-weight: 600;
+}
+
+.board-none {
+  margin: 0;
+  color: var(--board-mut);
+  font-size: clamp(14px, 3cqmin, 24px);
+}
+
+.board-wstrip {
+  --wd: min(50cqh, 15cqw);
+  flex: 1;
+  min-width: 0;
+  min-height: 0;
+  margin: 0;
+  padding: 0;
+  list-style: none;
+  display: flex;
+  align-items: flex-start;
+  justify-content: flex-start;
+  gap: 1.4cqw;
+}
+
+.board-wpf {
+  position: relative;
+  flex: none;
+  width: var(--wd);
+  display: flex;
+  flex-direction: column;
+  align-items: center;
+  gap: 3px;
+  padding-top: 3px;
+  font-size: clamp(10px, 11cqh, 20px);
+}
+
+.board-wpf .board-circle {
+  width: 100%;
+}
+
+.board-wpf.is-first .board-circle {
+  box-shadow: 0 0 0 3px var(--board-lime);
+}
+
+.board-no {
+  position: absolute;
+  top: 0;
+  left: 0;
+  z-index: 1;
+  box-sizing: border-box;
+  display: flex;
+  align-items: center;
+  justify-content: center;
+  width: calc(var(--wd) * 0.3);
+  height: calc(var(--wd) * 0.3);
+  border: 1.5px solid var(--board-bg);
+  border-radius: 50%;
+  background: var(--board-line);
+  font-size: calc(var(--wd) * 0.17);
+  font-weight: 600;
+}
+
+.board-wpf.is-first .board-no {
+  background: var(--board-lime);
+  color: var(--board-lime-ink);
+}
+
+.board-more-circle {
+  box-sizing: border-box;
+  display: flex;
+  align-items: center;
+  justify-content: center;
+  aspect-ratio: 1;
+  border: 1.5px dashed var(--board-edge);
+  color: var(--board-mut);
+  box-shadow: none;
+  font-size: calc(var(--wd) * 0.3);
+  font-weight: 600;
+}
+
+/* Landscape on a wide screen: courts in columns, each court a column with the teams stacked. */
+@media (orientation: landscape) and (min-width: 640px) {
+  .board-courts {
+    grid-template-columns: repeat(var(--cols-land, 1), minmax(0, 1fr));
+    grid-template-rows: repeat(var(--rows-land, 1), minmax(0, 1fr));
+  }
+
+  .board-teams {
+    --d: min(26cqh, 34cqw);
+    --vs: min(8cqh, 9cqw);
+    flex-direction: column;
+  }
+
+  .board-waiting {
+    height: 22%;
+    flex-direction: row;
+    gap: 1.4cqw;
+  }
+
+  .board-wl {
+    flex-direction: column;
+    align-items: flex-start;
+    justify-content: center;
+    width: 11%;
+  }
+
+  .board-wstrip {
+    --wd: min(62cqh, 11cqw);
+  }
+}
+
+/* A narrow screen: the venue and the end time make room. The name, the clock and Close stay. */
+@media (max-width: 520px) {
+  .board-venue,
+  .board-end {
+    display: none;
+  }
+}
diff --git a/src/ui/Avatar.tsx b/src/ui/Avatar.tsx
--- a/src/ui/Avatar.tsx
+++ b/src/ui/Avatar.tsx
@@ -1 +1,4 @@
+import type { CSSProperties } from 'react';
+import { nameHue } from '../store/boardInfo';
+
 export function initials(name: string): string {
@@ -13,3 +16,4 @@ interface AvatarProps {
   name: string;
-  size?: 'sm' | 'md' | 'lg';
+  /** `fill` makes the circle as wide as its container, for the board. */
+  size?: 'sm' | 'md' | 'lg' | 'fill';
   /** A photo to show; initials are shown without one. */
@@ -24,3 +28,7 @@ export function Avatar({ name, size = 'md', photoUrl }: AvatarProps) {
   return (
-    <span className={`avatar avatar-${size}`} aria-hidden="true">
+    <span
+      className={`avatar avatar-${size}`}
+      style={size === 'fill' ? ({ '--h': nameHue(name) } as CSSProperties) : undefined}
+      aria-hidden="true"
+    >
       {initials(name)}
diff --git a/src/ui/PlayerAvatar.tsx b/src/ui/PlayerAvatar.tsx
--- a/src/ui/PlayerAvatar.tsx
+++ b/src/ui/PlayerAvatar.tsx
@@ -7,3 +7,3 @@ interface Props {
   rosterId?: string;
-  size?: 'sm' | 'md' | 'lg';
+  size?: 'sm' | 'md' | 'lg' | 'fill';
 }
```

- [ ] **Step 4: Run them, then the whole project**

Run: `npx vitest run src/ui/BoardScreen.test.tsx src/store/boardInfo.test.ts`
Expected: both files pass.

Then run `npx tsc --noEmit && npx vitest run`.
Expected: `tsc` prints nothing and the suite shows 1437 tests across 116 files.

- [ ] **Step 5: Commit**

```bash
git add src/styles/app.css src/ui/Avatar.tsx src/ui/BoardCourt.tsx src/ui/BoardScreen.test.tsx src/ui/BoardScreen.tsx src/ui/BoardTeam.tsx src/ui/BoardWaiting.tsx src/ui/PlayerAvatar.tsx
git commit -m "Add the board screen: courts, teams, clocks and the waiting row"
```

### Task 3: Cover the header clock refresh

The mutation run found a break the first tests could not catch: the time of day in the header refreshing every second instead of every minute. The text looks the same either way, so this test checks the two interval lengths.

**Files:**
- Modify: `src/ui/BoardScreen.test.tsx`

- [ ] **Step 1: Add the test**

Apply this patch (save it as `step.patch`, run `git apply step.patch`, then delete it). It changes `src/ui/BoardScreen.test.tsx`:

```diff
diff --git a/src/ui/BoardScreen.test.tsx b/src/ui/BoardScreen.test.tsx
--- a/src/ui/BoardScreen.test.tsx
+++ b/src/ui/BoardScreen.test.tsx
@@ -86,2 +86,9 @@ describe('the board header', () => {
 
+  it('uses one one-second interval for the courts and one one-minute interval for the time of day', () => {
+    const spy = vi.spyOn(globalThis, 'setInterval');
+    view(build([court(1)]));
+    expect(spy.mock.calls.map((c) => c[1]).sort((a, b) => Number(a) - Number(b))).toEqual([SEC, MIN]);
+    spy.mockRestore();
+  });
+
   it('does not announce the time of day', () => {
```

- [ ] **Step 2: Run it**

Run: `npx vitest run src/ui/BoardScreen.test.tsx`
Expected: passes. It passes straight away because the code is already right; its job is to fail when the break named above is made. The final task runs that break.

- [ ] **Step 3: Check the whole project**

Run `npx tsc --noEmit && npx vitest run`.
Expected: `tsc` prints nothing and the suite shows 1438 tests across 116 files.

- [ ] **Step 4: Commit**

```bash
git add src/ui/BoardScreen.test.tsx
git commit -m "Cover a gap found by the mutation check"
```

### Task 4: Show board in the live menu (wiring)

"Show board" is the item after "Settings" in the live menu. The board is a screen of its own that opens only for a running session, pushes one history entry, and closes with its Close button, the Escape key or the phone's Back button. If the session ends while the board is open, the summary shows and the board can never come back.

**Files:**
- Modify: `src/ui/App.tsx`
- Modify: `src/ui/LiveScreen.tsx`
- Modify: `src/ui/addPlayerButton.test.tsx`
- Create: `src/ui/boardWiring.test.tsx`
- Modify: `src/ui/liveHome.test.tsx`
- Modify: `src/ui/liveScreen.test.tsx`
- Modify: `src/ui/oneUndo.test.tsx`

- [ ] **Step 1: Write the failing tests**

Create `src/ui/boardWiring.test.tsx`:

```tsx
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { newTestSession } from '../engine/testing';
import { resetHistoryDbForTests } from '../store/historyDb';
import { useHistoryStore } from '../store/historyStore';
import { resetRosterDbForTests } from '../store/rosterDb';
import { useRosterStore } from '../store/rosterStore';
import { useSessionStore } from '../store/sessionStore';
import { DEFAULT_SLOTS, useSlotsStore } from '../store/slots';
import css from '../styles/app.css?raw';
import App from './App';

const running = () => newTestSession(['Ann', 'Ben', 'Cy', 'Dee', 'Eve'], { courts: 2 });
const endedSession = () => ({ ...running(), endedAt: Date.now() });

beforeEach(async () => {
  localStorage.clear();
  localStorage.setItem('pickleball.autoStart', 'true');
  window.history.replaceState({ pk: 0, view: 'home' }, '');
  window.history.pushState(null, '');
  useSessionStore.setState({ session: null, undoStack: [], saveFailed: false });
  useSlotsStore.setState({ slots: DEFAULT_SLOTS.slots.map((s) => ({ ...s })), venues: [], tonight: {} });
  await resetRosterDbForTests();
  await resetHistoryDbForTests();
  useRosterStore.setState({ players: [], loaded: false });
  useHistoryStore.setState({ entries: [], loaded: false, persistent: true });
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date(2026, 10, 13, 12));
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.restoreAllMocks();
  window.history.replaceState(null, '');
});

const setup = () => userEvent.setup({ advanceTimers: () => {} });
type User = ReturnType<typeof setup>;
const state = () => window.history.state as { pk: number; view: string };
const board = () => screen.queryByRole('main', { name: 'Board' });
const liveTabs = () => screen.queryByRole('tablist', { name: 'Courts' });
const phoneBack = () => act(() => window.history.back());
const pop = (st: unknown) => act(() => void window.dispatchEvent(new PopStateEvent('popstate', { state: st })));
const settle = () => act(() => new Promise<void>((r) => setTimeout(r, 20)));
const menuLabels = () => within(document.querySelector<HTMLElement>('.menu-pop')!).getAllByRole('button').map((b) => b.textContent);
const openBoard = async (user: User) => {
  await user.click(screen.getByRole('button', { name: 'Menu' }));
  await user.click(screen.getByRole('button', { name: 'Show board' }));
};

describe('Show board in the live menu', () => {
  it('sits directly after Settings', async () => {
    useSessionStore.setState({ session: running() });
    const user = setup();
    render(<App />);
    await user.click(screen.getByRole('button', { name: 'Menu' }));
    const labels = menuLabels();
    expect(labels[0]).toBe('Settings');
    expect(labels[1]).toBe('Show board');
  });

  it('opens the board and pushes one history entry', async () => {
    useSessionStore.setState({ session: running() });
    const user = setup();
    render(<App />);
    const length = window.history.length;
    await openBoard(user);
    expect(board()).toBeInTheDocument();
    expect(liveTabs()).not.toBeInTheDocument();
    expect(state()).toEqual({ pk: 1, view: 'board' });
    expect(window.history.length).toBe(length + 1);
  });

  it('hides the app title bar while the board is open', async () => {
    useSessionStore.setState({ session: running() });
    const user = setup();
    render(<App />);
    await openBoard(user);
    expect(document.querySelector('.app-header')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Home' })).not.toBeInTheDocument();
  });
});

describe('closing the board', () => {
  it('Close returns to the live screen and steps the history back', async () => {
    useSessionStore.setState({ session: running() });
    const back = vi.spyOn(window.history, 'back');
    const user = setup();
    render(<App />);
    await openBoard(user);
    await user.click(screen.getByRole('button', { name: 'Close board' }));
    expect(board()).not.toBeInTheDocument();
    expect(liveTabs()).toBeInTheDocument();
    expect(back).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(state()).toEqual({ pk: 0, view: 'live' }));
  });

  it('the Escape key returns to the live screen and steps the history back', async () => {
    useSessionStore.setState({ session: running() });
    const back = vi.spyOn(window.history, 'back');
    const user = setup();
    render(<App />);
    await openBoard(user);
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(board()).not.toBeInTheDocument();
    expect(liveTabs()).toBeInTheDocument();
    expect(back).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(state()).toEqual({ pk: 0, view: 'live' }));
  });

  it('the phone Back button returns to the live screen', async () => {
    useSessionStore.setState({ session: running() });
    const user = setup();
    render(<App />);
    await openBoard(user);
    phoneBack();
    expect(await screen.findByRole('tablist', { name: 'Courts' })).toBeInTheDocument();
    expect(board()).not.toBeInTheDocument();
    expect(state().pk).toBe(0);
  });

  it('leaves the session object untouched by the round trip', async () => {
    const before = running();
    useSessionStore.setState({ session: before });
    const user = setup();
    render(<App />);
    await openBoard(user);
    await user.click(screen.getByRole('button', { name: 'Close board' }));
    expect(useSessionStore.getState().session).toBe(before);
  });

  it('can be opened again after closing, with the history staying in step', async () => {
    useSessionStore.setState({ session: running() });
    const user = setup();
    render(<App />);
    await openBoard(user);
    await user.click(screen.getByRole('button', { name: 'Close board' }));
    await waitFor(() => expect(state().pk).toBe(0));
    await openBoard(user);
    expect(board()).toBeInTheDocument();
    expect(state()).toEqual({ pk: 1, view: 'board' });
  });

  it('shows the board again for a forward step onto its entry while the session runs', async () => {
    useSessionStore.setState({ session: running() });
    const user = setup();
    render(<App />);
    await openBoard(user);
    phoneBack();
    await screen.findByRole('tablist', { name: 'Courts' });
    act(() => window.history.forward());
    expect(await screen.findByRole('main', { name: 'Board' })).toBeInTheDocument();
  });
});

describe('a session that ends while the board is open', () => {
  it('shows the summary, and the board does not come back', async () => {
    useSessionStore.setState({ session: running() });
    const user = setup();
    render(<App />);
    await openBoard(user);
    act(() => useSessionStore.setState({ session: endedSession() }));
    expect(board()).not.toBeInTheDocument();
    expect(screen.getByText('Session summary')).toBeInTheDocument();
    // The entry the board held now holds the live screen, so nothing can step back onto the board.
    expect(state()).toEqual({ pk: 1, view: 'live' });
    phoneBack();
    await settle();
    expect(board()).not.toBeInTheDocument();
    expect(screen.getByText('Session summary')).toBeInTheDocument();
    act(() => window.history.forward());
    await settle();
    expect(board()).not.toBeInTheDocument();
    expect(screen.getByText('Session summary')).toBeInTheDocument();
  });

  it('lands on Home after Done, as before', async () => {
    useSessionStore.setState({ session: running() });
    const user = setup();
    render(<App />);
    await openBoard(user);
    act(() => useSessionStore.setState({ session: endedSession() }));
    await user.click(screen.getByRole('button', { name: 'Done' }));
    await waitFor(() => expect(screen.getByRole('radiogroup', { name: 'Sessions' })).toBeInTheDocument());
    expect(board()).not.toBeInTheDocument();
    expect(state()).toEqual({ pk: 0, view: 'home' });
  });

  it('does not reopen the board for a session that starts afterwards', async () => {
    useSessionStore.setState({ session: running() });
    const user = setup();
    render(<App />);
    await openBoard(user);
    act(() => useSessionStore.setState({ session: endedSession() }));
    await user.click(screen.getByRole('button', { name: 'Done' }));
    await waitFor(() => expect(screen.getByRole('radiogroup', { name: 'Sessions' })).toBeInTheDocument());
    act(() => useSessionStore.setState({ session: running() }));
    expect(board()).not.toBeInTheDocument();
    expect(await screen.findByRole('tablist', { name: 'Courts' })).toBeInTheDocument();
  });
});

describe('an entry for the board that cannot be shown', () => {
  it('never renders for a missing session', () => {
    render(<App />);
    pop({ pk: 1, view: 'board' });
    expect(board()).not.toBeInTheDocument();
    expect(screen.getByRole('radiogroup', { name: 'Sessions' })).toBeInTheDocument();
  });

  it('never renders for an ended session', () => {
    useSessionStore.setState({ session: endedSession() });
    render(<App />);
    pop({ pk: 1, view: 'board' });
    expect(board()).not.toBeInTheDocument();
    expect(screen.getByText('Session summary')).toBeInTheDocument();
  });

  it('falls back to the live screen after a reload that left the board state behind', () => {
    useSessionStore.setState({ session: running() });
    window.history.replaceState({ pk: 1, view: 'board' }, '');
    render(<App />);
    expect(board()).not.toBeInTheDocument();
    expect(liveTabs()).toBeInTheDocument();
    expect(state()).toEqual({ pk: 0, view: 'live' });
  });

  it('falls back safely for a board entry with no pk or a null session after the entry is replayed', async () => {
    useSessionStore.setState({ session: running() });
    const user = setup();
    render(<App />);
    await openBoard(user);
    act(() => useSessionStore.setState({ session: null }));
    expect(board()).not.toBeInTheDocument();
    expect(document.body.textContent).not.toBe('');
    pop({ view: 'board' });
    expect(board()).not.toBeInTheDocument();
    expect(screen.getByRole('radiogroup', { name: 'Sessions' })).toBeInTheDocument();
  });
});

describe('the board overlay', () => {
  it('sits above every other layer, the sheets and the app bars included', () => {
    const own = /(?:^|\})\s*\.board\s*\{([^}]*)\}/m.exec(css)![1];
    const boardZ = Number(/z-index:\s*(\d+)/.exec(own)![1]);
    const all = [...css.matchAll(/z-index:\s*(\d+)/g)].map((m) => Number(m[1]));
    expect(all.length).toBeGreaterThan(4);
    // Its own is the only one at that height or above.
    expect(all.filter((z) => z >= boardZ)).toHaveLength(1);
  });

  it('covers the whole screen', () => {
    const m = /(?:^|\})\s*\.board\s*\{([^}]*)\}/m.exec(css)!;
    expect(m[1]).toMatch(/position:\s*fixed/);
    expect(m[1]).toMatch(/inset:\s*0/);
  });
});
```

Apply this patch (save it as `step.patch`, run `git apply step.patch`, then delete it). It changes `src/ui/addPlayerButton.test.tsx`, `src/ui/liveHome.test.tsx`, `src/ui/liveScreen.test.tsx`, `src/ui/oneUndo.test.tsx`:

```diff
diff --git a/src/ui/addPlayerButton.test.tsx b/src/ui/addPlayerButton.test.tsx
--- a/src/ui/addPlayerButton.test.tsx
+++ b/src/ui/addPlayerButton.test.tsx
@@ -50,3 +50,3 @@ describe('Add player on the live screen', () => {
     const pop = document.querySelector<HTMLElement>('.menu-pop')!;
-    expect(within(pop).getAllByRole('button')[1]).toHaveTextContent('Add player'); // Settings is first
+    expect(within(pop).getAllByRole('button')[2]).toHaveTextContent('Add player'); // Settings and Show board come first
     await user.click(within(pop).getByRole('button', { name: 'Add player' }));
diff --git a/src/ui/liveHome.test.tsx b/src/ui/liveHome.test.tsx
--- a/src/ui/liveHome.test.tsx
+++ b/src/ui/liveHome.test.tsx
@@ -43,3 +43,3 @@ describe('the live screen header', () => {
     const user = setup();
-    render(<LiveScreen session={running()} onHome={onHome} onSettings={() => {}} />);
+    render(<LiveScreen session={running()} onHome={onHome} onSettings={() => {}} onShowBoard={() => {}} />);
     await user.click(screen.getByRole('button', { name: 'Home' }));
@@ -52,3 +52,3 @@ describe('the live screen header', () => {
     const user = setup();
-    render(<LiveScreen session={running()} onHome={() => {}} onSettings={onSettings} />);
+    render(<LiveScreen session={running()} onHome={() => {}} onSettings={onSettings} onShowBoard={() => {}} />);
     await user.click(screen.getByRole('button', { name: 'Menu' }));
@@ -60,2 +60,14 @@ describe('the live screen header', () => {
 
+describe('the Show board item', () => {
+  it('follows Settings in the menu and calls onShowBoard', async () => {
+    const onShowBoard = vi.fn();
+    const user = setup();
+    render(<LiveScreen session={running()} onHome={() => {}} onSettings={() => {}} onShowBoard={onShowBoard} />);
+    await user.click(screen.getByRole('button', { name: 'Menu' }));
+    expect(menuItems().slice(0, 2)).toEqual(['Settings', 'Show board']);
+    await user.click(screen.getByRole('button', { name: 'Show board' }));
+    expect(onShowBoard).toHaveBeenCalledTimes(1);
+  });
+});
+
 describe('Home from the live screen, in the app', () => {
diff --git a/src/ui/liveScreen.test.tsx b/src/ui/liveScreen.test.tsx
--- a/src/ui/liveScreen.test.tsx
+++ b/src/ui/liveScreen.test.tsx
@@ -381,5 +381,5 @@ describe('extending the session', () => {
     const base = { ...newTestSession(['A', 'B', 'C', 'D']), plannedEndAt: END };
-    const { rerender } = render(<LiveScreen session={base} onHome={() => {}} onSettings={() => {}} />);
+    const { rerender } = render(<LiveScreen session={base} onHome={() => {}} onSettings={() => {}} onShowBoard={() => {}} />);
     expect(chip()).toBeInTheDocument();
-    rerender(<LiveScreen session={{ ...base, endedAt: END }} onHome={() => {}} onSettings={() => {}} />);
+    rerender(<LiveScreen session={{ ...base, endedAt: END }} onHome={() => {}} onSettings={() => {}} onShowBoard={() => {}} />);
     expect(chip()).not.toBeInTheDocument();
diff --git a/src/ui/oneUndo.test.tsx b/src/ui/oneUndo.test.tsx
--- a/src/ui/oneUndo.test.tsx
+++ b/src/ui/oneUndo.test.tsx
@@ -105,3 +105,3 @@ describe('Undo in the menu', () => {
 
-  it('says what it will undo, is the first item, and works', async () => {
+  it('says what it will undo, is the first item after Settings and Show board, and works', async () => {
     const user = userEvent.setup();
@@ -110,3 +110,3 @@ describe('Undo in the menu', () => {
     const pop = await menu(user);
-    const first = within(pop).getAllByRole('button')[1]; // Settings is first
+    const first = within(pop).getAllByRole('button')[2]; // Settings and Show board come first
     expect(first).toHaveTextContent('Undo: Started Court 1');
@@ -123,3 +123,3 @@ describe('Undo in the menu', () => {
     const pop = await menu(user);
-    expect(within(pop).getAllByRole('button')[1]).toHaveTextContent('Undo last action');
+    expect(within(pop).getAllByRole('button')[2]).toHaveTextContent('Undo last action');
   });
```

- [ ] **Step 2: Run them and watch them fail**

Run: `npx vitest run src/ui/boardWiring.test.tsx`
Expected: 13 tests fail because there is no "Show board" item. The 5 that pass are guards on behaviour that already holds (no board for a missing or ended session, a bad history entry, two CSS checks).

- [ ] **Step 3: Write the code**

Apply this patch (save it as `step.patch`, run `git apply step.patch`, then delete it). It changes `src/ui/App.tsx`, `src/ui/LiveScreen.tsx`:

```diff
diff --git a/src/ui/App.tsx b/src/ui/App.tsx
--- a/src/ui/App.tsx
+++ b/src/ui/App.tsx
@@ -10,2 +10,3 @@ import { ErrorBoundary } from './ErrorBoundary';
 import { SignInBanner } from './SignInBanner';
+import { BoardScreen } from './BoardScreen';
 import { HomeScreen, type SessionPlan } from './HomeScreen';
@@ -22,3 +23,3 @@ import { useWakeLock } from './useWakeLock';
 
-type View = 'home' | 'setup' | 'saved' | 'settings' | 'history' | 'summary' | 'live';
+type View = 'home' | 'setup' | 'saved' | 'settings' | 'history' | 'summary' | 'live' | 'board';
 
@@ -68,2 +69,5 @@ export default function App() {
           return fallback;
+        case 'board':
+          // The board only shows while a session is running.
+          return session && !session.endedAt ? 'board' : fallback;
         case 'setup':
@@ -106,2 +110,3 @@ export default function App() {
   };
+  const openBoard = () => screens.push('board');
   const openSetup = (p: SessionPlan | undefined) => {
@@ -138,2 +143,11 @@ export default function App() {
 
+  // A session that ends under the board shows its summary, and the board's history entry becomes the live screen's,
+  // so Back or Forward can never land on the board again.
+  const ended = !!session?.endedAt;
+  useEffect(() => {
+    if (!ended || view !== 'board') return;
+    setView('live');
+    screens.replace('live');
+  }, [ended, view, screens]);
+
   // Done makes the current entry the first one again; a new session takes over the entry Who's playing held.
@@ -228,4 +242,6 @@ export default function App() {
     screen = <SummaryScreen session={session} leaveRef={leaveSummary} />;
+  } else if (view === 'board') {
+    screen = <BoardScreen session={session} onClose={() => screens.back('live')} />;
   } else {
-    screen = <LiveScreen session={session} onHome={() => screens.push('home')} onSettings={openSettings} />;
+    screen = <LiveScreen session={session} onHome={() => screens.push('home')} onSettings={openSettings} onShowBoard={openBoard} />;
   }
@@ -233,3 +249,4 @@ export default function App() {
   // The live screen has its own slim top bar, so the app's title bar is left out to give the court the room.
-  const live = !!session && !session.endedAt && !overlay && view === 'live';
+  // The board covers the whole screen, so the title bar is left out under it too.
+  const live = !!session && !session.endedAt && !overlay && (view === 'live' || view === 'board');
 
diff --git a/src/ui/LiveScreen.tsx b/src/ui/LiveScreen.tsx
--- a/src/ui/LiveScreen.tsx
+++ b/src/ui/LiveScreen.tsx
@@ -35,3 +35,3 @@ function HomeButton({ onClick }: { onClick: () => void }) {
 
-export function LiveScreen({ session, onHome, onSettings }: { session: Session; onHome: () => void; onSettings: () => void }) {
+export function LiveScreen({ session, onHome, onSettings, onShowBoard }: { session: Session; onHome: () => void; onSettings: () => void; onShowBoard: () => void }) {
   const apply = useSessionStore((s) => s.apply);
@@ -154,2 +154,3 @@ export function LiveScreen({ session, onHome, onSettings }: { session: Session;
               { label: 'Settings', onSelect: onSettings },
+              { label: 'Show board', onSelect: onShowBoard },
               ...(undoCount > 0 ? [{ label: lastAction ? `Undo: ${lastAction.label}` : 'Undo last action', onSelect: undo }] : []),
```

- [ ] **Step 4: Run them, then the whole project**

Run: `npx vitest run src/ui/boardWiring.test.tsx src/ui/liveHome.test.tsx src/ui/liveScreen.test.tsx src/ui/addPlayerButton.test.tsx src/ui/oneUndo.test.tsx`
Expected: all pass.

Then run `npx tsc --noEmit && npx vitest run`.
Expected: `tsc` prints nothing and the suite shows 1457 tests across 117 files.

- [ ] **Step 5: Commit**

```bash
git add src/ui/App.tsx src/ui/LiveScreen.tsx src/ui/addPlayerButton.test.tsx src/ui/boardWiring.test.tsx src/ui/liveHome.test.tsx src/ui/liveScreen.test.tsx src/ui/oneUndo.test.tsx
git commit -m "Add Show board to the live menu"
```

### Task 5: Polish the board from the browser check

Looking at the built board at TV and phone sizes found several problems: type and clocks too small on a TV, a waiting row that left a wide empty band, cards that stack their teams when they are too short, a header that pushed Close off a narrow screen, and a dead band when nobody is waiting. The fixes are CSS rules that scale with the card, and one component class.

**Files:**
- Modify: `src/styles/app.css`
- Modify: `src/ui/BoardScreen.test.tsx`
- Modify: `src/ui/BoardWaiting.tsx`
- Create: `src/ui/boardPolishCss.test.tsx`

- [ ] **Step 1: Write the failing tests**

Create `src/ui/boardPolishCss.test.tsx`:

```tsx
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { mkPlayer, mkSession } from '../engine/testing';
import css from '../styles/app.css?raw';
import { BoardWaiting } from './BoardWaiting';

afterEach(cleanup);

/** The declarations of the first rule whose selector is exactly this one. */
function rule(selector: string, source = css): string {
  const esc = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const m = new RegExp(`(?:^|\\})\\s*${esc}\\s*\\{([^}]*)\\}`, 'm').exec(source);
  if (!m) throw new Error(`no rule for ${selector}`);
  return m[1];
}

/** The body of the first at-rule that starts with this text (a media or container block). */
function block(start: string): string {
  const at = css.indexOf(start);
  if (at < 0) throw new Error(`no ${start}`);
  const open = css.indexOf('{', at);
  let depth = 0;
  for (let i = open; i < css.length; i++) {
    if (css[i] === '{') depth++;
    if (css[i] === '}' && --depth === 0) return css.slice(open + 1, i);
  }
  throw new Error('unbalanced');
}

const declaration = (body: string, prop: string): string => {
  const m = new RegExp(`(?:^|[\\s;])${prop}:\\s*([^;]+);`).exec(body);
  if (!m) throw new Error(`no ${prop}`);
  return m[1].trim();
};

/** Evaluates a CSS size made of clamp, min, max, calc, var and cqw, cqh, px, rem, for a container of the given content size. */
function evalSize(expr: string, box: { w: number; h: number }, vars: Record<string, number> = {}): number {
  let i = 0;
  const src = expr.replace(/\s+/g, ' ').trim();
  function sum(): number {
    let v = product();
    while (src[i] === ' ' && (src[i + 1] === '+' || src[i + 1] === '-')) {
      const op = src[i + 1];
      i += 3;
      const r = product();
      v = op === '+' ? v + r : v - r;
    }
    return v;
  }
  function product(): number {
    let v = atom();
    while (src[i] === ' ' && src[i + 1] === '*') {
      i += 3;
      v *= atom();
    }
    return v;
  }
  function args(): number[] {
    const out = [sum()];
    while (src[i] === ',') {
      i += src[i + 1] === ' ' ? 2 : 1;
      out.push(sum());
    }
    i++; // the closing bracket
    return out;
  }
  function atom(): number {
    const rest = src.slice(i);
    const fn = /^(clamp|min|max|calc)\(/.exec(rest);
    if (fn) {
      i += fn[0].length;
      const a = fn[1] === 'calc' ? [sum()] : args();
      if (fn[1] === 'calc') i++;
      if (fn[1] === 'clamp') return Math.max(a[0], Math.min(a[1], a[2]));
      if (fn[1] === 'min') return Math.min(...a);
      if (fn[1] === 'max') return Math.max(...a);
      return a[0];
    }
    const v = /^var\((--[a-z-]+)\)/.exec(rest);
    if (v) {
      i += v[0].length;
      return vars[v[1]];
    }
    const n = /^(-?\d*\.?\d+)(cqw|cqh|px|rem)?/.exec(rest);
    if (!n) throw new Error(`cannot read "${rest}" in "${expr}"`);
    i += n[0].length;
    const x = Number(n[1]);
    return n[2] === 'cqw' ? (x * box.w) / 100 : n[2] === 'cqh' ? (x * box.h) / 100 : n[2] === 'rem' ? x * 16 : x;
  }
  return sum();
}

// A court card on a 1920 by 1080 screen with three courts, measured in the browser: 616 by 714, less padding and border.
const TV_CARD = { w: 577, h: 675 };
// A phone held upright with three courts: 346 by 179.
const PHONE_CARD = { w: 330, h: 160 };

describe('the evaluator used here', () => {
  it('reads clamp, min, max, calc and var', () => {
    expect(evalSize('clamp(20px, min(13cqw, 15cqh), 120px)', { w: 100, h: 100 })).toBe(20);
    expect(evalSize('clamp(20px, min(130cqw, 150cqh), 120px)', { w: 100, h: 100 })).toBe(120);
    expect(evalSize('max(11px, calc(var(--d) * 0.19))', { w: 1, h: 1 }, { '--d': 100 })).toBe(19);
    expect(evalSize('max(1.6rem, min(20cqh, 9cqw))', { w: 100, h: 100 })).toBe(25.6);
  });
});

describe('the board scales its type and circles to the screen', () => {
  it('has a court clock of 60 px or more on a TV with three courts, and a readable one on a phone', () => {
    const size = declaration(rule('.board-timer'), 'font-size');
    expect(evalSize(size, TV_CARD)).toBeGreaterThanOrEqual(60);
    expect(evalSize(size, PHONE_CARD)).toBeGreaterThanOrEqual(20);
  });

  it('lets the clock grow with the card, up to a ceiling above 100 px', () => {
    const size = declaration(rule('.board-timer'), 'font-size');
    expect(size).toMatch(/cqw/);
    expect(size).toMatch(/cqh/);
    expect(evalSize(size, { w: 5000, h: 5000 })).toBeGreaterThanOrEqual(100);
  });

  it('has circles of 140 px or more and names of 30 px or more on a TV with three courts', () => {
    const stacked = block('@container (max-aspect-ratio');
    const d = evalSize(declaration(stacked, '--d'), TV_CARD);
    expect(d).toBeGreaterThanOrEqual(140);
    const name = declaration(rule('.board-pf'), 'font-size');
    expect(evalSize(name, TV_CARD, { '--d': d })).toBeGreaterThanOrEqual(30);
  });

  it('keeps names at 11 px or more however small the circle', () => {
    const name = declaration(rule('.board-pf'), 'font-size');
    expect(evalSize(name, TV_CARD, { '--d': 20 })).toBe(11);
    const waiting = declaration(rule('.board-wpf'), 'font-size');
    expect(evalSize(waiting, TV_CARD, { '--wd': 20 })).toBe(11);
  });

  it('sizes the waiting names from their circle, 25 px or more at TV size', () => {
    const waiting = declaration(rule('.board-wpf'), 'font-size');
    expect(evalSize(waiting, TV_CARD, { '--wd': 164 })).toBeGreaterThanOrEqual(25);
  });

  it('has a header that grows with the screen up to 44 px', () => {
    for (const sel of ['.board-name', '.board-clock']) {
      const size = declaration(rule(sel), 'font-size');
      expect(size).toMatch(/^clamp\(18px, 3\.4vmin, 44px\)$/);
    }
  });
});

describe('the board picks the layout of a court from the shape of its card', () => {
  it('stacks the teams in a card that is square or taller and tall enough, wherever it sits', () => {
    const q = /@container \(max-aspect-ratio: ([\d.]+)\) and \(min-height: (\d+)px\)/.exec(css);
    expect(q).not.toBeNull();
    expect(Number(q![1])).toBeGreaterThanOrEqual(1);
    expect(Number(q![2])).toBeGreaterThanOrEqual(300);
    const stacked = block('@container (max-aspect-ratio');
    expect(rule('.board-teams', stacked)).toMatch(/flex-direction:\s*column/);
  });

  it('keeps side by side as the default and leaves the stacking to the card shape, not the screen', () => {
    expect(rule('.board-teams')).toMatch(/flex-direction:\s*row/);
    const landscape = block('@media (orientation: landscape)');
    expect(landscape).not.toContain('.board-teams');
  });

  it('keeps the VS circle readable and in proportion to the circles', () => {
    const vs = declaration(rule('.board-teams'), '--vs');
    expect(evalSize(vs, { w: 100, h: 100 }, { '--d': 10 })).toBeGreaterThanOrEqual(24);
    expect(evalSize(vs, { w: 5000, h: 5000 }, { '--d': 200 })).toBeLessThanOrEqual(80);
    expect(declaration(rule('.board-vs'), 'font-size')).toMatch(/^max\(10px/);
  });
});

describe('the header on a narrow screen', () => {
  it('never shrinks the clock and Close, so the name gives way first', () => {
    expect(css).toMatch(/\.board-head-r \{\s*flex:\s*none;/);
    expect(rule('.board-name')).toMatch(/text-overflow:\s*ellipsis/);
  });

  it('tightens the right side on a narrow screen so Close stays in view', () => {
    const narrow = block('@media (max-width: 520px)');
    expect(rule('.board-head-r', narrow)).toMatch(/gap:\s*8px/);
    expect(rule('.board-more', narrow)).toMatch(/font-size:\s*12px/);
  });
});

describe('the waiting strip', () => {
  it('centres the circles, so a short queue leaves no one-sided gap', () => {
    expect(rule('.board-wstrip')).toMatch(/justify-content:\s*center/);
  });

  it('gives the strip a quarter of a landscape screen and a larger label', () => {
    const landscape = block('@media (orientation: landscape)');
    expect(rule('.board-waiting', landscape)).toMatch(/height:\s*24%/);
    expect(rule('.board-wl-label', landscape)).toMatch(/font-size:\s*clamp\(12px, 9cqh/);
    expect(rule('.board-wl-count', landscape)).toMatch(/font-size:\s*clamp\(16px, 16cqh/);
  });

  it('shrinks to a slim band when no one is waiting, and the message is readable', () => {
    expect(rule('.board-waiting.is-empty')).toMatch(/height:\s*9%/);
    expect(declaration(rule('.board-none'), 'font-size')).toMatch(/cqh/);
    expect(rule('.board-none')).toMatch(/align-self:\s*center/);
  });

  it('marks the strip as empty only when no one waits', () => {
    const { rerender } = render(<BoardWaiting waiting={[]} everyone={[]} />);
    expect(screen.getByRole('region', { name: 'Waiting' })).toHaveClass('is-empty');
    const ids = ['p1', 'p2'];
    const s = mkSession(ids.map((id) => mkPlayer(id, { name: id })), {});
    rerender(<BoardWaiting waiting={s.players} everyone={s.players} />);
    expect(screen.getByRole('region', { name: 'Waiting' })).not.toHaveClass('is-empty');
  });
});
```

Apply this patch (save it as `step.patch`, run `git apply step.patch`, then delete it). It changes `src/ui/BoardScreen.test.tsx`:

```diff
diff --git a/src/ui/BoardScreen.test.tsx b/src/ui/BoardScreen.test.tsx
--- a/src/ui/BoardScreen.test.tsx
+++ b/src/ui/BoardScreen.test.tsx
@@ -580,6 +580,5 @@ describe('the board styles', () => {
 
-  it('lays a court out as a row in portrait and a column in landscape', () => {
+  it('lays a court out as a row by default and as a column when its card is square or tall', () => {
     expect(must('.board-teams')).toMatch(/flex-direction:\s*row/);
-    const land = media('(orientation: landscape)');
-    expect(rule('.board-teams', land)).toMatch(/flex-direction:\s*column/);
+    expect(css).toMatch(/@container \(max-aspect-ratio: [\d.]+\)[^{]*\{[^@]*\.board-teams\s*\{[^}]*flex-direction:\s*column/);
   });
```

- [ ] **Step 2: Run them and watch them fail**

Run: `npx vitest run src/ui/boardPolishCss.test.tsx src/ui/BoardScreen.test.tsx`
Expected: 16 tests fail. Fifteen are new CSS tests (the sixteenth new test, the self-test of the small CSS evaluator, passes), and one is the rewritten layout test in `BoardScreen.test.tsx`.

- [ ] **Step 3: Write the code**

Apply this patch (save it as `step.patch`, run `git apply step.patch`, then delete it). It changes `src/styles/app.css`, `src/ui/BoardWaiting.tsx`:

```diff
diff --git a/src/styles/app.css b/src/styles/app.css
--- a/src/styles/app.css
+++ b/src/styles/app.css
@@ -2300,5 +2300,10 @@ caption {
 
+/* The clock and Close never shrink, so the name gives way first. */
+.board-head-r {
+  flex: none;
+}
+
 .board-name {
   margin: 0;
-  font-size: clamp(16px, 2.6vmin, 30px);
+  font-size: clamp(18px, 3.4vmin, 44px);
   font-weight: 600;
@@ -2313,3 +2318,3 @@ caption {
   color: var(--board-mut);
-  font-size: clamp(13px, 2vmin, 22px);
+  font-size: clamp(13px, 2.4vmin, 30px);
   white-space: nowrap;
@@ -2318,3 +2323,3 @@ caption {
 .board-clock {
-  font-size: clamp(16px, 2.6vmin, 30px);
+  font-size: clamp(18px, 3.4vmin, 44px);
   font-weight: 600;
@@ -2393,3 +2398,3 @@ caption {
   color: var(--board-mut);
-  font-size: clamp(11px, 4cqmin, 20px);
+  font-size: clamp(11px, min(3.4cqw, 6cqh), 26px);
   letter-spacing: 0.08em;
@@ -2400,3 +2405,3 @@ caption {
   color: var(--board-lime);
-  font-size: clamp(18px, 9cqmin, 56px);
+  font-size: clamp(20px, min(13cqw, 15cqh), 120px);
   font-weight: 600;
@@ -2409,3 +2414,3 @@ caption {
   color: var(--board-lime);
-  font-size: clamp(12px, 5cqmin, 24px);
+  font-size: clamp(12px, min(4.6cqw, 8cqh), 34px);
   font-weight: 600;
@@ -2418,3 +2423,3 @@ caption {
   color: var(--board-fg);
-  font-size: clamp(11px, 4cqmin, 20px);
+  font-size: clamp(11px, min(3.4cqw, 6cqh), 26px);
   white-space: nowrap;
@@ -2429,3 +2434,3 @@ caption {
   color: var(--board-mut);
-  font-size: clamp(16px, 10cqmin, 44px);
+  font-size: clamp(16px, min(9cqw, 12cqh), 64px);
 }
@@ -2434,4 +2439,4 @@ caption {
 .board-teams {
-  --d: min(48cqh, 19cqw);
-  --vs: min(20cqh, 9cqw);
+  --d: min(40cqh, 19cqw);
+  --vs: max(1.6rem, min(20cqh, 9cqw, calc(var(--d) * 0.4)));
   flex: 1;
@@ -2473,3 +2478,3 @@ caption {
   gap: 0.4em;
-  font-size: clamp(11px, 3.4cqmin, 22px);
+  font-size: max(11px, calc(var(--d) * 0.19));
 }
@@ -2503,3 +2508,3 @@ caption {
   background: var(--board-bg);
-  font-size: calc(var(--vs) * 0.38);
+  font-size: max(10px, calc(var(--vs) * 0.38));
   font-weight: 700;
@@ -2549,3 +2554,3 @@ caption {
   color: var(--board-mut);
-  font-size: clamp(11px, 2cqmin, 18px);
+  font-size: clamp(11px, 2cqmin, 30px);
   letter-spacing: 0.08em;
@@ -2555,3 +2560,3 @@ caption {
 .board-wl-count {
-  font-size: clamp(14px, 3cqmin, 30px);
+  font-size: clamp(14px, 3cqmin, 56px);
   font-weight: 600;
@@ -2560,5 +2565,11 @@ caption {
 .board-none {
+  align-self: center;
   margin: 0;
   color: var(--board-mut);
-  font-size: clamp(14px, 3cqmin, 24px);
+  font-size: clamp(16px, 34cqh, 40px);
+}
+
+/* Nobody waiting: a slim band, so the courts get the room. */
+.board-waiting.is-empty {
+  height: 9%;
 }
@@ -2575,3 +2586,3 @@ caption {
   align-items: flex-start;
-  justify-content: flex-start;
+  justify-content: center;
   gap: 1.4cqw;
@@ -2588,3 +2599,3 @@ caption {
   padding-top: 3px;
-  font-size: clamp(10px, 11cqh, 20px);
+  font-size: max(11px, calc(var(--wd) * 0.16));
 }
@@ -2635,3 +2646,3 @@ caption {
 
-/* Landscape on a wide screen: courts in columns, each court a column with the teams stacked. */
+/* Landscape on a wide screen: the courts follow the landscape grid, and the waiting strip runs along the bottom. */
 @media (orientation: landscape) and (min-width: 640px) {
@@ -2642,10 +2653,4 @@ caption {
 
-  .board-teams {
-    --d: min(26cqh, 34cqw);
-    --vs: min(8cqh, 9cqw);
-    flex-direction: column;
-  }
-
   .board-waiting {
-    height: 22%;
+    height: 24%;
     flex-direction: row;
@@ -2661,4 +2666,21 @@ caption {
 
+  .board-wl-label {
+    font-size: clamp(12px, 9cqh, 28px);
+  }
+
+  .board-wl-count {
+    font-size: clamp(16px, 16cqh, 60px);
+  }
+
   .board-wstrip {
-    --wd: min(62cqh, 11cqw);
+    --wd: min(66cqh, 11cqw);
+  }
+}
+
+/* A court that is nearly square or taller, and tall enough to stack, puts Team A, VS and Team B in a column. A wider or shorter court puts them side by side. */
+@container (max-aspect-ratio: 1.35) and (min-height: 400px) {
+  .board-teams {
+    --d: min(25cqh, 34cqw);
+    --vs: max(1.6rem, min(8cqh, 9cqw));
+    flex-direction: column;
   }
@@ -2672,2 +2694,10 @@ caption {
   }
+
+  .board-head-r {
+    gap: 8px;
+  }
+
+  .board-more {
+    font-size: 12px;
+  }
 }
diff --git a/src/ui/BoardWaiting.tsx b/src/ui/BoardWaiting.tsx
--- a/src/ui/BoardWaiting.tsx
+++ b/src/ui/BoardWaiting.tsx
@@ -43,3 +43,3 @@ export function BoardWaiting({ waiting, everyone }: Props) {
   return (
-    <section className="board-waiting" aria-label="Waiting">
+    <section className={`board-waiting${waiting.length === 0 ? ' is-empty' : ''}`} aria-label="Waiting">
       <div className="board-wl">
```

- [ ] **Step 4: Run them, then the whole project**

Run: `npx vitest run src/ui/boardPolishCss.test.tsx src/ui/BoardScreen.test.tsx`
Expected: both files pass.

Then run `npx tsc --noEmit && npx vitest run`.
Expected: `tsc` prints nothing and the suite shows 1473 tests across 118 files.

- [ ] **Step 5: Commit**

```bash
git add src/styles/app.css src/ui/BoardScreen.test.tsx src/ui/BoardWaiting.tsx src/ui/boardPolishCss.test.tsx
git commit -m "Polish the board from the browser check"
```

### Task 6: Cover the board never drawing for an ended session

Another break survived: drawing the board for an ended session for one render before an effect corrected the view. This test records every session the board is drawn with.

**Files:**
- Create: `src/ui/boardWiringRender.test.tsx`

- [ ] **Step 1: Add the test**

Create `src/ui/boardWiringRender.test.tsx`:

```tsx
import { act, cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Session } from '../engine';
import { newTestSession } from '../engine/testing';
import { resetHistoryDbForTests } from '../store/historyDb';
import { useHistoryStore } from '../store/historyStore';
import { resetRosterDbForTests } from '../store/rosterDb';
import { useRosterStore } from '../store/rosterStore';
import { useSessionStore } from '../store/sessionStore';
import { DEFAULT_SLOTS, useSlotsStore } from '../store/slots';
import App from './App';

// Every session the board was drawn with, so a render for an ended session shows up even if it lasts one frame.
const drawn: Session[] = [];
vi.mock('./BoardScreen', async (importOriginal) => {
  const real = await importOriginal<typeof import('./BoardScreen')>();
  return {
    ...real,
    BoardScreen: (props: Parameters<typeof real.BoardScreen>[0]) => {
      drawn.push(props.session);
      return real.BoardScreen(props);
    },
  };
});

const running = () => newTestSession(['Ann', 'Ben', 'Cy', 'Dee', 'Eve'], { courts: 2 });

beforeEach(async () => {
  drawn.length = 0;
  localStorage.clear();
  localStorage.setItem('pickleball.autoStart', 'true');
  window.history.replaceState({ pk: 0, view: 'home' }, '');
  window.history.pushState(null, '');
  useSessionStore.setState({ session: null, undoStack: [], saveFailed: false });
  useSlotsStore.setState({ slots: DEFAULT_SLOTS.slots.map((s) => ({ ...s })), venues: [], tonight: {} });
  await resetRosterDbForTests();
  await resetHistoryDbForTests();
  useRosterStore.setState({ players: [], loaded: false });
  useHistoryStore.setState({ entries: [], loaded: false, persistent: true });
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date(2026, 10, 13, 12));
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.restoreAllMocks();
  window.history.replaceState(null, '');
});

describe('the board is only ever drawn for a running session', () => {
  it('is drawn with the running session while open', async () => {
    useSessionStore.setState({ session: running() });
    const user = userEvent.setup({ advanceTimers: () => {} });
    render(<App />);
    await user.click(screen.getByRole('button', { name: 'Menu' }));
    await user.click(screen.getByRole('button', { name: 'Show board' }));
    expect(drawn.length).toBeGreaterThan(0);
    expect(drawn.every((s) => s.endedAt === undefined)).toBe(true);
  });

  it('is not drawn again, not even for one frame, once the session has ended', async () => {
    useSessionStore.setState({ session: running() });
    const user = userEvent.setup({ advanceTimers: () => {} });
    render(<App />);
    await user.click(screen.getByRole('button', { name: 'Menu' }));
    await user.click(screen.getByRole('button', { name: 'Show board' }));
    drawn.length = 0;
    act(() => useSessionStore.setState({ session: { ...running(), endedAt: Date.now() } }));
    expect(drawn).toEqual([]);
    expect(screen.getByText('Session summary')).toBeInTheDocument();
  });

  it('is not drawn for an ended session found at load with a board entry', () => {
    useSessionStore.setState({ session: { ...running(), endedAt: Date.now() } });
    window.history.replaceState({ pk: 1, view: 'board' }, '');
    render(<App />);
    act(() => void window.dispatchEvent(new PopStateEvent('popstate', { state: { pk: 1, view: 'board' } })));
    expect(drawn).toEqual([]);
  });
});
```

- [ ] **Step 2: Run it**

Run: `npx vitest run src/ui/boardWiringRender.test.tsx`
Expected: passes. It passes straight away because the code is already right; its job is to fail when the break named above is made. The final task runs that break.

- [ ] **Step 3: Check the whole project**

Run `npx tsc --noEmit && npx vitest run`.
Expected: `tsc` prints nothing and the suite shows 1476 tests across 119 files.

- [ ] **Step 4: Commit**

```bash
git add src/ui/boardWiringRender.test.tsx
git commit -m "Cover a gap found by the mutation check"
```

### Task 7: Start the waiting row right after its label

On a wide screen the waiting row was centred, which left a gap between the "WAITING 6" label and the first face. The faces now start right after the label.

**Files:**
- Modify: `src/styles/app.css`
- Modify: `src/ui/boardPolishCss.test.tsx`

- [ ] **Step 1: Write the failing tests**

Apply this patch (save it as `step.patch`, run `git apply step.patch`, then delete it). It changes `src/ui/boardPolishCss.test.tsx`:

```diff
diff --git a/src/ui/boardPolishCss.test.tsx b/src/ui/boardPolishCss.test.tsx
--- a/src/ui/boardPolishCss.test.tsx
+++ b/src/ui/boardPolishCss.test.tsx
@@ -186,4 +186,4 @@ describe('the header on a narrow screen', () => {
 describe('the waiting strip', () => {
-  it('centres the circles, so a short queue leaves no one-sided gap', () => {
-    expect(rule('.board-wstrip')).toMatch(/justify-content:\s*center/);
+  it('starts the circles right after the label, so there is no gap between them', () => {
+    expect(rule('.board-wstrip')).toMatch(/justify-content:\s*flex-start/);
   });
```

- [ ] **Step 2: Run them and watch them fail**

Run: `npx vitest run src/ui/boardPolishCss.test.tsx`
Expected: 1 test fails (the waiting strip test that now expects the faces to start at the left).

- [ ] **Step 3: Write the code**

Apply this patch (save it as `step.patch`, run `git apply step.patch`, then delete it). It changes `src/styles/app.css`:

```diff
diff --git a/src/styles/app.css b/src/styles/app.css
--- a/src/styles/app.css
+++ b/src/styles/app.css
@@ -2586,3 +2586,3 @@ caption {
   align-items: flex-start;
-  justify-content: center;
+  justify-content: flex-start;
   gap: 1.4cqw;
```

- [ ] **Step 4: Run them, then the whole project**

Run: `npx vitest run src/ui/boardPolishCss.test.tsx`
Expected: all 16 tests in the file pass.

Then run `npx tsc --noEmit && npx vitest run`.
Expected: `tsc` prints nothing and the suite shows 1476 tests across 119 files.

- [ ] **Step 5: Commit**

```bash
git add src/styles/app.css src/ui/boardPolishCss.test.tsx
git commit -m "Start the board's waiting row right after its label"
```

### Task 8: Check everything, then look at it

**Files:**
- No new files. A script outside the repo, and a spec update that is already committed with this plan.

- [ ] **Step 1: Run the whole project**

```bash
npx vitest run
npx tsc --noEmit
npm run build
```

Expected: 1476 tests pass across 119 files, `tsc` prints nothing, the build finishes and writes `dist/sw.js`. The base was 1320 tests across 114 files. A different count means something was skipped or added.

- [ ] **Step 2: Mutation check**

Save this script as `/tmp/mutate-board.py` (outside the repo) and run it from the repo root with `python3 /tmp/mutate-board.py`. It first checks that the named test files pass. Then, for each break, it changes one line, runs the test files that must fail, and puts the line back. Every line must say KILLED, and the last line must say `83 of 83 killed`. A break that survives means a test is missing: add it before going on.


```python
#!/usr/bin/env python3
"""Deliberate breaks for the board view. Run from the repo root: python3 /tmp/mutate-board.py
Each break is applied, the named test files run, and the file is put back. Every break must be KILLED."""
import subprocess, sys

BREAKS = [
    ('gameClock off by a second',
     'src/store/boardInfo.ts',
     'Math.floor((nowMs - startedAt) / 1000)',
     'Math.floor((nowMs - startedAt) / 1000) + 1',
     ['src/store/boardInfo.test.ts', 'src/ui/BoardScreen.test.tsx']),
    ('gameClock minutes not padded over an hour',
     'src/store/boardInfo.ts',
     '`${h}:${pad(m)}:${pad(s)}`',
     '`${h}:${m}:${pad(s)}`',
     ['src/store/boardInfo.test.ts']),
    ('gameClock seconds not padded',
     'src/store/boardInfo.ts',
     ': `${m}:${pad(s)}`;',
     ': `${m}:${s}`;',
     ['src/store/boardInfo.test.ts']),
    ('gameClock hours format dropped',
     'src/store/boardInfo.ts',
     'return h > 0 ?',
     'return false ?',
     ['src/store/boardInfo.test.ts', 'src/ui/BoardScreen.test.tsx']),
    ('gameClock can go negative',
     'src/store/boardInfo.ts',
     'const total = Math.max(0, Math.floor((nowMs - startedAt) / 1000));',
     'const total = Math.floor((nowMs - startedAt) / 1000);',
     ['src/store/boardInfo.test.ts']),
    ('boardName does not add the initial',
     'src/store/boardInfo.ts',
     'return `${first} ${Array.from(rest[rest.length - 1])[0].toUpperCase()}.`;',
     'return first;',
     ['src/store/boardInfo.test.ts', 'src/ui/BoardScreen.test.tsx']),
    ('boardName compares first names case-sensitively',
     'src/store/boardInfo.ts',
     '.toLowerCase() === first.toLowerCase()',
     '=== first',
     ['src/store/boardInfo.test.ts']),
    ('boardName counts the player as their own clash',
     'src/store/boardInfo.ts',
     'o.id !== player.id && ',
     '',
     ['src/store/boardInfo.test.ts']),
    ('gridFor 4 courts as 1 by 4 in landscape',
     'src/store/boardInfo.ts',
     'if (shown === 4) return { columns: 2, rows: 2, shown, hidden };',
     'if (shown === 4) return { columns: 1, rows: 4, shown, hidden };',
     ['src/store/boardInfo.test.ts', 'src/ui/BoardScreen.test.tsx']),
    ('gridFor shows 7 courts as 7',
     'src/store/boardInfo.ts',
     'const shown = Math.min(courtCount, MAX_SHOWN);',
     'const shown = courtCount;',
     ['src/store/boardInfo.test.ts', 'src/ui/BoardScreen.test.tsx']),
    ('waitingCapacity does not reserve the +N slot',
     'src/store/boardInfo.ts',
     'return Math.max(1, fit - 1);',
     'return Math.max(1, fit);',
     ['src/store/boardInfo.test.ts']),
    ('waitingCapacity ignores the gap',
     'src/store/boardInfo.ts',
     '(stripWidth + gap) / (itemWidth + gap)',
     'stripWidth / itemWidth',
     ['src/store/boardInfo.test.ts']),
    ('waitingCapacity can return zero for a crowd',
     'src/store/boardInfo.ts',
     'return Math.max(1, fit - 1);',
     'return fit - 1;',
     ['src/store/boardInfo.test.ts']),
    ('courtViews ignores court-number order',
     'src/store/boardInfo.ts',
     '[...session.courts].sort((a, b) => a.number - b.number)',
     '[...session.courts]',
     ['src/store/boardInfo.test.ts', 'src/ui/BoardScreen.test.tsx']),
    ('courtViews keeps ids that are not in the session',
     'src/store/boardInfo.ts',
     'return p ? [p] : [];',
     'return [p as Player];',
     ['src/store/boardInfo.test.ts']),
    ('ready court takes its teams from the game',
     'src/store/boardInfo.ts',
     'const { team1, team2 } = court.lineup;',
     'const { team1, team2 } = court.game!;',
     ['src/store/boardInfo.test.ts', 'src/ui/BoardScreen.test.tsx']),
    ('nameHue range widened past 359',
     'src/store/boardInfo.ts',
     'return h % 360;',
     'return h % 400;',
     ['src/store/boardInfo.test.ts']),
    ('open court shows teams and avatars',
     'src/ui/BoardCourt.tsx',
     "{court.state === 'open' ? (",
     '{false ? (',
     ['src/ui/BoardScreen.test.tsx']),
    ('closing tag missing',
     'src/ui/BoardCourt.tsx',
     '{court.closing && <span className="board-closing">Closing</span>}',
     '{null}',
     ['src/ui/BoardScreen.test.tsx']),
    ('VS missing',
     'src/ui/BoardCourt.tsx',
     '<span className="board-vs">VS</span>',
     '',
     ['src/ui/BoardScreen.test.tsx']),
    ('Team A and Team B merged into one label',
     'src/ui/BoardCourt.tsx',
     '<BoardTeam side="b" players={court.teamB} everyone={everyone} />',
     '<BoardTeam side="a" players={court.teamB} everyone={everyone} />',
     ['src/ui/BoardScreen.test.tsx']),
    ('Up next tag missing',
     'src/ui/BoardCourt.tsx',
     '{court.state === \'ready\' && <span className="board-tag">Up next</span>}',
     '{null}',
     ['src/ui/BoardScreen.test.tsx']),
    ('timer role dropped',
     'src/ui/BoardCourt.tsx',
     ' role="timer" aria-live="off"',
     '',
     ['src/ui/BoardScreen.test.tsx']),
    ('waiting does not use orderedWaiting',
     'src/ui/BoardScreen.tsx',
     'const waiting = orderedWaiting(session);',
     "const waiting = session.players.filter((p) => p.status === 'active');",
     ['src/ui/BoardScreen.test.tsx']),
    ('players on a break are shown',
     'src/ui/BoardScreen.tsx',
     'const waiting = orderedWaiting(session);',
     "const waiting = [...orderedWaiting(session), ...session.players.filter((p) => p.status === 'break')];",
     ['src/ui/BoardScreen.test.tsx']),
    ('waiting numbers start at 0',
     'src/ui/BoardWaiting.tsx',
     '{i + 1}</span>',
     '{i}</span>',
     ['src/ui/BoardScreen.test.tsx']),
    ('lime ring on the wrong player',
     'src/ui/BoardWaiting.tsx',
     "i === 0 ? ' is-first' : ''",
     "i === 1 ? ' is-first' : ''",
     ['src/ui/BoardScreen.test.tsx']),
    ('no-one-waiting text missing',
     'src/ui/BoardWaiting.tsx',
     '<p className="board-none">No one is waiting.</p>',
     '<p className="board-none"></p>',
     ['src/ui/BoardScreen.test.tsx']),
    ('waiting capacity fallback is 5, not 6',
     'src/ui/BoardWaiting.tsx',
     'const FALLBACK = { width: 6, item: 1, gap: 0 };',
     'const FALLBACK = { width: 5, item: 1, gap: 0 };',
     ['src/ui/BoardScreen.test.tsx']),
    ('scores shown on the board',
     'src/ui/BoardScreen.tsx',
     '<BoardCourts session={session} everyone={everyone} />',
     '<BoardCourts session={session} everyone={everyone} /><p>{session.history.map((g) => `${g.winner} won ${g.score}`).join(" ")}</p>',
     ['src/ui/BoardScreen.test.tsx']),
    ('Close does not call onClose',
     'src/ui/BoardScreen.tsx',
     'onClick={onClose}',
     'onClick={() => undefined}',
     ['src/ui/BoardScreen.test.tsx']),
    ('Escape ignored',
     'src/ui/BoardScreen.tsx',
     "if (e.key === 'Escape') onClose();",
     "if (e.key === 'Esc') onClose();",
     ['src/ui/BoardScreen.test.tsx']),
    ('Escape listener not removed on unmount',
     'src/ui/BoardScreen.tsx',
     "return () => document.removeEventListener('keydown', onKey);",
     'return () => undefined;',
     ['src/ui/BoardScreen.test.tsx']),
    ('interval not cleared',
     'src/ui/BoardScreen.tsx',
     'return () => clearInterval(id);',
     'return () => undefined;',
     ['src/ui/BoardScreen.test.tsx']),
    ('court clocks tick every 2 seconds',
     'src/ui/BoardScreen.tsx',
     'useNow(SECOND)',
     'useNow(2 * SECOND)',
     ['src/ui/BoardScreen.test.tsx']),
    ('header clock refreshes every second, not each minute',
     'src/ui/BoardScreen.tsx',
     'useNow(MINUTE)',
     'useNow(SECOND)',
     ['src/ui/BoardScreen.test.tsx']),
    ('hidden courts not counted in the header',
     'src/ui/BoardScreen.tsx',
     '<BoardHeader session={session} hidden={grid.hidden} onClose={onClose} />',
     '<BoardHeader session={session} hidden={0} onClose={onClose} />',
     ['src/ui/BoardScreen.test.tsx']),
    ('plural of more courts always plural',
     'src/ui/BoardScreen.tsx',
     "{hidden === 1 ? 'court' : 'courts'}",
     "{'courts'}",
     ['src/ui/BoardScreen.test.tsx']),
    ('everyone leaves out the waiting players',
     'src/ui/BoardScreen.tsx',
     'return [...onCourts, ...waiting];',
     'return onCourts;',
     ['src/ui/BoardScreen.test.tsx']),
    ('team circle ignores the roster photo',
     'src/ui/BoardTeam.tsx',
     'rosterId={p.rosterId} ',
     '',
     ['src/ui/BoardScreen.test.tsx']),
    ('team shows the full name, not the board name',
     'src/ui/BoardTeam.tsx',
     '{boardName(p, everyone)}',
     '{p.name}',
     ['src/ui/BoardScreen.test.tsx']),
    ('initials hue not set',
     'src/ui/Avatar.tsx',
     "'--h': nameHue(name)",
     "'--h': 0",
     ['src/ui/BoardScreen.test.tsx']),
    ('initials lightness raised above 32',
     'src/styles/app.css',
     '--board-tile-l: 32%;',
     '--board-tile-l: 40%;',
     ['src/ui/BoardScreen.test.tsx']),
    ('initials text not white',
     'src/styles/app.css',
     '  color: #fff;\n  font-size: calc(var(--d, var(--wd)) * 0.36);',
     '  color: #888;\n  font-size: calc(var(--d, var(--wd)) * 0.36);',
     ['src/ui/BoardScreen.test.tsx']),
    ('light theme leaks into the board background',
     'src/styles/app.css',
     '--board-bg: #0f0f0e;',
     '--board-bg: var(--bg);',
     ['src/ui/BoardScreen.test.tsx']),
    ('board no longer dark colour-scheme',
     'src/styles/app.css',
     '  color-scheme: dark;\n  line-height: 1.2;',
     '  line-height: 1.2;',
     ['src/ui/BoardScreen.test.tsx']),
    ('muted text too dark',
     'src/styles/app.css',
     '--board-mut: #9b9b94;',
     '--board-mut: #4a4a46;',
     ['src/ui/BoardScreen.test.tsx']),
    ('dashed Open outline too faint',
     'src/styles/app.css',
     '--board-edge: #77776f;',
     '--board-edge: #2f2f2c;',
     ['src/ui/BoardScreen.test.tsx']),
    ('Close button below 44 px',
     'src/styles/app.css',
     '  width: 44px;\n  height: 44px;\n  padding: 0;\n  border: 1px solid var(--board-edge);',
     '  width: 36px;\n  height: 36px;\n  padding: 0;\n  border: 1px solid var(--board-edge);',
     ['src/ui/BoardScreen.test.tsx']),
    ('court card without container-type',
     'src/styles/app.css',
     '.board-court {\n  container-type: size;\n',
     '.board-court {\n',
     ['src/ui/BoardScreen.test.tsx']),
    ('landscape grid uses the portrait counts',
     'src/styles/app.css',
     'grid-template-columns: repeat(var(--cols-land, 1), minmax(0, 1fr));',
     'grid-template-columns: repeat(var(--cols-port, 1), minmax(0, 1fr));',
     ['src/ui/BoardScreen.test.tsx']),
    ('stacked layout applies to short cards',
     'src/styles/app.css',
     '(min-height: 400px)',
     '(min-height: 40px)',
     ['src/ui/BoardScreen.test.tsx', 'src/ui/boardPolishCss.test.tsx']),
    ('circle size in fixed pixels',
     'src/styles/app.css',
     '--d: min(40cqh, 19cqw);',
     '--d: 96px;',
     ['src/ui/BoardScreen.test.tsx', 'src/ui/boardPolishCss.test.tsx']),
    ('venue and end time kept on a narrow screen',
     'src/styles/app.css',
     '  .board-venue,\n  .board-end {\n    display: none;',
     '  .board-venue,\n  .board-end {\n    display: block;',
     ['src/ui/BoardScreen.test.tsx']),
    ('lime ring missing on number 1',
     'src/styles/app.css',
     '  box-shadow: 0 0 0 3px var(--board-lime);',
     '  box-shadow: 0 0 0 3px var(--board-edge);',
     ['src/ui/BoardScreen.test.tsx']),
    ('avatar fill not square',
     'src/styles/app.css',
     '  height: auto;\n  aspect-ratio: 1;\n}\n\n.board .avatar-fill',
     '  height: auto;\n}\n\n.board .avatar-fill',
     ['src/ui/BoardScreen.test.tsx']),
    ('menu item missing',
     'src/ui/LiveScreen.tsx',
     "              { label: 'Show board', onSelect: onShowBoard },\n",
     '',
     ['src/ui/boardWiring.test.tsx', 'src/ui/liveHome.test.tsx']),
    ('menu item before Settings',
     'src/ui/LiveScreen.tsx',
     "              { label: 'Settings', onSelect: onSettings },\n              { label: 'Show board', onSelect: onShowBoard },\n",
     "              { label: 'Show board', onSelect: onShowBoard },\n              { label: 'Settings', onSelect: onSettings },\n",
     ['src/ui/boardWiring.test.tsx', 'src/ui/liveHome.test.tsx']),
    ('menu item opens Settings instead',
     'src/ui/LiveScreen.tsx',
     "{ label: 'Show board', onSelect: onShowBoard }",
     "{ label: 'Show board', onSelect: onSettings }",
     ['src/ui/boardWiring.test.tsx', 'src/ui/liveHome.test.tsx']),
    ('App passes a no-op to the menu',
     'src/ui/App.tsx',
     'onSettings={openSettings} onShowBoard={openBoard} />',
     'onSettings={openSettings} onShowBoard={() => {}} />',
     ['src/ui/boardWiring.test.tsx']),
    ('history entry not pushed',
     'src/ui/App.tsx',
     "const openBoard = () => screens.push('board');",
     "const openBoard = () => setView('board');",
     ['src/ui/boardWiring.test.tsx']),
    ('Close does nothing',
     'src/ui/App.tsx',
     "onClose={() => screens.back('live')}",
     'onClose={() => {}}',
     ['src/ui/boardWiring.test.tsx']),
    ('Close shows live but leaves the history',
     'src/ui/App.tsx',
     "onClose={() => screens.back('live')}",
     "onClose={() => setView('live')}",
     ['src/ui/boardWiring.test.tsx']),
    ('phone Back ignored',
     'src/ui/useScreenHistory.ts',
     '      stack.current[at] = view;\n      latest.current.show(view);\n',
     '      stack.current[at] = view;\n',
     ['src/ui/boardWiring.test.tsx']),
    ('board entry cannot be shown again',
     'src/ui/App.tsx',
     "return session && !session.endedAt ? 'board' : fallback;",
     'return fallback;',
     ['src/ui/boardWiring.test.tsx']),
    ('null session crashes the board entry',
     'src/ui/App.tsx',
     "return session && !session.endedAt ? 'board' : fallback;",
     "return session!.endedAt ? fallback : 'board';",
     ['src/ui/boardWiring.test.tsx']),
    ('board stays after the session ends',
     'src/ui/App.tsx',
     "    if (!ended || view !== 'board') return;\n",
     '    return;\n',
     ['src/ui/boardWiring.test.tsx']),
    ('ended session keeps the board entry',
     'src/ui/App.tsx',
     "    screens.replace('live');\n  }, [ended, view, screens]);",
     '  }, [ended, view, screens]);',
     ['src/ui/boardWiring.test.tsx']),
    ('board entry resolves without checking the session',
     'src/ui/App.tsx',
     "return session && !session.endedAt ? 'board' : fallback;",
     "return 'board';",
     ['src/ui/boardWiring.test.tsx', 'src/ui/boardWiringRender.test.tsx']),
    ('board drawn for an ended session',
     'src/ui/App.tsx',
     "  } else if (session.endedAt) {\n    screen = <SummaryScreen session={session} leaveRef={leaveSummary} />;\n  } else if (view === 'board') {\n    screen = <BoardScreen session={session} onClose={() => screens.back('live')} />;\n",
     "  } else if (view === 'board') {\n    screen = <BoardScreen session={session} onClose={() => screens.back('live')} />;\n  } else if (session.endedAt) {\n    screen = <SummaryScreen session={session} leaveRef={leaveSummary} />;\n",
     ['src/ui/boardWiringRender.test.tsx']),
    ('title bar shows through the board',
     'src/ui/App.tsx',
     "(view === 'live' || view === 'board');",
     "view === 'live';",
     ['src/ui/boardWiring.test.tsx']),
    ('board layer drops under the sheets',
     'src/styles/app.css',
     '  z-index: 30;\n  box-sizing: border-box;',
     '  z-index: 5;\n  box-sizing: border-box;',
     ['src/ui/boardWiring.test.tsx']),
    ('board no longer covers the screen',
     'src/styles/app.css',
     '  position: fixed;\n  inset: 0;\n  z-index: 30;',
     '  position: absolute;\n  inset: 0;\n  z-index: 30;',
     ['src/ui/boardWiring.test.tsx']),
    ('court clock back to the small size',
     'src/styles/app.css',
     'font-size: clamp(20px, min(13cqw, 15cqh), 120px);',
     'font-size: clamp(18px, 9cqmin, 56px);',
     ['src/ui/boardPolishCss.test.tsx']),
    ('names back to a small cap',
     'src/styles/app.css',
     'font-size: max(11px, calc(var(--d) * 0.19));',
     'font-size: clamp(11px, 3.4cqmin, 22px);',
     ['src/ui/boardPolishCss.test.tsx']),
    ('waiting names lose their floor',
     'src/styles/app.css',
     'font-size: max(11px, calc(var(--wd) * 0.16));',
     'font-size: calc(var(--wd) * 0.16);',
     ['src/ui/boardPolishCss.test.tsx']),
    ('circles back to the small size',
     'src/styles/app.css',
     '--d: min(25cqh, 34cqw);',
     '--d: min(15cqh, 34cqw);',
     ['src/ui/boardPolishCss.test.tsx']),
    ('waiting strip centred again',
     'src/styles/app.css',
     '  justify-content: flex-start;\n  gap: 1.4cqw;',
     '  justify-content: center;\n  gap: 1.4cqw;',
     ['src/ui/boardPolishCss.test.tsx']),
    ('empty strip loses its slim band',
     'src/ui/BoardWaiting.tsx',
     "${waiting.length === 0 ? ' is-empty' : ''}",
     '',
     ['src/ui/boardPolishCss.test.tsx']),
    ('stacked layout never applies',
     'src/styles/app.css',
     '@container (max-aspect-ratio: 1.35) and (min-height: 400px) {',
     '@container (max-aspect-ratio: 0.1) and (min-height: 400px) {',
     ['src/ui/boardPolishCss.test.tsx', 'src/ui/BoardScreen.test.tsx']),
    ('clock and Close may shrink',
     'src/styles/app.css',
     '.board-head-r {\n  flex: none;\n}',
     '.board-head-r {\n  flex: 0 1 auto;\n}',
     ['src/ui/boardPolishCss.test.tsx']),
    ('VS circle loses its floor',
     'src/styles/app.css',
     '--vs: max(1.6rem, min(20cqh, 9cqw, calc(var(--d) * 0.4)));',
     '--vs: min(20cqh, 9cqw);',
     ['src/ui/boardPolishCss.test.tsx']),
    ('header type back to the small size',
     'src/styles/app.css',
     '.board-name {\n  margin: 0;\n  font-size: clamp(18px, 3.4vmin, 44px);',
     '.board-name {\n  margin: 0;\n  font-size: clamp(16px, 2.6vmin, 30px);',
     ['src/ui/boardPolishCss.test.tsx']),
]

def run(tests):
    p = subprocess.run(['npx', 'vitest', 'run', *tests], capture_output=True, text=True)
    return p.returncode

def main():
    every = sorted({t for *_, ts in BREAKS for t in ts})
    if run(every) != 0:
        sys.exit('The tests must pass before any break is tried.')
    survived = []
    for name, path, old, new, tests in BREAKS:
        src = open(path).read()
        if src.count(old) != 1:
            sys.exit(f'Cannot place the break "{name}": found {src.count(old)} matches in {path}')
        open(path, 'w').write(src.replace(old, new))
        try:
            killed = run(tests) != 0
        finally:
            open(path, 'w').write(src)
        print(('KILLED   ' if killed else 'SURVIVED ') + name, flush=True)
        if not killed:
            survived.append(name)
    print(f'{len(BREAKS) - len(survived)} of {len(BREAKS)} killed')
    sys.exit(1 if survived else 0)

main()
```

- [ ] **Step 3: Look at it in a browser**

Start `npx vite --port 5188 --strictPort`. In the page, clear storage and the `pickleball-roster` and `pickleball-history` databases, then set up through the app's own stores: about 18 saved players (give most of them a photo through the photo flow and leave two without), a session with 3 courts and `autoStart` off, two courts started and one left ready, and 6 players waiting. Open the live menu and choose "Show board". Check these sizes with the browser's device emulation: 1920 by 1080, 1280 by 720, 390 by 844 and 844 by 390.

1. At 1920 by 1080 with three courts: the game clock is at least 60 px, names at least 30 px, avatars at least 140 px, nothing overlaps, nothing scrolls, no name is cut off, and the waiting row shows numbers with a lime ring on number 1.
2. Court 3 shows "Up next" with a dashed lime outline. Players without a photo show initials on a coloured circle.
3. Close, the Escape key and the browser's back button each return to the live screen.
4. End the session from the live screen after closing the board: the summary shows.
5. Try 1, 2, 4, 6 and 8 courts, no one waiting, 20 waiting, two players with the same first name and a very long name. Nothing overlaps or scrolls.

Reset the emulation and stop the server when done. Clear the data you created in that browser.

- [ ] **Step 4: Push and merge only when Clyde says so**

Push and merge only when Clyde says "push and merge". Production is the branch `claude/pickleball-matchmaking-app-i4baca`, updated by fast-forward. If it has moved, rebase onto it and run Step 1 again before pushing.

- [ ] **Step 5: TV check (Clyde's, on a real screen)**

After the merge: open a running session on your phone or laptop, choose "Show board", and mirror or cast the screen to a TV. From across the court, check that:

1. The game clock, the names and the faces are readable.
2. It is clear who is teammates and who is the other team.
3. The waiting row shows who is next, and number 1 stands out.
4. A real photo that is not centred is not badly cut by the circle.
5. The screen stays awake, and Close and the phone's Back button work.

- [ ] **Step 6: After the merge, remove the worktrees**

```bash
git -C /Users/clydealegro/Vibe/pickleball-match-app/pickleball-match-app worktree remove /Users/clydealegro/Vibe/pickleball-match-app/pickleball-match-app-board-proved
git -C /Users/clydealegro/Vibe/pickleball-match-app/pickleball-match-app worktree prune
git -C /Users/clydealegro/Vibe/pickleball-match-app/pickleball-match-app branch -D board-proved
```

Use `--force` only after diffing the tree against the production branch and finding every change already landed.

---

## Self-review

- **Decisions covered.** 1 and 2: Task 4. 3 to 8: Tasks 1, 2, 5 and 7. 9: nothing to build (the existing wake lock).
- **Placeholders.** None. Every step has its code, its patch, or its command.
- **Names.** `courtViews`, `gameClock`, `boardName`, `gridFor`, `waitingCapacity`, `nameHue`, `BoardScreen`, `BoardCourt`, `BoardTeam`, `BoardWaiting` and the `fill` avatar size are spelled the same in every task that uses them. `waitingCapacity` takes a fourth argument, the total number waiting.

## Risks to watch

- **Real photos.** The board was looked at with stand-in portraits. A real photo that is not centred can lose part of a face to the circle crop.
- **Distance.** Sizes were measured on screens of the right pixel size, not read from across a court. The TV check in Task 8 is the real test.
- **Landscape phone.** Circles are small there (roughly 40 to 50 px). A phone on a stand is more likely portrait, so this was left.
- **Container query units** need a fairly recent browser (about 2022 onward). Older phones were not tested.

## Execution handoff

Plan complete. Two ways to run it:

1. **Subagent-driven (recommended).** A fresh subagent per task with a review between tasks.
2. **Inline.** Run the tasks in this session with checkpoints.
