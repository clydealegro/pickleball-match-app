# Organizer Phase 4a (Summary) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The end of a session becomes a moment: highlights and a plain summary line on the summary screen, and a "Share as picture" button that makes a 1080 by 1350 result card for the group chat.

**Architecture:** `highlights` and `summaryLine` are pure engine functions over the finished `Session`. The card is split in four so each part can be tested alone: a pure data model (`cardModel`), drawing against a small canvas interface (`cardDraw`, tested with a recording stub), a photo loader (`cardPhotos`), and delivery by the Web Share API with a download fallback (`cardShare`). Everything runs on the phone. No network, no new storage, no new dependency.

**Tech Stack:** React, TypeScript, Vite, Vitest (jsdom, fake-indexeddb). Spec: `docs/superpowers/specs/2026-11-07-organizer-experience-phases.md`, Phase 4 sections 4.1, 4.2 and the summary line from 4.6. The board view, the game-length reminder, the Sunlight theme and the haptics are 4b and 4c, with their own plans.

**Working copy:** run this in the worktree `pickleball-match-app-phase4a` on branch `phase4a`, cut from production (`origin/claude/pickleball-matchmaking-app-i4baca`, at 74e9ee1 when this plan was written). The main checkout is on the `ratings` branch; do not touch it. Never use `git add -A`; stage files by name. No AI attribution on any commit.

**Verified before writing:** the code below was built and tested in this worktree and then written into this plan from the files as they stand. 905 tests pass across 93 files, `tsc` is clean, `npm run build` succeeds. 19 mutations, one per rule, each made a test fail (the table is in Task 8). In a browser at 360 px wide the summary screen was checked, the card was rendered on a real canvas with 12 players (light) and 33 players (dark), and `renderCardBlob` produced a real PNG of 1080 by 1350 pixels (about 200 KB). The download fallback saved a file named after the session.

**Not verified:** the share sheet with a file on a real phone (the browser used for the check reports it cannot share files, so that path is covered by a stub only); a real roster photo on the card (`cardPhotos` is tested with a stubbed `createImageBitmap`, and the card with a synthetic bitmap); how the card looks in WhatsApp or Messenger. Task 8 leaves those as a phone check for Clyde.

---

## Decisions

Three were settled with Clyde on 2026-11-08, and they match the spec:

1. **Board view:** all courts at once (this is 4b).
2. **Picture and results:** the card reuses the summary's results switch. One switch governs the shared text and the picture, so they can never disagree. The label becomes "Include results when sharing".
3. **Sunlight:** a fourth appearance option beside Light (this is 4c). Until then the card draws any theme other than dark with the light colours. 4c decides whether Sunlight gets its own card palette.

Three were made while building, and Clyde can overrule them:

4. **Highlight lines.** At most three, in this order: unbeaten (only with results on, and it needs two wins and no loss), most games, longest game, most partners (two or more), shortest game (only when it differs from the longest). A games or partners line that would name every player is dropped, because if everyone ties, nobody stands out. Ties are named together ("Ann and Ben"), and more than three names become "5 players". Fewer than three games shows nothing.
5. **Total playing time is not a highlight line.** The Time tile and the summary line already say it.
6. **The summary line from 4.6 ships here**, because it uses the same data: "12 games, 3 hours, everyone got at least 3". The last part is left out when someone did not play. The haptics from 4.6 wait for 4c. The on-screen highlights count results (this screen already shows every record), while the card and the text follow the switch.

## File structure

| File | Job |
|---|---|
| `src/engine/highlights.ts` (new) | `highlights(session, { results })` and `summaryLine(session)`. Pure. |
| `src/engine/summary.ts`, `src/engine/index.ts` | Export `plural`; export the new functions |
| `src/ui/cardModel.ts` (new) | Everything the card says, as plain data: title, date, facts, highlight lines, players, palette, grid columns |
| `src/ui/cardDraw.ts` (new) | `drawCard` on a minimal canvas interface, `gridLayout`, `renderCardBlob` |
| `src/ui/cardPhotos.ts` (new) | Decodes saved photos for the canvas; a missing or bad photo means initials |
| `src/ui/cardShare.ts` (new) | `deliverPicture`: share as a file, or download |
| `src/ui/SummaryScreen.tsx`, `src/styles/app.css` | The line, the highlights, the Share as picture button |
| `src/ui/*.test.ts(x)` | One test file per new module, plus `summaryPicture.test.tsx` for the button |

---

### Task 1: Highlights and the summary line (engine)

**Files:**
- Create: `src/engine/highlights.ts`
- Create: `src/engine/highlights.test.ts`
- Modify: `src/engine/summary.ts` (export `plural`)
- Modify: `src/engine/index.ts`

- [ ] **Step 1: Write the failing tests**

Create `src/engine/highlights.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { highlights, summaryLine } from './highlights';
import { mkPlayer, mkSession } from './fixtures';
import type { FinishedGame, Player, Session } from './types';

const MIN = 60_000;

function game(team1: [string, string], team2: [string, string], minutes: number, at = 0, winner?: 1 | 2): FinishedGame {
  return { team1, team2, courtNumber: 1, startedAt: at, finishedAt: at + minutes * MIN, ...(winner ? { winner } : {}) };
}

/** Six players, four games. Ann has 4 games, Ben 3, the rest 2 or 1. Ann has met the most partners. */
function sixPlayers(): Session {
  const p = (id: string, gamesPlayed: number, partners: string[]): Player =>
    mkPlayer(id, { name: id, gamesPlayed, partnerCounts: Object.fromEntries(partners.map((x) => [x, 1])) });
  return mkSession(
    [p('Ann', 4, ['Ben', 'Cy', 'Dee']), p('Ben', 3, ['Ann', 'Cy']), p('Cy', 3, ['Ann', 'Ben']), p('Dee', 2, ['Ann']), p('Eve', 1, ['Fay']), p('Fay', 1, ['Eve'])],
    {
      history: [
        game(['Ann', 'Ben'], ['Cy', 'Dee'], 10),
        game(['Ann', 'Cy'], ['Ben', 'Dee'], 25, 10 * MIN),
        game(['Ann', 'Dee'], ['Ben', 'Cy'], 15, 35 * MIN),
        game(['Ann', 'Ben'], ['Eve', 'Fay'], 12, 50 * MIN),
      ],
    },
  );
}

describe('highlights', () => {
  it('names who played most, the longest game and who met the most partners, in that order', () => {
    const lines = highlights(sixPlayers());
    expect(lines.map((l) => l.text)).toEqual([
      'Most games: Ann, 4',
      'Longest game: 25m',
      'Most partners: Ann, 3 different',
    ]);
  });

  it('shows nothing for fewer than three games', () => {
    const s = sixPlayers();
    expect(highlights({ ...s, history: s.history.slice(0, 2) })).toEqual([]);
    expect(highlights({ ...s, history: s.history.slice(0, 3) })).not.toEqual([]);
  });

  it('names ties together', () => {
    const s = sixPlayers();
    const tied = { ...s, players: s.players.map((p) => (p.id === 'Ben' ? { ...p, gamesPlayed: 4 } : p)) };
    expect(highlights(tied)[0].text).toBe('Most games: Ann and Ben, 4');
    const three = { ...s, players: s.players.map((p) => (['Ben', 'Cy'].includes(p.id) ? { ...p, gamesPlayed: 4 } : p)) };
    expect(highlights(three)[0].text).toBe('Most games: Ann, Ben and Cy, 4');
    const many = { ...s, players: s.players.map((p) => (p.id === 'Fay' ? p : { ...p, gamesPlayed: 4 })) };
    expect(highlights(many)[0].text).toBe('Most games: 5 players, 4');
  });

  it('drops a line that would name everyone', () => {
    const s = sixPlayers();
    const even = { ...s, players: s.players.map((p) => ({ ...p, gamesPlayed: 3 })) };
    expect(highlights(even).map((l) => l.key)).not.toContain('mostGames');
  });

  it('adds the shortest game once the longest and the partners leave room, and only when it differs', () => {
    const s = sixPlayers();
    const noPartners = { ...s, players: s.players.map((p) => ({ ...p, partnerCounts: {} })) };
    expect(highlights(noPartners).map((l) => l.text)).toEqual(['Most games: Ann, 4', 'Longest game: 25m', 'Shortest game: 10m']);
    const samelength = { ...noPartners, history: noPartners.history.map((g) => ({ ...g, finishedAt: g.startedAt + 10 * MIN })) };
    expect(highlights(samelength).map((l) => l.key)).toEqual(['mostGames']);
  });

  it('never lists more than three lines', () => {
    const s = sixPlayers();
    const withResults = { ...s, history: s.history.map((g) => ({ ...g, winner: 1 as const })) };
    expect(highlights(withResults, { results: true }).length).toBeLessThanOrEqual(3);
  });

  describe('unbeaten', () => {
    function withWinners(winners: (1 | 2)[]): Session {
      const s = sixPlayers();
      const teams: [[string, string], [string, string]][] = [
        [['Ann', 'Ben'], ['Cy', 'Dee']],
        [['Ann', 'Ben'], ['Cy', 'Dee']],
        [['Ann', 'Cy'], ['Ben', 'Dee']],
        [['Eve', 'Fay'], ['Cy', 'Dee']],
      ];
      return { ...s, history: teams.map(([a, b], i) => game(a, b, 10 + i, i * 20 * MIN, winners[i])) };
    }

    it('comes first when results are on, and names players with two or more wins and no loss', () => {
      // Ben wins games 1 and 2 with Ann, then wins game 3 on the other side: 3 wins, no loss. Ann lost game 3.
      const s = withWinners([1, 1, 2, 1]);
      expect(highlights(s, { results: true })[0]).toEqual({ key: 'unbeaten', text: 'Unbeaten: Ben' });
    });

    it('names a tie together', () => {
      const s = sixPlayers();
      const together = { ...s, history: [0, 1, 2].map((i) => game(['Ann', 'Ben'], ['Cy', 'Dee'], 10 + i, i * 20 * MIN, 1)) };
      expect(highlights(together, { results: true })[0].text).toBe('Unbeaten: Ann and Ben');
    });

    it('needs two wins, so one lucky game is not a highlight', () => {
      const s = withWinners([1, 2, 2, 1]);
      expect(highlights(s, { results: true }).map((l) => l.key)).not.toContain('unbeaten');
    });

    it('stays out when results are off, which is the default', () => {
      const s = withWinners([1, 1, 2, 1]);
      expect(highlights(s).map((l) => l.key)).not.toContain('unbeaten');
      expect(highlights(s, { results: false }).map((l) => l.key)).not.toContain('unbeaten');
    });
  });
});

describe('summaryLine', () => {
  function played(games: number, minutes: number, minGames: number): Session {
    const s = sixPlayers();
    return {
      ...s,
      history: Array.from({ length: games }, (_, i) => game(['Ann', 'Ben'], ['Cy', 'Dee'], minutes, i * minutes * MIN)),
      players: s.players.map((p) => ({ ...p, gamesPlayed: minGames })),
    };
  }

  it('says the games, the time in plain words and the fewest games anyone got', () => {
    expect(summaryLine(played(12, 15, 3))).toBe('12 games, 3 hours, everyone got at least 3');
  });

  it('uses half hours, minutes and the singular', () => {
    expect(summaryLine(played(6, 15, 2))).toBe('6 games, 1.5 hours, everyone got at least 2');
    expect(summaryLine(played(4, 10, 2))).toBe('4 games, 40 minutes, everyone got at least 2');
    expect(summaryLine(played(4, 15, 2))).toBe('4 games, 1 hour, everyone got at least 2');
    expect(summaryLine(played(1, 10, 1))).toBe('1 game, 10 minutes, everyone got at least 1');
  });

  it('leaves out the last part when someone did not play', () => {
    expect(summaryLine(played(3, 10, 0))).toBe('3 games, 30 minutes');
  });

  it('is empty with no games', () => {
    expect(summaryLine(played(0, 10, 0))).toBe('');
  });
});
```

- [ ] **Step 2: Run them and watch them fail**

Run: `npx vitest run src/engine/highlights.test.ts`
Expected: the run fails because `./highlights` cannot be resolved.

- [ ] **Step 3: Write the code**

Create `src/engine/highlights.ts`:

```ts
import { formatDuration, plural, sessionStats, summarize } from './summary';
import type { Session } from './types';

/** Fewer games than this and a highlight says nothing, so none is shown. */
export const MIN_GAMES_FOR_HIGHLIGHTS = 3;
/** The summary shows at most this many lines. */
const MAX_LINES = 3;

export interface Highlight {
  key: 'unbeaten' | 'mostGames' | 'longest' | 'partners' | 'shortest';
  text: string;
}

/** "Ann", "Ann and Ben", "Ann, Ben and Cy", and "5 players" once a list would run long. */
function nameList(names: string[]): string {
  if (names.length > 3) return `${names.length} players`;
  if (names.length <= 1) return names.join('');
  return `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`;
}

/**
 * A few notable facts about a finished or running session, most interesting first. Win records only count when
 * `results` is true, because they can sting in a friendly group. A games or partners line that would name every
 * player is dropped: if everyone ties, nobody stands out.
 */
export function highlights(s: Session, options: { results?: boolean } = {}): Highlight[] {
  if (s.history.length < MIN_GAMES_FOR_HIGHLIGHTS) return [];
  const rows = summarize(s).filter((r) => r.gamesPlayed > 0);
  const lines: Highlight[] = [];

  /** The players with the top score, unless the score is empty or everyone shares it. */
  const leaders = (score: (r: (typeof rows)[number]) => number, atLeast: number) => {
    const best = Math.max(0, ...rows.map(score));
    if (best < atLeast) return undefined;
    const top = rows.filter((r) => score(r) === best);
    return top.length === rows.length ? undefined : { names: nameList(top.map((r) => r.name)), best };
  };

  if (options.results) {
    const unbeaten = rows.filter((r) => r.wins >= 2 && r.losses === 0);
    // Every recorded game gives one team a loss, so the unbeaten can never be the whole group.
    if (unbeaten.length > 0) {
      lines.push({ key: 'unbeaten', text: `Unbeaten: ${nameList(unbeaten.map((r) => r.name))}` });
    }
  }

  const most = leaders((r) => r.gamesPlayed, 1);
  if (most) lines.push({ key: 'mostGames', text: `Most games: ${most.names}, ${most.best}` });

  const lengths = s.history.map((g) => g.finishedAt - g.startedAt);
  const longest = Math.max(...lengths);
  const shortest = Math.min(...lengths);
  if (longest > shortest) lines.push({ key: 'longest', text: `Longest game: ${formatDuration(longest)}` });

  const mixers = leaders((r) => r.partners.length, 2);
  if (mixers) lines.push({ key: 'partners', text: `Most partners: ${mixers.names}, ${mixers.best} different` });

  if (longest > shortest) lines.push({ key: 'shortest', text: `Shortest game: ${formatDuration(shortest)}` });

  return lines.slice(0, MAX_LINES);
}

/** "1.5 hours", "40 minutes", "under a minute": time in the words a person would say. */
function spokenDuration(ms: number): string {
  const minutes = Math.round(ms / 60_000);
  if (minutes < 1) return 'under a minute';
  if (minutes < 60) return plural(minutes, 'minute');
  const hours = Math.round(minutes / 30) / 2;
  return `${hours} ${hours === 1 ? 'hour' : 'hours'}`;
}

/** "12 games, 3 hours, everyone got at least 3". Empty with no games. The last part is left out if someone sat out. */
export function summaryLine(s: Session): string {
  const stats = sessionStats(s);
  if (stats.games === 0) return '';
  const parts = [plural(stats.games, 'game'), spokenDuration(stats.playingMs)];
  if (stats.minGames >= 1) parts.push(`everyone got at least ${stats.minGames}`);
  return parts.join(', ');
}
```

In `src/engine/summary.ts`, replace:

```ts
function plural(n: number, word: string): string {
```

with:

```ts
export function plural(n: number, word: string): string {
```

In `src/engine/index.ts`, replace:

```ts
export { summarize, formatSummaryText,
```

with:

```ts
export { summarize, plural, formatSummaryText,
```

In `src/engine/index.ts`, replace:

```ts
export type { PlayerSummary,
```

with:

```ts
export { highlights, summaryLine, MIN_GAMES_FOR_HIGHLIGHTS } from './highlights';
export type { Highlight } from './highlights';
export type { PlayerSummary,
```

- [ ] **Step 4: Run them and watch them pass**

Run: `npx vitest run src/engine/highlights.test.ts && npx tsc --noEmit`
Expected: every test passes and `tsc` prints nothing.

- [ ] **Step 5: Commit**

```bash
git add src/engine/highlights.ts src/engine/highlights.test.ts src/engine/summary.ts src/engine/index.ts
git commit -m "Add session highlights and a plain-words summary line"
```


### Task 2: Show the line and the highlights on the summary screen

**Files:**
- Modify: `src/ui/SummaryScreen.tsx`
- Modify: `src/styles/app.css`
- Modify: `src/ui/summaryScreen.test.tsx`

- [ ] **Step 1: Write the failing tests**

In `src/ui/summaryScreen.test.tsx`, replace:

```tsx
describe('session summary screen', () => {
```

with:

```tsx
describe('summary highlights', () => {
  it('says the session in a plain line under the name', () => {
    render(<SummaryScreen session={finished(2)} />);
    expect(document.querySelector('.sum-line')!.textContent).toMatch(/^2 games, 24 minutes/);
  });

  it('shows a few highlight lines once there are three games', () => {
    render(<SummaryScreen session={finished(3)} />);
    const list = screen.getByRole('list', { name: 'Highlights' });
    const items = within(list).getAllByRole('listitem');
    expect(items.length).toBeGreaterThan(0);
    expect(items.length).toBeLessThanOrEqual(3);
  });

  it('shows none for fewer than three games', () => {
    render(<SummaryScreen session={finished(2)} />);
    expect(screen.queryByRole('list', { name: 'Highlights' })).not.toBeInTheDocument();
  });

  it('shows no line for a session with no games', () => {
    render(<SummaryScreen session={finished(0)} />);
    expect(document.querySelector('.sum-line')).toBeNull();
  });
});

describe('session summary screen', () => {
```

- [ ] **Step 2: Run them and watch them fail**

Run: `npx vitest run src/ui/summaryScreen.test.tsx`
Expected: the two `summary highlights` tests that look for the plain line and for the `Highlights` list fail, because neither exists yet. The two that expect nothing to show already pass.

- [ ] **Step 3: Write the code**

In `src/ui/SummaryScreen.tsx`, replace:

```tsx
  const fairness = engine.fairnessLine(stats);
```

with:

```tsx
  const fairness = engine.fairnessLine(stats);
  const line = engine.summaryLine(session);
  // This screen already shows every record, so the highlights may too. The shared text and picture follow the switch.
  const notable = engine.highlights(session, { results: true });
```

In `src/ui/SummaryScreen.tsx`, replace:

```tsx
          <p className="muted">{session.name}</p>
```

with:

```tsx
          <p className="muted">{session.name}</p>
          {line && <p className="sum-line">{line}</p>}
```

In `src/ui/SummaryScreen.tsx`, replace:

```tsx
      {fairness && <p className="sum-fairness">{fairness}</p>}
```

with:

```tsx
      {fairness && <p className="sum-fairness">{fairness}</p>}
      {notable.length > 0 && (
        <ul className="sum-highlights" aria-label="Highlights">
          {notable.map((h) => (
            <li key={h.key}>{h.text}</li>
          ))}
        </ul>
      )}
```

In `src/styles/app.css`, replace:

```css
.sum-fairness {
  margin: 0;
  font-weight: 600;
}
```

with:

```css
.sum-fairness {
  margin: 0;
  font-weight: 600;
}

.sum-line {
  margin: 4px 0 0;
  font-weight: 600;
}

.sum-highlights {
  list-style: none;
  margin: 0;
  padding: 0;
  display: grid;
  gap: 4px;
}

.sum-highlights li::before {
  content: '';
  display: inline-block;
  width: 8px;
  height: 8px;
  margin-right: 8px;
  border-radius: 50%;
  background: var(--accent);
  border: 1px solid var(--ink);
}
```

- [ ] **Step 4: Run them and watch them pass**

Run: `npx vitest run src/ui/summaryScreen.test.tsx && npx tsc --noEmit`
Expected: every test passes and `tsc` prints nothing.

- [ ] **Step 5: Commit**

```bash
git add src/ui/SummaryScreen.tsx src/styles/app.css src/ui/summaryScreen.test.tsx
git commit -m "Show highlights and a plain summary line on the summary screen"
```


### Task 3: The card's data model

**Files:**
- Create: `src/ui/cardModel.ts`
- Create: `src/ui/cardModel.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `src/ui/cardModel.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { finishGame } from '../engine/game';
import { makeCtx, mkPlayer, mkSession, newTestSession } from '../engine/testing';
import { MAX_CARD_PLAYERS, buildCardModel, gridColumns, paletteFor } from './cardModel';

function played() {
  const ctx = makeCtx(1, new Date(2026, 10, 4, 18).getTime());
  let s = newTestSession(['Ann', 'Ben', 'Cy', 'Dee', 'Eve'], { courts: 1 }, ctx);
  for (let i = 1; i <= 3; i++) s = finishGame(s, s.courts[0].id, { ...ctx, now: ctx.now + i * 20 * 60_000 });
  return { ...s, name: 'Wednesday open play', endedAt: ctx.now + 99 };
}

describe('buildCardModel', () => {
  it('carries the name, the day, the facts and the highlights', () => {
    const m = buildCardModel(played(), { results: false, theme: 'light' });
    expect(m.title).toBe('Wednesday open play');
    expect(m.date).toBe('Wed 4 Nov');
    expect(m.facts).toBe('3 games · 1h');
    expect(m.lines.length).toBeGreaterThan(0);
  });

  it('lists every player, most games first, with their games', () => {
    const s = played();
    const m = buildCardModel(s, { results: false, theme: 'light' });
    expect(m.players).toHaveLength(5);
    expect(m.players[0].games).toBeGreaterThanOrEqual(m.players[4].games);
    expect(m.more).toBe(0);
    expect(m.players.every((p) => p.record === undefined)).toBe(true);
  });

  it('keeps win records off unless results are switched on', () => {
    const s = played();
    const withWins = { ...s, history: s.history.map((g) => ({ ...g, winner: 1 as const })) };
    const off = buildCardModel(withWins, { results: false, theme: 'light' });
    expect(off.players.every((p) => p.record === undefined)).toBe(true);
    expect(off.lines.some((l) => l.startsWith('Unbeaten'))).toBe(false);
    const on = buildCardModel(withWins, { results: true, theme: 'light' });
    expect(on.players.some((p) => /^\d+W \d+L$/.test(p.record ?? ''))).toBe(true);
  });

  it('shows a player who did not play with 0 games, and carries the photo link', () => {
    const s = mkSession([mkPlayer('Ann', { name: 'Ann', rosterId: 'r1', gamesPlayed: 0 })]);
    const m = buildCardModel(s, { results: false, theme: 'light' });
    expect(m.players).toEqual([{ name: 'Ann', games: 0, rosterId: 'r1' }]);
  });

  it('caps the grid and counts the rest', () => {
    const many = mkSession(Array.from({ length: MAX_CARD_PLAYERS + 4 }, (_, i) => mkPlayer(`p${i}`, { name: `P${String(i).padStart(2, '0')}` })));
    const m = buildCardModel(many, { results: false, theme: 'light' });
    expect(m.players).toHaveLength(MAX_CARD_PLAYERS);
    expect(m.more).toBe(4);
  });
});

describe('gridColumns', () => {
  it('uses more columns as the group grows', () => {
    expect([1, 6, 7, 12, 13, 20, 21, 30].map(gridColumns)).toEqual([3, 3, 4, 4, 5, 5, 6, 6]);
  });
});

describe('paletteFor', () => {
  it('follows the theme and treats anything unknown as light', () => {
    expect(paletteFor('dark').bg).toBe('#0f0f0e');
    expect(paletteFor('light').bg).toBe('#fafaf7');
    expect(paletteFor(undefined).bg).toBe('#fafaf7');
    expect(paletteFor('sunlight').bg).toBe('#fafaf7');
  });
});
```

- [ ] **Step 2: Run them and watch them fail**

Run: `npx vitest run src/ui/cardModel.test.ts`
Expected: the run fails because `./cardModel` cannot be resolved.

- [ ] **Step 3: Write the code**

Create `src/ui/cardModel.ts`:

```ts
import * as engine from '../engine';
import type { Session } from '../engine';
import { shortDate } from '../store/attendance';

export const CARD_WIDTH = 1080;
export const CARD_HEIGHT = 1350;
/** More players than this would shrink the avatars past reading, so the rest are counted instead. */
export const MAX_CARD_PLAYERS = 30;

/** The app's own colours, copied from the style sheet so the picture matches the screen the organizer shared from. */
export interface Palette {
  bg: string;
  ink: string;
  muted: string;
  line: string;
  accent: string;
  accentInk: string;
}

const LIGHT: Palette = { bg: '#fafaf7', ink: '#111111', muted: '#66665f', line: '#e6e5df', accent: '#c8f03c', accentInk: '#111111' };
const DARK: Palette = { bg: '#0f0f0e', ink: '#f4f4ef', muted: '#a0a098', line: '#2c2c29', accent: '#c8f03c', accentInk: '#111111' };

/** Dark gets the dark palette; every other theme, including ones added later, gets the light one. */
export function paletteFor(theme: string | undefined): Palette {
  return theme === 'dark' ? DARK : LIGHT;
}

export interface CardPlayer {
  name: string;
  games: number;
  /** "4W 1L", only when results are switched on and the player has a recorded game. */
  record?: string;
  /** Where to find the photo on this device. */
  rosterId?: string;
}

export interface CardModel {
  title: string;
  date: string;
  facts: string;
  lines: string[];
  players: CardPlayer[];
  /** Players left off the grid because there were more than `MAX_CARD_PLAYERS`. */
  more: number;
  palette: Palette;
}

/** Everything the picture says, as plain data, so it can be tested without a canvas. */
export function buildCardModel(session: Session, options: { results: boolean; theme: string | undefined }): CardModel {
  const stats = engine.sessionStats(session);
  const rows = engine.summarize(session);
  const players = rows.slice(0, MAX_CARD_PLAYERS).map((r): CardPlayer => {
    const record = options.results && r.wins + r.losses > 0 ? `${r.wins}W ${r.losses}L` : undefined;
    return { name: r.name, games: r.gamesPlayed, ...(record ? { record } : {}), ...(r.rosterId ? { rosterId: r.rosterId } : {}) };
  });
  const facts = [engine.plural(stats.games, 'game')];
  if (stats.games > 0) facts.push(engine.formatDuration(stats.playingMs));
  return {
    title: session.name,
    date: shortDate(session.createdAt),
    facts: facts.join(' · '),
    lines: engine.highlights(session, { results: options.results }).map((h) => h.text),
    players,
    more: Math.max(0, rows.length - players.length),
    palette: paletteFor(options.theme),
  };
}

/** Columns for the avatar grid: few players get big avatars. */
export function gridColumns(count: number): number {
  if (count <= 6) return 3;
  if (count <= 12) return 4;
  if (count <= 20) return 5;
  return 6;
}
```

- [ ] **Step 4: Run them and watch them pass**

Run: `npx vitest run src/ui/cardModel.test.ts && npx tsc --noEmit`
Expected: every test passes and `tsc` prints nothing.

- [ ] **Step 5: Commit**

```bash
git add src/ui/cardModel.ts src/ui/cardModel.test.ts
git commit -m "Add the data model for the shareable result card"
```


### Task 4: Draw the card on a canvas

**Files:**
- Create: `src/ui/cardDraw.ts`
- Create: `src/ui/cardDraw.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `src/ui/cardDraw.test.ts`:

```ts
import { afterEach, describe, expect, it, vi } from 'vitest';
import { CARD_HEIGHT, CARD_WIDTH, paletteFor, type CardModel, type CardPlayer } from './cardModel';
import { drawCard, gridLayout, renderCardBlob, type DrawingContext } from './cardDraw';

interface Call {
  op: string;
  args: unknown[];
  fill?: unknown;
}

/** A canvas context that only writes down what it was asked to do. Text is 10 px wide per letter. */
function recorder() {
  const calls: Call[] = [];
  const state = { fillStyle: '' as unknown, strokeStyle: '', lineWidth: 1, font: '', textAlign: 'left', textBaseline: 'alphabetic' };
  const note =
    (op: string) =>
    (...args: unknown[]) => {
      calls.push({ op, args, fill: state.fillStyle });
    };
  const ctx = new Proxy(state, {
    get(target, key: string) {
      if (key === 'measureText') return (text: string) => ({ width: text.length * 10 });
      if (key in target) return target[key as keyof typeof target];
      return note(key);
    },
    set(target, key: string, value) {
      (target as Record<string, unknown>)[key] = value;
      return true;
    },
  }) as unknown as DrawingContext;
  return { ctx, calls };
}

const texts = (calls: Call[]) => calls.filter((c) => c.op === 'fillText').map((c) => c.args[0] as string);

function model(players: CardPlayer[], over: Partial<CardModel> = {}): CardModel {
  return {
    title: 'Wednesday open play',
    date: 'Wed 4 Nov',
    facts: '12 games · 3h 5m',
    lines: ['Most games: Ann, 6', 'Longest game: 25m'],
    players,
    more: 0,
    palette: paletteFor('light'),
    ...over,
  };
}

const ann: CardPlayer = { name: 'Ann Lee', games: 6 };
const ben: CardPlayer = { name: 'Ben', games: 5, record: '4W 1L', rosterId: 'r-ben' };

describe('drawCard', () => {
  it('paints the whole card in the theme colour, then writes the name, day, facts and highlights', () => {
    const { ctx, calls } = recorder();
    drawCard(ctx, model([ann, ben]), new Map());
    const first = calls.find((c) => c.op === 'fillRect')!;
    expect(first.args).toEqual([0, 0, CARD_WIDTH, CARD_HEIGHT]);
    expect(first.fill).toBe('#fafaf7');
    const written = texts(calls);
    expect(written).toContain('Wednesday open play');
    expect(written).toContain('Wed 4 Nov · 12 games · 3h 5m');
    expect(written).toContain('Most games: Ann, 6');
    expect(written).toContain('Longest game: 25m');
  });

  it('uses the dark colours for a dark card', () => {
    const { ctx, calls } = recorder();
    drawCard(ctx, model([ann], { palette: paletteFor('dark') }), new Map());
    expect(calls.find((c) => c.op === 'fillRect')!.fill).toBe('#0f0f0e');
  });

  it('writes each player with their games, and a record only when the model has one', () => {
    const { ctx, calls } = recorder();
    drawCard(ctx, model([ann, ben]), new Map());
    const written = texts(calls);
    expect(written).toContain('Ann Lee');
    expect(written).toContain('6');
    expect(written).toContain('Ben');
    expect(written).toContain('5 · 4W 1L');
    expect(written.filter((t) => t.includes('W '))).toEqual(['5 · 4W 1L']);
  });

  it('shows initials without a photo and the photo, cropped square from the middle, with one', () => {
    const { ctx, calls } = recorder();
    const photo = { width: 400, height: 200 } as ImageBitmap;
    drawCard(ctx, model([ann, ben]), new Map([['r-ben', photo]]));
    expect(texts(calls)).toContain('AL');
    expect(texts(calls)).not.toContain('BE');
    const draw = calls.filter((c) => c.op === 'drawImage');
    expect(draw).toHaveLength(1);
    expect(draw[0].args.slice(0, 5)).toEqual([photo, 100, 0, 200, 200]);
  });

  it('cuts a long name to fit its cell, and says how many more there were', () => {
    const { ctx, calls } = recorder();
    drawCard(ctx, model([{ name: 'Maximilian Featherstonehaugh-Cholmondeley', games: 2 }], { more: 4 }), new Map());
    const written = texts(calls);
    expect(written.some((t) => t.endsWith('…'))).toBe(true);
    expect(written).toContain('+4 more');
  });

  it('keeps every line of text inside the card, even with a full grid and no highlights', () => {
    const many = Array.from({ length: 30 }, (_, i): CardPlayer => ({ name: `Player ${i}`, games: i }));
    for (const lines of [[], ['a', 'b', 'c']]) {
      const { ctx, calls } = recorder();
      drawCard(ctx, model(many, { lines, more: 3 }), new Map());
      for (const c of calls.filter((x) => x.op === 'fillText')) {
        const [, x, y] = c.args as [string, number, number];
        expect(x).toBeGreaterThanOrEqual(0);
        expect(x).toBeLessThanOrEqual(CARD_WIDTH);
        expect(y).toBeGreaterThan(0);
        expect(y).toBeLessThan(CARD_HEIGHT);
      }
    }
  });
});

describe('gridLayout', () => {
  it('gives every cell room for the avatar, the name and the count, for any group size and number of highlights', () => {
    for (let count = 1; count <= 30; count++) {
      for (const lines of [0, 1, 2, 3]) {
        const top = 300 + lines * 60 + (lines ? 40 : 0) + 20;
        const g = gridLayout(count, top);
        expect(g.radius).toBeGreaterThan(20);
        expect(g.radius * 2 + g.small * 2 + 12).toBeLessThanOrEqual(g.cellH);
        expect(g.top + Math.ceil(count / g.cols) * g.cellH).toBeLessThanOrEqual(1240 + 0.001);
      }
    }
  });
});

describe('renderCardBlob', () => {
  afterEach(() => vi.restoreAllMocks());

  it('makes a 1080 by 1350 PNG', async () => {
    const { ctx, calls } = recorder();
    const sizes: number[][] = [];
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(function (this: HTMLCanvasElement) {
      sizes.push([this.width, this.height]);
      return ctx as unknown as CanvasRenderingContext2D;
    });
    const png = new Blob(['x'], { type: 'image/png' });
    const toBlob = vi.spyOn(HTMLCanvasElement.prototype, 'toBlob').mockImplementation((cb, type) => {
      expect(type).toBe('image/png');
      cb(png);
    });
    await expect(renderCardBlob(model([ann]), new Map())).resolves.toBe(png);
    expect(sizes).toEqual([[1080, 1350]]);
    expect(toBlob).toHaveBeenCalledTimes(1);
    expect(texts(calls)).toContain('Wednesday open play');
  });

  it('fails clearly when the browser has no canvas or cannot make the picture', async () => {
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null);
    await expect(renderCardBlob(model([ann]), new Map())).rejects.toThrow(/canvas/i);
    const { ctx } = recorder();
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(ctx as unknown as CanvasRenderingContext2D);
    vi.spyOn(HTMLCanvasElement.prototype, 'toBlob').mockImplementation((cb) => cb(null));
    await expect(renderCardBlob(model([ann]), new Map())).rejects.toThrow(/picture/i);
  });
});
```

- [ ] **Step 2: Run them and watch them fail**

Run: `npx vitest run src/ui/cardDraw.test.ts`
Expected: the run fails because `./cardDraw` cannot be resolved.

- [ ] **Step 3: Write the code**

Create `src/ui/cardDraw.ts`:

```ts
import { initials } from './Avatar';
import { CARD_HEIGHT, CARD_WIDTH, gridColumns, type CardModel, type Palette } from './cardModel';

/** The part of a canvas context the card uses. A stub with these members is enough for a test. */
export type DrawingContext = Pick<
  CanvasRenderingContext2D,
  | 'fillStyle'
  | 'strokeStyle'
  | 'lineWidth'
  | 'font'
  | 'textAlign'
  | 'textBaseline'
  | 'fillRect'
  | 'fillText'
  | 'beginPath'
  | 'arc'
  | 'fill'
  | 'stroke'
  | 'save'
  | 'restore'
  | 'clip'
  | 'drawImage'
  | 'measureText'
>;

/** Photos already decoded, by saved-player id. A player without one is drawn with initials. */
export type CardPhotos = Map<string, ImageBitmap>;

const FONT = "Inter, system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif";
const MARGIN = 72;
const CONTENT_WIDTH = CARD_WIDTH - MARGIN * 2;
const FOOTER_TOP = CARD_HEIGHT - 110;

/** The text, cut with an ellipsis if it is wider than `maxWidth` at the current font. */
function fit(ctx: DrawingContext, text: string, maxWidth: number): string {
  if (ctx.measureText(text).width <= maxWidth) return text;
  let cut = text;
  while (cut.length > 1 && ctx.measureText(`${cut}…`).width > maxWidth) cut = cut.slice(0, -1);
  return `${cut.trimEnd()}…`;
}

function write(ctx: DrawingContext, text: string, x: number, y: number, size: number, weight: number, color: string, align: CanvasTextAlign = 'left') {
  ctx.font = `${weight} ${size}px ${FONT}`;
  ctx.fillStyle = color;
  ctx.textAlign = align;
  ctx.textBaseline = 'alphabetic';
  ctx.fillText(text, x, y);
}

/** The title shrinks a little before it is cut, so most names stay whole. */
function drawTitle(ctx: DrawingContext, title: string, palette: Palette, y: number) {
  let size = 72;
  ctx.font = `800 ${size}px ${FONT}`;
  while (size > 44 && ctx.measureText(title).width > CONTENT_WIDTH) {
    size -= 4;
    ctx.font = `800 ${size}px ${FONT}`;
  }
  write(ctx, fit(ctx, title, CONTENT_WIDTH), MARGIN, y, size, 800, palette.ink);
}

function drawAvatar(ctx: DrawingContext, cx: number, cy: number, r: number, name: string, photo: ImageBitmap | undefined, palette: Palette) {
  ctx.save();
  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, Math.PI * 2);
  ctx.clip();
  if (photo) {
    const side = Math.min(photo.width, photo.height);
    ctx.drawImage(photo, (photo.width - side) / 2, (photo.height - side) / 2, side, side, cx - r, cy - r, r * 2, r * 2);
  } else {
    ctx.fillStyle = palette.accent;
    ctx.fillRect(cx - r, cy - r, r * 2, r * 2);
  }
  ctx.restore();
  if (!photo) write(ctx, initials(name), cx, cy + r * 0.22, Math.round(r * 0.7), 800, palette.accentInk, 'center');
  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, Math.PI * 2);
  ctx.strokeStyle = palette.ink;
  ctx.lineWidth = 3;
  ctx.stroke();
}

export interface GridLayout {
  cols: number;
  top: number;
  cellW: number;
  cellH: number;
  /** Avatar radius. */
  radius: number;
  /** Font size for the name and the games under each avatar. */
  small: number;
}

/** Room for the avatar, the name and the count in every cell, so rows never touch. */
export function gridLayout(count: number, top: number): GridLayout {
  const cols = gridColumns(count);
  const rows = Math.max(1, Math.ceil(count / cols));
  const cellW = CONTENT_WIDTH / cols;
  const cellH = Math.min(cellW * 1.6, (FOOTER_TOP - top) / rows);
  const small = Math.max(20, Math.round(Math.min(cellW, cellH) * 0.17));
  const radius = Math.min(cellW * 0.34, (cellH - small * 2 - 24) / 2);
  return { cols, top, cellW, cellH, radius, small };
}

/** Draws the whole card. Pure drawing: no network, no storage, nothing global. */
export function drawCard(ctx: DrawingContext, model: CardModel, photos: CardPhotos): void {
  const { palette } = model;
  ctx.fillStyle = palette.bg;
  ctx.fillRect(0, 0, CARD_WIDTH, CARD_HEIGHT);
  ctx.fillStyle = palette.accent;
  ctx.fillRect(0, 0, CARD_WIDTH, 28);

  drawTitle(ctx, model.title, palette, 170);
  write(ctx, `${model.date} · ${model.facts}`, MARGIN, 236, 38, 500, palette.muted);

  let top = 300;
  for (const line of model.lines) {
    top += 60;
    ctx.beginPath();
    ctx.arc(MARGIN + 12, top - 14, 11, 0, Math.PI * 2);
    ctx.fillStyle = palette.accent;
    ctx.fill();
    ctx.strokeStyle = palette.ink;
    ctx.lineWidth = 3;
    ctx.stroke();
    ctx.font = `600 40px ${FONT}`;
    write(ctx, fit(ctx, line, CONTENT_WIDTH - 44), MARGIN + 44, top, 40, 600, palette.ink);
  }
  if (model.lines.length > 0) top += 40;

  const grid = gridLayout(model.players.length, top + 20);
  const { cols, cellW, cellH, radius, small } = grid;
  const gridTop = grid.top;
  model.players.forEach((p, i) => {
    const cx = MARGIN + (i % cols) * cellW + cellW / 2;
    const cellTop = gridTop + Math.floor(i / cols) * cellH;
    drawAvatar(ctx, cx, cellTop + radius, radius, p.name, p.rosterId ? photos.get(p.rosterId) : undefined, palette);
    ctx.font = `600 ${small}px ${FONT}`;
    write(ctx, fit(ctx, p.name, cellW - 12), cx, cellTop + radius * 2 + small + 8, small, 600, palette.ink, 'center');
    const count = p.record ? `${p.games} · ${p.record}` : `${p.games}`;
    write(ctx, count, cx, cellTop + radius * 2 + small * 2 + 12, small, 800, palette.muted, 'center');
  });

  if (model.more > 0) write(ctx, `+${model.more} more`, MARGIN, CARD_HEIGHT - 52, 32, 600, palette.muted);
  write(ctx, 'PIKLMatch', CARD_WIDTH - MARGIN, CARD_HEIGHT - 52, 32, 800, palette.muted, 'right');
}

/** A 1080 by 1350 PNG of the card. Rejects when the browser has no canvas or cannot encode the picture. */
export function renderCardBlob(model: CardModel, photos: CardPhotos): Promise<Blob> {
  const canvas = document.createElement('canvas');
  canvas.width = CARD_WIDTH;
  canvas.height = CARD_HEIGHT;
  const ctx = canvas.getContext('2d');
  if (!ctx) return Promise.reject(new Error('This browser has no canvas to draw on.'));
  drawCard(ctx, model, photos);
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error('The browser could not make the picture.'))), 'image/png');
  });
}
```

- [ ] **Step 4: Run them and watch them pass**

Run: `npx vitest run src/ui/cardDraw.test.ts && npx tsc --noEmit`
Expected: every test passes and `tsc` prints nothing.

- [ ] **Step 5: Commit**

```bash
git add src/ui/cardDraw.ts src/ui/cardDraw.test.ts
git commit -m "Draw the shareable result card on a canvas"
```


### Task 5: Load saved photos for the card

**Files:**
- Create: `src/ui/cardPhotos.ts`
- Create: `src/ui/cardPhotos.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `src/ui/cardPhotos.test.ts`:

```ts
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { addRosterPlayer, resetRosterDbForTests, setRosterPhoto } from '../store/rosterDb';
import { loadCardPhotos } from './cardPhotos';

beforeEach(async () => {
  await resetRosterDbForTests();
});
afterEach(() => vi.unstubAllGlobals());

async function withPhoto(name: string) {
  const p = await addRosterPlayer(name);
  await setRosterPhoto(p.id, { type: 'image/jpeg', data: new Uint8Array([1, 2, 3]).buffer });
  return p.id;
}

describe('loadCardPhotos', () => {
  it('decodes the photos players have, and skips the rest', async () => {
    const ann = await withPhoto('Ann');
    const ben = (await addRosterPlayer('Ben')).id;
    const bitmap = { width: 10, height: 10 } as ImageBitmap;
    const decode = vi.fn().mockResolvedValue(bitmap);
    vi.stubGlobal('createImageBitmap', decode);
    const photos = await loadCardPhotos([ann, ben, 'gone']);
    expect([...photos.keys()]).toEqual([ann]);
    expect(photos.get(ann)).toBe(bitmap);
    expect(decode).toHaveBeenCalledTimes(1);
    expect(decode.mock.calls[0][0]).toBeInstanceOf(Blob);
    expect((decode.mock.calls[0][0] as Blob).type).toBe('image/jpeg');
  });

  it('reads each player once, however many times they are listed', async () => {
    const ann = await withPhoto('Ann');
    const decode = vi.fn().mockResolvedValue({ width: 1, height: 1 });
    vi.stubGlobal('createImageBitmap', decode);
    await loadCardPhotos([ann, ann]);
    expect(decode).toHaveBeenCalledTimes(1);
  });

  it('leaves out a photo that cannot be decoded, so that player shows initials', async () => {
    const ann = await withPhoto('Ann');
    const ben = await withPhoto('Ben');
    vi.stubGlobal('createImageBitmap', vi.fn().mockRejectedValueOnce(new Error('bad image')).mockResolvedValue({ width: 1, height: 1 }));
    const photos = await loadCardPhotos([ann, ben]);
    expect(photos.size).toBe(1);
  });

  it('gives no photos in a browser that cannot decode them', async () => {
    const ann = await withPhoto('Ann');
    vi.stubGlobal('createImageBitmap', undefined);
    expect((await loadCardPhotos([ann])).size).toBe(0);
  });
});
```

- [ ] **Step 2: Run them and watch them fail**

Run: `npx vitest run src/ui/cardPhotos.test.ts`
Expected: the run fails because `./cardPhotos` cannot be resolved.

- [ ] **Step 3: Write the code**

Create `src/ui/cardPhotos.ts`:

```ts
import { getRosterPhoto } from '../store/rosterDb';
import type { CardPhotos } from './cardDraw';

/**
 * The saved photos for these players, decoded for the canvas. A player with no photo, or a photo this browser cannot
 * decode, is simply missing from the result, and the card draws their initials instead.
 */
export async function loadCardPhotos(rosterIds: string[]): Promise<CardPhotos> {
  const photos: CardPhotos = new Map();
  if (typeof createImageBitmap !== 'function') return photos;
  await Promise.all(
    [...new Set(rosterIds)].map(async (id) => {
      try {
        const photo = await getRosterPhoto(id);
        if (photo) photos.set(id, await createImageBitmap(new Blob([photo.data], { type: photo.type })));
      } catch {
        /* initials it is */
      }
    }),
  );
  return photos;
}
```

- [ ] **Step 4: Run them and watch them pass**

Run: `npx vitest run src/ui/cardPhotos.test.ts && npx tsc --noEmit`
Expected: every test passes and `tsc` prints nothing.

- [ ] **Step 5: Commit**

```bash
git add src/ui/cardPhotos.ts src/ui/cardPhotos.test.ts
git commit -m "Load saved photos for the result card"
```


### Task 6: Share the picture as a file, or download it

**Files:**
- Create: `src/ui/cardShare.ts`
- Create: `src/ui/cardShare.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `src/ui/cardShare.test.ts`:

```ts
import { afterEach, describe, expect, it, vi } from 'vitest';
import { deliverPicture, pictureFileName } from './cardShare';

const png = new Blob(['x'], { type: 'image/png' });

function stubNavigator(extra: Record<string, unknown>) {
  vi.stubGlobal('navigator', Object.assign(Object.create(navigator), extra));
}

/** Catches the download link the page clicks. */
function watchDownloads() {
  const clicked: { download: string; href: string }[] = [];
  vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (this: HTMLAnchorElement) {
    clicked.push({ download: this.download, href: this.href });
  });
  return clicked;
}

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('pictureFileName', () => {
  it('turns the session name into a safe file name', () => {
    expect(pictureFileName('Wednesday open play')).toBe('wednesday-open-play.png');
    expect(pictureFileName('  PIKL — Sat 7 Nov!! ')).toBe('pikl-sat-7-nov.png');
    expect(pictureFileName('???')).toBe('session.png');
  });
});

describe('deliverPicture', () => {
  it('shares the picture as a file when the browser can', async () => {
    const share = vi.fn().mockResolvedValue(undefined);
    const canShare = vi.fn().mockReturnValue(true);
    stubNavigator({ share, canShare });
    const clicked = watchDownloads();
    await expect(deliverPicture(png, 'Open play')).resolves.toBe('shared');
    const data = share.mock.calls[0][0] as { files: File[]; title: string };
    expect(data.files).toHaveLength(1);
    expect(data.files[0].name).toBe('open-play.png');
    expect(data.files[0].type).toBe('image/png');
    expect(data.title).toBe('Open play');
    expect(canShare).toHaveBeenCalledWith({ files: data.files });
    expect(clicked).toEqual([]);
  });

  it('treats closing the share sheet as a cancel, not a failure, and saves nothing', async () => {
    stubNavigator({ share: vi.fn().mockRejectedValue(new DOMException('closed', 'AbortError')), canShare: () => true });
    const clicked = watchDownloads();
    await expect(deliverPicture(png, 'Open play')).resolves.toBe('cancelled');
    expect(clicked).toEqual([]);
  });

  it('downloads the picture where files cannot be shared', async () => {
    stubNavigator({ share: vi.fn(), canShare: () => false });
    const clicked = watchDownloads();
    await expect(deliverPicture(png, 'Open play')).resolves.toBe('saved');
    expect(clicked).toHaveLength(1);
    expect(clicked[0].download).toBe('open-play.png');
    expect(clicked[0].href).toMatch(/^blob:/);
  });

  it('downloads it when the browser has no share at all', async () => {
    stubNavigator({ share: undefined, canShare: undefined });
    const clicked = watchDownloads();
    await expect(deliverPicture(png, 'Open play')).resolves.toBe('saved');
    expect(clicked).toHaveLength(1);
  });

  it('downloads it when sharing fails for any other reason', async () => {
    stubNavigator({ share: vi.fn().mockRejectedValue(new Error('NotAllowedError')), canShare: () => true });
    const clicked = watchDownloads();
    await expect(deliverPicture(png, 'Open play')).resolves.toBe('saved');
    expect(clicked).toHaveLength(1);
  });
});
```

- [ ] **Step 2: Run them and watch them fail**

Run: `npx vitest run src/ui/cardShare.test.ts`
Expected: the run fails because `./cardShare` cannot be resolved.

- [ ] **Step 3: Write the code**

Create `src/ui/cardShare.ts`:

```ts
/** "shared" went through the share sheet, "saved" was downloaded, "cancelled" means the organizer closed the sheet. */
export type PictureOutcome = 'shared' | 'saved' | 'cancelled';

/** "wednesday-open-play.png": letters and digits only, so every phone and computer accepts it. */
export function pictureFileName(sessionName: string): string {
  const slug = sessionName
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return `${slug || 'session'}.png`;
}

function download(blob: Blob, fileName: string): void {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = fileName;
  link.click();
  // Give the browser a moment to start the download before the link is released.
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/** Hands the picture to the share sheet as a file, or downloads it where files cannot be shared. */
export async function deliverPicture(blob: Blob, sessionName: string): Promise<PictureOutcome> {
  const fileName = pictureFileName(sessionName);
  const file = new File([blob], fileName, { type: 'image/png' });
  const data = { files: [file] };
  if (typeof navigator.share === 'function' && typeof navigator.canShare === 'function' && navigator.canShare(data)) {
    try {
      await navigator.share({ ...data, title: sessionName });
      return 'shared';
    } catch (e) {
      // Closing the share sheet is not an error, and it must not also drop a download on the phone.
      if (e instanceof DOMException && e.name === 'AbortError') return 'cancelled';
    }
  }
  download(blob, fileName);
  return 'saved';
}
```

- [ ] **Step 4: Run them and watch them pass**

Run: `npx vitest run src/ui/cardShare.test.ts && npx tsc --noEmit`
Expected: every test passes and `tsc` prints nothing.

- [ ] **Step 5: Commit**

```bash
git add src/ui/cardShare.ts src/ui/cardShare.test.ts
git commit -m "Share the result card as a file, or download it"
```


### Task 7: The Share as picture button

**Files:**
- Modify: `src/ui/SummaryScreen.tsx`
- Modify: `src/ui/summaryScreen.test.tsx` (the switch label changes)
- Create: `src/ui/summaryPicture.test.tsx`

- [ ] **Step 1: Write the failing tests**

Create `src/ui/summaryPicture.test.tsx`:

```tsx
import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { finishGame } from '../engine/game';
import { makeCtx, newTestSession } from '../engine/testing';
import { resetHistoryDbForTests } from '../store/historyDb';
import { useHistoryStore } from '../store/historyStore';
import { resetRosterDbForTests } from '../store/rosterDb';
import type { CardModel } from './cardModel';
import { SummaryScreen } from './SummaryScreen';

const draw = vi.hoisted(() => ({ renderCardBlob: vi.fn() }));
// The canvas itself is tested in cardDraw.test.ts; here only what the screen hands it and does with the result.
vi.mock('./cardDraw', async (original) => ({ ...(await original<typeof import('./cardDraw')>()), renderCardBlob: draw.renderCardBlob }));

const png = new Blob(['x'], { type: 'image/png' });

beforeEach(async () => {
  localStorage.clear();
  await resetRosterDbForTests();
  await resetHistoryDbForTests();
  useHistoryStore.setState({ ...useHistoryStore.getInitialState(), entries: [], loaded: false });
  draw.renderCardBlob.mockReset().mockResolvedValue(png);
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

function finished(winners = false) {
  const ctx = makeCtx(1, 1_000_000);
  let s = newTestSession(['Ann', 'Ben', 'Cy', 'Dee', 'Eve'], { courts: 1 }, ctx);
  for (let i = 1; i <= 3; i++) s = finishGame(s, s.courts[0].id, { ...ctx, now: ctx.now + i * 12 * 60_000 }, winners ? { winner: 1 } : undefined);
  return { ...s, name: 'Open play', endedAt: ctx.now + 99 };
}

function canShareFiles() {
  const share = vi.fn().mockResolvedValue(undefined);
  vi.stubGlobal('navigator', Object.assign(Object.create(navigator), { share, canShare: () => true }));
  return share;
}

const button = () => screen.getByRole('button', { name: /share as picture|making picture/i });

describe('Share as picture', () => {
  it('sits next to Share results and hands the picture to the share sheet as a file', async () => {
    const share = canShareFiles();
    const user = userEvent.setup();
    render(<SummaryScreen session={finished()} />);
    expect(screen.getByRole('button', { name: /share results|copy results/i })).toBeInTheDocument();
    await user.click(button());
    await waitFor(() => expect(share).toHaveBeenCalledTimes(1));
    const data = share.mock.calls[0][0] as { files: File[] };
    expect(data.files[0].name).toBe('open-play.png');
    const model = draw.renderCardBlob.mock.calls[0][0] as CardModel;
    expect(model.title).toBe('Open play');
    expect(model.players).toHaveLength(5);
  });

  it('keeps win records off the picture until the results switch is turned on', async () => {
    canShareFiles();
    const user = userEvent.setup();
    render(<SummaryScreen session={finished(true)} />);
    await user.click(button());
    await waitFor(() => expect(draw.renderCardBlob).toHaveBeenCalledTimes(1));
    expect((draw.renderCardBlob.mock.calls[0][0] as CardModel).players.every((p) => p.record === undefined)).toBe(true);

    await user.click(screen.getByRole('switch', { name: 'Include results when sharing' }));
    await user.click(button());
    await waitFor(() => expect(draw.renderCardBlob).toHaveBeenCalledTimes(2));
    expect((draw.renderCardBlob.mock.calls[1][0] as CardModel).players.some((p) => p.record !== undefined)).toBe(true);
  });

  it('uses the dark colours when the page is dark', async () => {
    canShareFiles();
    document.documentElement.dataset.theme = 'dark';
    try {
      const user = userEvent.setup();
      render(<SummaryScreen session={finished()} />);
      await user.click(button());
      await waitFor(() => expect(draw.renderCardBlob).toHaveBeenCalled());
      expect((draw.renderCardBlob.mock.calls[0][0] as CardModel).palette.bg).toBe('#0f0f0e');
    } finally {
      delete document.documentElement.dataset.theme;
    }
  });

  it('downloads the picture where files cannot be shared, and says so', async () => {
    const clicks = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => undefined);
    const user = userEvent.setup();
    render(<SummaryScreen session={finished()} />);
    await user.click(button());
    expect(await screen.findByText('Picture saved to this device.')).toBeInTheDocument();
    expect(clicks).toHaveBeenCalledTimes(1);
  });

  it('counts a shared picture as shared, so Start new session does not warn', async () => {
    canShareFiles();
    // Not kept in Past sessions, so only having shared can switch the warning off.
    useHistoryStore.setState({ save: vi.fn().mockResolvedValue(undefined) });
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false);
    const user = userEvent.setup();
    render(<SummaryScreen session={finished()} />);
    await user.click(screen.getByRole('button', { name: 'Start new session' }));
    expect(confirm).toHaveBeenCalledTimes(1);
    await user.click(button());
    await waitFor(() => expect(draw.renderCardBlob).toHaveBeenCalled());
    await waitFor(() => expect(button()).toBeEnabled());
    await user.click(screen.getByRole('button', { name: 'Start new session' }));
    expect(confirm).toHaveBeenCalledTimes(1);
  });

  it('leaves the session unshared when the share sheet is closed', async () => {
    vi.stubGlobal(
      'navigator',
      Object.assign(Object.create(navigator), { share: vi.fn().mockRejectedValue(new DOMException('closed', 'AbortError')), canShare: () => true }),
    );
    useHistoryStore.setState({ save: vi.fn().mockResolvedValue(undefined) });
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false);
    const user = userEvent.setup();
    render(<SummaryScreen session={finished()} />);
    await user.click(button());
    await waitFor(() => expect(button()).toBeEnabled());
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Start new session' }));
    expect(confirm).toHaveBeenCalledTimes(1);
  });

  it('says so, and stays usable, when the picture cannot be made', async () => {
    draw.renderCardBlob.mockRejectedValue(new Error('no canvas'));
    const user = userEvent.setup();
    render(<SummaryScreen session={finished()} />);
    await user.click(button());
    expect(await screen.findByText('Could not make the picture.')).toBeInTheDocument();
    expect(button()).toBeEnabled();
  });

  it('shows it is working and ignores a second tap meanwhile', async () => {
    let finish: (b: Blob) => void = () => undefined;
    draw.renderCardBlob.mockReturnValue(new Promise<Blob>((resolve) => (finish = resolve)));
    canShareFiles();
    const user = userEvent.setup();
    render(<SummaryScreen session={finished()} />);
    await user.click(button());
    expect(button()).toBeDisabled();
    expect(button()).toHaveTextContent('Making picture…');
    await act(async () => finish(png));
    await waitFor(() => expect(button()).toBeEnabled());
    expect(draw.renderCardBlob).toHaveBeenCalledTimes(1);
  });

  it('works on a past session opened read-only', async () => {
    canShareFiles();
    const user = userEvent.setup();
    render(<SummaryScreen session={finished()} onBack={() => undefined} />);
    await user.click(button());
    await waitFor(() => expect(draw.renderCardBlob).toHaveBeenCalledTimes(1));
  });
});
```

- [ ] **Step 2: Run them and watch them fail**

Run: `npx vitest run src/ui/summaryPicture.test.tsx src/ui/summaryScreen.test.tsx`
Expected: the picture tests fail because there is no Share as picture button, and the two switch tests in `summaryScreen.test.tsx` still look for the old label until Step 3 renames it.

- [ ] **Step 3: Write the code**

In `src/ui/SummaryScreen.tsx`, replace:

```tsx
import { PlayerAvatar } from './PlayerAvatar';
```

with:

```tsx
import { PlayerAvatar } from './PlayerAvatar';
import { renderCardBlob } from './cardDraw';
import { buildCardModel } from './cardModel';
import { loadCardPhotos } from './cardPhotos';
import { deliverPicture } from './cardShare';
```

In `src/ui/SummaryScreen.tsx`, replace:

```tsx
  const [shared, setShared] = useState(false);
```

with:

```tsx
  const [shared, setShared] = useState(false);
  const [making, setMaking] = useState(false);
```

In `src/ui/SummaryScreen.tsx`, replace:

```tsx
  function startNew() {
```

with:

```tsx
  async function sharePicture() {
    setMaking(true);
    setMessage('');
    try {
      const model = buildCardModel(session, { results: withResults, theme: document.documentElement.dataset.theme });
      const photos = await loadCardPhotos(model.players.flatMap((p) => (p.rosterId ? [p.rosterId] : [])));
      const outcome = await deliverPicture(await renderCardBlob(model, photos), session.name);
      if (outcome !== 'cancelled') setShared(true);
      if (outcome === 'saved') setMessage('Picture saved to this device.');
    } catch {
      setMessage('Could not make the picture.');
    } finally {
      setMaking(false);
    }
  }

  function startNew() {
```

In `src/ui/SummaryScreen.tsx`, replace:

```tsx
<span>Include results in the shared text</span>
```

with:

```tsx
<span>Include results when sharing</span>
```

In `src/ui/SummaryScreen.tsx`, replace:

```tsx
          {canShare ? 'Share results' : 'Copy results'}
        </button>
```

with:

```tsx
          {canShare ? 'Share results' : 'Copy results'}
        </button>
        <button type="button" className="btn btn-block" disabled={making} onClick={() => void sharePicture()}>
          {making ? 'Making picture…' : 'Share as picture'}
        </button>
```

In `src/ui/summaryScreen.test.tsx`, replace (every occurrence):

```tsx
Include results in the shared text
```

with:

```tsx
Include results when sharing
```

- [ ] **Step 4: Run them and watch them pass**

Run: `npx vitest run src/ui/summaryPicture.test.tsx src/ui/summaryScreen.test.tsx && npx tsc --noEmit`
Expected: every test passes and `tsc` prints nothing.

The `renderCardBlob` mock in this test file is the only place the canvas is skipped. `cardDraw.test.ts` covers the real drawing.

- [ ] **Step 5: Commit**

```bash
git add src/ui/SummaryScreen.tsx src/ui/summaryScreen.test.tsx src/ui/summaryPicture.test.tsx
git commit -m "Add Share as picture to the summary"
```


### Task 8: Check everything, then look at it

**Files:**
- No new files. Spec update at the end.

- [ ] **Step 1: Run the whole project**

```bash
npx vitest run
npx tsc --noEmit
npm run build
```

Expected: 905 tests pass across 93 files, `tsc` prints nothing, the build finishes and writes `dist/sw.js`. The count is what this plan produced; a different count means something was skipped or added.

- [ ] **Step 2: Mutation check**

For each row, make the change by hand, run the named test file, and expect it to fail. Then undo the change. A row that does not fail means a test is missing; add it before going on.

| File | Change | Test file that must fail |
|---|---|---|
| `src/engine/highlights.ts` | `MIN_GAMES_FOR_HIGHLIGHTS = 3` to `2` | `highlights.test.ts` |
| `src/engine/highlights.ts` | drop the "everyone ties" check (`top.length === rows.length ? undefined :`) | `highlights.test.ts` |
| `src/engine/highlights.ts` | `if (options.results) {` to `if (true) {` | `highlights.test.ts` |
| `src/engine/highlights.ts` | unbeaten needs `wins >= 1` instead of `>= 2` | `highlights.test.ts` |
| `src/engine/highlights.ts` | drop the `minGames >= 1` guard in `summaryLine` | `highlights.test.ts` |
| `src/engine/highlights.ts` | always add the shortest game, even when it equals the longest | `highlights.test.ts` |
| `src/ui/cardModel.ts` | show records without checking `options.results` | `cardModel.test.ts` |
| `src/ui/cardModel.ts` | swap the dark and light palettes | `cardModel.test.ts` |
| `src/ui/cardModel.ts` | `count <= 12` returns 5 columns instead of 4 | `cardModel.test.ts` |
| `src/ui/cardDraw.ts` | crop the photo from the corner instead of the middle | `cardDraw.test.ts` |
| `src/ui/cardDraw.ts` | never write the `+N more` line | `cardDraw.test.ts` |
| `src/ui/cardDraw.ts` | canvas width 540 instead of `CARD_WIDTH` | `cardDraw.test.ts` |
| `src/ui/cardDraw.ts` | `(cellH - small * 2 - 24) / 2` to `+ 24` | `cardDraw.test.ts` |
| `src/ui/cardShare.ts` | remove the `AbortError` check | `cardShare.test.ts` |
| `src/ui/cardShare.ts` | skip the `navigator.canShare(data)` check | `cardShare.test.ts` |
| `src/ui/cardPhotos.ts` | read each id without removing duplicates | `cardPhotos.test.ts` |
| `src/ui/SummaryScreen.tsx` | mark shared even when the sheet was cancelled | `summaryPicture.test.tsx` |
| `src/ui/SummaryScreen.tsx` | pass `results: true` to the card whatever the switch says | `summaryPicture.test.tsx` |
| `src/ui/SummaryScreen.tsx` | remove the summary line | `summaryScreen.test.tsx` |

All 19 were run once when this plan was written and each made its test file fail. Two more were tried and left out because they showed dead code, which was then removed: a check that the unbeaten are never the whole group (every recorded game gives one team a loss, so it cannot happen) and a second `if (making) return` guard (the button is already disabled while the picture is made).

- [ ] **Step 3: Look at it in a browser at 360 px wide**

Start `npx vite --port 5199 --strictPort`, open `http://localhost:5199/`, set the viewport to 360 by 740. Put a finished session on screen from the page console, then check the three things below. The console snippet imports `/src/engine/index.ts` and `/src/store/sessionStore.ts`, builds a session with `createSession` and `finishGame` for nine games, and calls `useSessionStore.setState({ session: { ...s, endedAt } })`.

1. The summary shows the plain line under the session name, up to three highlight lines under the stat tiles, and three buttons at the bottom (Copy or Share results, Share as picture, Start new session).
2. Render the card on a real canvas with 12 players, then with 30 players in the dark theme. The title is cut with an ellipsis when long, names are cut to fit their cell, rows do not touch, and `+N more` shows past 30 players.
3. `renderCardBlob` returns a PNG of 1080 by 1350 pixels, and `deliverPicture` downloads a file named after the session where the browser cannot share files.

Reset the viewport to desktop and stop the server when done.

- [ ] **Step 4: Push and merge only when Clyde says so**

The spec already records these decisions (section "Decisions for 4a"), committed with this plan. Push and merge only when Clyde says "push and merge". Production is the branch `claude/pickleball-matchmaking-app-i4baca`, updated by fast-forward. If it has moved, rebase `phase4a` onto it and run Step 1 again before pushing.

- [ ] **Step 5: Phone check (Clyde's, on a real phone)**

On the live site after the merge, finish a session with at least three games, then:

1. Tap Share as picture. The share sheet opens with a PNG attached. Send it to yourself.
2. Open it in the chat app. The title, the highlights and the player names are readable at chat size.
3. With a saved player who has a photo, the photo shows on the card and everyone else shows initials.
4. Open a session from Past sessions and share its picture too.

- [ ] **Step 6: After the merge, remove the worktree**

```bash
git -C /Users/clydealegro/Vibe/pickleball-match-app/pickleball-match-app worktree remove /Users/clydealegro/Vibe/pickleball-match-app/pickleball-match-app-phase4a
git -C /Users/clydealegro/Vibe/pickleball-match-app/pickleball-match-app worktree prune
```

Use `--force` only after diffing the tree against `origin/main`'s production branch and finding every change already landed.


---

## Self-review

- **Spec coverage.** 4.1 highlights: Task 1 and 2 (ties, under three games, unbeaten with results, all tested). 4.2 card: Tasks 3 to 7 (1080 by 1350 PNG, name, date, games and time, highlights, avatar grid with photos or initials, light and dark, Share as picture next to Share results, Web Share with a file, download fallback, no network, win records only with the switch on; the text share is unchanged). 4.6 summary line: Tasks 1 and 2. Acceptance: highlights tested with fixed sessions including ties and under three games; the card tested for dimensions and the text drawn through a canvas stub (Tasks 4 and 8). Left for 4b and 4c on purpose: board view, game-length reminder, Sunlight theme, haptics.
- **Placeholders.** None. Every step has its code or its command.
- **Names.** `highlights`, `summaryLine`, `plural`, `buildCardModel`, `gridColumns`, `paletteFor`, `drawCard`, `gridLayout`, `renderCardBlob`, `loadCardPhotos`, `deliverPicture`, `pictureFileName` are spelled the same in every task that uses them.

## Risks to watch

- The summary's bottom bar now holds three buttons and takes about 170 px of a 740 px screen. If the list feels cramped on a small phone, make Share as picture a smaller button beside Share results.
- Photos on the card are the sharpest edge: `createImageBitmap` of a stored JPEG is only tested with a stub. The phone check covers it.
- The card draws in the `Inter` font stack the app uses and falls back to the system font, so its type can differ slightly between phones.

## Execution handoff

Plan complete. Two ways to run it:

1. **Subagent-driven (recommended).** A fresh subagent per task with a review between tasks.
2. **Inline.** Run the tasks in this session with checkpoints.
